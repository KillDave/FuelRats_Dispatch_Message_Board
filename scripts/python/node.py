import asyncio
import websockets
import json
import sys
import os
import logging
from datetime import datetime, timezone
import traceback

# Suppress spurious "did not receive a valid HTTP request" errors from
# connections that open the TCP socket but close before completing the
# WebSocket handshake (health checks, port probes, etc.).
logging.getLogger("websockets.server").setLevel(logging.CRITICAL)

IRC_HOST = "127.0.0.1"
IRC_PORT = 12346
WS_PORT = 8080
PROTOCOL = "fr-dispatch"
VERSION = "1.0.0"

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
        async with websockets.serve(
            handle_client,
            "127.0.0.1",
            WS_PORT,
            ping_interval=20,
            ping_timeout=10
        ):
            print(f"OK WebSocket bridge listening on port {WS_PORT}")
            print("Waiting for dispatch board connection...")
            print()
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
