#!/usr/bin/perl
# ====================================================
# HexChat TCP Server for FuelRats Dispatch Board
# ====================================================
# This script creates a TCP server that the Dispatch
# Board connects to. It forwards IRC messages to the
# board and executes commands received from it.
#
# Requirements:
# - Strawberry Perl: https://strawberryperl.com/
# - HexChat installed with Perl plugin enabled.
#   Re-run the HexChat installer and under
#   "Language Interfaces" check "Perl (requires Perl 5.20)".
# - Verify the plugin is active: Window > Plugins and Scripts
#   should list "Perl Interface". If missing, see above.
#
# Installation:
# 1. Copy this file to %APPDATA%\HexChat\addons\
# 2. In HexChat: HexChat > Load Plugin or Script
#    (or restart HexChat — addons load automatically)
# 3. The server starts on port 12346 automatically.
#
# Commands (type in HexChat):
#   /bridge_status   - Show connection status
#   /bridge_start    - Start the TCP server
#   /bridge_stop     - Stop the TCP server
#   /bridge_restart  - Restart the TCP server
# ====================================================

use strict;
use warnings;
use IO::Socket::INET;
use IO::Select;

Xchat::register(
    'fuelrats_bridge', '1.0',
    'FuelRats Dispatch Board IRC Bridge',
    \&_on_unload
);

my $PORT   = 12346;
my $server = undef;
my $sel    = IO::Select->new();
my %buf;        # fileno => accumulated read buffer
my @cmd_queue;  # commands received from bridge

# ---- Helpers --------------------------------------------------------

sub _log { Xchat::print("*** FuelRats IRC Bridge: $_[0]") }

sub _remove_client {
    my ($sock) = @_;
    $sel->remove($sock);
    delete $buf{ $sock->fileno() };
    eval { $sock->close() };
    Xchat::print("*** FuelRats IRC Bridge: Bridge client disconnected");
}

sub _broadcast {
    my ($msg) = @_;
    $msg =~ s/\r?\n$//;
    $msg .= "\r\n";
    my @clients = defined $server
        ? grep { $_ != $server } $sel->handles()
        : $sel->handles();
    for my $client (@clients) {
        $client->send($msg) or _remove_client($client);
    }
}

# ---- Server control -------------------------------------------------

sub _start_server {
    if ( defined $server ) {
        _log("TCP server already running on port $PORT");
        return;
    }
    $server = IO::Socket::INET->new(
        LocalHost => '127.0.0.1',
        LocalPort => $PORT,
        Proto     => 'tcp',
        Listen    => 5,
        ReuseAddr => 1,
        Blocking  => 0,
    ) or do { _log("Failed to start TCP server: $!"); return };
    $sel->add($server);
    _log("TCP server started on port $PORT");
}

sub _stop_server {
    unless ( defined $server ) {
        _log("TCP server is not running");
        return;
    }
    for my $s ( $sel->handles() ) {
        $sel->remove($s);
        eval { $s->close() };
    }
    %buf   = ();
    $server = undef;
    _log("TCP server stopped");
}

# ---- Timer: poll sockets + drain command queue ----------------------

sub _poll {
    if ( defined $server ) {
        for my $sock ( $sel->can_read(0) ) {
            if ( $sock == $server ) {
                my $client = $server->accept() or next;
                $client->blocking(0);
                $sel->add($client);
                $buf{ $client->fileno() } = '';
                Xchat::print("*** FuelRats IRC Bridge: Bridge client connected");
                my $nick = Xchat::get_info('nick') // '';
                $client->send("IDENTIFY $nick\r\n");
            }
            else {
                my $data = '';
                my $n    = sysread( $sock, $data, 4096 );
                if ( !defined $n || $n == 0 ) {
                    _remove_client($sock);
                    next;
                }
                $buf{ $sock->fileno() } .= $data;
                while ( $buf{ $sock->fileno() } =~ s/^([^\n]*)\n// ) {
                    ( my $line = $1 ) =~ s/\r$//;
                    $line =~ s/^\s+|\s+$//g;
                    push @cmd_queue, $line if length $line;
                }
            }
        }
    }

    while (@cmd_queue) {
        my $cmd = shift @cmd_queue;
        Xchat::print("*** Bridge -> IRC: $cmd");
        # To allow the Dispatch Board to send to IRC (including #debrief),
        # uncomment the line below:
        # Xchat::command($cmd);
    }

    return 1;  # keep timer running
}

# ---- IRC event hooks ------------------------------------------------

sub _on_server_msg {
    my ( $word, $word_eol ) = @_;
    _broadcast( $word_eol->[0] );
    return Xchat::EAT_NONE();
}

sub _on_your_message {
    my ( $word, $word_eol ) = @_;
    my $nick    = Xchat::get_info('nick')    // 'me';
    my $channel = Xchat::get_info('channel') // '#';
    my $text    = $word->[1] // '';
    _broadcast(":$nick!dispatch\@local PRIVMSG $channel :$text");
    return Xchat::EAT_NONE();
}

sub _on_your_action {
    my ( $word, $word_eol ) = @_;
    my $nick    = Xchat::get_info('nick')    // 'me';
    my $channel = Xchat::get_info('channel') // '#';
    my $text    = $word->[1] // '';
    _broadcast(":$nick!dispatch\@local PRIVMSG $channel :\x01ACTION $text\x01");
    return Xchat::EAT_NONE();
}

# ---- Commands -------------------------------------------------------

sub _cmd_status {
    _log("Bridge Status:");
    _log( defined $server
        ? "  Listener: Active on port $PORT"
        : "  Listener: NOT ACTIVE  (run /bridge_start)" );
    my $count = defined $server
        ? scalar( grep { $_ != $server } $sel->handles() )
        : 0;
    _log("  Connected clients: $count");
    return Xchat::EAT_ALL();
}

sub _cmd_start   { _start_server();                  return Xchat::EAT_ALL() }
sub _cmd_stop    { _stop_server();                   return Xchat::EAT_ALL() }
sub _cmd_restart { _stop_server(); _start_server();  return Xchat::EAT_ALL() }
sub _on_unload   { _stop_server() }

# ---- Register hooks -------------------------------------------------

for my $event (qw(PRIVMSG NOTICE JOIN PART QUIT NICK)) {
    Xchat::hook_server( $event, \&_on_server_msg );
}
Xchat::hook_print( 'Your Message', \&_on_your_message );
Xchat::hook_print( 'Your Action',  \&_on_your_action );

Xchat::hook_command( 'bridge_status',  \&_cmd_status,  { help => '/bridge_status — show bridge status' } );
Xchat::hook_command( 'bridge_start',   \&_cmd_start,   { help => '/bridge_start — start the TCP server' } );
Xchat::hook_command( 'bridge_stop',    \&_cmd_stop,    { help => '/bridge_stop — stop the TCP server' } );
Xchat::hook_command( 'bridge_restart', \&_cmd_restart, { help => '/bridge_restart — restart the TCP server' } );

Xchat::hook_timer( 100, \&_poll );

_start_server();
_log("Plugin loaded (v1.0)");
