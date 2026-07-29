import { Case, CaseStatus, Injection, Message } from '../components/DispatchBoard';
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
   * Connect to the FuelRats API (REST first, then WebSocket)
   */
  connect(callback: (cases: Case[]) => void): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.isConnecting) return;

    this.isConnecting = true;
    this.shouldReconnect = true;
    this.onUpdateCallback = callback;
    this.notifyStatusChange('connecting');

    this.fetchActiveRescues()
      .then((cases) => {
        this.activeCases.clear();
        cases.forEach(c => this.activeCases.set(c.id, c));
        if (this.onUpdateCallback) this.onUpdateCallback(cases);
        cases.forEach(c => this.resolveUnmatchedNicks(c));
        this.connectWebSocket();
      })
      .catch((error) => {
        console.error('[FuelRats API] Initial REST fetch failed:', error);
        this.connectWebSocket();
      });
  }

  /**
   * Establish WebSocket connection for real-time updates
   */
  private connectWebSocket(): void {
    console.log(`[FuelRats WS] Connecting (attempt ${this.wsFailureCount + 1}/${this.maxWsFailures})...`);
    try {
      const wsUrlWithAuth = `${this.wsUrl}/?bearer=${this.apiKey}`;
      this.ws = new WebSocket(wsUrlWithAuth, this.wsProtocol);

      this.ws.onopen = () => {
        console.log('[FuelRats WS] Connected');
        this.isConnecting = false;
        this.notifyStatusChange('connected');
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WSMessage = JSON.parse(event.data);
          this.handleWebSocketMessage(message);
        } catch (error) {
          console.error('[FuelRats WS] Error parsing message:', error);
        }
      };

      this.ws.onerror = () => {
        console.error('[FuelRats WS] Connection error');
        this.isConnecting = false;
        this.notifyStatusChange('error');
        this.notifyError('WebSocket connection error');
      };

      this.ws.onclose = (event) => {
        console.log(`[FuelRats WS] Closed — code ${event.code} (${this.getCloseCodeDescription(event.code)})`);
        this.isConnecting = false;
        this.ws = null;

        if (this.pollingInterval) {
          clearInterval(this.pollingInterval);
          this.pollingInterval = null;
        }

        this.notifyStatusChange('disconnected');

        // 1000 = Normal closure, 1001 = Going away
        if (this.shouldReconnect && event.code !== 1000 && event.code !== 1001) {
          this.wsFailureCount++;
          if (this.wsFailureCount >= this.maxWsFailures) {
            console.warn('[FuelRats WS] Max failures reached, falling back to REST polling');
            this.startPolling();
          } else {
            console.log(`[FuelRats WS] Reconnecting in ${this.reconnectDelay / 1000}s (${this.wsFailureCount}/${this.maxWsFailures})...`);
            this.reconnectTimer = window.setTimeout(() => this.connectWebSocket(), this.reconnectDelay);
          }
        }
      };
    } catch (error) {
      console.error('[FuelRats WS] Failed to create connection:', error);
      this.isConnecting = false;
      this.notifyStatusChange('error');
      this.notifyError(`Failed to connect: ${error}`);
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
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const getRescuesMessage = [
      'rescues_initial',
      'rescues',
      { filter: JSON.stringify({ status: { ne: 'closed' } }), sort: '-createdAt' },
      {}
    ];

    try {
      this.ws.send(JSON.stringify(getRescuesMessage));
    } catch (error) {
      console.error('[FuelRats WS] Error sending rescue request:', error);
    }
  }

  /**
   * Handle incoming WebSocket messages
   * FuelRats format: [eventType, statusCode, data, meta]
   */
  private handleWebSocketMessage(message: WSMessage): void {
    const [eventType, statusCode, eventData] = message;

    if (statusCode === 200) {
      this.wsFailureCount = 0;
    }

    if (eventType === 'connection' && statusCode === 200) {
      if (eventData.meta) {
        this.rateLimitTotal = eventData.meta.rateLimitTotal || 0;
        this.rateLimitRemaining = eventData.meta.rateLimitRemaining || 0;
        if (eventData.meta.rateLimitReset) {
          this.rateLimitReset = new Date(eventData.meta.rateLimitReset);
        }
      }
      this.wsFailureCount = 0;
      this.ws!.send(JSON.stringify(['subscribe', 'events', 'subscribe', {}]));
      this.requestRescues();
      return;
    }

    if (eventType === 'fuelrats.rescuecreate' || eventType === 'fuelrats.rescueupdate') {
      this.fetchRescueById(eventData);
      return;
    }

    if (eventData.errors) {
      eventData.errors.forEach((err: any) => this.notifyError(`API Error: ${err.detail}`));
      return;
    }

    if (eventData.data) {
      const data = Array.isArray(eventData.data) ? eventData.data : [eventData.data];
      this.wsFailureCount = 0;

      if (data.length > 0 && data[0].type === 'rescues') {
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
          links: eventData.links || { self: '', first: '', last: '' },
          data,
          included: eventData.included || []
        };

        const cases = this.transformApiData(apiResponse);
        // Sync activeCases from the list, preserving inactive cases the list may omit
        cases.forEach(c => this.activeCases.set(c.id, c));
        for (const [id, c] of this.activeCases) {
          if (!cases.find(r => r.id === id) && c.status !== 'inactive') {
            this.activeCases.delete(id);
          }
        }
        if (this.onUpdateCallback) {
          this.onUpdateCallback(Array.from(this.activeCases.values()));
        }
      }
    }
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
        if (data.data.attributes?.status === 'closed') {
          const existing = Array.from(this.activeCases.values()).find(c => c.apiId === id);
          if (existing) this.activeCases.delete(existing.id);
        } else {
          this.activeCases.set(caseData.id, caseData);
          this.resolveUnmatchedNicks(caseData);
        }
        if (this.onUpdateCallback) this.onUpdateCallback(Array.from(this.activeCases.values()));
      }
    } catch (error) {
      console.error('[FuelRats API] Error fetching rescue by ID:', error);
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
    try {
      const params = new URLSearchParams({
        'filter': JSON.stringify({ status: { ne: 'closed' } }),
        'sort': '-createdAt'
      });

      const headers: HeadersInit = { 'Accept': 'application/json' };
      if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`;

      const response = await fetch(`${this.apiUrl}?${params.toString()}`, { headers });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data: ApiResponse = await response.json();

      if (data.meta) {
        this.rateLimitRemaining = data.meta.rateLimitRemaining;
        this.rateLimitTotal = data.meta.rateLimitTotal;
        this.rateLimitReset = new Date(data.meta.rateLimitReset);
      }

      return this.transformApiData(data);
    } catch (error) {
      console.error('[FuelRats API] Error fetching rescues:', error);
      this.notifyError(`Failed to fetch rescues: ${error}`);
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
    
    // Determine status based on API data.
    //
    // Inactive is checked first because it is the only one of these a dispatcher
    // sets deliberately, and it outranks the rest: a case that has been parked is
    // parked whether or not rats are on it or the client is on fumes. Checking it
    // last, as this used to, meant it was almost never reached -- cases usually go
    // inactive after rats were assigned, and there is a live case right now that
    // is inactive *and* codeRed, which reported 'code-red' and sorted to the top
    // of the board flashing. The code red itself is not lost: oxygenStatus below
    // is set from attrs.codeRed independently of this.
    let status: CaseStatus = 'open';
    if (attrs.status === 'inactive') {
      status = 'inactive';
    } else if (attrs.codeRed) {
      status = 'code-red';
    } else if (rescue.relationships.rats.data.length > 0) {
      status = 'assigned';
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

    // Scan quote messages for rat progress, jump calls, and SC distances
    type RatStage = { fr?: '+' | '-'; wr?: '+' | '-'; bc?: '+' | '-'; fuel?: boolean };
    const ratProgress: Record<string, RatStage> = {};
    const jumpCalls: Record<string, { jumps: number; text: string; timestamp: Date }> = {};
    let scDistance: { ls: number; timestamp: Date } | undefined;

    const statusPatterns: [RegExp, keyof RatStage, '+' | '-' | true][] = [
      [/\bfr\s*\+/i,        'fr',   '+'],
      [/\bfr\s*-/i,         'fr',   '-'],
      [/\b(?:wr|tm)\s*\+/i, 'wr',   '+'],
      [/\b(?:wr|tm)\s*-/i,  'wr',   '-'],
      [/\b(?:bc|inst)\s*\+/i, 'bc', '+'],
      [/\b(?:bc|inst)\s*-/i,  'bc', '-'],
      [/\bfuel\s*\+/i,      'fuel', true],
    ];

    // Matches "#2 4j" or "4j #2" in either order
    const jumpPattern = new RegExp(`(?:#${caseNum}\\s+(\\d+)j|(\\d+)j\\s+#${caseNum})\\b`, 'i');
    const extractJumps = (m: RegExpMatchArray) => parseInt(m[1] ?? m[2], 10);
    const caseNumPattern = new RegExp(`#${caseNum}\\b`);

    for (const msg of messages) {
      if (msg.isSystem || !msg.sender || !msg.text) continue;
      const text = msg.text;
      const sender = msg.sender;

      // Jump calls
      const jumpMatch = text.match(jumpPattern);
      if (jumpMatch) {
        jumpCalls[sender] = { jumps: extractJumps(jumpMatch), text, timestamp: msg.timestamp };
      }

      // SC distance: "#N ... X.Xly/ls/au"
      if (caseNumPattern.test(text)) {
        const distMatch = text.match(/([\d]*\.?[\d]+)\s*(Mls|kls|ls|ly|au)\b/i);
        if (distMatch) {
          const val = parseFloat(distMatch[1]);
          const unit = distMatch[2].toLowerCase();
          const ls = unit === 'ly' ? val * 31_557_600
            : unit === 'au' ? val * 499
            : unit === 'kls' ? val * 1_000
            : unit === 'mls' ? val * 1_000_000
            : val;
          scDistance = { ls, timestamp: msg.timestamp };
        }
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

    // Determine client channel presence from the last MechaSqueak join/leave quote
    const lastPresenceQuote = [...attrs.quotes].reverse().find((q) =>
      q.author === 'MechaSqueak[BOT]' &&
      (q.message === 'Client left the rescue channel' || q.message === 'Client rejoined the rescue channel')
    );
    const clientInChannel = lastPresenceQuote?.message !== 'Client left the rescue channel';

    // Quotes serve double duty: the chat log above is derived from them, but they
    // are also the case's own record -- the same list the rescue page shows under
    // "Quotes". Everything is kept, because the author only says who recorded a
    // line, not how useful it is: MechaSqueak is the author of every rat call-in
    // (`#7 1j`, `#7 rdy`, `#7 fuel+`), which is the rat action timeline, while a
    // dispatcher is the author of both !inject notes and !grab'd client lines.
    // Kept raw -- the relay parsing applied to the chat log rewrites the author,
    // which for a quote would misattribute it.
    const injections: Injection[] = attrs.quotes.map((quote, index) => ({
      id: `${caseId}-inj-${index}`,
      author: quote.author,
      text: quote.message,
      createdAt: new Date(quote.createdAt),
      isBot: quote.author.includes('[BOT]'),
      lastAuthor: quote.lastAuthor && quote.lastAuthor !== quote.author ? quote.lastAuthor : undefined,
    }));

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
      injections,
      assignedRats,
      ratIrcNicks,
      oxygenStatus: attrs.codeRed ? 'CRITICAL' : undefined,
      landmark: attrs.data.landmark || undefined,
      scDistance,
      ratProgress: Object.keys(ratProgress).length > 0 ? ratProgress : undefined,
      jumpCalls: Object.keys(jumpCalls).length > 0 ? jumpCalls : undefined,
      clientInChannel,
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
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.notifyStatusChange('disconnected');
  }

  /**
   * Start polling the REST API as a fallback when WebSocket fails
   */
  private startPolling(): void {
    if (this.pollingInterval) return;

    console.log('[FuelRats API] Starting REST polling fallback');
    this.notifyStatusChange('connected');
    this.fetchAndNotify();
    this.pollingInterval = window.setInterval(() => this.fetchAndNotify(), this.pollingDelay);
  }

  private async fetchAndNotify(): Promise<void> {
    try {
      const cases = await this.fetchActiveRescues();
      if (this.onUpdateCallback) this.onUpdateCallback(cases);
    } catch (error) {
      console.error('[FuelRats API] Polling error:', error);
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
