import { useState, useRef, useEffect } from 'react';
import type { Case, CaseStatus } from './DispatchBoard';
import { Button } from '@/app/components/ui/button';
import { Input } from '@/app/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/app/components/ui/popover';
import { rescueMessages, dispatchMessages } from '../config/quickMessages';
import {
  User,
  Clock,
  AlertTriangle,
  Send,
  Users,
  Zap,
  MoreVertical,
  Languages,
  X,
  ChevronDown,
} from 'lucide-react';

interface CaseWindowProps {
  caseData: Case;
  totalCases: number;
  caseIndex: number;
  onAddMessage: (caseId: string, text: string, channel?: string) => void;
  onStatusChange: (caseId: string, status: CaseStatus) => void;
  onClose: (caseId: string) => void;
  onAssignRat: (caseId: string, ratName: string) => void;
  onRemoveRat: (caseId: string, ratName: string) => void;
  hasUnread?: boolean;
  onClearUnread: (caseId: string) => void;
  ircConnected: boolean;
}

const statusColors = {
  open: 'border-blue-500',
  assigned: 'border-yellow-500',
  'code-red': 'border-red-500',
  inactive: 'border-slate-500',
  closed: 'border-slate-500',
};

const statusBgColors = {
  open: 'bg-blue-500/10',
  assigned: 'bg-yellow-500/10',
  'code-red': 'bg-red-500/10',
  inactive: 'bg-slate-500/10',
  closed: 'bg-slate-500/10',
};

export function CaseWindow({
  caseData,
  totalCases,
  caseIndex,
  onAddMessage,
  onStatusChange,
  onClose,
  onAssignRat,
  onRemoveRat,
  hasUnread = false,
  onClearUnread,
  ircConnected,
}: CaseWindowProps) {
  const [messageInput, setMessageInput] = useState('');
  const [isFlickering, setIsFlickering] = useState(false);
  const [tabIndex, setTabIndex] = useState(-1);
  const [tabBase, setTabBase] = useState('');
  const [tabWordStart, setTabWordStart] = useState(0);
  const [caseElapsedTime, setCaseElapsedTime] = useState(0);
  const [activityElapsedTime, setActivityElapsedTime] = useState(0);
  const [combinedPopoverOpen, setCombinedPopoverOpen] = useState(false);
  const [translateEnabled, setTranslateEnabled] = useState(false);
  const [rescuePopoverOpen, setRescuePopoverOpen] = useState(false);
  const [dispatchPopoverOpen, setDispatchPopoverOpen] = useState(false);
  const [subPopoverOpen, setSubPopoverOpen] = useState<Record<string, boolean>>({});
  const [openRatMenuId, setOpenRatMenuId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const chatAreaRef = useRef<HTMLDivElement>(null);
  const messageInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [caseData.messages]);

  // Trigger flicker effect based on case status and messages
  useEffect(() => {
    const lastMessage = caseData.messages[caseData.messages.length - 1];
    
    // For Code Red cases: flash continuously if only system messages exist
    if (caseData.status === 'codeRed') {
      // Check if there are any non-system messages (excluding "Incoming Client" and disconnect/reconnect messages)
      const hasRealMessages = caseData.messages.some(msg => {
        // Skip system messages
        if (msg.isSystem) return false;
        
        // Skip "Incoming Client" message
        if (msg.text.includes('Incoming Client')) return false;
        
        // If we get here, it's a real message from a user/rat
        return true;
      });
      
      if (!hasRealMessages) {
        // Keep flashing if no real messages
        setIsFlickering(true);
      } else {
        // Stop flashing once we have a real message
        setIsFlickering(false);
      }
    } else {
      // For non-Code Red cases: brief flicker on external messages
      if (lastMessage && lastMessage.sender !== 'Dispatch' && !lastMessage.isSystem) {
        setIsFlickering(true);
        const timer = setTimeout(() => {
          setIsFlickering(false);
        }, 180);
        return () => clearTimeout(timer);
      } else {
        setIsFlickering(false);
      }
    }
  }, [caseData.messages, caseData.status]);

  // Timer for case elapsed time (from case creation)
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - caseData.createdAt.getTime()) / 1000);
      setCaseElapsedTime(elapsed);
    }, 1000);
    return () => clearInterval(interval);
  }, [caseData.createdAt]);

  // Timer for activity (from last message of any kind)
  useEffect(() => {
    const lastMessage = caseData.messages[caseData.messages.length - 1];

    if (lastMessage) {
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - lastMessage.timestamp.getTime()) / 1000);
        // Cap at 10 minutes (600 seconds)
        setActivityElapsedTime(Math.min(elapsed, 600));
      }, 1000);
      return () => clearInterval(interval);
    } else {
      // No messages yet, start from case creation
      const interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - caseData.createdAt.getTime()) / 1000);
        setActivityElapsedTime(Math.min(elapsed, 600));
      }, 1000);
      return () => clearInterval(interval);
    }
  }, [caseData.messages, caseData.createdAt]);

  // Returns unique speakers from messages in last-spoke order (most recent first)
  const getLastSpokeOrder = (): string[] => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (let i = caseData.messages.length - 1; i >= 0; i--) {
      const msg = caseData.messages[i];
      if (!msg.isSystem && msg.sender !== 'Dispatch' && !seen.has(msg.sender)) {
        seen.add(msg.sender);
        result.push(msg.sender);
      }
    }
    return result;
  };

  const handleSendMessage = () => {
    if (messageInput.trim()) {
      let finalMessage = messageInput;

      // Apply /tr formatting if enabled and message doesn't start with !
      if (translateEnabled && !messageInput.trim().startsWith('!')) {
        // Extract case number without leading zero
        const caseNumber = parseInt(caseData.id.split('-')[1], 10);
        finalMessage = `/tr ${caseNumber} ${messageInput}`;
      }

      onAddMessage(caseData.id, finalMessage);
      setMessageInput('');
      setTabIndex(-1);
      setTabBase('');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSendMessage();
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      const nicks = getLastSpokeOrder();
      if (nicks.length === 0) return;

      let base: string;
      let wordStart: number;
      let nextIndex: number;

      if (tabIndex === -1) {
        // Start new completion from cursor position
        const cursorPos = e.currentTarget.selectionStart ?? messageInput.length;
        const textBeforeCursor = messageInput.substring(0, cursorPos);
        const lastSpaceIndex = textBeforeCursor.lastIndexOf(' ');
        wordStart = lastSpaceIndex + 1;
        base = textBeforeCursor.substring(wordStart);
        nextIndex = 0;
      } else {
        // Continue cycling
        base = tabBase;
        wordStart = tabWordStart;
        nextIndex = tabIndex + 1;
      }

      const matchingNicks = nicks.filter((n) =>
        n.toLowerCase().startsWith(base.toLowerCase())
      );
      if (matchingNicks.length === 0) return;

      nextIndex = nextIndex % matchingNicks.length;
      // Add ": " suffix when completing at the start of input (addressing someone)
      const suffix = wordStart === 0 ? ': ' : ' ';
      const newValue =
        messageInput.substring(0, wordStart) + matchingNicks[nextIndex] + suffix;

      setMessageInput(newValue);
      setTabIndex(nextIndex);
      setTabBase(base);
      setTabWordStart(wordStart);
      return;
    }

    // Reset tab completion on any non-modifier key
    const isModifier = ['Shift', 'Control', 'Alt', 'Meta', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key);
    if (!isModifier && tabIndex !== -1) {
      setTabIndex(-1);
      setTabBase('');
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMessageInput(e.target.value);
    // Close menu when user starts typing
    if (combinedPopoverOpen) {
      setCombinedPopoverOpen(false);
      setRescuePopoverOpen(false);
      setDispatchPopoverOpen(false);
      setSubPopoverOpen({});
    }
  };

  const formatTime = (date: Date) => {
    return new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatElapsedTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const widthPercent = 100 / totalCases;

  const handleChatAreaClick = () => {
    if (hasUnread) {
      onClearUnread(caseData.id);
    }
  };

  const caseNumber = parseInt(caseData.id.split('-')[1], 10);

  // Resolve {clientName} and {caseNumber} placeholders in quick message templates
  // Uses trMessage (without client name prefix) when /tr is enabled
  const resolveMessage = (msg: { message: string; trMessage?: string }) => {
    const template = (translateEnabled && msg.trMessage) ? msg.trMessage : msg.message;
    return template.replace(/\{clientName\}/g, caseData.clientName).replace(/\{caseNumber\}/g, String(caseNumber));
  };

  // Commands that support the -a (auto-translate) suffix
  const trCommands = new Set([
    '!crinst', '!donate', '!fueltank', '!invite', '!kgbfoam', '!multi',
    '!o2synth', '!oldcrinst', '!oldkgbfoam', '!pg', '!pqueue', '!prep',
    '!prepcr', '!reboot', '!rto', '!sc', '!quit', '!team', '!relog',
    '!modules', '!open', '!frcr', '!wing', '!beacon', '!fr', '!gofr', '!go',
  ]);

  const sendQuickMessage = (message: string) => {
    let finalMessage = message;

    // If /tr is enabled and command supports -a, add -a after the command
    if (translateEnabled && message.startsWith('!')) {
      const parts = message.split(' ');
      const command = parts[0]; // e.g., "!team"
      const args = parts.slice(1).join(' ');

      if (trCommands.has(command)) {
        finalMessage = `${command}-a${args ? ' ' + args : ''}`;
      }
    } else if (translateEnabled && !message.startsWith('!')) {
      // Regular messages get /tr prefix
      finalMessage = `/tr ${caseNumber} ${message}`;
    }
    
    onAddMessage(caseData.id, finalMessage);
    // Refocus the input field after sending a quick message
    setTimeout(() => {
      messageInputRef.current?.focus();
    }, 0);
  };

  return (
    <div
      className={`flex-shrink-0 bg-slate-900/70 backdrop-blur-md border-r-2 last:border-r-0 ${statusColors[caseData.status]} h-full flex flex-col ${caseData.status === 'codeRed' && isFlickering ? 'code-red-flash' : 'transition-colors duration-[180ms]'}`}
      style={{
        width: `${widthPercent}%`,
        backgroundColor: isFlickering && caseData.status !== 'codeRed' ? 'rgba(148, 148, 148, 0.7)' : undefined,
      }}
    >
      {/* Header */}
      <div className={`px-4 py-3 ${statusBgColors[caseData.status]} border-b border-slate-700 flex items-center justify-between flex-shrink-0`}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <span className="font-semibold text-white truncate">CMDR {caseData.clientName}</span>
            {caseData.status === 'code-red' && (
              <AlertTriangle className="w-4 h-4 text-red-500 animate-pulse flex-shrink-0" />
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
            <span className="text-slate-300 font-semibold flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatElapsedTime(caseElapsedTime)}
            </span>
            <span>•</span>
            <span className="text-slate-500">Window {caseIndex + 1} of {totalCases}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-2xl font-bold text-orange-400">
            {caseData.id.split('-')[1]}
          </span>
        </div>
      </div>

      {(
        <div className="flex flex-col flex-1 min-h-0">
          {/* Messages */}
          <div 
            className="flex-1 overflow-y-auto p-4 min-h-0"
            ref={chatAreaRef}
            onClick={handleChatAreaClick}
          >
            <div className="space-y-3">
              {caseData.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`${
                    msg.isSystem
                      ? 'text-center text-xs text-slate-500 italic'
                      : 'bg-slate-800/60 backdrop-blur-sm rounded p-2'
                  }`}
                >
                  {!msg.isSystem && (
                    <>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-orange-400">
                            {msg.sender}
                          </span>
                        </div>
                        <span className="text-xs text-slate-500">
                          {formatTime(msg.timestamp)}
                        </span>
                      </div>
                      <p className={`text-sm break-words ${msg.isNotice ? 'text-cyan-300 italic' : 'text-slate-200'}`}>{msg.isNotice ? `⟫ ${msg.text}` : msg.text}</p>
                      {msg.translation && (
                        <p className="text-sm break-words text-cyan-300 italic mt-1">⟫ {msg.translation}</p>
                      )}
                    </>
                  )}
                  {msg.isSystem && (
                    <span>
                      {msg.text} <span className="text-slate-600">({formatTime(msg.timestamp)})</span>
                    </span>
                  )}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Bottom Bar with Message Input and Controls */}
          <div className="p-3 border-t border-slate-700 flex-shrink-0 bg-slate-900/50 backdrop-blur-sm">
            {/* Activity Timer and Action Buttons */}
            <div className="mb-2 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2">
                <Clock className="w-3 h-3 text-slate-400" />
                <span className="text-slate-400">Last activity:</span>
                <span 
                  className={`font-semibold ${
                    activityElapsedTime >= 600 
                      ? 'text-red-500' 
                      : activityElapsedTime >= 120 
                        ? 'text-red-300' 
                        : 'text-slate-300'
                  }`}
                >
                  {activityElapsedTime >= 600 ? '>10:00' : formatElapsedTime(activityElapsedTime)}
                </span>
              </div>

              {/* Combined menu button - always shown */}
              <div>
                <Popover open={combinedPopoverOpen} onOpenChange={setCombinedPopoverOpen}>
                  <PopoverTrigger className="h-7 px-2 bg-slate-800 border border-slate-600 text-white hover:bg-slate-700 flex items-center gap-1 rounded cursor-pointer text-xs">
                    <MoreVertical className="w-3 h-3" />
                    Menu
                  </PopoverTrigger>
                  <PopoverContent 
                    className="w-64 bg-slate-800/90 backdrop-blur-md border-slate-700 p-3"
                    align="end"
                    side="top"
                  >
                    <div className="space-y-4">
                      {/* Rats Section */}
                      <div>
                        <h3 className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          Rats ({caseData.assignedRats.length})
                        </h3>
                        <div className="space-y-1">
                          {caseData.assignedRats.length === 0 ? (
                            <div className="text-xs text-slate-500 italic">No rats assigned</div>
                          ) : (
                            caseData.assignedRats.map((rat, idx) => (
                              <Popover
                                key={idx}
                                open={openRatMenuId === `${caseData.id}-${rat}`}
                                onOpenChange={(open) => setOpenRatMenuId(open ? `${caseData.id}-${rat}` : null)}
                              >
                                <PopoverTrigger asChild>
                                  <button
                                    className="w-full text-xs bg-slate-900 rounded px-2 py-1 text-slate-300 hover:bg-slate-800 transition-colors flex items-center justify-between group cursor-pointer"
                                  >
                                    <span>{rat}</span>
                                    <ChevronDown className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent 
                                  className="w-48 p-1 bg-slate-900 border-slate-700"
                                  align="start"
                                  side="right"
                                >
                                  <div className="flex flex-col gap-1">
                                    <button
                                      className="flex items-center gap-2 px-3 py-2 text-xs text-red-400 hover:bg-slate-800 rounded transition-colors"
                                      onClick={() => {
                                        onAddMessage(caseData.id, `!standdown ${caseNumber} ${rat}`, '#ratchat');
                                        setOpenRatMenuId(null);
                                      }}
                                    >
                                      <X className="w-3 h-3" />
                                      Remove
                                    </button>
                                    <button
                                      className="flex items-center gap-2 px-3 py-2 text-xs text-green-400 hover:bg-slate-800 rounded transition-colors"
                                      onClick={() => {
                                        onAddMessage(caseData.id, `!close ${caseNumber} ${rat}`, '#ratchat');
                                        setOpenRatMenuId(null);
                                      }}
                                    >
                                      <Zap className="w-3 h-3" />
                                      Close
                                    </button>
                                    <button
                                      className="flex items-center gap-2 px-3 py-2 text-xs text-yellow-400 hover:bg-slate-800 rounded transition-colors"
                                      onClick={() => {
                                        onAddMessage(caseData.id, `!close -p ${caseNumber} ${rat}`, '#ratchat');
                                        setOpenRatMenuId(null);
                                      }}
                                    >
                                      <Zap className="w-3 h-3" />
                                      Close -p
                                    </button>
                                  </div>
                                </PopoverContent>
                              </Popover>
                            ))
                          )}
                        </div>
                      </div>

                      {/* Language Section */}
                      <div>
                        <h3 className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1">
                          <Languages className="w-3 h-3" />
                          Language
                        </h3>
                        <div>
                          <Button
                            variant="outline"
                            size="sm"
                            className={`w-full text-xs h-8 bg-slate-900 border-slate-600 text-white hover:bg-slate-700 ${translateEnabled ? 'bg-orange-600/20 border-orange-500' : ''}`}
                            onClick={() => setTranslateEnabled(!translateEnabled)}
                          >
                            /tr {translateEnabled ? '(ON)' : '(OFF)'}
                          </Button>
                        </div>
                      </div>

                      {/* Quick Message Section */}
                      <div>
                        <h3 className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1">
                          <Zap className="w-3 h-3" />
                          Quick Message
                        </h3>
                        <div className="space-y-1">
                          {/* Rescue Popover */}
                          <Popover open={rescuePopoverOpen} onOpenChange={setRescuePopoverOpen}>
                            <PopoverTrigger className="w-full text-xs h-8 bg-slate-900 border border-slate-600 text-white hover:bg-slate-700 rounded px-2">
                              {'>'}RESCUE{'<'}
                            </PopoverTrigger>
                            <PopoverContent className="w-56 bg-slate-800/90 backdrop-blur-md border-slate-700 p-2" side="right" align="start">
                              <div className="space-y-1">
                                {rescueMessages.map((msg) => (
                                  <Button
                                    key={msg.label}
                                    variant="outline"
                                    size="sm"
                                    className="w-full text-xs h-8 bg-slate-900 border-slate-600 text-white hover:bg-slate-700"
                                    onMouseDown={(e: any) => e.preventDefault()}
                                    onClick={() => sendQuickMessage(resolveMessage(msg))}
                                  >
                                    {msg.label}
                                  </Button>
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>

                          {/* Dispatch Popover */}
                          <Popover open={dispatchPopoverOpen} onOpenChange={setDispatchPopoverOpen}>
                            <PopoverTrigger className="w-full text-xs h-8 bg-slate-900 border border-slate-600 text-white hover:bg-slate-700 rounded px-2">
                              {'>'}{dispatchMessages.label}{'<'}
                            </PopoverTrigger>
                            <PopoverContent className="w-56 bg-slate-800/90 backdrop-blur-md border-slate-700 p-2" side="right" align="start">
                              <div className="space-y-1">
                                {/* Subgroup popovers (NORMAL, CODE RED, OTHERS) */}
                                {dispatchMessages.subgroups?.map((subgroup) => (
                                  <Popover
                                    key={subgroup.label}
                                    open={subPopoverOpen[subgroup.label] || false}
                                    onOpenChange={(open: any) => setSubPopoverOpen((prev) => ({ ...prev, [subgroup.label]: open }))}
                                  >
                                    <PopoverTrigger className="w-full text-xs h-8 bg-slate-900 border border-slate-600 text-white hover:bg-slate-700 rounded px-2">
                                      {'>'}{subgroup.label}{'<'}
                                    </PopoverTrigger>
                                    <PopoverContent className="w-56 bg-slate-800/90 backdrop-blur-md border-slate-700 p-2" side="right" align="start">
                                      <div className="space-y-1">
                                        {subgroup.messages?.map((msg) => (
                                          <Button
                                            key={msg.label}
                                            variant="outline"
                                            size="sm"
                                            className="w-full text-xs h-8 bg-slate-900 border-slate-600 text-white hover:bg-slate-700"
                                            onMouseDown={(e: any) => e.preventDefault()}
                                            onClick={() => sendQuickMessage(resolveMessage(msg))}
                                          >
                                            {msg.label}
                                          </Button>
                                        ))}
                                      </div>
                                    </PopoverContent>
                                  </Popover>
                                ))}

                                {/* Top-level dispatch messages */}
                                {dispatchMessages.messages?.map((msg) => (
                                  <Button
                                    key={msg.label}
                                    variant="outline"
                                    size="sm"
                                    className="w-full text-xs h-8 bg-slate-900 border-slate-600 text-white hover:bg-slate-700"
                                    onMouseDown={(e: any) => e.preventDefault()}
                                    onClick={() => sendQuickMessage(resolveMessage(msg))}
                                  >
                                    {msg.label}
                                  </Button>
                                ))}
                              </div>
                            </PopoverContent>
                          </Popover>
                        </div>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Message Input */}
            <div className="flex gap-2">
              <Input
                ref={messageInputRef}
                value={messageInput}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={ircConnected ? 'Type message... (Tab to complete nick)' : 'IRC disconnected'}
                disabled={!ircConnected}
                className="flex-1 bg-slate-800/70 backdrop-blur-sm border-slate-700 text-white placeholder:text-slate-500 disabled:opacity-50 disabled:cursor-not-allowed"
              />
              <Button
                onClick={handleSendMessage}
                onMouseDown={(e) => e.preventDefault()}
                size="icon"
                disabled={!ircConnected}
                className="bg-orange-600 hover:bg-orange-700 flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Send className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
