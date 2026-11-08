import asyncio
import websockets
import json
import sys
import os
import logging
import re
import subprocess
import urllib.request
import urllib.error
import urllib.parse
import webbrowser
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

# The pages allowed to use the bridge and the proxy: the board as FRBoard.exe
# and `npm run dev` serve it. Anyone serving dist/ from somewhere else adds
# that origin to "allowed_origins" in bridge-config.json.
ALLOWED_ORIGINS = set(_cfg.get('allowed_origins') or [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
])

# Upper bounds on what one proxy request may send. Translation text, a Spansh
# form and the update trigger are all far below these.
MAX_HEADER_BYTES = 64 * 1024
MAX_BODY_BYTES   = 2 * 1024 * 1024


def _origin_allowed(origin):
    """No Origin at all is a local tool such as curl; a browser always sends one."""
    return origin is None or origin in ALLOWED_ORIGINS


def _host_allowed(host, port):
    """Only loopback names, so the proxy answers to nothing but this machine."""
    return host in (f'localhost:{port}', f'127.0.0.1:{port}', f'[::1]:{port}')


class _SameHostRedirects(urllib.request.HTTPRedirectHandler):
    """Follow a redirect only to the same https host the request was for."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        old = urllib.parse.urlsplit(req.full_url)
        new = urllib.parse.urlsplit(urllib.parse.urljoin(req.full_url, newurl))
        if new.scheme != 'https' or new.hostname != old.hostname:
            raise urllib.error.HTTPError(req.full_url, 502, 'redirect refused', headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


_opener = urllib.request.build_opener(_SameHostRedirects)


def _open(req, timeout=60):
    return _opener.open(req, timeout=timeout)

# ── DeepL proxy (runs on same port as WebSocket via process_request) ──────────

def _deepl_forward(path, headers, body):
    if path.startswith('/deepl-proxy-pro/'):
        target = 'https://api.deepl.com' + path[len('/deepl-proxy-pro'):]
    elif path.startswith('/deepl-proxy/'):
        target = 'https://api-free.deepl.com' + path[len('/deepl-proxy'):]
    else:
        return 404, 'text/plain', b'Not found'

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
        with _open(req) as resp:
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
        with _open(req) as resp:
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
        with _open(req, timeout=30) as resp:
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


def _journal_dir():
    """Where Elite writes its journals.

    The default lives under Saved Games, which is not %USERPROFILE%\\Documents and
    can be relocated, so the registry is asked first and the usual path is only a
    fallback. JOURNAL_DIR overrides both, for a non-standard install or a copy
    synced from another machine.
    """
    override = os.environ.get('JOURNAL_DIR')
    if override and os.path.isdir(override):
        return override

    saved_games = None
    try:
        import winreg
        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r'Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders',
        )
        # {4C5C32FF-BB9D-43b0-B5B4-2D72E54EAAA4} is Saved Games.
        saved_games, _ = winreg.QueryValueEx(key, '{4C5C32FF-BB9D-43b0-B5B4-2D72E54EAAA4}')
    except Exception:
        pass

    candidates = []
    if saved_games:
        candidates.append(os.path.join(saved_games, 'Frontier Developments', 'Elite Dangerous'))
    candidates.append(os.path.join(
        os.path.expanduser('~'), 'Saved Games', 'Frontier Developments', 'Elite Dangerous'))

    for c in candidates:
        if os.path.isdir(c):
            return c
    return None


def _journal_position():
    """Current commander, system, and ship, read from the newest journal.

    Read backwards from the end: the events that carry a system are written as
    they happen, so the last one wins, and a long session's journal is not worth
    parsing in full to answer this. Only the newest file is consulted -- Elite
    starts a fresh one per session, so an older file cannot hold a newer position.

    The Loadout event is included the same way _journal_commanders returns it --
    verbatim, so the board can notice a swapped ship on the next poll instead of
    only ever seeing the one that was live at the moment the account was imported.
    """
    d = _journal_dir()
    if not d:
        return {'error': 'journal directory not found'}

    try:
        logs = [f for f in os.listdir(d) if f.startswith('Journal.') and f.endswith('.log')]
        if not logs:
            return {'error': 'no journal files'}
        newest = max(logs, key=lambda f: os.path.getmtime(os.path.join(d, f)))
        path = os.path.join(d, newest)

        system = timestamp = cmdr = loadout = None
        docked = None
        with open(path, 'r', encoding='utf-8', errors='replace') as fh:
            lines = fh.readlines()

        for line in reversed(lines):
            line = line.strip()
            if not line:
                continue
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            kind = ev.get('event')
            # Location is emitted on load and on relog; FSDJump and CarrierJump on
            # arrival. Any of them is authoritative for where the ship now is.
            if system is None and kind in ('FSDJump', 'CarrierJump', 'Location'):
                system = ev.get('StarSystem')
                timestamp = ev.get('timestamp')
                docked = ev.get('Docked')
            if cmdr is None and kind in ('Commander', 'LoadGame'):
                cmdr = ev.get('Name')
            # Reading backwards, the first Loadout hit is the newest -- a refit or
            # ship swap since the session started, or just what was already fit.
            if loadout is None and kind == 'Loadout':
                loadout = ev
            if system and cmdr and loadout:
                break

        if not system:
            return {'error': 'no position in the current journal'}
        return {
            'system': system,
            'cmdr': cmdr,
            'timestamp': timestamp,
            'docked': docked,
            'journal': newest,
            'loadout': loadout,
            'ship': loadout.get('Ship') if loadout else None,
            'shipName': loadout.get('ShipName') if loadout else None,
        }
    except Exception as e:
        return {'error': str(e)}


def _journal_commanders(max_files=60):
    """Every commander the journals know about, with their last system and ship.

    Files are walked newest first and the first answer for a commander wins, so
    an old session cannot overwrite a newer one. The scan is capped because a
    long-running install accumulates hundreds of journals and the older ones can
    only repeat what has already been found.

    The Loadout event is returned verbatim: it is the same shape EDSY's "Journal"
    export produces, so the board can feed it to the existing build parser rather
    than having a second one here.
    """
    d = _journal_dir()
    if not d:
        return {'error': 'journal directory not found'}

    try:
        logs = [f for f in os.listdir(d) if f.startswith('Journal.') and f.endswith('.log')]
        if not logs:
            return {'error': 'no journal files'}
        logs.sort(key=lambda f: os.path.getmtime(os.path.join(d, f)), reverse=True)

        found = {}
        newest_cmdr = None

        for name in logs[:max_files]:
            cmdr = None
            system = timestamp = docked = None
            loadout = None

            try:
                with open(os.path.join(d, name), 'r', encoding='utf-8', errors='replace') as fh:
                    for line in fh:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            ev = json.loads(line)
                        except ValueError:
                            continue
                        kind = ev.get('event')
                        if kind in ('Commander', 'LoadGame'):
                            cmdr = ev.get('Name') or cmdr
                        elif kind in ('FSDJump', 'CarrierJump', 'Location'):
                            system = ev.get('StarSystem')
                            timestamp = ev.get('timestamp')
                            docked = ev.get('Docked')
                        elif kind == 'Loadout':
                            # Later Loadouts supersede earlier ones in the same
                            # session -- refits, module swaps, a different ship.
                            loadout = ev
            except OSError:
                continue

            if not cmdr:
                continue
            if newest_cmdr is None:
                newest_cmdr = cmdr

            entry = found.setdefault(cmdr, {'cmdr': cmdr})
            if system and 'system' not in entry:
                entry['system'] = system
                entry['timestamp'] = timestamp
                entry['docked'] = docked
            if loadout and 'loadout' not in entry:
                entry['loadout'] = loadout
                entry['ship'] = loadout.get('Ship')
                entry['shipName'] = loadout.get('ShipName')

        return {
            'commanders': list(found.values()),
            # Whoever the most recently written journal belongs to. Not necessarily
            # in game right now, but the best available answer for "who is active".
            'active': newest_cmdr,
            'scanned': min(len(logs), max_files),
            'total': len(logs),
        }
    except Exception as e:
        return {'error': str(e)}


def _cors(origin):
    """CORS headers naming the requesting origin, which is already allowed."""
    if origin is None:
        return ''
    return (
        f'Access-Control-Allow-Origin: {origin}\r\n'
        'Vary: Origin\r\n'
        'Access-Control-Allow-Headers: Authorization, Content-Type\r\n'
        'Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n'
    )


async def _read_head(reader):
    """Read up to the end of the headers, or None if they run past the limit."""
    data = b''
    while b'\r\n\r\n' not in data:
        if len(data) > MAX_HEADER_BYTES:
            return None
        chunk = await reader.read(4096)
        if not chunk:
            return None
        data += chunk
    return data


def _plain(writer, status, text):
    body = text.encode()
    writer.write(
        f'HTTP/1.1 {status}\r\nContent-Type: text/plain\r\n'
        f'Content-Length: {len(body)}\r\nConnection: close\r\n\r\n'.encode() + body
    )

# ── The board itself ─────────────────────────────────────────────────────────
#
# Serving dist/ from here is what removes Python from the list of things a
# dispatcher has to install. This process already runs an HTTP server and, as a
# PyInstaller one-file build, already contains a Python interpreter -- so the
# old arrangement shipped an interpreter and then asked the user to install a
# second one just to run `python -m http.server`.
#
# 5173 on purpose, matching what the .bat used. The board builds its OAuth
# redirect from window.location.origin, and that address is registered with
# FuelRats, so keeping the port identical means sign-in keeps working with
# nothing to re-register.

BOARD_PORT = 5173

MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'text/javascript; charset=utf-8',
    '.css':  'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg':  'image/svg+xml',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.ico':  'image/x-icon',
    '.mp3':  'audio/mpeg',
    '.wav':  'audio/wav',
    '.woff2': 'font/woff2',
    '.map':  'application/json',
}


def _board_root():
    """
    Where dist/ lives.

    Frozen, it is unpacked beside the bundle at runtime -- PyInstaller extracts
    --add-data into a temporary folder it points sys._MEIPASS at. Running from
    a source checkout, it is the dist/ the Vite build writes two levels up.
    """
    if getattr(sys, 'frozen', False):
        return os.path.join(sys._MEIPASS, 'dist')
    return os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', 'dist'))


def _board_file(path):
    """
    Resolve a request path to a file inside dist/, or None.

    Everything that is not a real file falls back to index.html, because the
    board is a single-page app: /callback is handled in the browser, not here,
    and returning 404 for it would break sign-in at the last step.

    The realpath check is what stops "/../../.." reading outside dist/. It is
    not theoretical -- this listens on a socket, and a request line is entirely
    attacker-controlled.
    """
    root = _board_root()
    clean = path.split('?', 1)[0].split('#', 1)[0]
    if clean in ('', '/'):
        clean = '/index.html'

    real_root = os.path.realpath(root)
    candidate = os.path.realpath(os.path.join(root, clean.lstrip('/').replace('/', os.sep)))
    try:
        if os.path.commonpath([candidate, real_root]) != real_root:
            return None
    except ValueError:   # a different drive entirely
        return None
    if os.path.isfile(candidate):
        return candidate

    index = os.path.join(root, 'index.html')
    return index if os.path.isfile(index) else None


def _run_updater():
    """
    Hand the update to FRBoard-Setup.exe and get out of its way.

    Answered as soon as the installer is started, because the work kills this
    process: the installer stops FRBoard.exe so the file can be replaced, then
    starts it again. Waiting for a result would mean waiting to be killed. The
    only thing done first is fetching and verifying the installer itself.

    Only offered from the packaged build. From a source checkout there is no
    installer beside us and nothing sensible to replace -- `git pull` is the
    update mechanism there.
    """
    if not getattr(sys, 'frozen', False):
        body = json.dumps({'error': 'running from source; use git pull'}).encode()
        return 400, 'application/json', body

    setup = os.path.join(os.path.dirname(sys.executable), 'FRBoard-Setup.exe')

    # Swap in the latest release's installer, checked against that release's
    # SHA256SUMS.txt, before running it. The copy already installed may predate
    # checksums; the fresh one verifies everything else it downloads.
    try:
        import installer
        print(f"[Update] {installer.refresh_setup(installer.Path(os.path.dirname(sys.executable)))}")
    except Exception as e:
        print(f"[Update] refused: {e}")
        return 502, 'application/json', json.dumps({'error': f'update not verified: {e}'}).encode()

    if not os.path.isfile(setup):
        body = json.dumps({
            'error': 'FRBoard-Setup.exe is not beside FRBoard.exe; reinstall to restore it',
        }).encode()
        return 404, 'application/json', body

    try:
        # Detached, or it dies with the process it is about to stop.
        DETACHED_PROCESS = 0x00000008
        CREATE_NO_WINDOW = 0x08000000
        # --dir is explicit: without it the installer targets whatever the
        # registry calls the install location, which is not necessarily where
        # the copy being replaced is running from. Somebody running a second
        # copy out of Downloads would otherwise update the installed one and
        # be left wondering why the button changed nothing.
        subprocess.Popen(
            [setup, '--update', '--relaunch', '--dir', os.path.dirname(sys.executable)],
            cwd=os.path.dirname(setup),
            creationflags=DETACHED_PROCESS | CREATE_NO_WINDOW,
            close_fds=True,
        )
    except Exception as e:
        return 500, 'application/json', json.dumps({'error': str(e)}).encode()

    return 200, 'application/json', json.dumps({'ok': True}).encode()


async def handle_board_http(reader, writer):
    """Static file server for the board. Loopback only, GET and HEAD only."""
    try:
        data = await _read_head(reader)
        if data is None:
            return

        request_line = data[:data.index(b'\r\n')].decode('utf-8', errors='replace')
        parts = request_line.split(' ')
        if len(parts) < 2:
            return
        method, path = parts[0], parts[1]

        if method not in ('GET', 'HEAD'):
            writer.write(b'HTTP/1.1 405 Method Not Allowed\r\nContent-Length: 0\r\n\r\n')
            await writer.drain()
            return

        target = _board_file(path)
        if target is None:
            body = b'Board files not found. Reinstall, or run npm run build.'
            writer.write(
                b'HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\n'
                + f'Content-Length: {len(body)}\r\n\r\n'.encode() + body
            )
            await writer.drain()
            return

        with open(target, 'rb') as fh:
            body = fh.read()

        ctype = MIME.get(os.path.splitext(target)[1].lower(), 'application/octet-stream')
        # index.html must not be cached: it names the hashed bundle, so a stale
        # copy points at a file the next update has already deleted.
        cache = ('no-store' if target.endswith('index.html')
                 else 'public, max-age=31536000, immutable')
        head = (
            'HTTP/1.1 200 OK\r\n'
            f'Content-Type: {ctype}\r\n'
            f'Content-Length: {len(body)}\r\n'
            f'Cache-Control: {cache}\r\n'
            '\r\n'
        ).encode()
        writer.write(head if method == 'HEAD' else head + body)
        await writer.drain()
    except Exception as e:
        print(f"[Board] HTTP error: {e}")
    finally:
        try:
            writer.close()
        except Exception:
            pass

async def handle_deepl_http(reader, writer):
    try:
        data = await _read_head(reader)
        if data is None:
            _plain(writer, '431 Request Header Fields Too Large', 'Headers too large')
            await writer.drain()
            return

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

        origin = headers.get('origin')
        if not _host_allowed(headers.get('host'), PROXY_PORT) or not _origin_allowed(origin):
            _plain(writer, '403 Forbidden', 'Forbidden')
            await writer.drain()
            return
        cors = _cors(origin)

        if method == 'OPTIONS':
            writer.write(f'HTTP/1.1 204 No Content\r\n{cors}Content-Length: 0\r\n\r\n'.encode())
            await writer.drain()
            return

        try:
            content_length = int(headers.get('content-length', 0))
        except ValueError:
            content_length = -1
        if content_length < 0 or content_length > MAX_BODY_BYTES:
            _plain(writer, '413 Payload Too Large', 'Body too large')
            await writer.drain()
            return
        body = body_so_far
        while len(body) < content_length:
            chunk = await reader.read(content_length - len(body))
            if not chunk:
                break
            body += chunk

        if path.startswith('/update') and method == 'POST':
            # Downloads and verifies the installer first, so off the event loop.
            status, content_type, resp_body = await asyncio.get_event_loop().run_in_executor(
                None, _run_updater
            )
        elif path.startswith('/journal/commanders'):
            payload = json.dumps(_journal_commanders()).encode()
            status, content_type, resp_body = 200, 'application/json', payload
        elif path.startswith('/journal/position'):
            # Local file read, so no executor round trip and no upstream call.
            payload = json.dumps(_journal_position()).encode()
            status, content_type, resp_body = 200, 'application/json', payload
        elif path.startswith('/spansh-proxy/'):
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
            f'{cors}\r\n'
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

# One IRC line per message. CR, LF and NUL end or corrupt a line, and \x01
# is CTCP framing, which the board never needs in a plain message (its /me goes
# out as /describe).
_LINE_BREAKS = re.compile(r'[\r\n]+')
_UNSAFE_CHARS = re.compile(r'[\x00\x01]')
# A channel or nick: no whitespace, no control characters, no commas.
_VALID_TARGET = re.compile(r'^[^\s,\x00-\x1f]{1,64}$')


def _clean_text(text):
    return _UNSAFE_CHARS.sub('', _LINE_BREAKS.sub(' ', str(text)))


def _clean_command(command):
    """A raw command must be a single line; anything else is refused whole."""
    command = str(command)
    if _LINE_BREAKS.search(command) or _UNSAFE_CHARS.search(command):
        return None
    return command

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
                            target = str(data.get("target", "#fuelrats"))
                            text = _clean_text(data.get("text", ""))
                            if not _VALID_TARGET.match(target):
                                print(f"WARN Refused message to an invalid target: {target!r}")
                                continue
                            irc_command = f"PRIVMSG {target} :{text}\r\n"
                            writer.write(irc_command.encode())
                            await writer.drain()
                            print(f"-> IRC: {irc_command.strip()}")
                        elif data.get("type") == "raw":
                            command = _clean_command(data.get("command", ""))
                            if command is None:
                                print("WARN Refused a raw command spanning more than one line")
                                continue
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
            except websockets.exceptions.ConnectionClosed:
                # The browser went away: a tab closed, a refresh, or the dev
                # server reloading the page. Close code 1001 is "going away"
                # and ConnectionClosedOK means it was a clean one, so this is
                # an ordinary end to the pump rather than a fault.
                #
                # Caught here as well as in ws_to_irc because the two ends fail
                # in different places: this one raises out of websocket.send,
                # which the old message blamed on reading from IRC -- the
                # opposite end of the bridge from the one that actually closed.
                print("WebSocket connection closed")
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

        # The board, but only from the packaged build -- or on request.
        #
        # A source checkout is a development machine, where `npm run dev` owns
        # port 5173. Serving dist/ here as well would have `npm run bridge`
        # fight the dev server for it, and a stale dist/ from an earlier build
        # is not what anyone editing the board wants to see anyway. The old
        # workflow keeps working exactly as it did.
        serve_board = getattr(sys, 'frozen', False) or '--serve' in sys.argv
        board_server = None
        if serve_board and os.path.isdir(_board_root()):
            board_server = await asyncio.start_server(handle_board_http, '127.0.0.1', BOARD_PORT)
            print(f"OK Board listening on http://localhost:{BOARD_PORT}")
            if '--no-browser' not in sys.argv:
                try:
                    webbrowser.open(f'http://localhost:{BOARD_PORT}')
                except Exception:
                    pass
        elif serve_board:
            print("-- No dist/ in this build; serve the board yourself")
        else:
            print("-- Source checkout: use npm run dev, or --serve to serve dist/")

        async with websockets.serve(
            handle_client,
            "127.0.0.1",
            WS_PORT,
            ping_interval=20,
            ping_timeout=10,
            # Only the board's own pages may connect.
            origins=sorted(ALLOWED_ORIGINS),
        ):
            print(f"OK WebSocket bridge listening on port {WS_PORT}")
            print("Waiting for dispatch board connection...")
            print()
            async with proxy_server:
                await asyncio.Future()
    except OSError as e:
        if _port_in_use(e):
            _already_running(e)
        else:
            print(f"ERR {e}")
            _hold_window()
        sys.exit(0)
    except Exception as e:
        print(f"ERR Fatal error: {e}")
        traceback.print_exc()
        _hold_window()


def _port_in_use(e):
    """
    Whether an OSError from bind means another process owns the port.

    The text cannot be matched: Windows says "only one usage of each socket
    address ... is normally permitted", not "address already in use", so the
    old string check never fired there and a second launch printed a raw
    WinError and vanished. errno is EADDRINUSE on POSIX; on Windows the
    10048 lives in winerror, and asyncio's own wrapper keeps it in errno.
    """
    import errno
    return (e.errno in (errno.EADDRINUSE, 10048)
            or getattr(e, 'winerror', None) == 10048)


def _port_open(port):
    import socket
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=1):
            return True
    except OSError:
        return False


def _already_running(e):
    """
    Another copy holds the ports -- almost always an earlier FRBoard.exe still
    running, minimised or in a console tab that was forgotten about.

    Starting a second one is pointless: the ports are taken and the browser
    would talk to the old copy anyway. So point the user at the copy that
    works, rather than dying with a socket error they cannot act on.
    """
    print()
    # Which port is not worth guessing at: the proxy binds first, then the
    # board (5173, which `npm run dev` also wants), then the WebSocket.
    print("INFO A port FRBoard needs is already taken -- most likely FRBoard")
    print("     is already running. (" + str(e).split(': ', 1)[0] + ")")
    if _port_open(BOARD_PORT) and '--no-browser' not in sys.argv:
        print(f"     Opening the running board: http://localhost:{BOARD_PORT}")
        try:
            webbrowser.open(f'http://localhost:{BOARD_PORT}')
        except Exception:
            pass
    print("     To restart it, close the other FRBoard window first,")
    print("     or end FRBoard.exe in Task Manager.")
    _hold_window()


def _hold_window():
    """
    Keep the console open long enough to read why we are exiting.

    Double-clicking FRBoard.exe gives it a console of its own that closes the
    instant the process ends, which turned every startup error into a flash
    on screen. Only when there is a console to read from: launched by the
    protocol handler or redirected, input() would raise, so fall back to a
    short sleep.
    """
    if not getattr(sys, 'frozen', False):
        return
    try:
        if sys.stdin and sys.stdin.isatty():
            input("Press Enter to close...")
            return
    except (EOFError, OSError, RuntimeError):
        pass
    import time
    time.sleep(8)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n")
        print("=" * 60)
        print("Shutting down IRC bridge...")
        print("=" * 60)
