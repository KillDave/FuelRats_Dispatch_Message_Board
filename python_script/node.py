import asyncio
import websockets
import json
from datetime import datetime
import traceback

IRC_HOST = "127.0.0.1"
IRC_PORT = 12346
WS_PORT = 8080

# Store connected WebSocket clients
connected_clients = set()

async def handle_client(websocket):
    """Handle a WebSocket client connection from the dispatch board"""
    # Add client to connected set
    connected_clients.add(websocket)
    client_addr = websocket.remote_address if hasattr(websocket, 'remote_address') else 'unknown'
    print(f"✓ Dispatch board connected from {client_addr}")
    
    reader = None
    writer = None
    
    try:
        # Send connection confirmation to dispatch board first
        await websocket.send(json.dumps({
            "type": "system",
            "text": "Connected to IRC bridge",
            "timestamp": datetime.utcnow().isoformat() + "Z"
        }))
        
        # Now try to connect to IRC (AdiIRC TCP socket)
        try:
            reader, writer = await asyncio.open_connection(IRC_HOST, IRC_PORT)
            print(f"✓ Connected to AdiIRC at {IRC_HOST}:{IRC_PORT}")
            
            # Send success message
            await websocket.send(json.dumps({
                "type": "system",
                "text": "Connected to AdiIRC",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }))
        except ConnectionRefusedError:
            print(f"❌ Cannot connect to AdiIRC at {IRC_HOST}:{IRC_PORT}")
            print("   Make sure AdiIRC is running and TCP server is started")
            print("   In AdiIRC, type: /bridge.status")
            
            await websocket.send(json.dumps({
                "type": "system",
                "text": "ERROR: Cannot connect to AdiIRC. Make sure AdiIRC is running with tcp_server.mrc loaded.",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }))
            
            # Keep WebSocket open but without IRC connection
            # Just listen for WebSocket messages
            async for message in websocket:
                await websocket.send(json.dumps({
                    "type": "system",
                    "text": "Cannot send to IRC - AdiIRC not connected",
                    "timestamp": datetime.utcnow().isoformat() + "Z"
                }))
            return
        except Exception as e:
            print(f"❌ Error connecting to AdiIRC: {e}")
            await websocket.send(json.dumps({
                "type": "system",
                "text": f"ERROR: {str(e)}",
                "timestamp": datetime.utcnow().isoformat() + "Z"
            }))
            return
        
        # Both connections established, start bidirectional forwarding
        async def ws_to_irc():
            """Forward messages from WebSocket (dispatch board) to IRC"""
            try:
                async for message in websocket:
                    try:
                        data = json.loads(message)
                        
                        # Handle different message types
                        if data.get("type") == "message":
                            # Format: PRIVMSG #channel :message
                            target = data.get("target", "#fuelrats")
                            text = data.get("text", "")
                            irc_command = f"PRIVMSG {target} :{text}\r\n"
                            writer.write(irc_command.encode())
                            await writer.drain()
                            print(f"→ IRC: {irc_command.strip()}")
                            
                        elif data.get("type") == "raw":
                            # Send raw IRC command
                            command = data.get("command", "")
                            writer.write(f"{command}\r\n".encode())
                            await writer.drain()
                            print(f"→ IRC RAW: {command}")
                            
                    except json.JSONDecodeError as e:
                        print(f"⚠ Invalid JSON from WebSocket: {message}")
                        print(f"   Error: {e}")
                    except Exception as e:
                        print(f"❌ Error processing WebSocket message: {e}")
                        traceback.print_exc()
                        
            except websockets.exceptions.ConnectionClosed:
                print("WebSocket connection closed")
            except Exception as e:
                print(f"❌ Error in ws_to_irc: {e}")
                traceback.print_exc()
        
        async def irc_to_ws():
            """Forward messages from IRC to WebSocket (dispatch board)"""
            try:
                while True:
                    data = await reader.readline()
                    if not data:
                        print("IRC connection closed")
                        break
                    
                    line = data.decode('utf-8', errors='ignore').rstrip()
                    if line:
                        print(f"← IRC: {line}")
                        
                        # Parse IRC message and convert to JSON
                        parsed = parse_irc_message(line)
                        if parsed:
                            await websocket.send(json.dumps(parsed))
                        
            except Exception as e:
                print(f"❌ Error reading from IRC: {e}")
                traceback.print_exc()
        
        # Run both directions concurrently
        await asyncio.gather(ws_to_irc(), irc_to_ws())
        
    except websockets.exceptions.ConnectionClosedError as e:
        print(f"WebSocket connection closed: {e}")
    except Exception as e:
        print(f"❌ Connection error: {e}")
        traceback.print_exc()
    finally:
        # Clean up
        connected_clients.discard(websocket)
        print(f"✗ Client disconnected")
        if writer:
            try:
                writer.close()
                await writer.wait_closed()
            except:
                pass

def parse_irc_message(line):
    """
    Parse IRC message and convert to dispatch board JSON format
    
    IRC format examples:
    :nick!user@host PRIVMSG #channel :message text
    :nick!user@host JOIN #channel
    :nick!user@host PART #channel :reason
    """
    try:
        # Handle PING
        if line.startswith("PING"):
            return None  # Handle ping separately if needed
        
        # Parse IRC message
        if not line.startswith(":"):
            return None
            
        parts = line.split(" ", 3)
        if len(parts) < 3:
            return None
        
        # Extract nick from :nick!user@host
        prefix = parts[0][1:]  # Remove leading :
        nick = prefix.split("!")[0] if "!" in prefix else prefix
        
        command = parts[1]
        target = parts[2] if len(parts) > 2 else ""
        message_text = parts[3][1:] if len(parts) > 3 and parts[3].startswith(":") else (parts[3] if len(parts) > 3 else "")
        
        timestamp = datetime.utcnow().isoformat() + "Z"
        
        # Handle PRIVMSG (regular messages)
        if command == "PRIVMSG":
            return {
                "type": "message",
                "channel": target,
                "nick": nick,
                "text": message_text,
                "timestamp": timestamp
            }
        
        # Handle NOTICE (e.g. bot translations)
        elif command == "NOTICE":
            return {
                "type": "notice",
                "channel": target,
                "nick": nick,
                "text": message_text,
                "timestamp": timestamp
            }

        # Handle JOIN
        elif command == "JOIN":
            channel = target.lstrip(":")
            return {
                "type": "join",
                "channel": channel,
                "nick": nick,
                "text": f"{nick} has joined {channel}",
                "timestamp": timestamp
            }
        
        # Handle PART
        elif command == "PART":
            return {
                "type": "part",
                "channel": target,
                "nick": nick,
                "text": f"{nick} has left {target}: {message_text}",
                "timestamp": timestamp
            }
        
        # Handle QUIT
        elif command == "QUIT":
            return {
                "type": "quit",
                "nick": nick,
                "text": f"{nick} has quit: {message_text}",
                "timestamp": timestamp
            }
        
        return None
        
    except Exception as e:
        print(f"⚠ Error parsing IRC message '{line}': {e}")
        return None

async def main():
    print("=" * 60)
    print("FuelRats IRC WebSocket Bridge")
    print("=" * 60)
    print(f"WebSocket Server: ws://localhost:{WS_PORT}")
    print(f"IRC Connection: {IRC_HOST}:{IRC_PORT}")
    print("=" * 60)
    print()
    print("IMPORTANT: Make sure AdiIRC is running with tcp_server.mrc loaded!")
    print("In AdiIRC, verify with: /bridge.status")
    print()
    print("=" * 60)
    
    try:
        async with websockets.serve(
            handle_client, 
            "0.0.0.0", 
            WS_PORT,
            ping_interval=20,
            ping_timeout=10
        ):
            print(f"✓ WebSocket bridge listening on port {WS_PORT}")
            print("Waiting for dispatch board connection...")
            print()
            await asyncio.Future()  # run forever
    except OSError as e:
        if "address already in use" in str(e).lower():
            print(f"❌ ERROR: Port {WS_PORT} is already in use!")
            print(f"   Another program is using port {WS_PORT}")
            print(f"   Options:")
            print(f"   1. Close the other program")
            print(f"   2. Change WS_PORT in node.py to a different port (e.g., 8081)")
        else:
            print(f"❌ ERROR: {e}")
    except Exception as e:
        print(f"❌ Fatal error: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n")
        print("=" * 60)
        print("✗ Shutting down IRC bridge...")
        print("=" * 60)
