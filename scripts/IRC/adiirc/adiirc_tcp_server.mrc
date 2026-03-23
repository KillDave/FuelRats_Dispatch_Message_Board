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
; 3. Click "New" and save as "tcp_server.mrc"
; 4. Paste this code
; 5. Save and restart AdiIRC
; ====================================================

on *:START: {
  ; Start TCP server on port 12346 (skip if already running)
  if (!$sock(ircbridge).listening) {
    socklisten ircbridge 12346
    echo -s *** FuelRats IRC Bridge: TCP server started on port 12346
  }
  else {
    echo -s *** FuelRats IRC Bridge: TCP server already running on port 12346
  }
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
    
    ; Execute the command
    ; === TESTING MODE: Command execution disabled ===
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
  
  var %i = 1
  var %found = 0
  while ($sock(ircbridge*,%i)) {
    echo -a ***   Socket: $v1 - Connected
    inc %found
    inc %i
  }
  
  if (%found == 0) {
    echo -a ***   No Python bridges connected
  }
  
  ; Check if listener is active
  if ($sock(ircbridge).listening) {
    echo -a ***   Listener: Active on port 12346
  }
  else {
    echo -a ***   Listener: NOT ACTIVE
    echo -a ***   Run /bridge.start to restart
  }
}

alias bridge.start {
  ; Start the TCP server
  if ($sock(ircbridge).listening) {
    echo -a *** TCP server already running
  }
  else {
    socklisten ircbridge 12346
    echo -a *** TCP server started on port 12346
  }
}

alias bridge.stop {
  ; Stop the TCP server and disconnect all clients
  sockclose ircbridge*
  echo -a *** TCP server stopped and all bridges disconnected
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
