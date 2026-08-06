; ====================================================
; AdiIRC TCP Server for FuelRats Dispatch Board
; ====================================================
; This script creates a TCP server that the Python bridge
; connects to. It forwards IRC messages to Python and
; executes commands received from Python.
;
; Installation:
; 1. Open AdiIRC
; 2. Press Alt+R (Script Editor)
; 3. Check the file list on the left first -- if an older copy of this script
;    is already loaded, replace its contents rather than adding a second file.
;    Two loaded copies both answer on *:START: and fight over the same socket.
; 4. Otherwise click "New" and save as "tcp_server.mrc"
; 5. Paste this code
; 6. Save and restart AdiIRC
;
; Troubleshooting:
;   "'ircbridge' socket in use"  ->  /bridge.restart
;   Nothing connects             ->  /bridge.status
; ====================================================

on *:START: {
  ; Defers to bridge.start rather than repeating it. The old copy here guarded
  ; on .listening, which AdiIRC leaves empty, so the "already running" branch
  ; never ran and the two implementations could drift. bridge.start closes
  ; before it listens, so firing this twice -- which happens when two copies of
  ; the script are loaded -- is harmless rather than an error.
  bridge.start
}

on *:SOCKLISTEN:ircbridge: {
  ; Accept incoming connection from Python bridge
  var %sock = ircbridge $+ $rand(1000,9999)
  sockaccept %sock
  echo -s *** FuelRats IRC Bridge: Python bridge connected (%sock)
  ; Send our nick to the bridge so the dispatch board knows who we are
  sockwrite -n %sock IDENTIFY $me
}

on *:SOCKREAD:ircbridge*: {
  ; Read data from Python bridge
  var %data
  sockread %data
  
  ; Execute IRC command received from Python
  if (%data) {
    ; Log the command
    echo -s *** Bridge → IRC: %data
    
    ; To allow the Dispatch Board to send to IRC (including #debrief),
    ; uncomment the line below:
    ; %data
  }
}

; ====================================================
; Forward IRC messages to Python bridge
; ====================================================

on *:TEXT:*:#: {
  ; Forward channel messages from other users
  ; Format: :nick!user@host PRIVMSG #channel :message
  var %msg = : $+ $nick $+ ! $+ $address($nick,5) PRIVMSG # : $+ $1-
  sockwrite -n ircbridge* %msg

  ; Optional: Log forwarded messages
  ; echo -s *** IRC → Bridge: %msg
}

on *:INPUT:#: {
  ; Forward your own outgoing channel messages (TEXT does not fire for your own messages)
  if ($left($1,1) != /) {
    var %msg = : $+ $me $+ ! $+ $address($me,5) PRIVMSG # : $+ $1-
    sockwrite -n ircbridge* %msg
  }
}

on *:NOTICE:*:#fuelrats: {
  ; Forward channel notices from #fuelrats
  var %msg = : $+ $nick $+ ! $+ $address($nick,5) NOTICE #fuelrats : $+ $1-
  sockwrite -n ircbridge* %msg
}

on *:NOTICE:*:?: {
  ; Forward private notices from MechaSqueak (e.g. translations)
  if ($nick == MechaSqueak[BOT]) {
    var %msg = : $+ $nick $+ ! $+ $address($nick,5) NOTICE $me : $+ $1-
    sockwrite -n ircbridge* %msg
  }
}

on *:ACTION:*:#: {
  ; Forward /me actions
  var %msg = : $+ $nick $+ ! $+ $address($nick,5) PRIVMSG # : $+ $chr(1) $+ ACTION $1- $+ $chr(1)
  sockwrite -n ircbridge* %msg
}

on *:JOIN:#: {
  ; Forward join events
  var %msg = : $+ $nick $+ ! $+ $address($nick,5) JOIN :#
  sockwrite -n ircbridge* %msg
}

on *:PART:#: {
  ; Forward part events
  var %msg = : $+ $nick $+ ! $+ $address($nick,5) PART # : $+ $1-
  sockwrite -n ircbridge* %msg
}

on *:QUIT: {
  ; Forward quit events
  var %msg = : $+ $nick $+ ! $+ $address($nick,5) QUIT : $+ $1-
  sockwrite -n ircbridge* %msg
}

on *:NICK: {
  ; Forward nick changes
  var %msg = : $+ $nick $+ ! $+ $address($nick,5) NICK : $+ $newnick
  sockwrite -n ircbridge* %msg
}

on *:SOCKCLOSE:ircbridge*: {
  ; Handle disconnection
  echo -s *** FuelRats IRC Bridge: Python bridge disconnected ($sockname)
}

; ====================================================
; Utility aliases
; ====================================================

alias bridge.status {
  ; Check bridge status
  echo -a *** FuelRats IRC Bridge Status:
  
  ; ircbridge* matches the listener as well as the accepted connections, and
  ; the listener is not a bridge. Reporting it as "Socket: ircbridge -
  ; Connected" made an idle client look like it had one attached, and made a
  ; genuine connection hard to pick out from the noise.
  ;
  ; Accepted sockets are named ircbridgeNNNN by on SOCKLISTEN, so the listener
  ; is exactly the one whose name has nothing after the prefix.
  var %i = 1
  var %found = 0
  while ($sock(ircbridge*,%i)) {
    if ($sock(ircbridge*,%i) != ircbridge) {
      echo -a ***   Bridge connected: $sock(ircbridge*,%i)
      inc %found
    }
    inc %i
  }

  if (%found == 0) {
    echo -a ***   No Python bridges connected
  }

  ; Existence, not .listening.
  ;
  ; AdiIRC does not report .listening the way mIRC does -- it comes back empty
  ; even for a listener that is up and has a client attached. Verified from
  ; outside the client: AdiIRC holding 0.0.0.0:12346 with an ESTABLISHED
  ; connection from the bridge, while this alias said NOT ACTIVE.
  ;
  ; That false negative was the whole problem. It told people to run
  ; /bridge.start, which then failed with "'ircbridge' socket in use" because
  ; the socket it claimed was missing had been there all along.
  if ($sock(ircbridge)) {
    echo -a ***   Listener: Active on port 12346
  }
  else {
    echo -a ***   Listener: NOT ACTIVE
    echo -a ***   Run /bridge.start to restart
  }
}

alias bridge.start {
  ; Close then listen, unconditionally.
  ;
  ; No guard, because there is nothing dependable to guard on: AdiIRC returns
  ; empty for .listening even when the socket is up, so the old "already
  ; running" branch was unreachable and every start walked into socklisten
  ; over a name that was still held -- "'ircbridge' socket in use".
  ;
  ; sockclose on a name that is not open is harmless, so this is safe to run
  ; any number of times. Only the listener is closed; bridges already accepted
  ; are named ircbridgeNNNN and keep their connections.
  sockclose ircbridge
  socklisten ircbridge 12346
  echo -a *** TCP server listening on port 12346
}

alias bridge.stop {
  ; Stop the TCP server and disconnect all clients
  sockclose ircbridge*
  echo -a *** TCP server stopped and all bridges disconnected
}

alias bridge.debug {
  ; Everything needed to diagnose a bridge that will not start, in one paste.
  ;
  ; Worth reading .listening here even though nothing branches on it any more:
  ; seeing it blank next to a socket that plainly exists is what explains a
  ; "NOT ACTIVE" listener that is in fact serving.
  echo -a *** bridge.debug
  echo -a ***   $!sock(ircbridge) = $sock(ircbridge)
  echo -a ***   .name = $sock(ircbridge).name
  echo -a ***   .listening = $sock(ircbridge).listening $+ $chr(32) $+ (blank is normal in AdiIRC)
  echo -a *** --- sockets matching ircbridge* ---
  var %i = 1
  while ($sock(ircbridge*,%i)) {
    echo -a ***   $calc(%i) name= $sock(ircbridge*,%i) listening= $sock(ircbridge*,%i).listening
    inc %i
  }
  echo -a ***   total: $calc(%i - 1)
  echo -a *** --- server connections ---
  echo -a ***   $!scon(0) = $scon(0)
  var %s = 1
  while (%s <= $scon(0)) {
    echo -a ***   network= $scon(%s).network status= $scon(%s).status channels= $scon(%s).chan(0)
    inc %s
  }
  echo -a *** --- end ---
}

alias bridge.restart {
  ; Restart the bridge server
  bridge.stop
  .timer 1 1 bridge.start
  echo -a *** Restarting TCP server...
}

; ====================================================
; Menu integration (optional)
; ====================================================

menu status,channel {
  FuelRats Bridge
  .Status:/bridge.status
  .Restart:/bridge.restart
  .Stop:/bridge.stop
  .-
  .Start Server:/bridge.start
}

; ====================================================
; End of script
; ====================================================
