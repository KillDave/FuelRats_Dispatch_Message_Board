import React, { useState, useEffect } from 'react';
import { IRCConnectionStatus } from '../services/ircWebSocket';

interface IRCConnectionPanelProps {
  status: IRCConnectionStatus;
  onConnect: (url: string) => void;
  onDisconnect: () => void;
  errorMessage?: string;
  channel: string;
  onChannelChange: (channel: string) => void;
}

export function IRCConnectionPanel({
  status,
  onConnect,
  onDisconnect,
  errorMessage,
  channel,
  onChannelChange
}: IRCConnectionPanelProps) {
  const [wsUrl, setWsUrl] = useState('ws://localhost:8080');
  const [isExpanded, setIsExpanded] = useState(false);

  const handleConnect = () => {
    if (wsUrl.trim()) {
      onConnect(wsUrl.trim());
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case 'connected':
        return 'text-green-400';
      case 'connecting':
        return 'text-yellow-400';
      case 'error':
        return 'text-red-400';
      default:
        return 'text-slate-400';
    }
  };

  const getStatusText = () => {
    switch (status) {
      case 'connected':
        return 'IRC: CONNECTED';
      case 'connecting':
        return 'IRC: CONNECTING...';
      case 'error':
        return 'IRC: ERROR';
      default:
        return 'IRC: DISCONNECTED';
    }
  };

  return (
    <div className="bg-slate-800/50 border border-slate-600 rounded">
      {/* Status Bar */}
      <div 
        className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-slate-700/30"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            status === 'connected' ? 'bg-green-400 animate-pulse' :
            status === 'connecting' ? 'bg-yellow-400 animate-pulse' :
            status === 'error' ? 'bg-red-400' :
            'bg-slate-500'
          }`} />
          <span className={`text-sm font-semibold ${getStatusColor()}`}>
            {getStatusText()}
          </span>
        </div>
        <button className="text-slate-400 hover:text-white text-xs">
          {isExpanded ? '▼' : '▶'}
        </button>
      </div>

      {/* Expandable Configuration */}
      {isExpanded && (
        <div className="border-t border-slate-600 p-3 space-y-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">
              AdiIRC WebSocket URL
            </label>
            <input
              type="text"
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              disabled={status === 'connected' || status === 'connecting'}
              placeholder="ws://localhost:8080"
              className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white placeholder-slate-500 disabled:opacity-50"
            />
          </div>

          <div>
            <label className="block text-xs text-slate-400 mb-1">
              IRC Channel
            </label>
            <input
              type="text"
              value={channel}
              onChange={(e) => onChannelChange(e.target.value)}
              placeholder="#fuelrats"
              className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm text-white placeholder-slate-500"
            />
          </div>

          {errorMessage && (
            <div className="text-xs text-red-400 bg-red-900/20 border border-red-700/50 rounded px-2 py-1">
              {errorMessage}
            </div>
          )}

          <div className="flex gap-2">
            {status === 'connected' ? (
              <button
                onClick={onDisconnect}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm py-1 rounded"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleConnect}
                disabled={status === 'connecting' || !wsUrl.trim()}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white text-sm py-1 rounded"
              >
                {status === 'connecting' ? 'Connecting...' : 'Connect'}
              </button>
            )}
          </div>

          <div className="text-xs text-slate-400 bg-slate-900/50 rounded p-2">
            <div className="font-semibold text-slate-300 mb-1">Setup Instructions:</div>
            <ol className="list-decimal list-inside space-y-1">
              <li>Create WebSocket server in AdiIRC script</li>
              <li>Send JSON messages: <code className="text-orange-400">{'{ type, channel, nick, text }'}</code></li>
              <li>Enter WebSocket URL above and connect</li>
            </ol>
          </div>
        </div>
      )}
    </div>
  );
}
