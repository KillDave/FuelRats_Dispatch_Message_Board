export interface IRCMessage {
  type: 'message' | 'system' | 'join' | 'part' | 'quit' | 'action' | 'notice' | 'identify';
  channel?: string;
  nick?: string;
  text: string;
  timestamp: Date;
  caseId?: string; // Extracted case ID if message is case-related
}

export type IRCConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export class IRCWebSocketService {
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectAttempts: number = 0;
  private maxReconnectAttempts: number = 5;
  private reconnectDelay: number = 3000;
  
  public status: IRCConnectionStatus = 'disconnected';
  public myNick: string | null = null; // Our IRC nick, set via IDENTIFY from AdiIRC
  public onMessage: ((message: IRCMessage) => void) | null = null;
  public onStatusChange: ((status: IRCConnectionStatus) => void) | null = null;
  public onError: ((error: string) => void) | null = null;

  /**
   * Connect to AdiIRC WebSocket server
   */
  connect(url: string): void {
    console.log('[IRC WS] ========================================');
    console.log('[IRC WS] connect() called with URL:', url);
    console.log('[IRC WS] URL type:', typeof url);
    console.log('[IRC WS] URL length:', url.length);
    console.log('[IRC WS] Browser WebSocket support:', typeof WebSocket !== 'undefined');
    
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[IRC WS] Already connected to IRC WebSocket');
      return;
    }

    if (this.ws) {
      console.log('[IRC WS] Previous ws exists, readyState:', this.ws.readyState);
    }

    try {
      console.log('[IRC WS] About to create WebSocket...');
      this.updateStatus('connecting');
      console.log('[IRC WS] Status updated to connecting');
      console.log('[IRC WS] Calling new WebSocket() constructor...');
      this.ws = new WebSocket(url);
      console.log('[IRC WS] ✅ WebSocket object created successfully!');
      console.log('[IRC WS] WebSocket readyState:', this.ws.readyState);
      console.log('[IRC WS] WebSocket url property:', this.ws.url);

      this.ws.onopen = () => {
        console.log('[IRC WS] ✅ Connected successfully!');
        console.log('[IRC WS] ReadyState:', this.ws?.readyState);
        this.reconnectAttempts = 0;
        this.updateStatus('connected');
      };

      this.ws.onmessage = (event) => {
        console.log('[IRC WS] 📨 Received message:', event.data);
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error('[IRC WS] Error parsing IRC message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[IRC WS] ❌ onerror event fired!');
        console.error('[IRC WS] Error object:', error);
        console.error('[IRC WS] Error type:', typeof error);
        console.error('[IRC WS] Error constructor:', error.constructor.name);
        console.error('[IRC WS] ReadyState:', this.ws?.readyState);
        this.updateStatus('error');
        if (this.onError) {
          this.onError('WebSocket connection error');
        }
      };

      this.ws.onclose = (event) => {
        console.log('[IRC WS] 🔌 onclose event fired!');
        console.log('[IRC WS] Close code:', event.code);
        console.log('[IRC WS] Close reason:', event.reason);
        console.log('[IRC WS] Was clean:', event.wasClean);
        console.log('[IRC WS] ReadyState:', this.ws?.readyState);
        this.updateStatus('disconnected');
        this.attemptReconnect(url);
      };
      
      console.log('[IRC WS] All event handlers attached successfully');
      console.log('[IRC WS] ========================================');
    } catch (error) {
      console.error('[IRC WS] ❌ EXCEPTION in connect()!');
      console.error('[IRC WS] Exception type:', typeof error);
      console.error('[IRC WS] Exception:', error);
      console.error('[IRC WS] Exception message:', (error as Error).message);
      console.error('[IRC WS] Exception stack:', (error as Error).stack);
      this.updateStatus('error');
      if (this.onError) {
        this.onError('Failed to connect: ' + (error as Error).message);
      }
    }
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    this.reconnectAttempts = this.maxReconnectAttempts; // Prevent auto-reconnect
    
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    this.updateStatus('disconnected');
  }

  /**
   * Send a message to IRC via WebSocket
   */
  sendMessage(target: string, message: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const payload = {
        type: 'message',
        target,
        text: message
      };
      this.ws.send(JSON.stringify(payload));
    } else {
      console.error('Cannot send message: WebSocket not connected');
      if (this.onError) {
        this.onError('Cannot send message: Not connected to IRC');
      }
    }
  }

  /**
   * Send a raw IRC command
   */
  sendRaw(command: string): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      const payload = {
        type: 'raw',
        command
      };
      this.ws.send(JSON.stringify(payload));
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(data: any): void {
    // Capture our IRC nick from IDENTIFY messages
    if (data.type === 'identify' && data.nick) {
      this.myNick = data.nick;
      console.log('[IRC WS] Identified as:', this.myNick);
      return; // Don't forward identify to message handlers
    }

    const ircMessage: IRCMessage = {
      type: data.type || 'message',
      channel: data.channel,
      nick: data.nick,
      text: data.text || data.message || '',
      timestamp: data.timestamp ? new Date(data.timestamp) : new Date(),
    };

    // Try to extract case ID from message
    const caseId = this.extractCaseId(ircMessage.text);
    if (caseId) {
      ircMessage.caseId = caseId;
    }

    if (this.onMessage) {
      this.onMessage(ircMessage);
    }
  }

  /**
   * Extract case ID from message text
   * Looks for patterns like: #0, #1, #15, case 5, etc.
   */
  private extractCaseId(text: string): string | undefined {
    // Pattern: #0-20 or case 0-20
    const patterns = [
      /#(\d{1,2})\b/i,           // #5, #15
      /\bcase[:\s]+(\d{1,2})\b/i, // case 5, case: 15
      /\[(\d{1,2})\]/,            // [5]
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const caseNum = parseInt(match[1], 10);
        if (caseNum >= 0 && caseNum <= 20) {
          return `case-${caseNum.toString().padStart(2, '0')}`;
        }
      }
    }

    return undefined;
  }

  /**
   * Update connection status
   */
  private updateStatus(status: IRCConnectionStatus): void {
    this.status = status;
    if (this.onStatusChange) {
      this.onStatusChange(status);
    }
  }

  /**
   * Attempt to reconnect after disconnect
   */
  private attemptReconnect(url: string): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

    this.reconnectTimer = window.setTimeout(() => {
      this.connect(url);
    }, this.reconnectDelay);
  }

  /**
   * Get current connection status
   */
  getStatus(): IRCConnectionStatus {
    return this.status;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

export const ircWebSocket = new IRCWebSocketService();
