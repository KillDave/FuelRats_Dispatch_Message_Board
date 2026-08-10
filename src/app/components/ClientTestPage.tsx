import { useState } from 'react';
import { CaseWindow } from './CaseWindow';
import type { Case, Injection, Message } from './DispatchBoard';
import { rescueMessages, dispatchMessages } from '../config/quickMessages';
import type { QuickMessageGroup } from '../config/quickMessages';
import { Button } from '@/app/components/ui/button';
import { findLatestGrabDuration } from '../services/codeRedTimerService';
import { readRatMessage } from '../services/ratMessageService';

const BUTTON_GROUPS: QuickMessageGroup[] = [
  { label: 'RESCUE', messages: rescueMessages },
  dispatchMessages,
];

/** Everything the setup panel can change about the case being tested. */
interface Setup {
  /** Distance and jump reports are matched against "#N", so this has to be
   *  settable -- a sandbox fixed at case 0 silently drops "#1 bc+ 32kls". */
  caseNumber: string;
  clientName: string;
  ircNick: string;
  system: string;
  platform: string;
  language: string;
  /** Comma-separated in the form; split on apply. */
  rats: string;
  clientInChannel: boolean;
}

const DEFAULT_SETUP: Setup = {
  caseNumber: '1',
  clientName: 'TestClient',
  ircNick: 'TestClient',
  system: 'Fuelum',
  platform: 'PC - Odyssey',
  language: 'en',
  rats: 'Absolver',
  clientInChannel: true,
};

const PLATFORMS = ['PC - Odyssey', 'PC - Horizons', 'Xbox', 'PlayStation'];

function splitRats(rats: string): string[] {
  return rats.split(',').map((r) => r.trim()).filter(Boolean);
}

function newId(prefix: string): string {
  return `${prefix}${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * A case built from whatever is currently in the setup panel.
 *
 * The opening ratsignal is seeded because a case with no history at all does
 * not look like anything CaseWindow is ever asked to render, and the point of
 * this page is to look at the real thing.
 */
function buildCase(setup: Setup): Case {
  const rats = splitRats(setup.rats);
  const caseNumber = setup.caseNumber.trim() || '0';
  return {
    id: `case-${caseNumber.padStart(2, '0')}`,
    clientName: setup.clientName,
    ircNick: setup.ircNick || setup.clientName,
    system: setup.system,
    platform: setup.platform,
    language: setup.language,
    status: 'open',
    messages: [
      {
        id: newId('m'),
        sender: 'Dispatch',
        text: `Incoming Client: ${setup.clientName} - ${setup.system} (${setup.platform})`,
        timestamp: new Date(),
        isSystem: true,
      },
    ],
    // Both seeded quotes are built from the setup, never written out. The one
    // this replaced said "Calling in for case 0" with the number typed into it,
    // so a case set to anything else opened with a quote naming a case that was
    // not the one you were looking at.
    injections: [
      {
        id: newId('q'),
        author: 'RatMama[BOT]',
        text: `<${setup.clientName}> Ratsignal! I'm out of fuel in ${setup.system}, please send a rat!`,
        createdAt: new Date(Date.now() - 5 * 60 * 1000),
        isBot: true,
      },
      ...(rats.length > 0 ? [{
        id: newId('q'),
        author: 'MechaSqueak[BOT]',
        text: `<${rats[0]}> Calling in for case ${caseNumber}`,
        createdAt: new Date(Date.now() - 3 * 60 * 1000),
        isBot: true,
      }] : []),
    ],
    assignedRats: rats,
    ratIrcNicks: {},
    clientInChannel: setup.clientInChannel,
    createdAt: new Date(),
  };
}

/** Who a typed line is coming from. */
type SpeakerKind = 'client' | 'dispatch' | 'rat';

/**
 * Sandbox for driving a case by hand, with no IRC connection anywhere near it.
 *
 * Two things are being tested here and they are not the same thing, which is
 * why the panel keeps them apart:
 *
 *   Speaking   appends a chat message from a named person. The sender is what
 *              classifyMessageRole reads, so this is what exercises the role
 *              colours -- bubble, nickname, message text, translation.
 *   Injecting  appends a case note, the `!inject`/`!grab` kind. These are not
 *              chat and never appear in the log; they are what the code red
 *              timer reads. A grab must not be marked as a bot line or the
 *              parser skips it, which is easy to get wrong by hand and is the
 *              reason the presets exist.
 *
 * Everything CaseWindow would normally put on the wire is appended to the raw
 * command log instead, so button wiring and message templates can be checked
 * before anything touches real IRC. Not linked anywhere in the UI -- reached
 * via #clienttest.
 */
export function ClientTestPage({ onBack }: { onBack: () => void }) {
  const [setup, setSetup] = useState<Setup>(DEFAULT_SETUP);
  const [caseData, setCaseData] = useState<Case>(() => buildCase(DEFAULT_SETUP));
  const [rawLog, setRawLog] = useState<string[]>([]);

  const [speakerKind, setSpeakerKind] = useState<SpeakerKind>('client');
  const [speakerRat, setSpeakerRat] = useState<string>('');
  const [speech, setSpeech] = useState('');
  const [asNotice, setAsNotice] = useState(false);

  const [injectAuthor, setInjectAuthor] = useState('Dispatch');
  const [injectText, setInjectText] = useState('');
  const [injectAsBot, setInjectAsBot] = useState(false);

  const rats = splitRats(setup.rats);
  const activeRat = speakerRat || rats[0] || '';

  const logRaw = (text: string, channel?: string) => {
    const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
    setRawLog((prev) => [...prev, `[${ts}]${channel ? ` (${channel})` : ''} ${text}`]);
  };

  const addMessage = (msg: Message) =>
    setCaseData((prev) => ({ ...prev, messages: [...prev.messages, msg] }));

  const handleAddMessage = (_caseId: string, text: string, channel?: string, original?: string) => {
    logRaw(text, channel);
    void original;
    addMessage({ id: newId('m'), sender: 'Dispatch', text, timestamp: new Date() });
  };

  /**
   * The sender string has to be what the real thing would be, not a label.
   * classifyMessageRole matches the client on ircNick and a rat on its IRC
   * nick, so anything friendlier here would colour every test message as a
   * dispatcher and quietly make the page useless for what it is mostly for.
   */
  const senderFor = (kind: SpeakerKind): string => {
    if (kind === 'dispatch') return 'Dispatch';
    if (kind === 'client') return caseData.ircNick || caseData.clientName;
    return caseData.ratIrcNicks[activeRat] ?? activeRat;
  };

  const speak = () => {
    const text = speech.trim();
    if (!text || (speakerKind === 'rat' && !activeRat)) return;
    const now = new Date();
    setCaseData((prev) => {
      const messages = [...prev.messages, {
        id: newId('m'),
        sender: senderFor(speakerKind),
        text,
        timestamp: now,
        // Everyone but the local dispatcher reaches the board over IRC.
        isIRC: speakerKind !== 'dispatch',
        isNotice: asNotice || undefined,
      }];

      // Everything the board would take from this line -- distance reports,
      // jump calls, rat status, the countdown -- read by the board's own
      // function rather than a copy of it that can fall behind.
      const effects = readRatMessage(prev, {
        text,
        nick: senderFor(speakerKind),
        timestamp: now,
        matchedRatName: speakerKind === 'rat' ? activeRat : null,
        isAssignedRat: speakerKind === 'rat' && prev.assignedRats.includes(activeRat),
        ratIrcNicks: prev.ratIrcNicks,
      });
      return { ...prev, messages, ...effects };
    });
    setSpeech('');
  };

  const inject = (text: string, author = injectAuthor, isBot = injectAsBot) => {
    const body = text.trim();
    if (!body) return;
    const note: Injection = {
      id: newId('q'),
      author,
      text: body,
      createdAt: new Date(),
      isBot: isBot || undefined,
    };
    setCaseData((prev) => {
      const injections = [...prev.injections, note];
      // The real board only looks for a grab inside the API reconcile, which
      // never runs here. Without this the presets add a note that parses
      // perfectly and changes nothing -- the sandbox would disagree with the
      // board about the one thing it exists to demonstrate.
      const grab = findLatestGrabDuration(injections, prev.clientName, prev.ircNick);
      if (!grab || grab.injectionId === prev.codeRedTimer?.lastSeenGrabInjectionId) {
        return { ...prev, injections };
      }
      return {
        ...prev,
        injections,
        codeRedTimer: {
          baseSeconds: grab.seconds,
          lastSeenGrabInjectionId: grab.injectionId,
          manualOverride: false,
          running: prev.codeRedTimer?.running ?? false,
          runningSince: prev.codeRedTimer?.running ? new Date() : undefined,
          accumulatedSeconds: 0,
        },
      };
    });
  };

  /**
   * A grab the timer will actually react to: not a bot line, quoting the
   * client, carrying a duration. Getting any of the three wrong produces an
   * injection that looks right and does nothing.
   */
  const injectGrab = (minutes: number) => {
    inject(`<${caseData.clientName}> about ${minutes} minutes of oxygen left`, 'Dispatch', false);
  };

  const applySetup = () => {
    const rebuilt = splitRats(setup.rats);
    setCaseData((prev) => ({
      ...prev,
      id: `case-${(setup.caseNumber.trim() || '0').padStart(2, '0')}`,
      clientName: setup.clientName,
      ircNick: setup.ircNick || setup.clientName,
      system: setup.system,
      platform: setup.platform,
      language: setup.language,
      assignedRats: rebuilt,
      clientInChannel: setup.clientInChannel,
    }));
    if (speakerRat && !rebuilt.includes(speakerRat)) setSpeakerRat('');
  };

  const resetCase = () => {
    setCaseData(buildCase(setup));
    setRawLog([]);
    setSpeakerRat('');
  };

  const field = 'w-full bg-slate-950 border border-slate-700 rounded px-2 py-1 text-xs text-slate-200 outline-none focus:border-orange-500';
  const label = 'text-[10px] uppercase tracking-wide text-slate-500';

  return (
    // flex-1 min-h-0 rather than min-h-screen: the #clienttest route wraps this
    // in a fixed-height flex column, where min-h-screen is squashed to exactly
    // one viewport and anything past it overflows onto the page background.
    // Same trap the colours page fell into.
    <div className="flex-1 min-h-0 bg-slate-950 flex flex-col">
      <div className="flex items-center gap-4 px-4 py-2 border-b border-slate-700 bg-slate-900 flex-shrink-0">
        <Button variant="outline" size="sm" onClick={onBack} className="border-slate-400 text-white bg-slate-700 hover:bg-slate-600 hover:border-slate-300">
          ← Back
        </Button>
        <h1 className="text-lg font-bold text-orange-400">Client Test</h1>
        <span className="text-xs text-slate-500">Nothing here touches IRC</span>
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
            onAssignRat={(_caseId, rat) =>
              setCaseData((prev) =>
                prev.assignedRats.includes(rat)
                  ? prev
                  : { ...prev, assignedRats: [...prev.assignedRats, rat] }
              )
            }
            onRemoveRat={(_caseId, rat) =>
              setCaseData((prev) => ({
                ...prev,
                assignedRats: prev.assignedRats.filter((r) => r !== rat),
              }))
            }
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
            onSetCodeRedTimer={(_caseId, seconds) =>
              setCaseData((prev) => ({
                ...prev,
                codeRedTimer: {
                  baseSeconds: seconds,
                  lastSeenGrabInjectionId: prev.codeRedTimer?.lastSeenGrabInjectionId,
                  manualOverride: true,
                  running: prev.codeRedTimer?.running ?? false,
                  runningSince: prev.codeRedTimer?.running ? new Date() : undefined,
                  accumulatedSeconds: 0,
                },
              }))
            }
          />
        </div>

        <div className="w-[26rem] flex-shrink-0 border-l border-slate-700 bg-slate-900 flex flex-col min-h-0">
          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* --- who the case is ------------------------------------- */}
            <section className="p-3 border-b border-slate-700/60 flex flex-col gap-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Case setup</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className={label}>Case #</p>
                  <input className={field} value={setup.caseNumber} inputMode="numeric"
                         onChange={(e) => setSetup({ ...setup, caseNumber: e.target.value })} />
                </div>
                <div>
                  <p className={label}>Client name</p>
                  <input className={field} value={setup.clientName}
                         onChange={(e) => setSetup({ ...setup, clientName: e.target.value })} />
                </div>
                <div>
                  <p className={label}>IRC nick</p>
                  <input className={field} value={setup.ircNick} placeholder="same as name"
                         onChange={(e) => setSetup({ ...setup, ircNick: e.target.value })} />
                </div>
                <div>
                  <p className={label}>System</p>
                  <input className={field} value={setup.system}
                         onChange={(e) => setSetup({ ...setup, system: e.target.value })} />
                </div>
                <div>
                  <p className={label}>Language</p>
                  <input className={field} value={setup.language}
                         onChange={(e) => setSetup({ ...setup, language: e.target.value })} />
                </div>
                <div>
                  <p className={label}>Platform</p>
                  <select className={field} value={setup.platform}
                          onChange={(e) => setSetup({ ...setup, platform: e.target.value })}>
                    {PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <p className={label}>Assigned rats</p>
                  <input className={field} value={setup.rats} placeholder="comma separated"
                         onChange={(e) => setSetup({ ...setup, rats: e.target.value })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" className="accent-orange-500" checked={setup.clientInChannel}
                       onChange={(e) => setSetup({ ...setup, clientInChannel: e.target.checked })} />
                Client in channel
              </label>
              <div className="flex gap-2">
                <Button size="sm" onClick={applySetup} className="bg-orange-600 hover:bg-orange-700 text-xs h-7">
                  Apply
                </Button>
                <Button size="sm" variant="outline" onClick={resetCase}
                        className="border-slate-500 text-white bg-slate-700 hover:bg-slate-600 text-xs h-7">
                  Reset case
                </Button>
              </div>
              <p className="text-[10px] text-slate-500">
                Apply keeps the conversation; Reset starts a fresh case from these fields.
              </p>
            </section>

            {/* --- talking as somebody ---------------------------------- */}
            <section className="p-3 border-b border-slate-700/60 flex flex-col gap-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Say something as</p>
              <div className="flex gap-1">
                {(['client', 'dispatch', 'rat'] as SpeakerKind[]).map((kind) => (
                  <button
                    key={kind}
                    onClick={() => setSpeakerKind(kind)}
                    className={`flex-1 rounded px-2 py-1 text-xs capitalize transition-colors ${
                      speakerKind === kind
                        ? 'bg-orange-600 text-white'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {kind}
                  </button>
                ))}
              </div>

              {speakerKind === 'rat' && (
                rats.length === 0 ? (
                  <p className="text-[10px] text-amber-400">No rats assigned — add one in setup above.</p>
                ) : (
                  <select className={field} value={activeRat} onChange={(e) => setSpeakerRat(e.target.value)}>
                    {rats.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                )
              )}

              <div className="flex gap-2">
                <input
                  className={field}
                  value={speech}
                  placeholder={`as ${senderFor(speakerKind) || '…'}`}
                  onChange={(e) => setSpeech(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') speak(); }}
                />
                <Button size="sm" onClick={speak} className="bg-orange-600 hover:bg-orange-700 text-xs h-7 flex-shrink-0">
                  Send
                </Button>
              </div>
              <label className="flex items-center gap-2 text-[10px] text-slate-400">
                <input type="checkbox" className="accent-orange-500" checked={asNotice}
                       onChange={(e) => setAsNotice(e.target.checked)} />
                Send as a NOTICE (how translations arrive)
              </label>
              <p className="text-[10px] text-slate-500">
                Distance and jump reports need the case number, as they do on the board —
                <code className="text-slate-400"> #{setup.caseNumber} 32kls</code>,{' '}
                <code className="text-slate-400">#{setup.caseNumber} 3j</code>.
                Status calls like <code className="text-slate-400">fr+</code> do not.
              </p>
            </section>

            {/* --- case notes ------------------------------------------- */}
            <section className="p-3 border-b border-slate-700/60 flex flex-col gap-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Inject a case note</p>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className={label}>Author</p>
                  <input className={field} value={injectAuthor}
                         onChange={(e) => setInjectAuthor(e.target.value)} />
                </div>
                <label className="flex items-end gap-2 text-[10px] text-slate-400 pb-1">
                  <input type="checkbox" className="accent-orange-500" checked={injectAsBot}
                         onChange={(e) => setInjectAsBot(e.target.checked)} />
                  Bot line (dimmed, skipped by the timer)
                </label>
              </div>
              <div className="flex gap-2">
                <input
                  className={field}
                  value={injectText}
                  placeholder="<Client> quote, or a plain note"
                  onChange={(e) => setInjectText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { inject(injectText); setInjectText(''); } }}
                />
                <Button size="sm" onClick={() => { inject(injectText); setInjectText(''); }}
                        className="bg-orange-600 hover:bg-orange-700 text-xs h-7 flex-shrink-0">
                  Inject
                </Button>
              </div>

              <p className={label}>Grab presets — start the code red timer</p>
              <div className="flex gap-1 flex-wrap">
                {[3, 6, 10, 14].map((m) => (
                  <button key={m} onClick={() => injectGrab(m)}
                          className="rounded bg-slate-800 hover:bg-slate-700 px-2 py-1 text-xs text-slate-300 transition-colors">
                    {m} min
                  </button>
                ))}
                <button
                  onClick={() => inject(`<${caseData.clientName}> Ratsignal! I'm out of fuel in ${caseData.system}!`, 'RatMama[BOT]', true)}
                  className="rounded bg-slate-800 hover:bg-slate-700 px-2 py-1 text-xs text-slate-300 transition-colors"
                >
                  ratsignal
                </button>
              </div>
            </section>

            {/* --- what would have gone to IRC -------------------------- */}
            <section className="p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Raw commands sent</p>
                <button onClick={() => setRawLog([])} className="text-xs text-slate-500 hover:text-red-400 transition-colors">
                  Clear
                </button>
              </div>
              <textarea
                readOnly
                value={rawLog.length ? rawLog.join('\n') : ''}
                placeholder="Send a message or click a quick-message button — the raw text that would go to IRC shows up here."
                className="h-40 resize-none bg-slate-950 text-slate-300 text-xs font-mono p-3 rounded border border-slate-800 outline-none placeholder:text-slate-600"
              />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
