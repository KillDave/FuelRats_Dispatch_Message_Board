import { useState } from 'react';
import { CaseWindow } from './CaseWindow';
import type { Case, Message } from './DispatchBoard';
import { rescueMessages, dispatchMessages } from '../config/quickMessages';
import type { QuickMessageGroup } from '../config/quickMessages';
import { Button } from '@/app/components/ui/button';

const BUTTON_GROUPS: QuickMessageGroup[] = [
  { label: 'RESCUE', messages: rescueMessages },
  dispatchMessages,
];

const initialCase: Case = {
  id: 'case-00',
  clientName: 'TestClient',
  ircNick: 'TestClient',
  system: 'Fuelum',
  platform: 'PC - Odyssey',
  language: 'en',
  status: 'open',
  messages: [
    { id: 'm0', sender: 'Dispatch', text: 'Incoming Client: TestClient - Fuelum (PC - Odyssey)', timestamp: new Date(), isSystem: true },
  ],
  injections: [
    {
      id: 'q0',
      author: 'RatMama[BOT]',
      text: "<TestClient> Ratsignal! I'm out of fuel in Fuelum, please send a rat! (Translation: Ratsignal! I'm out of fuel in Fuelum, please send a rat!)",
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
      isBot: true,
    },
    {
      id: 'q1',
      author: 'MechaSqueak[BOT]',
      text: '<Absolver> Calling in for case 0',
      createdAt: new Date(Date.now() - 3 * 60 * 1000),
      isBot: true,
    },
  ],
  assignedRats: [],
  ratIrcNicks: {},
  clientInChannel: true,
  createdAt: new Date(),
};

/**
 * Sandbox for trying out quick-message buttons and the chat input without an
 * IRC connection. Everything CaseWindow would normally send over the wire is
 * appended to the raw-command log instead, so button wiring and message
 * templates can be checked before anything touches real IRC. Not linked
 * anywhere in the UI -- reached via #clienttest.
 */
export function ClientTestPage({ onBack }: { onBack: () => void }) {
  const [caseData, setCaseData] = useState<Case>(initialCase);
  const [rawLog, setRawLog] = useState<string[]>([]);

  const logRaw = (text: string, channel?: string) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    setRawLog((prev) => [...prev, `[${ts}]${channel ? ` (${channel})` : ''} ${text}`]);
  };

  const handleAddMessage = (_caseId: string, text: string, channel?: string, original?: string) => {
    logRaw(text, channel);
    const msg: Message = {
      id: `m${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sender: 'Dispatch',
      text,
      timestamp: new Date(),
    };
    void original;
    setCaseData((prev) => ({ ...prev, messages: [...prev.messages, msg] }));
  };

  const clearLog = () => setRawLog([]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      <div className="flex items-center gap-4 px-4 py-2 border-b border-slate-700 bg-slate-900 flex-shrink-0">
        <Button variant="outline" size="sm" onClick={onBack} className="border-slate-400 text-white bg-slate-700 hover:bg-slate-600 hover:border-slate-300">
          ← Back
        </Button>
        <h1 className="text-lg font-bold text-orange-400">Client Test</h1>
        <span className="text-xs text-slate-500">Quick-message / chat sandbox — nothing here touches IRC</span>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 min-w-0 flex">
          <CaseWindow
            caseData={caseData}
            totalCases={1}
            caseIndex={0}
            onAddMessage={handleAddMessage}
            onStatusChange={() => {}}
            onClose={() => {}}
            onAssignRat={() => {}}
            onRemoveRat={() => {}}
            onClearUnread={() => {}}
            ircConnected
            clientInChannel={caseData.clientInChannel}
            buttonGroups={BUTTON_GROUPS}
            onSetTranslation={(_caseId, messageId, translation) =>
              setCaseData((prev) => ({
                ...prev,
                messages: prev.messages.map((m) => (m.id === messageId ? { ...m, translation } : m)),
              }))
            }
          />
        </div>

        <div className="w-96 flex-shrink-0 border-l border-slate-700 bg-slate-900 flex flex-col min-h-0">
          <div className="px-3 py-2 border-b border-slate-700/60 flex items-center justify-between flex-shrink-0">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Raw commands sent</p>
            <button onClick={clearLog} className="text-xs text-slate-500 hover:text-red-400 transition-colors">
              Clear
            </button>
          </div>
          <textarea
            readOnly
            value={rawLog.length ? rawLog.join('\n') : ''}
            placeholder="Send a message or click a quick-message button — the raw text that would go to IRC shows up here."
            className="flex-1 resize-none bg-slate-950 text-slate-300 text-xs font-mono p-3 border-0 outline-none placeholder:text-slate-600"
          />
        </div>
      </div>
    </div>
  );
}
