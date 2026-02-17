import { useState, useEffect, useRef } from 'react';
import { CaseWindow } from './CaseWindow';
import { Button } from '@/app/components/ui/button';
import { Eye, EyeOff, Sidebar, User, MapPin, AlertTriangle, Clock, X } from 'lucide-react';
import { fuelRatsApi } from '../services/fuelRatsApi';
import { ircWebSocket, IRCMessage, IRCConnectionStatus } from '../services/ircWebSocket';
import { IRCConnectionPanel } from './IRCConnectionPanel';
import fuelRatsLogo from './image/TransparentBackgroundRatto.png';

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
  status: CaseStatus;
  messages: Message[];
  assignedRats: string[];
  oxygenStatus?: string;
  createdAt: Date;
}

const initialCases: Case[] = [];

export function DispatchBoard() {
  const [useApiData] = useState(true); // API active by default
  const [cases, setCases] = useState<Case[]>(initialCases);
  const [toggledCaseIds, setToggledCaseIds] = useState<Set<string>>(
    new Set(initialCases.map((c) => c.id))
  );
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [unreadCases, setUnreadCases] = useState<Set<string>>(new Set());
  const [isLoadingApi, setIsLoadingApi] = useState(false);
  const [rateLimitRemaining, setRateLimitRemaining] = useState(0);
  const [secondsToReset, setSecondsToReset] = useState(0);
  const seenCaseIdsRef = useRef<Set<string>>(
    new Set(initialCases.map((c) => c.id))
  ); // Track which cases we've already seen to avoid flashing on every poll
  
  // IRC state
  const [ircStatus, setIrcStatus] = useState<IRCConnectionStatus>('disconnected');
  const [ircError, setIrcError] = useState<string | undefined>();
  const [ircChannel, setIrcChannel] = useState('#fuelrats'); // Default IRC channel

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
            // Deduplicate by both id and text to handle the race condition where
            // an IRC message may have arrived before the API quote for the same content
            const existingMessageIds = new Set(existingCase.messages.map((m) => m.id));
            const existingMessageTexts = new Set(existingCase.messages.map((m) => m.text));
            const newMessages = fetchedCase.messages.filter(
              (msg) => !existingMessageIds.has(msg.id) && !existingMessageTexts.has(msg.text)
            );

            return {
              ...fetchedCase,
              messages: [...existingCase.messages, ...newMessages],
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
        
        // Preserve cases the API no longer returns — mark as closed instead of removing
        const fetchedIds = new Set(fetchedCases.map((c) => c.id));
        const removedCases = prevCases
          .filter((c) => !fetchedIds.has(c.id))
          .map((c) => c.status === 'closed' ? c : { ...c, status: 'closed' as const });

        return [...updatedCases, ...removedCases];
      });
    });

    // Cleanup: disconnect WebSocket when component unmounts or useApiData is disabled
    return () => {
      fuelRatsApi.disconnect();
    };
  }, [useApiData]);

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
      }
    };

    // Set up error handler
    ircWebSocket.onError = (error: string) => {
      setIrcError(error);
    };

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

    const isNotice = ircMsg.type === 'notice';

    setCases((prev) =>
      prev.map((c) => {
        // Match by case number, IRC nick (exact), fuzzy client name, or text mention
        const nickLower = ircMsg.nick!.toLowerCase();
        const textLower = ircMsg.text.toLowerCase();

        // Prefer exact IRC nick match when available from the API
        const ircNickLower = c.ircNick?.toLowerCase();
        const exactNickMatch = ircNickLower && (nickLower === ircNickLower || textLower.includes(ircNickLower));

        // Fallback: fuzzy match client name (handles spaces, underscores, periods)
        const clientNameLower = c.clientName.toLowerCase();
        const normalizedClientName = clientNameLower.replace(/[. _]+/g, '[. _]*');
        const namePattern = new RegExp(normalizedClientName);
        const fuzzyMatch = namePattern.test(nickLower) || namePattern.test(textLower);

        // Check if the message sender is an assigned rat (e.g. "Dr Leo" → matches IRC nick "Dr_Leo")
        const isAssignedRat = c.assignedRats.some((ratName) => {
          const normalizedRat = ratName.toLowerCase().replace(/[. _]+/g, '[. _]*');
          // Match sender nick OR rat name mentioned in text (e.g. MechaSqueak notice: "<PlzDontKillDave> ...")
          return new RegExp(`^${normalizedRat}$`).test(nickLower) || new RegExp(normalizedRat).test(textLower);
        });

        // For private notices (e.g. MechaSqueak translations), match by text content
        // since they aren't sent to a channel
        const isPrivateNotice = isNotice && !ircMsg.channel?.startsWith('#');

        const isForThisCase =
          (ircMsg.caseId && c.id === ircMsg.caseId) ||
          (ircMsg.channel === '#fuelrats' && (exactNickMatch || fuzzyMatch || isAssignedRat)) ||
          (isPrivateNotice && (exactNickMatch || fuzzyMatch || isAssignedRat));

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

        // Deduplicate by text only — catches messages that arrive via both IRC stream
        // and API quotes (where sender names differ between the two sources)
        const isDuplicate = c.messages.some((msg) => msg.text === displayText);

        if (isDuplicate) {
          console.log('🚫 Duplicate IRC message detected, skipping:', displayText);
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

        return {
          ...c,
          ircNick: updatedIrcNick,
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

  const addMessage = (caseId: string, text: string) => {
    if (!text.trim()) return;
    // Commands like /tr are executed by AdiIRC directly, not wrapped in PRIVMSG
    if (text.startsWith('/')) {
      ircWebSocket.sendRaw(text);
    } else {
      ircWebSocket.sendMessage(ircChannel, text);

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

  const removeCaseFromBoard = (caseId: string) => {
    setCases((prev) => prev.filter((c) => c.id !== caseId));
    setToggledCaseIds((prev) => { const s = new Set(prev); s.delete(caseId); return s; });
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
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs border ${
                isLoadingApi
                  ? 'bg-yellow-600/20 border-yellow-500 text-yellow-400'
                  : useApiData
                    ? 'bg-green-600/20 border-green-500 text-green-400'
                    : 'bg-red-600/20 border-red-500 text-red-400'
              }`}>
                <div className={`w-2 h-2 rounded-full ${
                  isLoadingApi
                    ? 'bg-yellow-400 animate-pulse'
                    : useApiData
                      ? 'bg-green-400'
                      : 'bg-red-400'
                }`} />
                {isLoadingApi ? 'API: Connecting...' : useApiData ? 'API: Connected' : 'API: Disconnected'}
              </div>
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
                          <MapPin 
                            className="w-3 h-3 flex-shrink-0 cursor-pointer hover:text-orange-400 transition-colors" 
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(caseData.system);
                            }}
                            title="Click to copy system name"
                          />
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
                        {caseData.status === 'closed' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); removeCaseFromBoard(caseData.id); }}
                            className="p-0.5 rounded hover:bg-red-500/20 text-slate-500 hover:text-red-400 transition-colors"
                            title="Remove closed case"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            
            {/* IRC Connection Panel */}
            <div className="border-t border-slate-700 p-4">
              <IRCConnectionPanel
                status={ircStatus}
                onConnect={handleIRCConnect}
                onDisconnect={handleIRCDisconnect}
                errorMessage={ircError}
                channel={ircChannel}
                onChannelChange={setIrcChannel}
              />
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
            visibleCases.map((caseData, index) => (
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
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
