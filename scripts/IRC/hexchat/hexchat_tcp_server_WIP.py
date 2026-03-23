"""
====================================================
HexChat TCP Server for FuelRats Dispatch Board
====================================================
This script creates a TCP server that the Python bridge
connects to. It forwards IRC messages to Python and
executes commands received from Python.

Installation:
1. Copy this file to %APPDATA%\HexChat\addons\
2. In HexChat: Settings > Load Plugin or Script
   (or restart HexChat — addons load automatically)
3. The server starts on port 12346 automatically.

Commands (type in HexChat):
  /bridge_status   - Show connection status
  /bridge_start    - Start the TCP server
  /bridge_stop     - Stop the TCP server
  /bridge_restart  - Restart the TCP server
====================================================
"""

__module_name__        = "fuelrats_bridge"
__module_version__     = "1.0"
__module_description__ = "FuelRats Dispatch Board IRC Bridge"

import hexchat
import socket
import threading
import queue

PORT = 12346

# ---- State --------------------------------------------------------

_server_sock  = None          # listening socket
_clients      = []            # list of connected client sockets
_clients_lock = threading.Lock()
_cmd_queue    = queue.Queue() # commands from bridge → HexChat main thread

# ---- Helpers ------------------------------------------------------

def _broadcast(msg: str):
    """Send a line to all connected bridge clients."""
    data = (msg + "\r\n").encode("utf-8", errors="replace")
    with _clients_lock:
        dead = []
        for c in _clients:
            try:
                c.sendall(data)
            except OSError:
                dead.append(c)
        for c in dead:
            _clients.remove(c)
            try:
                c.close()
            except OSError:
                pass


def _log(msg: str):
    hexchat.prnt(f"*** FuelRats IRC Bridge: {msg}")

# ---- TCP server (runs in background thread) -----------------------

def _client_reader(sock: socket.socket):
    """Read commands from one connected bridge client and queue them."""
    buf = b""
    try:
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                line = line.rstrip(b"\r").decode("utf-8", errors="replace").strip()
                if line:
                    _cmd_queue.put(line)
    except OSError:
        pass
    finally:
        with _clients_lock:
            if sock in _clients:
                _clients.remove(sock)
        try:
            sock.close()
        except OSError:
            pass
        hexchat.prnt("*** FuelRats IRC Bridge: Bridge client disconnected")


def _accept_loop(server: socket.socket):
    """Accept connections until the server socket is closed."""
    while True:
        try:
            conn, _ = server.accept()
        except OSError:
            break  # server was closed

        with _clients_lock:
            _clients.append(conn)

        hexchat.prnt("*** FuelRats IRC Bridge: Bridge client connected")

        # Send our nick so the dispatch board knows who we are
        try:
            nick = hexchat.get_info("nick") or ""
            conn.sendall(f"IDENTIFY {nick}\r\n".encode())
        except OSError:
            pass

        t = threading.Thread(target=_client_reader, args=(conn,), daemon=True)
        t.start()

# ---- Start / stop -------------------------------------------------

def _start_server():
    global _server_sock
    if _server_sock is not None:
        _log("TCP server already running on port 12346")
        return

    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", PORT))
        s.listen(5)
        _server_sock = s
        t = threading.Thread(target=_accept_loop, args=(s,), daemon=True)
        t.start()
        _log(f"TCP server started on port {PORT}")
    except OSError as e:
        _log(f"Failed to start TCP server: {e}")


def _stop_server():
    global _server_sock
    if _server_sock is None:
        _log("TCP server is not running")
        return

    try:
        _server_sock.close()
    except OSError:
        pass
    _server_sock = None

    with _clients_lock:
        for c in _clients:
            try:
                c.close()
            except OSError:
                pass
        _clients.clear()

    _log("TCP server stopped")

# ---- Timer: drain command queue → HexChat -------------------------

def _process_commands(_userdata):
    while not _cmd_queue.empty():
        cmd = _cmd_queue.get_nowait()
        hexchat.prnt(f"*** Bridge → IRC: {cmd}")
        # Un-comment the line below to actually execute received commands:
        # hexchat.command(cmd)
    return 1  # keep the timer running


# ---- IRC event hooks → forward to bridge --------------------------

def _on_server_message(word, word_eol, userdata):
    """
    Catch raw server lines for PRIVMSG, NOTICE, JOIN, PART, QUIT, NICK.
    word_eol[0] is the full raw IRC line e.g. ':nick!u@h PRIVMSG #ch :hi'
    """
    _broadcast(word_eol[0])
    return hexchat.EAT_NONE


def _on_your_message(word, word_eol, userdata):
    """Forward our own outgoing channel messages."""
    nick    = hexchat.get_info("nick") or "me"
    channel = hexchat.get_info("channel") or "#"
    text    = word_eol[1] if len(word_eol) > 1 else ""
    _broadcast(f":{nick}!dispatch@local PRIVMSG {channel} :{text}")
    return hexchat.EAT_NONE


def _on_your_action(word, word_eol, userdata):
    """Forward our own /me actions."""
    nick    = hexchat.get_info("nick") or "me"
    channel = hexchat.get_info("channel") or "#"
    text    = word_eol[1] if len(word_eol) > 1 else ""
    _broadcast(f":{nick}!dispatch@local PRIVMSG {channel} :\x01ACTION {text}\x01")
    return hexchat.EAT_NONE

# ---- Commands -----------------------------------------------------

def _cmd_status(word, word_eol, userdata):
    _log("Bridge Status:")
    if _server_sock is not None:
        _log(f"  Listener: Active on port {PORT}")
    else:
        _log("  Listener: NOT ACTIVE  (run /bridge_start)")
    with _clients_lock:
        count = len(_clients)
    _log(f"  Connected clients: {count}")
    return hexchat.EAT_ALL


def _cmd_start(word, word_eol, userdata):
    _start_server()
    return hexchat.EAT_ALL


def _cmd_stop(word, word_eol, userdata):
    _stop_server()
    return hexchat.EAT_ALL


def _cmd_restart(word, word_eol, userdata):
    _stop_server()
    _start_server()
    return hexchat.EAT_ALL

# ---- Registration -------------------------------------------------

# Server-side events (raw lines from IRC server)
for _event in ("PRIVMSG", "NOTICE", "JOIN", "PART", "QUIT", "NICK"):
    hexchat.hook_server(_event, _on_server_message)

# Our own outgoing messages (not fired by hook_server)
hexchat.hook_print("Your Message", _on_your_message)
hexchat.hook_print("Your Action",  _on_your_action)

# HexChat commands
hexchat.hook_command("bridge_status",  _cmd_status,  help="/bridge_status — show bridge status")
hexchat.hook_command("bridge_start",   _cmd_start,   help="/bridge_start — start the TCP server")
hexchat.hook_command("bridge_stop",    _cmd_stop,    help="/bridge_stop — stop the TCP server")
hexchat.hook_command("bridge_restart", _cmd_restart, help="/bridge_restart — restart the TCP server")

# Poll the command queue every 100 ms
hexchat.hook_timer(100, _process_commands)

# Auto-start
_start_server()

_log(f"Plugin loaded (v{__module_version__})")
