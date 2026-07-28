import { useState, useEffect, useRef, useMemo } from 'react';
import type { Case, Message } from './DispatchBoard';
import { RatCaseCard } from './RatCaseCard';
import { RatCaseDetail } from './RatCaseDetail';
import { useRatAccounts, type RatAccount, type AccountCardDist } from '../hooks/useRatAccounts';
import { ircWebSocket } from '../services/ircWebSocket';
import { translateText, toDeepLTargetLang } from '../services/translationService';
import { langblyTranslate, toLangblyTargetLang } from '../services/langblyService';

// Common DeepL/Langbly language codes shown in the debrief target-language picker.
// Swap translateText() in translationService.ts to switch providers.
const DEBRIEF_LANGS = [
  { code: 'EN', label: 'EN' }, { code: 'DE', label: 'DE' }, { code: 'FR', label: 'FR' },
  { code: 'ES', label: 'ES' }, { code: 'IT', label: 'IT' }, { code: 'NL', label: 'NL' },
  { code: 'PL', label: 'PL' }, { code: 'PT-PT', label: 'PT' }, { code: 'PT-BR', label: 'PT-BR' },
  { code: 'RU', label: 'RU' }, { code: 'ZH', label: 'ZH' }, { code: 'JA', label: 'JA' },
  { code: 'KO', label: 'KO' }, { code: 'AR', label: 'AR' }, { code: 'TR', label: 'TR' },
];

const PLATFORM_OPTIONS = [
  { key: 'PC', label: 'PC' },
  { key: 'Xbox', label: 'XB' },
  { key: 'PlayStation', label: 'PS' },
] as const;

const STORAGE_KEY = 'ratboard-enabled-platforms';

function loadEnabledPlatforms(): Set<string> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return new Set(JSON.parse(stored) as string[]);
  } catch {}
  return new Set(PLATFORM_OPTIONS.map(p => p.key));
}

// ---- EDSM coordinate type -----------------------------------------

interface EdsmCoordSystem {
  name: string;
  coords?: { x: number; y: number; z: number };
}

// ---- Accounts panel ------------------------------------------------

interface AccountRowProps {
  account: RatAccount;
  onUpdate: (id: string, cmdr: string, system: string) => void;
  onRemove: (id: string) => void;
}

function AccountRow({ account, onUpdate, onRemove }: AccountRowProps) {
  const [editing, setEditing] = useState(false);
  const [cmdr, setCmdr]     = useState(account.cmdr);
  const [system, setSystem] = useState(account.system);

  const save = () => {
    if (cmdr.trim()) {
      onUpdate(account.id, cmdr.trim(), system.trim());
      setEditing(false);
    }
  };

  const cancel = () => {
    setCmdr(account.cmdr);
    setSystem(account.system);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-2 py-1">
        <input
          value={cmdr}
          onChange={e => setCmdr(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
          placeholder="CMDR Name"
          className="flex-1 min-w-0 bg-slate-800 border border-slate-600 focus:border-orange-500 outline-none rounded px-2 py-1 text-xs text-white placeholder-slate-600"
        />
        <input
          value={system}
          onChange={e => setSystem(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
          placeholder="Current System"
          className="flex-1 min-w-0 bg-slate-800 border border-slate-600 focus:border-orange-500 outline-none rounded px-2 py-1 text-xs text-white placeholder-slate-600"
        />
        <button onClick={save}   className="text-green-400 hover:text-green-300 text-xs px-1 flex-shrink-0">✓</button>
        <button onClick={cancel} className="text-slate-500 hover:text-slate-300 text-xs px-1 flex-shrink-0">✕</button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 group py-1">
      <span className="text-xs text-slate-300 w-36 flex-shrink-0 truncate">{account.cmdr}</span>
      <span className="text-xs text-slate-500 flex-1 truncate">{account.system || <span className="text-slate-700">no system set</span>}</span>
      <button
        onClick={() => setEditing(true)}
        title="Edit"
        className="text-slate-600 hover:text-slate-300 text-xs px-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
      >✎</button>
      <button
        onClick={() => onRemove(account.id)}
        title="Remove"
        className="text-slate-600 hover:text-red-400 text-xs px-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
      >✕</button>
    </div>
  );
}

function AddAccountRow({ onAdd, onCancel }: { onAdd: (cmdr: string, system: string) => void; onCancel: () => void }) {
  const [cmdr, setCmdr]     = useState('');
  const [system, setSystem] = useState('');

  const save = () => {
    if (cmdr.trim()) onAdd(cmdr.trim(), system.trim());
  };

  return (
    <div className="flex items-center gap-2 py-1">
      <input
        value={cmdr}
        onChange={e => setCmdr(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }}
        placeholder="CMDR Name"
        autoFocus
        className="flex-1 min-w-0 bg-slate-800 border border-slate-600 focus:border-orange-500 outline-none rounded px-2 py-1 text-xs text-white placeholder-slate-600"
      />
      <input
        value={system}
        onChange={e => setSystem(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }}
        placeholder="Current System"
        className="flex-1 min-w-0 bg-slate-800 border border-slate-600 focus:border-orange-500 outline-none rounded px-2 py-1 text-xs text-white placeholder-slate-600"
      />
      <button onClick={save}     className="text-green-400 hover:text-green-300 text-xs px-1 flex-shrink-0">✓</button>
      <button onClick={onCancel} className="text-slate-500 hover:text-slate-300 text-xs px-1 flex-shrink-0">✕</button>
    </div>
  );
}

interface AccountsPanelProps {
  accounts: RatAccount[];
  onAdd:    (cmdr: string, system: string) => void;
  onUpdate: (id: string, cmdr: string, system: string) => void;
  onRemove: (id: string) => void;
}

function AccountsPanel({ accounts, onAdd, onUpdate, onRemove }: AccountsPanelProps) {
  const [adding, setAdding] = useState(false);

  const handleAdd = (cmdr: string, system: string) => {
    onAdd(cmdr, system);
    setAdding(false);
  };

  return (
    <div className="flex-shrink-0 border-t border-slate-700/60 bg-slate-900/70 max-h-52 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-2 sticky top-0 bg-slate-900/90 backdrop-blur-sm z-10">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">My Accounts</span>
        {!adding && (
          <button onClick={() => setAdding(true)} className="text-xs text-orange-400 hover:text-orange-300 transition-colors">
            + Add
          </button>
        )}
      </div>
      <div className="px-4 pb-3 space-y-0.5">
        {accounts.map(a => (
          <AccountRow key={a.id} account={a} onUpdate={onUpdate} onRemove={onRemove} />
        ))}
        {adding && <AddAccountRow onAdd={handleAdd} onCancel={() => setAdding(false)} />}
        {accounts.length === 0 && !adding && (
          <p className="text-xs text-slate-500 py-1 leading-relaxed">
            No accounts yet — click <span className="text-orange-400">+ Add</span> to get started.<br />
            <span className="text-slate-600">Adding your CMDR name and current system lets the board estimate your jump distance to each case.</span>
          </p>
        )}
      </div>
    </div>
  );
}

// ---- RatBoard ------------------------------------------------------

interface RatBoardProps {
  cases: Case[];
  debriefMessages: Message[];
}

export function RatBoard({ cases, debriefMessages }: RatBoardProps) {
  const [enabledPlatforms, setEnabledPlatforms] = useState<Set<string>>(loadEnabledPlatforms);
  const [selectedCaseId, setSelectedCaseId]     = useState<string | null>(null);
  const [isClosed, setIsClosed]                 = useState(false);
  const frozenCaseRef                           = useRef<Case | null>(null);
  const { accounts, add, update, remove }       = useRatAccounts();

  const [showDebrief, setShowDebrief]     = useState(false);
  const [debriefInput, setDebriefInput]   = useState('');
  const [lastSeenCount, setLastSeenCount] = useState(0);
  const debriefScrollRef                  = useRef<HTMLDivElement>(null);

  const [targetLang, setTargetLang]           = useState('EN');
  const [transMethod, setTransMethod]         = useState<'mecha' | 'deepl' | 'langbly'>('deepl');
  const [debriefTranslations, setDebriefTranslations] = useState<Record<string, string>>({});
  const [translatingIds, setTranslatingIds]   = useState<Set<string>>(new Set());
  const [translatingInput, setTranslatingInput] = useState(false);

  // caseId -> accountId -> dist result
  const [distMap, setDistMap] = useState<Record<string, Record<string, { distance: number | null; status: AccountCardDist['status'] }>>>({});

  // Pre-populate target language from the last case the user drilled into
  useEffect(() => {
    if (!selectedCaseId) return;
    const c = cases.find(c => c.id === selectedCaseId);
    if (c?.language && !c.language.toLowerCase().startsWith('en')) {
      setTargetLang(toDeepLTargetLang(c.language));
    }
  }, [selectedCaseId]);

  const translateMessage = async (msgId: string, text: string) => {
    if (translatingIds.has(msgId)) return;
    setTranslatingIds(prev => { const s = new Set(prev); s.add(msgId); return s; });
    const result = await translateText(text, 'EN');
    setTranslatingIds(prev => { const s = new Set(prev); s.delete(msgId); return s; });
    if (result) setDebriefTranslations(prev => ({ ...prev, [msgId]: result }));
  };

  const translateAndSend = async () => {
    const text = debriefInput.trim();
    if (!text) return;
    if (targetLang === 'EN') { sendDebrief(); return; }

    if (transMethod === 'mecha') {
      const langCode = targetLang.toLowerCase().split('-')[0];
      ircWebSocket.sendMessage('#debrief', `!t-${langCode} ${text}`);
      setDebriefInput('');
      return;
    }

    setTranslatingInput(true);
    const translated = transMethod === 'langbly'
      ? await langblyTranslate(text, toLangblyTargetLang(targetLang))
      : await translateText(text, targetLang);
    setTranslatingInput(false);
    if (translated) {
      ircWebSocket.sendMessage('#debrief', translated);
      setDebriefInput('');
    } else {
      sendDebrief();
    }
  };

  const debriefUnread = showDebrief ? 0 : Math.max(0, debriefMessages.length - lastSeenCount);

  useEffect(() => {
    if (showDebrief) {
      setLastSeenCount(debriefMessages.length);
      if (debriefScrollRef.current) {
        debriefScrollRef.current.scrollTop = debriefScrollRef.current.scrollHeight;
      }
    }
  }, [showDebrief, debriefMessages.length]);

  useEffect(() => {
    if (showDebrief && debriefScrollRef.current) {
      debriefScrollRef.current.scrollTop = debriefScrollRef.current.scrollHeight;
    }
  }, [debriefMessages, showDebrief]);

  const sendDebrief = () => {
    const text = debriefInput.trim();
    if (!text) return;
    ircWebSocket.sendMessage('#debrief', text);
    setDebriefInput('');
  };

  const togglePlatform = (key: string) => {
    setEnabledPlatforms(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
      return next;
    });
  };

  const visibleCases = cases
    .filter(c => c.status !== 'closed')
    .filter(c => PLATFORM_OPTIONS.some(p => enabledPlatforms.has(p.key) && c.platform.toLowerCase().includes(p.key.toLowerCase())))
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  // Stable keys so the fetch only re-runs when systems actually change
  const caseKey    = visibleCases.map(c => `${c.id}:${c.system}`).join('|');
  const accountKey = accounts.map(a => `${a.id}:${a.system}`).join('|');

  useEffect(() => {
    if (!accounts.length || !visibleCases.length) { setDistMap({}); return; }

    const validAccounts = accounts.filter(a => a.system && a.system !== 'Unknown');
    const validCases    = visibleCases.filter(c => c.system && c.system !== 'Unknown');

    // Seed loading state for all pairs
    const loading: typeof distMap = {};
    for (const c of visibleCases) {
      loading[c.id] = {};
      for (const a of accounts) {
        const noData = !c.system || c.system === 'Unknown' || !a.system;
        loading[c.id][a.id] = { distance: null, status: noData ? 'no-system' : 'loading' };
      }
    }
    setDistMap(loading);

    if (!validCases.length || !validAccounts.length) return;

    const allSystems = [...validCases.map(c => c.system), ...validAccounts.map(a => a.system)];
    const unique     = [...new Set(allSystems.map(s => s.toLowerCase()))];
    const params     = unique.map(s => `systemName[]=${encodeURIComponent(s)}`).join('&');
    const controller = new AbortController();

    fetch(`https://www.edsm.net/api-v1/systems?${params}&showCoordinates=1`, { signal: controller.signal })
      .then(r => r.json())
      .then((data: EdsmCoordSystem[]) => {
        const coordMap = new Map(data.map(s => [s.name.toLowerCase(), s.coords]));
        const next: typeof distMap = {};
        for (const c of visibleCases) {
          next[c.id] = {};
          const cc = c.system ? coordMap.get(c.system.toLowerCase()) : undefined;
          for (const a of accounts) {
            if (!a.system)                              { next[c.id][a.id] = { distance: null, status: 'no-system' }; continue; }
            if (!c.system || c.system === 'Unknown')   { next[c.id][a.id] = { distance: null, status: 'no-system' }; continue; }
            const rc = coordMap.get(a.system.toLowerCase());
            if (!cc || !rc)                             { next[c.id][a.id] = { distance: null, status: 'error' }; continue; }
            const dist = Math.sqrt((cc.x - rc.x) ** 2 + (cc.y - rc.y) ** 2 + (cc.z - rc.z) ** 2);
            next[c.id][a.id] = { distance: dist, status: 'done' };
          }
        }
        setDistMap(next);
      })
      .catch(err => {
        if (err.name === 'AbortError') return;
        const errState: typeof distMap = {};
        for (const c of visibleCases) {
          errState[c.id] = {};
          for (const a of accounts) errState[c.id][a.id] = { distance: null, status: 'error' };
        }
        setDistMap(errState);
      });

    return () => controller.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseKey, accountKey]);

  // Build AccountCardDist[] for a given caseId
  const buildDists = useMemo(() => (caseId: string): AccountCardDist[] =>
    accounts.map(a => ({
      id:       a.id,
      cmdr:     a.cmdr,
      system:   a.system,
      distance: distMap[caseId]?.[a.id]?.distance ?? null,
      status:   distMap[caseId]?.[a.id]?.status   ?? 'loading',
    })),
  [accounts, distMap]);

  const liveCase = selectedCaseId ? cases.find(c => c.id === selectedCaseId) ?? null : null;

  useEffect(() => {
    if (liveCase) {
      frozenCaseRef.current = liveCase;
      setIsClosed(false);
    } else if (selectedCaseId && frozenCaseRef.current) {
      setIsClosed(true);
    }
  }, [liveCase, selectedCaseId]);

  const handleClose = () => {
    setSelectedCaseId(null);
    setIsClosed(false);
    frozenCaseRef.current = null;
  };

  if (selectedCaseId && (liveCase || frozenCaseRef.current)) {
    const detailCase = (liveCase ?? frozenCaseRef.current)!;
    return (
      <div className="flex-1 flex flex-col min-h-0 relative z-10">
        <RatCaseDetail
          caseData={detailCase}
          isClosed={isClosed}
          onClose={handleClose}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-black/30 relative z-10">

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700/60 bg-slate-900/60 flex-shrink-0">
        <span className="text-xs text-slate-500 font-semibold">Show:</span>
        {PLATFORM_OPTIONS.map(p => (
          <button
            key={p.key}
            onClick={() => togglePlatform(p.key)}
            className={`px-2.5 py-1 text-xs rounded border transition-colors ${
              enabledPlatforms.has(p.key)
                ? 'border-orange-500/60 bg-orange-500/10 text-orange-300'
                : 'border-slate-600 bg-transparent text-slate-500 hover:text-slate-300'
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-600">
          {visibleCases.length} case{visibleCases.length !== 1 ? 's' : ''}
        </span>
        <button
          onClick={() => setShowDebrief(v => !v)}
          className={`relative px-2.5 py-1 text-xs rounded border transition-colors ${
            showDebrief
              ? 'border-orange-500/60 bg-orange-500/10 text-orange-300'
              : 'border-slate-600 bg-transparent text-slate-500 hover:text-slate-300'
          }`}
        >
          #debrief
          {debriefUnread > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-0.5 bg-orange-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
              {debriefUnread}
            </span>
          )}
        </button>
      </div>

      {/* Debrief panel */}
      {showDebrief && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Header: channel label, language picker, join/leave */}
          <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-700/40 bg-slate-900/40 flex-shrink-0">
            <span className="text-xs text-slate-500 font-mono">#debrief</span>
            {/* Translation method toggle */}
            <div className="flex rounded overflow-hidden border border-slate-600 text-[10px] ml-auto">
              {(['mecha', 'deepl', 'langbly'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setTransMethod(m)}
                  className={`px-2 py-0.5 transition-colors ${transMethod === m ? 'bg-orange-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'}`}
                >
                  {m === 'mecha' ? 'Mecha' : m === 'deepl' ? 'DeepL' : 'Langbly'}
                </button>
              ))}
            </div>
            <select
              value={targetLang}
              onChange={e => setTargetLang(e.target.value)}
              title="Target language for outgoing translation"
              className="bg-slate-800 border border-slate-600 text-slate-300 text-xs rounded px-1.5 py-0.5 focus:outline-none focus:border-orange-500"
            >
              {DEBRIEF_LANGS.map(l => (
                <option key={l.code} value={l.code}>{l.label}</option>
              ))}
            </select>
            <button
              onClick={() => ircWebSocket.sendRaw('JOIN #debrief')}
              className="px-2 py-0.5 text-xs border border-slate-600 text-slate-400 hover:text-green-300 hover:border-green-500/50 rounded transition-colors"
            >
              Join
            </button>
            <button
              onClick={() => ircWebSocket.sendRaw('PART #debrief')}
              className="px-2 py-0.5 text-xs border border-slate-600 text-slate-400 hover:text-red-300 hover:border-red-500/50 rounded transition-colors"
            >
              Leave
            </button>
          </div>

          {/* Message log */}
          <div ref={debriefScrollRef} className="flex-1 overflow-y-auto p-3 space-y-1.5 font-mono text-xs">
            {debriefMessages.length === 0 ? (
              <div className="text-center text-slate-600 pt-10">No messages yet</div>
            ) : (
              debriefMessages.map(m => (
                <div key={m.id} className="group">
                  <div className="flex gap-2 leading-relaxed items-start">
                    <span className="text-slate-600 flex-shrink-0">
                      {m.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="text-orange-400 flex-shrink-0">{m.sender}</span>
                    <span className="text-slate-300 break-all flex-1">{m.text}</span>
                    <button
                      onClick={() => translateMessage(m.id, m.text)}
                      disabled={translatingIds.has(m.id) || !!debriefTranslations[m.id]}
                      title="Translate to English"
                      className="flex-shrink-0 opacity-0 group-hover:opacity-100 text-slate-600 hover:text-orange-400 disabled:opacity-30 disabled:cursor-default transition-opacity text-[10px] px-1"
                    >
                      {translatingIds.has(m.id) ? '…' : 'T'}
                    </button>
                  </div>
                  {debriefTranslations[m.id] && (
                    <div className="ml-[4.5rem] text-slate-500 italic text-[11px] leading-relaxed">
                      {debriefTranslations[m.id]}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Input row */}
          <div className="flex-shrink-0 border-t border-slate-700/60 p-2 flex gap-2">
            <input
              value={debriefInput}
              onChange={e => setDebriefInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendDebrief(); }}
              placeholder="Message #debrief…"
              className="flex-1 bg-slate-800 border border-slate-600 focus:border-orange-500 outline-none rounded px-3 py-1.5 text-xs text-white placeholder-slate-600"
            />
            {targetLang !== 'EN' && (
              <button
                onClick={translateAndSend}
                disabled={!debriefInput.trim() || translatingInput}
                title={transMethod === 'mecha' ? `Send as !t-${targetLang.toLowerCase().split('-')[0]} via Mecha` : `Translate to ${targetLang} via ${transMethod === 'deepl' ? 'DeepL' : 'Langbly'} then send`}
                className="px-3 py-1.5 text-xs border border-slate-600 text-slate-400 hover:text-orange-300 hover:border-orange-500/50 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-colors"
              >
                {translatingInput ? '…' : `→${targetLang}`}
              </button>
            )}
            <button
              onClick={sendDebrief}
              disabled={!debriefInput.trim()}
              className="px-3 py-1.5 text-xs bg-orange-600 hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Case list + accounts (hidden when debrief is open) */}
      {!showDebrief && (
        <>
          <div className="flex-1 overflow-y-auto p-4">
            <div className="max-w-3xl mx-auto space-y-3">
              {visibleCases.map(c => (
                <RatCaseCard
                  key={c.id}
                  caseData={c}
                  accountDistances={buildDists(c.id)}
                  onSelect={() => { frozenCaseRef.current = null; setIsClosed(false); setSelectedCaseId(c.id); }}
                />
              ))}
              {visibleCases.length === 0 && (
                <div className="text-center text-slate-500 pt-20 text-sm">No active cases</div>
              )}
            </div>
          </div>
          <AccountsPanel
            accounts={accounts}
            onAdd={add}
            onUpdate={update}
            onRemove={remove}
          />
        </>
      )}

    </div>
  );
}
