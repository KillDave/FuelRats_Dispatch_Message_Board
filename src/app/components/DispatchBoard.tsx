import { useState, useEffect, useRef } from 'react';
import { CaseWindow } from './CaseWindow';
import { MessageEditorPage } from './MessageEditorPage';
import { Button } from '@/app/components/ui/button';
import { Eye, EyeOff, Sidebar, User, MapPin, AlertTriangle, Clock, LogOut } from 'lucide-react';
import { fuelRatsApi } from '../services/fuelRatsApi';
import { ircWebSocket, IRCMessage, IRCConnectionStatus } from '../services/ircWebSocket';
import { IRCConnectionPanel } from './IRCConnectionPanel';
import fuelRatsLogo from './image/TransparentBackgroundRatto.png';
import { dispatchMessages, rescueMessages } from '../config/quickMessages';
import type { QuickMessageGroup } from '../config/quickMessages';
import { BUTTON_GROUPS_KEY, DISPATCH_CONFIG_KEY, RESCUE_CONFIG_KEY } from '../config/messageTreeHelpers';

// Helper component for displaying elapsed time
function CaseTimer({ startTime }: { startTime: Date }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
      const interval = setInterval(() => {
      const seconds = Math.floor((Date.now() - startTime.getTime()) / 1000);
      setElapsed(seconds);
    }, 1000);
    return () => clearInterval(interval);
  }, [startTime]);

  const formatElapsedTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  return <span>{formatElapsedTime(elapsed)}</span>;
}

// Helper component for displaying UTC time with Elite Dangerous year (3312)
function UTCClock() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const formatUTCTime = (date: Date) => {
    const hours = date.getUTCHours().toString().padStart(2, '0');
    const minutes = date.getUTCMinutes().toString().padStart(2, '0');
    const seconds = date.getUTCSeconds().toString().padStart(2, '0');
    const day = date.getUTCDate().toString().padStart(2, '0');
    const monthNames = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const month = monthNames[date.getUTCMonth()];
    
    const edYear = date.getUTCFullYear() + 1286;
    return `${hours}:${minutes}:${seconds} UTC | ${day} ${month} ${edYear}`;
  };

  return <span className="text-slate-300 font-mono text-base">{formatUTCTime(time)}</span>;
}

export type CaseStatus = 'open' | 'assigned' | 'code-red' | 'inactive' | 'closed';

export interface Message {
  id: string;
  sender: string;
  text: string;
  timestamp: Date;
  isSystem?: boolean;
  isIRC?: boolean; // Flag to identify IRC messages
  isNotice?: boolean; // Flag for IRC NOTICE messages (e.g. translations)
  translation?: string; // Translated text attached to the original message
}

export interface Case {
  id: string;
  apiId?: string; // The API's internal UUID for this rescue
  clientName: string;
  ircNick?: string; // The client's IRC nickname (may differ from clientName)
  system: string;
  platform: string;
  language?: string;
  status: CaseStatus;
  messages: Message[];
  assignedRats: string[];
  ratIrcNicks: Record<string, string>; // CMDR name → IRC nick, derived from relay messages
  oxygenStatus?: string;
  landmark?: { name: string; distance: number };
  scoopable?: boolean;
  nearestStation?: { name: string; distanceToArrival: number; type: string; systemName?: string; systemDistance?: number };
  ratProgress?: Record<string, {
    fr?: '+' | '-';
    wr?: '+' | '-';
    bc?: '+' | '-';
    fuel?: boolean;
  }>;
  jumpCalls?: Record<string, { jumps: number; text: string; timestamp: Date }>;
  createdAt: Date;
}

const initialCases: Case[] = [];

const RESCUE_DEFAULT: QuickMessageGroup = { label: 'RESCUE', messages: rescueMessages };
const DEFAULT_BUTTON_GROUPS: QuickMessageGroup[] = [RESCUE_DEFAULT, dispatchMessages];

function loadButtonGroups(): QuickMessageGroup[] {
  try {
    const s = localStorage.getItem(BUTTON_GROUPS_KEY);
    if (s) return JSON.parse(s) as QuickMessageGroup[];
  } catch {}
  // Migrate from old separate keys
  if (localStorage.getItem(RESCUE_CONFIG_KEY) !== null || localStorage.getItem(DISPATCH_CONFIG_KEY) !== null) {
    const rescue = (() => { try { const s = localStorage.getItem(RESCUE_CONFIG_KEY); return s ? JSON.parse(s) : RESCUE_DEFAULT; } catch { return RESCUE_DEFAULT; } })();
    const dispatch = (() => { try { const s = localStorage.getItem(DISPATCH_CONFIG_KEY); return s ? JSON.parse(s) : dispatchMessages; } catch { return dispatchMessages; } })();
    const groups = [rescue, dispatch];
    localStorage.setItem(BUTTON_GROUPS_KEY, JSON.stringify(groups));
    return groups;
  }
  return DEFAULT_BUTTON_GROUPS;
}

export function DispatchBoard({ onLogout }: { onLogout?: () => void }) {
  const [view, setView] = useState<'board' | 'editor'>('board');
  const [buttonGroups, setButtonGroups] = useState<QuickMessageGroup[]>(loadButtonGroups);
  const [useApiData] = useState(true); // API active by default
  const [cases, setCases] = useState<Case[]>(initialCases);
  const [toggledCaseIds, setToggledCaseIds] = useState<Set<string>>(
    new Set(initialCases.map((c) => c.id))
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [unreadCases, setUnreadCases] = useState<Set<string>>(new Set());
  const [isLoadingApi, setIsLoadingApi] = useState(false);
  const [, setRateLimitRemaining] = useState(0);
  const [, setSecondsToReset] = useState(0);
  const seenCaseIdsRef = useRef<Set<string>>(
    new Set(initialCases.map((c) => c.id))
  ); // Track which cases we've already seen to avoid flashing on every poll
  const scoopableFetchedRef = useRef<Map<string, string>>(new Map()); // caseId → system name last fetched
  const nearestStationFetchedRef = useRef<Map<string, string>>(new Map()); // caseId → system name last fetched
  // Tracks the rat IRC nick used in the most recent !gofr/!go command per case,
  // so we can correlate with MechaSqueak's response to learn nick → CMDR name
  const lastRatCommandRef = useRef<Map<string, { nicks: string[]; time: number }>>(new Map());

  // IRC state
  const [ircStatus, setIrcStatus] = useState<IRCConnectionStatus>('disconnected');
  const [ircError, setIrcError] = useState<string | undefined>();
  const [ircChannel, setIrcChannel] = useState('#fuelrats'); // Default IRC channel
  const [isConnectionPanelOpen, setIsConnectionPanelOpen] = useState(false);
  const ircFailCountRef = useRef(0);

  // Effect to handle API WebSocket connection when useApiData is enabled
  useEffect(() => {
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('⚙️  DispatchBoard: API Connection Effect');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('   useApiData:', useApiData);
    
    if (!useApiData) {
      console.log('ℹ️  API data disabled - skipping connection');
      return;
    }

    console.log('📡 Initializing FuelRats API connection...');
    setIsLoadingApi(true);

    // Connect to WebSocket and receive real-time updates
    fuelRatsApi.connect((fetchedCases) => {
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📥 DispatchBoard: Received cases from API');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('   Fetched cases:', fetchedCases.length);
      setIsLoadingApi(false);
      
      // Merge with existing cases to preserve local state like messages added by dispatch
      setCases((prevCases) => {
        // Create a map of existing cases by ID
        const prevCasesMap = new Map(prevCases.map((c) => [c.id, c]));
        
        // Track which cases are actually NEW (not seen before)
        const newCaseIds: string[] = [];
        
        // Update or add fetched cases
        const updatedCases = fetchedCases.map((fetchedCase) => {
          const existingCase = prevCasesMap.get(fetchedCase.id);
          
          // Check if this is a brand new case we haven't seen
          if (!seenCaseIdsRef.current.has(fetchedCase.id)) {
            newCaseIds.push(fetchedCase.id);
            seenCaseIdsRef.current.add(fetchedCase.id);
          }
          
          if (existingCase) {
            // If same case number but different API UUID, it's a new rescue reusing the number
            // Discard the old closed case and treat this as brand new
            if (existingCase.apiId && fetchedCase.apiId && existingCase.apiId !== fetchedCase.apiId) {
              newCaseIds.push(fetchedCase.id);
              seenCaseIdsRef.current.add(fetchedCase.id);
              return fetchedCase;
            }

            // Merge messages: keep existing + add any new ones from API
            // Deduplicate by id, or by text only within a 15-second window to handle
            // the IRC/API race where the same content can arrive via both streams.
            const existingMessageIds = new Set(existingCase.messages.map((m) => m.id));
            const newMessages = fetchedCase.messages.filter((msg) => {
              if (existingMessageIds.has(msg.id)) return false;
              const recentDupe = existingCase.messages.some(
                (m) => m.text === msg.text &&
                  Math.abs(m.timestamp.getTime() - msg.timestamp.getTime()) < 5000
              );
              return !recentDupe;
            });

            return {
              ...fetchedCase,
              messages: [...existingCase.messages, ...newMessages],
              scoopable: existingCase.scoopable,
              nearestStation: existingCase.nearestStation,
              ratProgress: existingCase.ratProgress,
              jumpCalls: existingCase.jumpCalls,
              // Merge ratIrcNicks: live IRC-derived mappings take precedence over API-derived
              ratIrcNicks: { ...fetchedCase.ratIrcNicks, ...existingCase.ratIrcNicks },
            };
          }
          
          return fetchedCase;
        });
        
        // Auto-toggle all new cases to make them visible
        if (newCaseIds.length > 0) {
          setToggledCaseIds((prev) => {
            const newSet = new Set(prev);
            newCaseIds.forEach((id) => newSet.add(id));
            return newSet;
          });
        }
        
        // Auto-remove cases the API no longer returns (closed/resolved on the API side)
        // Clear them from seenCaseIdsRef so the case number can be reused later
        const fetchedIds = new Set(fetchedCases.map((c) => c.id));
        prevCases
          .filter((c) => !fetchedIds.has(c.id))
          .forEach((c) => seenCaseIdsRef.current.delete(c.id));

        return updatedCases;
      });
    });

    // Cleanup: disconnect WebSocket when component unmounts or useApiData is disabled
    return () => {
      fuelRatsApi.disconnect();
    };
  }, [useApiData]);

  // Fetch scoopable star status from EDSM; re-fetches if a case's system name changes
  useEffect(() => {
    cases.forEach((c) => {
      const system = c.system;
      if (!system || system === 'Unknown') return;
      if (scoopableFetchedRef.current.get(c.id) === system) return; // already fetched for this system
      scoopableFetchedRef.current.set(c.id, system);
      fetch(`https://www.edsm.net/api-v1/system?systemName=${encodeURIComponent(system)}&showPrimaryStar=1`)
        .then((r) => r.json())
        .then((data) => {
          if (typeof data?.primaryStar?.isScoopable === 'boolean') {
            setCases((prev) =>
              prev.map((pc) =>
                pc.id === c.id && pc.system === system
                  ? { ...pc, scoopable: data.primaryStar.isScoopable }
                  : pc
              )
            );
          }
        })
        .catch(() => {});
    });
  }, [cases]);

  // Fetch nearest station from EDSM; re-fetches if a case's system name changes.
  // Falls back to a 50ly sphere search if the rescue system has no stations.
  useEffect(() => {
    cases.forEach((c) => {
      const system = c.system;
      if (!system || system === 'Unknown') return;
      if (nearestStationFetchedRef.current.get(c.id) === system) return;
      nearestStationFetchedRef.current.set(c.id, system);

      fetch(`https://www.edsm.net/api-system-v1/stations?systemName=${encodeURIComponent(system)}`)
        .then((r) => r.json())
        .then(async (data) => {
          const stations: { name: string; distanceToArrival: number; type: string }[] =
            data?.stations ?? [];

          if (stations.length > 0) {
            const nearest = stations.reduce((a, b) =>
              a.distanceToArrival <= b.distanceToArrival ? a : b
            );
            setCases((prev) =>
              prev.map((pc) =>
                pc.id === c.id && pc.system === system
                  ? { ...pc, nearestStation: { name: nearest.name, distanceToArrival: nearest.distanceToArrival, type: nearest.type } }
                  : pc
              )
            );
            return;
          }

          // No stations in system — search nearby systems within 50ly
          const sphereRes = await fetch(
            `https://www.edsm.net/api-v1/sphere-systems?systemName=${encodeURIComponent(system)}&radius=50&showInformation=1`
          );
          const nearbySystems: { name: string; distance: number; information?: { population?: number } }[] =
            await sphereRes.json();

          // Filter to populated systems (likely to have stations), sort by distance
          const candidates = nearbySystems
            .filter((s) => (s.information?.population ?? 0) > 0)
            .sort((a, b) => a.distance - b.distance);

          for (const candidate of candidates) {
            const stnRes = await fetch(
              `https://www.edsm.net/api-system-v1/stations?systemName=${encodeURIComponent(candidate.name)}`
            );
            const stnData = await stnRes.json();
            const nearbyStations: { name: string; distanceToArrival: number; type: string }[] =
              stnData?.stations ?? [];

            if (nearbyStations.length > 0) {
              const nearest = nearbyStations.reduce((a, b) =>
                a.distanceToArrival <= b.distanceToArrival ? a : b
              );
              setCases((prev) =>
                prev.map((pc) =>
                  pc.id === c.id && pc.system === system
                    ? { ...pc, nearestStation: { name: nearest.name, distanceToArrival: nearest.distanceToArrival, type: nearest.type, systemName: candidate.name, systemDistance: candidate.distance } }
                    : pc
                )
              );
              return;
            }
          }
        })
        .catch(() => {});
    });
  }, [cases]);

  // Sync toggledCaseIds and unreadCases when cases are removed from state
  useEffect(() => {
    const caseIds = new Set(cases.map((c) => c.id));
    setToggledCaseIds((prev) => {
      const filtered = new Set([...prev].filter((id) => caseIds.has(id)));
      return filtered.size === prev.size ? prev : filtered;
    });
    setUnreadCases((prev) => {
      const filtered = new Set([...prev].filter((id) => caseIds.has(id)));
      return filtered.size === prev.size ? prev : filtered;
    });
  }, [cases]);

  // Effect to update rate limit display every second
  useEffect(() => {
    if (!useApiData) {
      setRateLimitRemaining(0);
      setSecondsToReset(0);
      return;
    }

    const updateRateLimit = () => {
      const info = fuelRatsApi.getRateLimitInfo();
      setRateLimitRemaining(info.remaining);
      
      if (info.resetDate) {
        const now = new Date();
        const seconds = Math.max(0, Math.floor((info.resetDate.getTime() - now.getTime()) / 1000));
        setSecondsToReset(seconds);
      }
    };

    updateRateLimit();
    const interval = setInterval(updateRateLimit, 1000);

    return () => clearInterval(interval);
  }, [useApiData]);

  // IRC WebSocket setup
  useEffect(() => {
    // Set up IRC message handler
    ircWebSocket.onMessage = (ircMsg: IRCMessage) => {
      handleIRCMessage(ircMsg);
    };

    // Set up status change handler
    ircWebSocket.onStatusChange = (status: IRCConnectionStatus) => {
      setIrcStatus(status);
      if (status === 'connected') {
        setIrcError(undefined);
        ircFailCountRef.current = 0;
        setIsConnectionPanelOpen(false);
      }
    };

    // Set up error handler
    ircWebSocket.onError = (error: string) => {
      setIrcError(error);
    };

    // Each failed connection attempt increments the counter;
    // after 2 failures open the connection status panel
    ircWebSocket.onConnectionFailed = () => {
      ircFailCountRef.current += 1;
      if (ircFailCountRef.current >= 2) {
        setIsConnectionPanelOpen(true);
      }
    };

    // Auto-connect using the saved URL (defaults to ws://localhost:8080)
    const savedUrl = localStorage.getItem('fr_irc_ws_url') || 'ws://localhost:8080';
    ircWebSocket.connect(savedUrl);

    return () => {
      ircWebSocket.disconnect();
    };
  }, []);

  const handleIRCMessage = (ircMsg: IRCMessage) => {
    if (ircMsg.type === 'system') {
      console.log('[IRC System]', ircMsg.text);
      return;
    }

    if ((ircMsg.type !== 'message' && ircMsg.type !== 'notice') || !ircMsg.nick || !ircMsg.text) return;

    // Detect MechaSqueak nick-change notice and update ircNick immediately,
    // before the API has a chance to reflect the new value.
    // Format: "Caution: Client of case #7 (old name) has changed IRC nick to newNick"
    const nickChangeMatch = ircMsg.text.match(/Client of case #(\d+) .+ has changed IRC nick to (\S+)/i);
    if (nickChangeMatch && ircMsg.nick?.toLowerCase().includes('mechasqueak')) {
      const caseNum = parseInt(nickChangeMatch[1], 10);
      const newNick = nickChangeMatch[2];
      const caseId = `case-${caseNum.toString().padStart(2, '0')}`;
      setCases((prev) => prev.map((c) => c.id === caseId ? { ...c, ircNick: newNick } : c));
    }

    const isNotice = ircMsg.type === 'notice';

    setCases((prev) =>
      prev.map((c) => {
        // Match by case number, IRC nick (exact), fuzzy client name, or text mention
        const nickLower = ircMsg.nick!.toLowerCase();
        const textLower = ircMsg.text.toLowerCase();

        // For translation notices like "<PlzDontKillDave> translated text",
        // extract the inner sender nick so we can match by who originally spoke
        let effectiveNickLower = nickLower;
        if (isNotice) {
          const innerNickMatch = ircMsg.text.match(/^<([^>]+)>/);
          if (innerNickMatch) {
            effectiveNickLower = innerNickMatch[1].toLowerCase();
          }
        }

        // Prefer exact IRC nick match when available from the API
        const ircNickLower = c.ircNick?.toLowerCase();
        const exactNickMatch = ircNickLower && (effectiveNickLower === ircNickLower || textLower.includes(ircNickLower));

        // Fallback: fuzzy match client name (handles spaces, underscores, periods)
        const clientNameLower = c.clientName.toLowerCase();
        const normalizedClientName = clientNameLower.replace(/[. _]+/g, '[. _]*');
        const namePattern = new RegExp(normalizedClientName);
        const fuzzyMatch = namePattern.test(effectiveNickLower) || namePattern.test(textLower);

        // Check if the message sender is an assigned rat (e.g. "Dr Leo" → matches IRC nick "Dr_Leo")
        const matchedRatName = c.assignedRats.find((ratName) => {
          const normalizedRat = ratName.toLowerCase().replace(/[. _]+/g, '[. _]*');
          return new RegExp(`^${normalizedRat}$`).test(effectiveNickLower) || new RegExp(normalizedRat).test(textLower);
        });
        const isAssignedRat = !!matchedRatName;

        // For private notices (e.g. MechaSqueak translations), match by text content
        // since they aren't sent to a channel
        const isPrivateNotice = isNotice && !ircMsg.channel?.startsWith('#');

        // Also check if the effective nick (from <SenderNick> in notices) recently sent
        // a message in this case — handles dispatcher's own translations
        const hasRecentMessage = isNotice && c.messages.some(
          (msg) => !msg.isSystem && msg.sender.toLowerCase() === effectiveNickLower
        );

        const isForThisCase =
          (ircMsg.caseId && c.id === ircMsg.caseId) ||
          (ircMsg.channel === '#fuelrats' && (exactNickMatch || fuzzyMatch || isAssignedRat || hasRecentMessage)) ||
          (isPrivateNotice && (exactNickMatch || fuzzyMatch || isAssignedRat || hasRecentMessage));

        if (!isForThisCase) return c;

        // Strip [#N] case prefix from outbound messages that bounced back via IRC
        const displayText = ircMsg.text.replace(/^\[#\d{1,2}\]\s*/, '');

        // For translation notices, attach to the most recent message from that sender
        // Notice format: "<SenderNick> translated text"
        if (isNotice) {
          const senderMatch = displayText.match(/^<([^>]+)>\s*(.+)$/s);
          if (senderMatch) {
            const [, originalSender, translatedText] = senderMatch;
            // Find the most recent message from this sender (fuzzy match nick)
            const normalizedSender = originalSender.toLowerCase().replace(/[. _]+/g, '[. _]*');
            const senderPattern = new RegExp(`^${normalizedSender}$`, 'i');
            const lastMsgIndex = [...c.messages].reverse().findIndex(
              (msg) => !msg.isSystem && senderPattern.test(msg.sender.toLowerCase())
            );
            if (lastMsgIndex !== -1) {
              const actualIndex = c.messages.length - 1 - lastMsgIndex;
              const updatedMessages = [...c.messages];
              updatedMessages[actualIndex] = {
                ...updatedMessages[actualIndex],
                translation: translatedText.trim(),
              };
              return { ...c, messages: updatedMessages };
            }
          }
          // If we can't match to an original message, fall through and add as separate notice
        }

        // Deduplicate only against API-sourced messages — catches the IRC/API race where
        // the same content arrives via both streams, without suppressing identical messages
        // from different IRC users.
        const isDuplicate = c.messages.some(
          (msg) => !msg.isIRC &&
            msg.text === displayText &&
            (Date.now() - msg.timestamp.getTime()) < 5000
        );

        if (isDuplicate) {
          console.log('🚫 Duplicate IRC/API message detected, skipping:', displayText);
          return c;
        }

        const newMessage: Message = {
          id: `irc-${Date.now()}-${Math.random()}`,
          sender: ircMsg.nick || 'IRC',
          text: displayText,
          timestamp: ircMsg.timestamp,
          isIRC: true,
          isNotice,
        };

        // Mark as unread if window is not visible
        if (!toggledCaseIds.has(c.id)) {
          setUnreadCases((prev) => new Set(prev).add(c.id));
        }

        // Extract IRC nickname from "Incoming Client" messages if we don't have one yet
        const updatedIrcNick = c.ircNick || (() => {
          const nickMatch = displayText.match(/IRC Nickname:\s*(\S+)/i);
          return nickMatch ? nickMatch[1] : undefined;
        })();

        let updatedRatIrcNicks = c.ratIrcNicks;

        // PRIMARY: learn nick → CMDR from MechaSqueak's response to !gofr/!go
        // Response format (any language): ... "CMDR Name 1" "CMDR Name 2"
        // Zip quoted names from the response with nicks from the command by index
        if (ircMsg.nick?.toLowerCase().includes('mechasqueak')) {
          const lastCmd = lastRatCommandRef.current.get(c.id);
          if (lastCmd && Date.now() - lastCmd.time < 30000) {
            const quotedNames = [...displayText.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
            quotedNames.forEach((cmdrName, i) => {
              const nick = lastCmd.nicks[i];
              if (nick && c.assignedRats.includes(cmdrName) && !updatedRatIrcNicks[cmdrName]) {
                updatedRatIrcNicks = { ...updatedRatIrcNicks, [cmdrName]: nick };
              }
            });
          }
        }

        // BACKUP: learn from direct rat attribution (e.g. nick matches assigned rat name)
        if (matchedRatName && ircMsg.nick && !updatedRatIrcNicks[matchedRatName]) {
          updatedRatIrcNicks = { ...updatedRatIrcNicks, [matchedRatName]: ircMsg.nick };
        }

        // Detect jump calls: "#N Xj [optional text]"
        let updatedJumpCalls = c.jumpCalls ?? {};
        const caseNum = parseInt(c.id.split('-')[1], 10);
        const jumpMatch = displayText.match(new RegExp(`#${caseNum}\\s+(\\d+)j\\b`, 'i'));
        if (jumpMatch && ircMsg.nick) {
          updatedJumpCalls = {
            ...updatedJumpCalls,
            [ircMsg.nick]: { jumps: parseInt(jumpMatch[1], 10), text: displayText, timestamp: ircMsg.timestamp },
          };
        }

        // Detect rat status reports: fr±, wr±, sys+, inst±, bc±, fuel+
        let updatedRatProgress = c.ratProgress ?? {};
        const ratKey = matchedRatName ?? ircMsg.nick;
        if (ratKey) {
          const current = updatedRatProgress[ratKey] ?? {};
          const updated = { ...current };
          const statusPatterns: [RegExp, keyof typeof updated, '+' | '-' | true][] = [
            [/\bfr\s*\+/i,          'fr',   '+'],
            [/\bfr\s*-/i,           'fr',   '-'],
            [/\b(?:wr|tm)\s*\+/i,   'wr',   '+'],
            [/\b(?:wr|tm)\s*-/i,    'wr',   '-'],
            [/\bbc\s*\+/i,          'bc',   '+'],
            [/\bbc\s*-/i,           'bc',   '-'],
            [/\bfuel\s*\+/i,        'fuel', true],
          ];
          // fuel is a case-level first-delivery flag — only the first rat to report it is marked
          const fuelAlreadyClaimed = Object.values(updatedRatProgress).some((p) => p.fuel);
          let changed = false;
          for (const [pattern, key, value] of statusPatterns) {
            if (pattern.test(displayText)) {
              if (key === 'fuel' && fuelAlreadyClaimed) continue;
              (updated as Record<string, unknown>)[key] = value;
              changed = true;
            }
          }
          if (changed) {
            updatedRatProgress = { ...updatedRatProgress, [ratKey]: updated };
          }
        }

        return {
          ...c,
          ircNick: updatedIrcNick,
          ratIrcNicks: updatedRatIrcNicks,
          jumpCalls: updatedJumpCalls,
          ratProgress: updatedRatProgress,
          messages: [...c.messages, newMessage],
        };
      })
    );
  };

  const handleIRCConnect = (url: string) => {
    setIrcError(undefined);
    ircWebSocket.connect(url);
  };

  const handleIRCDisconnect = () => {
    ircWebSocket.disconnect();
  };

  // Sort cases oldest-first (by createdAt ascending)
  const sortedCases = [...cases].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const visibleCases = sortedCases.filter((c) => toggledCaseIds.has(c.id));

  const addMessage = (caseId: string, text: string, channel?: string) => {
    if (!text.trim()) return;
    const targetChannel = channel || ircChannel;
    // Commands like /tr are executed by AdiIRC directly, not wrapped in PRIVMSG
    if (text.startsWith('/')) {
      ircWebSocket.sendRaw(text);
    } else {
      ircWebSocket.sendMessage(targetChannel, text);

      // Track rat nicks used in !gofr/!go commands (including -a translated variants)
      // Format: !gofr[-a] <caseNumber> <nick1> [nick2 ...]
      const ratCmdMatch = text.match(/^!(?:gofr|go)-?a?\s+\d+\s+(.+)/i);
      if (ratCmdMatch) {
        const nicks = ratCmdMatch[1].trim().split(/\s+/);
        lastRatCommandRef.current.set(caseId, { nicks, time: Date.now() });
      }

      // Add the message to this case window immediately so it appears right away
      // The deduplication logic will prevent it from showing twice when it bounces back via IRC
      setCases((prev) =>
        prev.map((c) => {
          if (c.id !== caseId) return c;
          const newMessage: Message = {
            id: `local-${Date.now()}-${Math.random()}`,
            sender: ircWebSocket.myNick || 'You',
            text,
            timestamp: new Date(),
            isIRC: true,
          };
          return { ...c, messages: [...c.messages, newMessage] };
        })
      );
    }
  };

  const clearUnread = (caseId: string) => {
    setUnreadCases((prev) => {
      const newSet = new Set(prev);
      newSet.delete(caseId);
      return newSet;
    });
  };

  const updateCaseStatus = (caseId: string, status: CaseStatus) => {
    setCases((prev) =>
      prev.map((c) => (c.id === caseId ? { ...c, status } : c))
    );
  };

  const closeCase = (caseId: string) => {
    // Mark as closed but keep in the board for debugging — use the X in the sidebar to remove
    setCases((prev) => prev.map((c) => (c.id === caseId ? { ...c, status: 'closed' } : c)));
  };

  const assignRat = (caseId: string, ratName: string) => {
    if (!ratName.trim()) return;
    
    setCases((prev) =>
      prev.map((c) =>
        c.id === caseId && !c.assignedRats.includes(ratName)
          ? { ...c, assignedRats: [...c.assignedRats, ratName] }
          : c
      )
    );
  };

  const removeRat = (caseId: string, ratName: string) => {
    setCases((prev) =>
      prev.map((c) =>
        c.id === caseId
          ? { ...c, assignedRats: c.assignedRats.filter((rat) => rat !== ratName) }
          : c
      )
    );
  };

  const toggleCase = (caseId: string) => {
    setToggledCaseIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(caseId)) {
        newSet.delete(caseId);
      } else {
        newSet.add(caseId);
      }
      return newSet;
    });
  };

  const getStatusColor = (status: CaseStatus) => {
    switch (status) {
      case 'open':
        return 'bg-blue-500';
      case 'assigned':
        return 'bg-yellow-500';
      case 'code-red':
        return 'bg-red-500';
      case 'inactive':
        return 'bg-slate-500';
      case 'closed':
        return 'bg-slate-700';
      default:
        return 'bg-slate-500';
    }
  };

  return (
    <>
    <div className="size-full bg-black relative overflow-hidden flex flex-col">
      {/* Background Image */}
      <div 
        className="absolute inset-[10%] bg-contain bg-center bg-no-repeat opacity-20"
        style={{
          backgroundImage: `url(${fuelRatsLogo})`,
        }}
      />
      
      {/* Header */}
      <div className="bg-slate-900/90 backdrop-blur-sm border-b border-slate-700 px-6 py-4 flex-shrink-0 relative z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="outline"
              size="icon"
              className="bg-slate-800 border-slate-600 hover:bg-slate-700"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <Sidebar className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-2xl font-bold text-orange-500">FuelRats Dispatch Board</h1>
              <p className="text-sm text-slate-400 mt-1">
                Active Cases: {cases.length} | Viewing: {visibleCases.length} | Code Red:{' '}
                {cases.filter((c) => c.status === 'code-red').length}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setView('editor')}
                className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-400 hover:text-orange-400 hover:bg-orange-500/10 border border-slate-700 hover:border-orange-500/40 rounded transition-colors"
                title="Edit quick messages"
              >
                Messages
              </button>
              {onLogout && (
                <button
                  onClick={onLogout}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs text-slate-400 hover:text-red-400 hover:bg-red-500/10 border border-slate-700 hover:border-red-500/40 rounded transition-colors"
                  title="Sign out"
                >
                  <LogOut className="w-3 h-3" />
                  Sign out
                </button>
              )}
            </div>
          </div>

          {/* Status Legend with UTC Time */}
          <div className="flex flex-col items-end gap-2">
            <UTCClock />
            <div className="flex gap-4 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                <span className="text-slate-300">Open</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <span className="text-slate-300">Assigned</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <span className="text-slate-300">Code Red</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-slate-500"></div>
                <span className="text-slate-300">Inactive</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0 relative z-10">
        {/* Sidebar */}
        {sidebarOpen && (
          <div className="w-80 bg-slate-900/80 backdrop-blur-sm border-r border-slate-700 flex flex-col flex-shrink-0">
            <div className="px-4 py-3 border-b border-slate-700">
              <h2 className="font-semibold text-white">Active Cases</h2>
              <p className="text-xs text-slate-400 mt-1">
                Click to toggle visibility
              </p>
            </div>
            <div className="flex-1 overflow-y-auto">
              {sortedCases.map((caseData) => {
                const isVisible = toggledCaseIds.has(caseData.id);
                const hasUnread = unreadCases.has(caseData.id);
                return (
                  <button
                    key={caseData.id}
                    onClick={() => toggleCase(caseData.id)}
                    className={`w-full px-4 py-3 border-b border-slate-800 hover:bg-slate-800 transition-colors text-left ${
                      isVisible ? 'bg-slate-850' : 'bg-slate-900 opacity-60'
                    } ${hasUnread && isVisible ? 'animate-pulse bg-orange-500/10 border-l-4 border-l-orange-500' : ''} ${hasUnread && !isVisible ? 'animate-pulse bg-red-500/20 border-l-4 border-l-red-500 opacity-100' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <div
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${
                              hasUnread && !isVisible ? 'bg-red-500 animate-pulse' : getStatusColor(caseData.status)
                            }`}
                          ></div>
                          <User className={`w-3 h-3 flex-shrink-0 ${hasUnread && !isVisible ? 'text-red-400' : isVisible ? 'text-slate-400' : 'text-slate-600'}`} />
                          <span className={`text-sm font-semibold truncate ${hasUnread && !isVisible ? 'text-white' : isVisible ? 'text-white' : 'text-slate-500'}`}>
                            CMDR {caseData.clientName}
                          </span>
                          {caseData.status === 'code-red' && isVisible && (
                            <AlertTriangle className="w-3 h-3 text-red-500 animate-pulse flex-shrink-0" />
                          )}
                        </div>
                        <div className={`flex items-center gap-2 text-xs mb-1 ${isVisible ? 'text-slate-400' : 'text-slate-600'}`}>
                          <span title="Click to copy system name">
                            <MapPin
                              className="w-3 h-3 flex-shrink-0 cursor-pointer hover:text-orange-400 transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(caseData.system);
                              }}
                            />
                          </span>
                          <span className="truncate">{caseData.system}</span>
                          <span>•</span>
                          <span>{caseData.platform}</span>
                        </div>
                        <div className={`flex items-center gap-2 text-xs mb-1 ${isVisible ? 'text-slate-400' : 'text-slate-600'}`}>
                          <Clock className="w-3 h-3 flex-shrink-0" />
                          <span className="font-semibold">
                            <CaseTimer startTime={caseData.createdAt} />
                          </span>
                        </div>
                        {caseData.assignedRats.length > 0 && (
                          <div className={`text-xs mt-1 ${isVisible ? 'text-slate-500' : 'text-slate-600'}`}>
                            Rats: {caseData.assignedRats.join(', ')}
                          </div>
                        )}
                      </div>
                      <div className="flex-shrink-0 flex items-center gap-2">
                        <span className="text-2xl font-bold text-orange-400">
                          {caseData.id.split('-')[1]}
                        </span>
                        {isVisible ? (
                          <Eye className="w-4 h-4 text-orange-500" />
                        ) : hasUnread ? (
                          <EyeOff className="w-4 h-4 text-red-500 animate-pulse" />
                        ) : (
                          <EyeOff className="w-4 h-4 text-slate-600" />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Connection Status Panel */}
            <div className="border-t border-slate-700 flex-shrink-0">
              {/* Header toggle */}
              <div
                className="flex items-center justify-between px-4 py-2 cursor-pointer hover:bg-slate-800/50"
                onClick={() => setIsConnectionPanelOpen(!isConnectionPanelOpen)}
              >
                <div className="flex items-center gap-3">
                  {/* API dot */}
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${isLoadingApi ? 'bg-yellow-400 animate-pulse' : useApiData ? 'bg-green-400' : 'bg-red-400'}`} />
                    <span className={`text-xs ${isLoadingApi ? 'text-yellow-400' : useApiData ? 'text-green-400' : 'text-red-400'}`}>API</span>
                  </div>
                  {/* IRC dot */}
                  <div className="flex items-center gap-1.5">
                    <div className={`w-2 h-2 rounded-full ${ircStatus === 'connected' ? 'bg-green-400' : ircStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' : ircStatus === 'error' ? 'bg-red-400' : 'bg-slate-500'}`} />
                    <span className={`text-xs ${ircStatus === 'connected' ? 'text-green-400' : ircStatus === 'connecting' ? 'text-yellow-400' : ircStatus === 'error' ? 'text-red-400' : 'text-slate-400'}`}>IRC</span>
                  </div>
                </div>
                <span className="text-slate-500 text-xs">{isConnectionPanelOpen ? '▼︎' : '▶︎'}</span>
              </div>
              {/* Expanded config */}
              {isConnectionPanelOpen && (
                <div className="border-t border-slate-700/50 px-4 py-3 space-y-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-400 mb-1">FuelRats API</div>
                    <div className={`flex items-center gap-2 text-xs ${isLoadingApi ? 'text-yellow-400' : useApiData ? 'text-green-400' : 'text-red-400'}`}>
                      <div className={`w-2 h-2 rounded-full ${isLoadingApi ? 'bg-yellow-400 animate-pulse' : useApiData ? 'bg-green-400' : 'bg-red-400'}`} />
                      {isLoadingApi ? 'Connecting...' : useApiData ? 'Connected' : 'Disconnected'}
                    </div>
                  </div>
                  <div className="border-t border-slate-700/50" />
                  <div>
                    <div className="text-xs font-semibold text-slate-400 mb-2">IRC Bridge</div>
                    <IRCConnectionPanel
                      status={ircStatus}
                      onConnect={handleIRCConnect}
                      onDisconnect={handleIRCDisconnect}
                      errorMessage={ircError}
                      channel={ircChannel}
                      onChannelChange={setIrcChannel}
                      embedded={true}
                    />
                  </div>
                </div>
              )}
            </div>

          </div>
        )}

        {/* Case Windows */}
        <div className="flex-1 flex min-w-0">
          {visibleCases.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              <div className="text-center">
                <EyeOff className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p className="text-lg">No cases selected</p>
                <p className="text-sm mt-1">Toggle cases from the sidebar to view them</p>
              </div>
            </div>
          ) : (
            visibleCases.map((caseData) => (
              <CaseWindow
                key={caseData.id}
                caseData={caseData}
                totalCases={visibleCases.length}
                caseIndex={cases.findIndex((c) => c.id === caseData.id)}
                onAddMessage={addMessage}
                onStatusChange={updateCaseStatus}
                onClose={closeCase}
                onAssignRat={assignRat}
                onRemoveRat={removeRat}
                hasUnread={unreadCases.has(caseData.id)}
                onClearUnread={clearUnread}
                ircConnected={ircStatus === 'connected'}
                buttonGroups={buttonGroups}
              />
            ))
          )}
        </div>
      </div>


    </div>

      {view === 'editor' && (
        <MessageEditorPage
          onBack={() => {
            setButtonGroups(loadButtonGroups());
            setView('board');
          }}
        />
      )}
    </>
  );
}
