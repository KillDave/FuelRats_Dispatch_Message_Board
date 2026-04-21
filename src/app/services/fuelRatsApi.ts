import { Case, CaseStatus, Message } from '../components/DispatchBoard';
import { authService } from './authService';

interface ApiQuote {
  author: string;
  message: string;
  createdAt: string;
  updatedAt: string;
  lastAuthor: string;
}

interface ApiRescueAttributes {
  client: string;
  clientNick: string;
  clientLanguage: string;
  commandIdentifier: number;
  codeRed: boolean;
  data: {
    landmark?: {
      name: string;
      distance: number;
    };
    systemId?: number;
    dispatchers?: string[];
    clientLastHostname?: string;
  };
  notes: string;
  platform: string;
  expansion: string;
  system: string;
  title: string | null;
  unidentifiedRats: string[];
  createdAt: string;
  updatedAt: string;
  status: string;
  outcome: string | null;
  quotes: ApiQuote[];
}

interface ApiRescue {
  type: string;
  id: string;
  attributes: ApiRescueAttributes;
  relationships: {
    rats: {
      data: Array<{
        type: string;
        id: string;
      }>;
    };
    firstLimpet: {
      data: any;
    };
    epics: {
      data: any[];
    };
    lastEditUser: {
      data: {
        type: string;
        id: string;
      };
    };
  };
}

interface ApiRat {
  type: string;
  id: string;
  attributes: {
    name: string;
    data: any;
    platform: string;
    expansion: string;
    frontierId: string | null;
    createdAt: string;
    updatedAt: string;
  };
}

interface ApiResponse {
  jsonapi: {
    version: string;
    meta: {
      apiVersion: string;
    };
  };
  meta: {
    page: number;
    lastPage: number;
    offset: number;
    limit: number;
    total: number;
    apiVersion: string;
    rateLimitTotal: number;
    rateLimitRemaining: number;
    rateLimitReset: string;
  };
  links: {
    self: string;
    first: string;
    last: string;
  };
  data: ApiRescue[];
  included: Array<ApiRat | any>;
}

// WebSocket message types
// WebSocket message types
// FuelRats uses array format: [eventType, statusCode, data, meta]
type WSMessage = [string, number, any, any];

interface WSEventData {
  jsonapi?: {
    version: string;
    meta: {
      apiVersion: string;
    };
  };
  meta?: {
    apiVersion?: string;
    rateLimitTotal?: number;
    rateLimitRemaining?: number;
    rateLimitReset?: string;
    event?: string;
    resource?: string;
    timestamp?: string;
  };
  data?: any;
  included?: Array<ApiRat | any>;
  errors?: Array<{
    status: string;
    detail: string;
  }>;
}

export class FuelRatsApiService {
  private wsUrl = 'wss://api.fuelrats.com';
  private apiUrl = 'https://api.fuelrats.com/rescues';
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private reconnectDelay: number = 5000; // 5 seconds
  private get apiKey(): string { return authService.getToken() || ''; }
  private isConnecting: boolean = false;
  private shouldReconnect: boolean = true;
  private wsProtocol: string = 'FR-JSONAPI-WS'; // FuelRats WebSocket protocol
  private wsFailureCount: number = 0;
  private maxWsFailures: number = 3;
  private pollingInterval: number | null = null;
  private pollingDelay: number = 10000; // 10 seconds
  
  // Callbacks
  private onUpdateCallback: ((cases: Case[]) => void) | null = null;
  private onStatusChangeCallback: ((status: 'connected' | 'connecting' | 'disconnected' | 'error') => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  
  // Cache for active rescues (to merge WebSocket updates)
  private activeCases: Map<string, Case> = new Map();

  // Per-rescue rat ID → CMDR name map, used for /nicknames API lookups
  private rescueRatIdMaps: Map<string, Map<string, string>> = new Map();

  // Rate limit tracking
  public rateLimitRemaining: number = 0;
  public rateLimitTotal: number = 0;
  public rateLimitReset: Date | null = null;

  /**
   * Set the API key for authentication
   */
  setApiKey(key: string): void {
    this.apiKey = key;
  }

  /**
   * Connect to the FuelRats API (REST first, then WebSocket)
   */
  connect(callback: (cases: Case[]) => void): void {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔌 FuelRats API - Connection Requested');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('⚠️  WebSocket already connected or connecting');
      console.log('   Current state:', this.getReadyStateString(this.ws.readyState));
      return;
    }

    if (this.isConnecting) {
      console.log('⚠️  Connection attempt already in progress');
      return;
    }

    this.isConnecting = true;
    this.shouldReconnect = true;
    this.onUpdateCallback = callback;

    console.log('📊 Connection Strategy:');
    console.log('   Step 1: Fetch from REST API to get initial data');
    console.log('   Step 2: Establish WebSocket for real-time updates');

    this.notifyStatusChange('connecting');

    // STEP 1: Fetch initial data from REST API first (like official dispatch board)
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📡 STEP 1: Fetching initial data from REST API');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    this.fetchActiveRescues()
      .then((cases) => {
        console.log('✅ Initial REST fetch successful');
        console.log('   Received', cases.length, 'cases');
        
        // Update cache with initial data
        this.activeCases.clear();
        cases.forEach(c => this.activeCases.set(c.id, c));
        console.log('💾 Cached', this.activeCases.size, 'cases');

        // Send initial data to callback
        if (this.onUpdateCallback) {
          console.log('📤 Sending initial data to callback');
          this.onUpdateCallback(cases);
        }

        // Async nickname resolution for any unmatched rats
        cases.forEach(c => this.resolveUnmatchedNicks(c));
        
        // STEP 2: Now establish WebSocket for real-time updates
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📡 STEP 2: Establishing WebSocket connection');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        
        this.connectWebSocket();
      })
      .catch((error) => {
        console.error('❌ Initial REST fetch failed:', error);
        console.log('⚠️  Attempting WebSocket connection anyway...');
        
        // Try WebSocket anyway
        this.connectWebSocket();
      });
  }

  /**
   * Establish WebSocket connection for real-time updates
   */
  private connectWebSocket(): void {
    console.log('📊 WebSocket Parameters:');
    console.log('   Base URL:', this.wsUrl);
    console.log('   API Key:', this.apiKey.substring(0, 8) + '...' + this.apiKey.substring(this.apiKey.length - 4));
    console.log('   Protocol:', this.wsProtocol);
    console.log('   Failure Count:', this.wsFailureCount, '/', this.maxWsFailures);

    try {
      // Connect with bearer token as query parameter and specify WebSocket protocol
      const wsUrlWithAuth = `${this.wsUrl}/?bearer=${this.apiKey}`;
      console.log('🔗 Full WebSocket URL:', wsUrlWithAuth);
      console.log('🔐 Using Protocol:', this.wsProtocol);
      
      console.log('⏳ Creating WebSocket connection...');
      this.ws = new WebSocket(wsUrlWithAuth, this.wsProtocol);
      console.log('✅ WebSocket object created, state:', this.getReadyStateString(this.ws.readyState));

      this.ws.onopen = () => {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('✅ WebSocket OPENED Successfully');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('   Ready State:', this.getReadyStateString(this.ws!.readyState));
        console.log('   URL:', this.ws!.url);
        console.log('   Protocol:', this.ws!.protocol);
        console.log('   Extensions:', this.ws!.extensions || 'none');
        
        this.isConnecting = false;
        this.notifyStatusChange('connected');

        console.log('👂 Waiting for WebSocket messages...');
      };

      this.ws.onmessage = (event) => {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('📨 WebSocket MESSAGE Received');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('   Type:', typeof event.data);
        console.log('   Length:', event.data?.length || 0, 'bytes');
        console.log('   Raw Data:', event.data);
        
        try {
          const message: WSMessage = JSON.parse(event.data);
          console.log('✅ Successfully parsed JSON');
          console.log('   Message Structure:', Array.isArray(message) ? `Array[${message.length}]` : typeof message);
          console.log('   Parsed Message:', JSON.stringify(message, null, 2));
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error('❌ Error parsing WebSocket message');
          console.error('   Error:', error);
          console.error('   Raw data:', event.data);
        }
      };

      this.ws.onerror = (error) => {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('❌ WebSocket ERROR');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('   Error Event:', error);
        console.error('   Ready State:', this.ws ? this.getReadyStateString(this.ws.readyState) : 'null');
        console.error('   URL:', this.ws?.url);
        console.error('   Protocol:', this.ws?.protocol);
        
        this.isConnecting = false;
        this.notifyStatusChange('error');
        this.notifyError('WebSocket connection error');
      };

      this.ws.onclose = (event) => {
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('🔌 WebSocket CLOSED');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('   Code:', event.code, '(' + this.getCloseCodeDescription(event.code) + ')');
        console.log('   Reason:', event.reason || '<empty>');
        console.log('   Was Clean:', event.wasClean);
        console.log('   Timestamp:', new Date().toISOString());
        
        this.isConnecting = false;
        this.ws = null;
        
        // Clear WebSocket polling interval
        if (this.pollingInterval) {
          console.log('🧹 Clearing polling interval');
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
        }
        
        this.notifyStatusChange('disconnected');

        // Only count as failure if it wasn't a clean close
        // 1000 = Normal closure
        // 1001 = Going away
        if (this.shouldReconnect && event.code !== 1000 && event.code !== 1001) {
          this.wsFailureCount++;
          console.log('⚠️  Connection failed (count: ' + this.wsFailureCount + '/' + this.maxWsFailures + ')');
          
          // If WebSocket keeps failing, fall back to REST polling
          if (this.wsFailureCount >= this.maxWsFailures) {
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.warn('⚠️  WebSocket failed ' + this.wsFailureCount + ' times');
            console.warn('🔄 Falling back to REST API polling');
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            this.startPolling();
          } else {
            console.log('🔄 Reconnecting WebSocket in ' + (this.reconnectDelay / 1000) + ' seconds...');
            console.log('   (attempt ' + this.wsFailureCount + '/' + this.maxWsFailures + ')');
            this.reconnectTimer = window.setTimeout(() => {
              // Just reconnect WebSocket, not the whole flow (we already have initial data)
              this.connectWebSocket();
            }, this.reconnectDelay);
          }
        } else if (!this.shouldReconnect) {
          console.log('ℹ️  Reconnection disabled by user');
        } else {
          console.log('ℹ️  Clean closure - no reconnection needed');
        }
      };
    } catch (error) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('❌ Error creating WebSocket connection');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('   Error:', error);
      console.error('   Stack:', (error as Error).stack);
      
      this.isConnecting = false;
      this.notifyStatusChange('error');
      this.notifyError(`Failed to connect: ${error}`);
    }
  }

  /**
   * Get human-readable WebSocket ready state
   */
  private getReadyStateString(state: number): string {
    switch (state) {
      case WebSocket.CONNECTING: return 'CONNECTING (0)';
      case WebSocket.OPEN: return 'OPEN (1)';
      case WebSocket.CLOSING: return 'CLOSING (2)';
      case WebSocket.CLOSED: return 'CLOSED (3)';
      default: return `UNKNOWN (${state})`;
    }
  }

  /**
   * Get description for WebSocket close codes
   */
  private getCloseCodeDescription(code: number): string {
    const descriptions: { [key: number]: string } = {
      1000: 'Normal Closure',
      1001: 'Going Away',
      1002: 'Protocol Error',
      1003: 'Unsupported Data',
      1005: 'No Status Received',
      1006: 'Abnormal Closure',
      1007: 'Invalid Frame Payload Data',
      1008: 'Policy Violation',
      1009: 'Message Too Big',
      1010: 'Mandatory Extension',
      1011: 'Internal Server Error',
      1012: 'Service Restart',
      1013: 'Try Again Later',
      1014: 'Bad Gateway',
      1015: 'TLS Handshake Failure'
    };
    return descriptions[code] || 'Unknown';
  }

  /**
   * Request current rescues via WebSocket
   * Using standard REST API path through WebSocket
   */
  private requestRescues(): void {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📤 Requesting rescues via WebSocket');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('⚠️  Cannot request rescues - WebSocket not open');
      console.warn('   WebSocket:', this.ws ? 'exists' : 'null');
      console.warn('   State:', this.ws ? this.getReadyStateString(this.ws.readyState) : 'N/A');
      return;
    }

    // Correct WS format: [state, endpoint, query, body]
    const getRescuesMessage = [
      'rescues_initial',
      'rescues',
      { filter: JSON.stringify({ status: { ne: 'closed' } }), sort: '-createdAt' },
      {}
    ];

    try {
      this.ws.send(JSON.stringify(getRescuesMessage));
      console.log('✅ Rescue list request sent');
    } catch (error) {
      console.error('❌ Error sending request:', error);
    }
  }

  /**
   * Handle incoming WebSocket messages
   * FuelRats format: [eventType, statusCode, data, meta]
   */
  private handleWebSocketMessage(message: WSMessage): void {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔍 Handling WebSocket Message');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    const [eventType, statusCode, eventData, eventMeta] = message;
    
    console.log('📋 Message Details:');
    console.log('   Event Type:', eventType);
    console.log('   Status Code:', statusCode);
    console.log('   Has Data:', !!eventData);
    console.log('   Has Meta:', !!eventMeta);
    console.log('   Full Message:', JSON.stringify(message, null, 2));
    
    // Reset failure count on successful responses
    // Note: For rescue events, statusCode is actually a user ID, not an HTTP status
    if (statusCode === 200) {
      console.log('✅ Status 200 - Success! Resetting failure count');
      this.wsFailureCount = 0;
    } else if (eventType !== 'fuelrats.rescuecreate' && eventType !== 'fuelrats.rescueupdate') {
      // Only warn about non-200 for non-rescue events
      console.warn('⚠️  Non-200 status code:', statusCode);
    }

    // Handle connection confirmation
    if (eventType === 'connection' && statusCode === 200) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('✅ WebSocket Connection CONFIRMED');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      // Update rate limit info
      if (eventData.meta) {
        this.rateLimitTotal = eventData.meta.rateLimitTotal || 0;
        this.rateLimitRemaining = eventData.meta.rateLimitRemaining || 0;
        console.log('📊 Rate Limit Info:');
        console.log('   Total:', this.rateLimitTotal);
        console.log('   Remaining:', this.rateLimitRemaining);
        if (eventData.meta.rateLimitReset) {
          this.rateLimitReset = new Date(eventData.meta.rateLimitReset);
          console.log('   Reset:', this.rateLimitReset.toISOString());
        }
      }
      
      // Reset failure count on successful connection
      this.wsFailureCount = 0;
      
      // WebSocket is now ready for real-time updates
      // (Initial data was already fetched from REST API)
      // Subscribe to real-time events
      this.ws!.send(JSON.stringify(['subscribe', 'events', 'subscribe', {}]));
      console.log('📋 Subscribed to events, requesting rescue list...');
      this.requestRescues();
      return;
    }

    // Handle rescue create and update events
    // Format: [eventType, userId, rescueId, dataObject]
    if (eventType === 'fuelrats.rescuecreate' || eventType === 'fuelrats.rescueupdate') {
      const rescueId = eventData; // rescue UUID
      console.log(eventType === 'fuelrats.rescuecreate' ? '🆕 Rescue Created:' : '🔄 Rescue Updated:', rescueId);
      this.fetchRescueById(rescueId);
      return;
    }

    // Handle errors
    if (eventData.errors) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('❌ WebSocket API Errors Detected');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('   Errors:', eventData.errors);
      eventData.errors.forEach((err: any, index: number) => {
        console.error(`   Error ${index + 1}:`, err.detail);
        this.notifyError(`API Error: ${err.detail}`);
      });
      return;
    }

    // Handle rescue data (initial load or updates)
    if (eventData.data) {
      const data = Array.isArray(eventData.data) ? eventData.data : [eventData.data];
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📦 Received Rescue Data');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('   Count:', data.length);
      console.log('   First item type:', data[0]?.type);
      console.log('   First item ID:', data[0]?.id);
      
      // Reset failure count since we're getting data
      this.wsFailureCount = 0;
      
      // Check if this is rescue data
      if (data.length > 0 && data[0].type === 'rescues') {
        // Transform the data and send to callback
        const apiResponse: ApiResponse = {
          jsonapi: eventData.jsonapi || { version: '1.0', meta: { apiVersion: '3.1.0' } },
          meta: eventData.meta || {
            page: 1,
            lastPage: 1,
            previousPage: 0,
            offset: 0,
            limit: 100,
            total: data.length,
            apiVersion: '3.1.0',
            rateLimitTotal: this.rateLimitTotal,
            rateLimitRemaining: this.rateLimitRemaining,
            rateLimitReset: this.rateLimitReset?.toISOString() || new Date().toISOString()
          },
          links: eventData.links || {
            self: '',
            first: '',
            last: ''
          },
          data: data,
          included: eventData.included || []
        };
        
        const cases = this.transformApiData(apiResponse);
        if (this.onUpdateCallback) {
          this.onUpdateCallback(cases);
        }
      }
      return;
    }

    // Log unknown events for debugging
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.warn('⚠️  Unknown WebSocket Event');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.warn('   Event Type:', eventType);
    console.warn('   Status Code:', statusCode);
    console.warn('   Event Data:', eventData);
    console.warn('   Event Meta:', eventMeta);
    console.warn('   Full Message:', JSON.stringify(message, null, 2));
  }

  /**
   * Fetch active rescues from the REST API (used for initial load and refresh)
   */
  private async fetchRescueById(id: string): Promise<void> {
    try {
      const headers: HeadersInit = { 'Accept': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
      const response = await fetch(`${this.apiUrl}/${id}`, { headers });
      if (!response.ok) {
        if (response.status === 404) {
          // Rescue gone — remove from cache
          const existing = Array.from(this.activeCases.values()).find(c => c.apiId === id);
          if (existing) {
            this.activeCases.delete(existing.id);
            if (this.onUpdateCallback) this.onUpdateCallback(Array.from(this.activeCases.values()));
          }
        }
        return;
      }
      const data = await response.json();
      const apiResponse: ApiResponse = { ...data, data: [data.data], included: data.included || [] };
      const cases = this.transformApiData(apiResponse);
      if (cases.length > 0) {
        const caseData = cases[0];
        if (caseData.status === 'inactive' || (data.data.attributes?.status === 'closed')) {
          const existing = Array.from(this.activeCases.values()).find(c => c.apiId === id);
          if (existing) this.activeCases.delete(existing.id);
        } else {
          this.activeCases.set(caseData.id, caseData);
          this.resolveUnmatchedNicks(caseData);
        }
        if (this.onUpdateCallback) this.onUpdateCallback(Array.from(this.activeCases.values()));
      }
    } catch (error) {
      console.error('❌ Error fetching rescue by ID:', error);
    }
  }

  private async lookupNickname(nick: string): Promise<string | null> {
    const headers: HeadersInit = { 'Accept': 'application/json' };
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;
    try {
      const resp = await fetch(`https://api.fuelrats.com/nicknames?nick=${encodeURIComponent(nick)}`, { headers });
      if (!resp.ok) return null;
      const json = await resp.json();
      return json.data?.[0]?.relationships?.rat?.data?.id ?? null;
    } catch {
      return null;
    }
  }

  private async resolveUnmatchedNicks(caseData: Case): Promise<void> {
    if (!caseData.apiId) return;
    const ratIdMap = this.rescueRatIdMaps.get(caseData.apiId);
    if (!ratIdMap || ratIdMap.size === 0) return;

    const unmatchedRats = caseData.assignedRats.filter((r) => !caseData.ratIrcNicks[r]);
    if (unmatchedRats.length === 0) return;

    const activeNicks = new Set([
      ...Object.keys(caseData.jumpCalls ?? {}),
      ...Object.keys(caseData.ratProgress ?? {}),
    ]);
    const claimedNicks = new Set(Object.values(caseData.ratIrcNicks));
    const unclaimedActiveNicks = [...activeNicks].filter((n) => !claimedNicks.has(n));
    if (unclaimedActiveNicks.length === 0) return;

    let updated = false;
    for (const nick of unclaimedActiveNicks) {
      const ratId = await this.lookupNickname(nick);
      if (!ratId) continue;
      const cmdrName = ratIdMap.get(ratId);
      if (cmdrName && !caseData.ratIrcNicks[cmdrName]) {
        caseData.ratIrcNicks[cmdrName] = nick;
        updated = true;
        console.log(`🔍 Nickname lookup: ${nick} → ${cmdrName} (rat ${ratId})`);
      }
    }

    if (updated && this.onUpdateCallback) {
      this.onUpdateCallback(Array.from(this.activeCases.values()));
    }
  }

  async fetchActiveRescues(): Promise<Case[]> {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🌐 Fetching Active Rescues (REST API)');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    try {
      // Filter for non-closed rescues, sorted by newest first
      // v4 API uses JSON filter format
      const params = new URLSearchParams({
        'filter': JSON.stringify({ status: { ne: 'closed' } }),
        'sort': '-createdAt'
      });

      const headers: HeadersInit = {
        'Accept': 'application/json',
      };

      if (this.apiKey) {
        headers['Authorization'] = `Bearer ${this.apiKey}`;
      }

      const fullUrl = `${this.apiUrl}?${params.toString()}`;
      console.log('📡 Request Details:');
      console.log('   URL:', fullUrl);
      console.log('   Auth:', this.apiKey ? `Bearer ${this.apiKey.substring(0, 8)}...` : 'None');
      
      console.log('⏳ Sending REST API request...');
      const startTime = Date.now();
      const response = await fetch(fullUrl, { headers });
      const elapsed = Date.now() - startTime;
      
      console.log('📥 Response received in', elapsed + 'ms');
      console.log('   Status:', response.status, response.statusText);
      console.log('   Headers:', Object.fromEntries(response.headers.entries()));
      
      if (!response.ok) {
        console.error('❌ Request failed');
        console.error('   Status:', response.status);
        console.error('   Status Text:', response.statusText);
        const errorText = await response.text();
        console.error('   Response Body:', errorText);
        throw new Error(`API request failed: ${response.status}`);
      }

      console.log('✅ Response OK - parsing JSON...');
      const data: ApiResponse = await response.json();
      
      console.log('📊 Response Data:');
      console.log('   Has data:', !!data.data);
      console.log('   Data count:', Array.isArray(data.data) ? data.data.length : 'not array');
      console.log('   Has included:', !!data.included);
      console.log('   Included count:', Array.isArray(data.included) ? data.included.length : 'not array');
      
      // Update rate limit info
      if (data.meta) {
        this.rateLimitRemaining = data.meta.rateLimitRemaining;
        this.rateLimitTotal = data.meta.rateLimitTotal;
        this.rateLimitReset = new Date(data.meta.rateLimitReset);
        console.log('📊 Rate Limit:');
        console.log('   Remaining:', this.rateLimitRemaining);
        console.log('   Total:', this.rateLimitTotal);
        console.log('   Reset:', this.rateLimitReset.toISOString());
      }
      
      console.log('🔄 Transforming API data...');
      const cases = this.transformApiData(data);
      console.log('✅ Transformed', cases.length, 'cases');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      
      return cases;
    } catch (error) {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('❌ Error fetching rescues');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.error('   Error:', error);
      console.error('   Stack:', (error as Error).stack);
      this.notifyError(`Failed to fetch rescues: ${error}`);
      // Return empty array on error to prevent app crash
      return [];
    }
  }

  /**
   * Transform API response to our Case format
   */
  private transformApiData(apiResponse: ApiResponse): Case[] {
    const { data, included } = apiResponse;

    // Create a map of rat IDs to rat names for quick lookup
    const ratMap = new Map<string, string>();
    if (included) {
      included.forEach((item) => {
        if (item.type === 'rats') {
          ratMap.set(item.id, item.attributes.name);
        }
      });
    }

    return data.map((rescue) => {
      const rescueRatMap = new Map<string, string>();
      rescue.relationships.rats.data.forEach((ratRef) => {
        const name = ratMap.get(ratRef.id);
        if (name) rescueRatMap.set(ratRef.id, name);
      });
      this.rescueRatIdMaps.set(rescue.id, rescueRatMap);
      return this.transformRescue(rescue, ratMap);
    });
  }

  /**
   * Transform a single rescue to Case format
   */
  private transformRescue(rescue: ApiRescue, ratMap: Map<string, string>): Case {
    const attrs = rescue.attributes;
    
    // Determine status based on API data
    let status: CaseStatus = 'open';
    if (attrs.codeRed) {
      status = 'code-red';
    } else if (rescue.relationships.rats.data.length > 0) {
      status = 'assigned';
    } else if (attrs.status === 'inactive') {
      status = 'inactive';
    }

    // Get assigned rat names
    const assignedRats = rescue.relationships.rats.data
      .map((ratRef) => ratMap.get(ratRef.id))
      .filter((name): name is string => name !== undefined);

    // Transform quotes to messages
    const messages: Message[] = attrs.quotes.map((quote, index) => {
      // Parse mechabot relay messages
      let sender = quote.author;
      let text = quote.message;
      let isSystem = quote.author.includes('[BOT]');

      // Check if this is a mechabot relay message
      const isMechabot = quote.author.toLowerCase().includes('mechasqueak[bot]');

      if (isMechabot) {
        // Try multiple parsing patterns for mechabot relays
        
        // Pattern 1: [RatName] message
        const bracketMatch = quote.message.match(/^\[([^\]]+)\]\s*(.+)$/);
        if (bracketMatch) {
          sender = bracketMatch[1].trim();
          text = bracketMatch[2].trim();
          isSystem = false;
        } 
        // Pattern 2: <RatName> message
        else {
          const angleBracketMatch = quote.message.match(/^<([^>]+)>\s*(.+)$/);
          if (angleBracketMatch) {
            sender = angleBracketMatch[1].trim();
            text = angleBracketMatch[2].trim();
            isSystem = false;
          }
          // Pattern 3: RatName: message (single word name only)
          else {
            const colonMatch = quote.message.match(/^([^\s:]+):\s*(.+)$/);
            if (colonMatch) {
              sender = colonMatch[1].trim();
              text = colonMatch[2].trim();
              isSystem = false;
            }
            // Pattern 4: Check if message starts with a rat name followed by any punctuation
            else {
              // Try to match any of the assigned rats at the start of the message
              const ratNames = [...assignedRats, ...attrs.unidentifiedRats];
              for (const ratName of ratNames) {
                if (ratName && quote.message.startsWith(ratName)) {
                  // Check if followed by : or space
                  const restOfMessage = quote.message.substring(ratName.length).trim();
                  if (restOfMessage.startsWith(':') || restOfMessage.startsWith('-')) {
                    sender = ratName;
                    text = restOfMessage.substring(1).trim();
                    isSystem = false;
                    break;
                  }
                }
              }
            }
          }
        }
      }

      return {
        id: `${rescue.id}-msg-${index}`,
        sender,
        text,
        timestamp: new Date(quote.createdAt),
        isSystem
      };
    });

    // Build CMDR name → IRC nick map from relay-parsed message senders.
    // Normalise by lowercasing and stripping non-alphanumeric so that
    // "Dr Leo" (CMDR) matches "Dr_Leo" (IRC nick).
    const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
    const ircNicksSeen = new Set<string>(
      messages
        .filter((m) => !m.isSystem && m.sender !== 'Dispatch')
        .map((m) => m.sender)
    );
    const ratIrcNicks: Record<string, string> = {};

    // Pass 1: exact normalized match (e.g. "Dr_Leo" → "Dr Leo")
    for (const cmdrName of assignedRats) {
      const normalizedCmdr = normalize(cmdrName);
      for (const nick of ircNicksSeen) {
        if (normalize(nick) === normalizedCmdr) {
          ratIrcNicks[cmdrName] = nick;
          break;
        }
      }
    }

    // Pass 2: prefix-match fallback for shortened IRC nicks (e.g. "Nat" → "Natalia Renault")
    for (const cmdrName of assignedRats) {
      if (ratIrcNicks[cmdrName]) continue;
      const normalizedCmdr = normalize(cmdrName);
      for (const nick of ircNicksSeen) {
        const normalizedNick = normalize(nick);
        if (normalizedNick.length >= 3 && normalizedCmdr.startsWith(normalizedNick)) {
          // Only use if unambiguous — no other unmatched CMDR also starts with this nick
          const isAmbiguous = assignedRats
            .filter((r) => r !== cmdrName && !ratIrcNicks[r])
            .some((r) => normalize(r).startsWith(normalizedNick));
          if (!isAmbiguous) {
            ratIrcNicks[cmdrName] = nick;
            break;
          }
        }
      }
    }

    // Format case ID with leading zero
    const caseId = `case-${attrs.commandIdentifier.toString().padStart(2, '0')}`;
    const caseNum = attrs.commandIdentifier;

    // Scan quote messages for rat progress and jump calls
    type RatStage = { fr?: '+' | '-'; wr?: '+' | '-'; bc?: '+' | '-'; fuel?: boolean };
    const ratProgress: Record<string, RatStage> = {};
    const jumpCalls: Record<string, { jumps: number; text: string; timestamp: Date }> = {};

    const statusPatterns: [RegExp, keyof RatStage, '+' | '-' | true][] = [
      [/\bfr\s*\+/i,        'fr',   '+'],
      [/\bfr\s*-/i,         'fr',   '-'],
      [/\b(?:wr|tm)\s*\+/i, 'wr',   '+'],
      [/\b(?:wr|tm)\s*-/i,  'wr',   '-'],
      [/\bbc\s*\+/i,        'bc',   '+'],
      [/\bbc\s*-/i,         'bc',   '-'],
      [/\bfuel\s*\+/i,      'fuel', true],
    ];

    const jumpPattern = new RegExp(`#${caseNum}\\s+(\\d+)j\\b`, 'i');

    for (const msg of messages) {
      if (msg.isSystem || !msg.sender || !msg.text) continue;
      const text = msg.text;
      const sender = msg.sender;

      // Jump calls
      const jumpMatch = text.match(jumpPattern);
      if (jumpMatch) {
        jumpCalls[sender] = { jumps: parseInt(jumpMatch[1], 10), text, timestamp: msg.timestamp };
      }

      // Status patterns
      const current = ratProgress[sender] ?? {};
      const updated = { ...current };
      const fuelAlreadyClaimed = Object.values(ratProgress).some((p) => p.fuel);
      let changed = false;
      for (const [pattern, key, value] of statusPatterns) {
        if (pattern.test(text)) {
          if (key === 'fuel' && fuelAlreadyClaimed) continue;
          (updated as Record<string, unknown>)[key] = value;
          changed = true;
        }
      }
      if (changed) ratProgress[sender] = updated;
    }

    // Pass 3: if exactly 1 rat is unmatched and exactly 1 "active" nick
    // (one that sent a jump call or status update) is unclaimed, map them.
    const claimedNicks = new Set(Object.values(ratIrcNicks));
    const activeNicks = new Set([...Object.keys(jumpCalls), ...Object.keys(ratProgress)]);
    const unmatchedRats = assignedRats.filter((r) => !ratIrcNicks[r]);
    const unclaimedActiveNicks = [...activeNicks].filter((n) => !claimedNicks.has(n));
    if (unmatchedRats.length === 1 && unclaimedActiveNicks.length === 1) {
      ratIrcNicks[unmatchedRats[0]] = unclaimedActiveNicks[0];
    }

    return {
      id: caseId,
      apiId: rescue.id, // Store the API's UUID for WebSocket event matching
      clientName: attrs.client || attrs.clientNick,
      ircNick: attrs.clientNick || undefined,
      system: attrs.system || 'Unknown',
      platform: this.formatPlatform(attrs.platform, attrs.expansion),
      language: attrs.clientLanguage || undefined,
      status,
      messages,
      assignedRats,
      ratIrcNicks,
      oxygenStatus: attrs.codeRed ? 'CRITICAL' : undefined,
      landmark: attrs.data.landmark || undefined,
      ratProgress: Object.keys(ratProgress).length > 0 ? ratProgress : undefined,
      jumpCalls: Object.keys(jumpCalls).length > 0 ? jumpCalls : undefined,
      createdAt: new Date(attrs.createdAt)
    };
  }

  /**
   * Format platform string for display
   */
  private formatPlatform(platform: string, expansion: string): string {
    const platformMap: Record<string, string> = {
      pc: 'PC',
      ps: 'PlayStation',
      xb: 'Xbox'
    };

    const expansionMap: Record<string, string> = {
      odyssey: 'Odyssey',
      horizons4: 'Horizons',
      horizons3: 'Legacy',
      legacy: 'Legacy'
    };

    const platformStr = platformMap[platform] || platform.toUpperCase();

    // PlayStation and Xbox don't have meaningful expansion variants — just show the platform
    if (platform === 'ps' || platform === 'xb') {
      return platformStr;
    }

    const expansionStr = expansionMap[expansion] || expansion;
    return `${platformStr} - ${expansionStr}`;
  }

  /**
   * Disconnect from WebSocket
   */
  disconnect(): void {
    this.shouldReconnect = false;

    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pollingInterval !== null) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }

    if (this.ws) {
      console.log('Disconnecting from FuelRats WebSocket API...');
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.notifyStatusChange('disconnected');
  }

  /**
   * Start polling the REST API as a fallback when WebSocket fails
   */
  private startPolling(): void {
    if (this.pollingInterval) {
      console.log('⚠️  Already polling - skipping');
      return; // Already polling
    }

    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('🔄 Starting REST API Polling Mode');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('   Interval:', this.pollingDelay / 1000, 'seconds');
    console.log('   Reason: WebSocket unavailable');
    
    this.notifyStatusChange('connected');

    // Do an immediate fetch
    console.log('📡 Performing initial fetch...');
    this.fetchAndNotify();

    // Then poll at intervals
    console.log('⏰ Setting up polling interval...');
    this.pollingInterval = window.setInterval(() => {
      console.log('🔄 Polling interval triggered');
      this.fetchAndNotify();
    }, this.pollingDelay);
    console.log('✅ Polling started successfully');
  }

  /**
   * Fetch data and notify callback
   */
  private async fetchAndNotify(): Promise<void> {
    console.log('📡 fetchAndNotify called');
    try {
      const cases = await this.fetchActiveRescues();
      console.log('📦 Fetched', cases.length, 'cases - notifying callback');
      if (this.onUpdateCallback) {
        this.onUpdateCallback(cases);
        console.log('✅ Callback notified');
      } else {
        console.warn('⚠️  No callback registered');
      }
    } catch (error) {
      console.error('❌ Polling error:', error);
      // Don't notify errors repeatedly during polling
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  /**
   * Set status change callback
   */
  onStatusChange(callback: (status: 'connected' | 'connecting' | 'disconnected' | 'error') => void): void {
    this.onStatusChangeCallback = callback;
  }

  /**
   * Set error callback
   */
  onError(callback: (error: string) => void): void {
    this.onErrorCallback = callback;
  }

  /**
   * Notify status change
   */
  private notifyStatusChange(status: 'connected' | 'connecting' | 'disconnected' | 'error'): void {
    if (this.onStatusChangeCallback) {
      this.onStatusChangeCallback(status);
    }
  }

  /**
   * Notify error
   */
  private notifyError(error: string): void {
    if (this.onErrorCallback) {
      this.onErrorCallback(error);
    }
  }

  /**
   * Get current rate limit info
   */
  getRateLimitInfo(): { remaining: number; total: number; resetDate: Date | null } {
    return {
      remaining: this.rateLimitRemaining,
      total: this.rateLimitTotal,
      resetDate: this.rateLimitReset
    };
  }

}

export const fuelRatsApi = new FuelRatsApiService();
