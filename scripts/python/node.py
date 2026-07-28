import asyncio
import websockets
import json
import sys
import os
import logging
import urllib.request
import urllib.error
from datetime import datetime, timezone
import traceback

# Suppress spurious "did not receive a valid HTTP request" errors from
# connections that open the TCP socket but close before completing the
# WebSocket handshake (health checks, port probes, etc.).
logging.getLogger("websockets.server").setLevel(logging.CRITICAL)

IRC_HOST = "127.0.0.1"
IRC_PORT = 12346
PROTOCOL = "fr-dispatch"
VERSION = "1.0.0"

def load_config():
    base = os.path.dirname(sys.executable if getattr(sys, 'frozen', False) else os.path.abspath(__file__))
    for path in [os.path.join(base, 'bridge-config.json'), os.path.join(base, '..', 'bridge-config.json')]:
        try:
            with open(os.path.normpath(path)) as f:
                cfg = json.load(f)
                print(f"OK Loaded config: {os.path.normpath(path)}")
                return cfg
        except FileNotFoundError:
            continue
        except Exception as e:
            print(f"WARN bridge-config.json error: {e}")
    return {}

_cfg       = load_config()
WS_PORT    = int(_cfg.get('ws_port',    8080))
PROXY_PORT = int(_cfg.get('proxy_port', 8081))

# ── DeepL proxy (runs on same port as WebSocket via process_request) ──────────

def _deepl_forward(path, headers, body):
    if path.startswith('/deepl-proxy-pro/'):
        target = 'https://api.deepl.com' + path[len('/deepl-proxy-pro'):]
    else:
        target = 'https://api-free.deepl.com' + path[len('/deepl-proxy'):]

    if body:
        try:
            text = json.loads(body).get('text', [''])[0]
            print(f"[DeepL] Translating: {text}")
        except Exception:
            pass

    req = urllib.request.Request(
        target,
        data=body,
        headers={
            'Authorization': headers.get('Authorization', headers.get('authorization', '')),
            'Content-Type': headers.get('Content-Type', headers.get('content-type', 'application/json')),
        },
        method='GET' if not body else 'POST',
    )

    try:
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
            try:
                result = json.loads(data).get('translations', [{}])[0].get('text', '')
                print(f"[DeepL] Response: {result}")
            except Exception:
                pass
            return resp.status, resp.headers.get('Content-Type', 'application/json'), data
    except urllib.error.HTTPError as e:
        data = e.read()
        print(f"[DeepL] Error {e.code}: {data.decode('utf-8', errors='replace')}")
        return e.code, 'application/json', data
    except Exception as e:
        print(f"[DeepL] Failed: {e}")
        return 502, 'text/plain', str(e).encode()


def _langbly_forward(path, headers, body, method='POST'):
    target = 'https://api.langbly.com' + path[len('/langbly-proxy'):]

    if body:
        try:
            parsed = json.loads(body)
            text = parsed.get('q', parsed.get('limitDollars', parsed.get('limitCents', '')))
            print(f"[Langbly] {method} {path} — {text}")
        except Exception:
            pass

    req = urllib.request.Request(
        target,
        data=body,
        headers={
            'Authorization': headers.get('authorization', headers.get('Authorization', '')),
            'Content-Type': 'application/json',
        },
        method=method,
    )

    try:
        with urllib.request.urlopen(req) as resp:
            data = resp.read()
            try:
                result = json.loads(data).get('data', {}).get('translations', [{}])[0].get('translatedText', '')
                print(f"[Langbly] Response: {result}")
            except Exception:
                pass
            return resp.status, resp.headers.get('Content-Type', 'application/json'), data
    except urllib.error.HTTPError as e:
        data = e.read()
        print(f"[Langbly] Error {e.code}: {data.decode('utf-8', errors='replace')}")
        return e.code, 'application/json', data
    except Exception as e:
        print(f"[Langbly] Failed: {e}")
        return 502, 'text/plain', str(e).encode()

def _spansh_forward(path, headers, body, method='POST'):
    """Forward to spansh.co.uk.

    Spansh serves no Access-Control-Allow-Origin header at all -- its preflight
    returns 204 with no CORS headers -- so the browser cannot call it directly.
    Routing through this proxy is the only way the board can plot routes.

    Two endpoints are used:
      POST /api/generic/route  -- galaxy plotter, takes use_supercharge=0|1
      GET  /api/results/<job>  -- poll until {"status": "ok"}
    """
    target = 'https://spansh.co.uk' + path[len('/spansh-proxy'):]

    req = urllib.request.Request(
        target,
        data=body if method == 'POST' else None,
        headers={
            # The plotter takes form-encoded bodies, not JSON.
            'Content-Type': headers.get('content-type', 'application/x-www-form-urlencoded'),
            'User-Agent': 'FuelRatsDispatchBoard/1.0',
        },
        method=method,
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = resp.read()
            try:
                parsed = json.loads(data)
                # The results payload echoes the job id too, so key the log on
                # the request rather than on the presence of a 'job' field.
                if method == 'POST':
                    print(f"[Spansh] queued job {parsed.get('job')}")
                elif parsed.get('status') == 'ok':
                    jumps = len(parsed.get('result', {}).get('jumps', [])) - 1
                    print(f"[Spansh] route done - {jumps} jumps")
            except Exception:
                pass
            return resp.status, resp.headers.get('Content-Type', 'application/json'), data
    except urllib.error.HTTPError as e:
        data = e.read()
        print(f"[Spansh] Error {e.code}: {data.decode('utf-8', errors='replace')[:200]}")
        return e.code, 'application/json', data
    except Exception as e:
        print(f"[Spansh] Failed: {e}")
        return 502, 'text/plain', str(e).encode()


PROXY_PORT = 8081
CORS = (
    'Access-Control-Allow-Origin: *\r\n'
    'Access-Control-Allow-Headers: Authorization, Content-Type\r\n'
    'Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n'
)

async def handle_deepl_http(reader, writer):
    try:
        data = b''
        while b'\r\n\r\n' not in data:
            chunk = await reader.read(4096)
            if not chunk:
                return
            data += chunk

        header_end = data.index(b'\r\n\r\n')
        header_text = data[:header_end].decode('utf-8', errors='replace')
        body_so_far = data[header_end + 4:]

        lines = header_text.split('\r\n')
        method, path, _ = lines[0].split(' ', 2)
        headers = {}
        for line in lines[1:]:
            if ':' in line:
                k, _, v = line.partition(':')
                headers[k.strip().lower()] = v.strip()

        if method == 'OPTIONS':
            writer.write(f'HTTP/1.1 204 No Content\r\n{CORS}Content-Length: 0\r\n\r\n'.encode())
            await writer.drain()
            return

        content_length = int(headers.get('content-length', 0))
        body = body_so_far
        while len(body) < content_length:
            chunk = await reader.read(content_length - len(body))
            if not chunk:
                break
            body += chunk

        if path.startswith('/spansh-proxy/'):
            status, content_type, resp_body = await asyncio.get_event_loop().run_in_executor(
                None, _spansh_forward, path, headers, body if body else None, method
            )
        elif path.startswith('/langbly-proxy/'):
            status, content_type, resp_body = await asyncio.get_event_loop().run_in_executor(
                None, _langbly_forward, path, headers, body if body else None, method
            )
        else:
            status, content_type, resp_body = await asyncio.get_event_loop().run_in_executor(
                None, _deepl_forward, path, headers, body if body else None
            )

        response = (
            f'HTTP/1.1 {status} OK\r\n'
            f'Content-Type: {content_type}\r\n'
            f'Content-Length: {len(resp_body)}\r\n'
            f'{CORS}\r\n'
        ).encode() + resp_body
        writer.write(response)
        await writer.drain()
    except Exception as e:
        print(f"[Proxy] HTTP error: {e}")
    finally:
        try:
            writer.close()
        except Exception:
            pass

# ── Registry helpers (Windows only) ──────────────────────────────────────────

def get_exe_path():
    if getattr(sys, 'frozen', False):
        return f'"{sys.executable}"'
    else:
        return f'"{sys.executable}" "{os.path.abspath(__file__)}"'

def register():
    try:
        import winreg
    except ImportError:
        print("ERR Registry access is only supported on Windows.")
        sys.exit(1)

    exe_cmd = get_exe_path()
    key_path = rf"Software\Classes\{PROTOCOL}"
    cmd_path = rf"Software\Classes\{PROTOCOL}\shell\open\command"

    try:
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, key_path) as key:
            winreg.SetValue(key, "", winreg.REG_SZ, "URL:FuelRats Dispatch Bridge Protocol")
            winreg.SetValueEx(key, "URL Protocol", 0, winreg.REG_SZ, "")

        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, cmd_path) as key:
            winreg.SetValue(key, "", winreg.REG_SZ, f'{exe_cmd} "%1"')

        print("OK Registered fr-dispatch:// protocol handler")
        print(f"   Exe: {exe_cmd}")
        print()
        print("The dispatch board can now launch this bridge automatically.")
        input("Press Enter to exit...")
    except Exception as e:
        print(f"ERR Failed to register protocol: {e}")
        print("   Try running as administrator if this fails.")
        sys.exit(1)

def unregister():
    try:
        import winreg
    except ImportError:
        print("ERR Registry access is only supported on Windows.")
        sys.exit(1)

    key_path = rf"Software\Classes\{PROTOCOL}"
    try:
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, rf"{key_path}\shell\open\command")
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, rf"{key_path}\shell\open")
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, rf"{key_path}\shell")
        winreg.DeleteKey(winreg.HKEY_CURRENT_USER, key_path)
        print("OK Unregistered fr-dispatch:// protocol handler")
    except FileNotFoundError:
        print("Protocol handler was not registered.")
    sys.exit(0)

# ── Argument handling ─────────────────────────────────────────────────────────

arg = sys.argv[1] if len(sys.argv) > 1 else ""

if arg == "--version":
    print(VERSION)
    sys.exit(0)
elif arg == "--register":
    register()
    sys.exit(0)
elif arg == "--unregister":
    unregister()
# fr-dispatch://launch — fall through and start the bridge normally

# ── WebSocket bridge ──────────────────────────────────────────────────────────

connected_clients = set()

async def handle_client(websocket):
    connected_clients.add(websocket)
    client_addr = websocket.remote_address if hasattr(websocket, 'remote_address') else 'unknown'
    print(f"OK Dispatch board connected from {client_addr}")

    reader = None
    writer = None

    try:
        await websocket.send(json.dumps({
            "type": "system",
            "text": "Connected to IRC bridge",
            "timestamp": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        }))

        try:
            reader, writer = await asyncio.open_connection(IRC_HOST, IRC_PORT)
            print(f"OK Connected to AdiIRC at {IRC_HOST}:{IRC_PORT}")

            await websocket.send(json.dumps({
                "type": "system",
                "text": "Connected to AdiIRC",
                "timestamp": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            }))
        except ConnectionRefusedError:
            print(f"ERR Cannot connect to AdiIRC at {IRC_HOST}:{IRC_PORT}")
            print("   Make sure AdiIRC is running and TCP server is started")
            print("   In AdiIRC, type: /bridge.status")

            await websocket.send(json.dumps({
                "type": "system",
                "text": "ERROR: Cannot connect to AdiIRC. Make sure AdiIRC is running with tcp_server.mrc loaded.",
                "timestamp": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            }))

            async for message in websocket:
                await websocket.send(json.dumps({
                    "type": "system",
                    "text": "Cannot send to IRC - AdiIRC not connected",
                    "timestamp": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
                }))
            return
        except Exception as e:
            print(f"ERR Error connecting to AdiIRC: {e}")
            await websocket.send(json.dumps({
                "type": "system",
                "text": f"ERROR: {str(e)}",
                "timestamp": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            }))
            return

        async def ws_to_irc():
            try:
                async for message in websocket:
                    try:
                        data = json.loads(message)
                        if data.get("type") == "message":
                            target = data.get("target", "#fuelrats")
                            text = data.get("text", "")
                            irc_command = f"PRIVMSG {target} :{text}\r\n"
                            writer.write(irc_command.encode())
                            await writer.drain()
                            print(f"-> IRC: {irc_command.strip()}")
                        elif data.get("type") == "raw":
                            command = data.get("command", "")
                            writer.write(f"{command}\r\n".encode())
                            await writer.drain()
                            print(f"-> IRC RAW: {command}")
                    except json.JSONDecodeError as e:
                        print(f"WARN Invalid JSON from WebSocket: {e}")
                    except Exception as e:
                        print(f"ERR Error processing WebSocket message: {e}")
                        traceback.print_exc()
            except websockets.exceptions.ConnectionClosed:
                print("WebSocket connection closed")
            except Exception as e:
                print(f"ERR Error in ws_to_irc: {e}")
                traceback.print_exc()

        async def irc_to_ws():
            try:
                while True:
                    data = await reader.readline()
                    if not data:
                        print("IRC connection closed")
                        break
                    line = data.decode('utf-8', errors='ignore').rstrip()
                    if line:
                        print(f"<- IRC: {line}")
                        parsed = parse_irc_message(line)
                        if parsed:
                            await websocket.send(json.dumps(parsed))
            except Exception as e:
                print(f"ERR Error reading from IRC: {e}")
                traceback.print_exc()

        await asyncio.gather(ws_to_irc(), irc_to_ws())

    except websockets.exceptions.ConnectionClosedError as e:
        print(f"WebSocket connection closed: {e}")
    except Exception as e:
        print(f"ERR Connection error: {e}")
        traceback.print_exc()
    finally:
        connected_clients.discard(websocket)
        print("XX Client disconnected")
        if writer:
            try:
                writer.close()
                await writer.wait_closed()
            except:
                pass

def parse_irc_message(line):
    try:
        if line.startswith("PING"):
            return None

        if line.startswith("IDENTIFY "):
            nick = line.split(" ", 1)[1].strip()
            return {
                "type": "identify",
                "nick": nick,
                "text": f"Identified as {nick}",
                "timestamp": datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
            }

        if not line.startswith(":"):
            return None

        parts = line.split(" ", 3)
        if len(parts) < 3:
            return None

        prefix = parts[0][1:]
        nick = prefix.split("!")[0] if "!" in prefix else prefix
        command = parts[1]
        target = parts[2] if len(parts) > 2 else ""
        message_text = parts[3][1:] if len(parts) > 3 and parts[3].startswith(":") else (parts[3] if len(parts) > 3 else "")
        timestamp = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')

        if command == "PRIVMSG":
            return {"type": "message", "channel": target, "nick": nick, "text": message_text, "timestamp": timestamp}
        elif command == "NOTICE":
            return {"type": "notice", "channel": target, "nick": nick, "text": message_text, "timestamp": timestamp}
        elif command == "JOIN":
            channel = target.lstrip(":")
            return {"type": "join", "channel": channel, "nick": nick, "text": f"{nick} has joined {channel}", "timestamp": timestamp}
        elif command == "PART":
            return {"type": "part", "channel": target, "nick": nick, "text": f"{nick} has left {target}: {message_text}", "timestamp": timestamp}
        elif command == "QUIT":
            return {"type": "quit", "nick": nick, "text": f"{nick} has quit: {message_text}", "timestamp": timestamp}

        return None
    except Exception as e:
        print(f"WARN Error parsing IRC message '{line}': {e}")
        return None

async def main():
    print("=" * 60)
    print("FuelRats IRC WebSocket Bridge")
    print("=" * 60)
    print(f"WebSocket Server: ws://localhost:{WS_PORT}")
    print(f"IRC Connection:   {IRC_HOST}:{IRC_PORT}")
    print("=" * 60)
    print()
    print("IMPORTANT: Make sure AdiIRC is running with tcp_server.mrc loaded!")
    print("In AdiIRC, verify with: /bridge.status")
    print()
    print("=" * 60)

    try:
        proxy_server = await asyncio.start_server(handle_deepl_http, '127.0.0.1', PROXY_PORT)
        print(f"OK DeepL proxy listening on port {PROXY_PORT}")

        async with websockets.serve(
            handle_client,
            "127.0.0.1",
            WS_PORT,
            ping_interval=20,
            ping_timeout=10,
        ):
            print(f"OK WebSocket bridge listening on port {WS_PORT}")
            print("Waiting for dispatch board connection...")
            print()
            async with proxy_server:
                await asyncio.Future()
    except OSError as e:
        if "address already in use" in str(e).lower():
            print(f"INFO Bridge already running on port {WS_PORT}, exiting.")
        else:
            print(f"ERR {e}")
        sys.exit(0)
    except Exception as e:
        print(f"ERR Fatal error: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n")
        print("=" * 60)
        print("Shutting down IRC bridge...")
        print("=" * 60)
