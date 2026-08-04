import { useState, useEffect, useRef, useMemo } from 'react';
import { Zap, MapPin } from 'lucide-react';
import type { Case, Message } from './DispatchBoard';
import { compareCases } from './DispatchBoard';
import { RatCaseCard } from './RatCaseCard';
import { RatCaseDetail } from './RatCaseDetail';
import { useRatAccounts, type RatAccount, type AccountCardDist, type ShipSlot } from '../hooks/useRatAccounts';
import { ircWebSocket } from '../services/ircWebSocket';
import {
  fetchJournalPosition, fetchDetectedCommanders, positionAge, POSITION_POLL_MS,
  isJournalEnabled, setJournalEnabled,
} from '../services/journalPosition';
import { translateText, toDeepLTargetLang } from '../services/translationService';
import { langblyTranslate, toLangblyTargetLang } from '../services/langblyService';
import {
  parseEdsyBuild, verifyBuild, jumpRange, plotJumps, NEUTRON_THRESHOLD_LY,
  type ShipParams,
} from '../services/spanshService';

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
  /** Requested via &showId=1. Spansh's plotter identifies systems by id64, not name. */
  id64?: number;
}

// ---- Accounts panel ------------------------------------------------

interface AccountRowProps {
  account: RatAccount;
  onUpdate: (id: string, cmdr: string, system: string) => void;
  onSetShip: (id: string, slot: ShipSlot, ship: ShipParams | undefined) => void;
  onSetSupercharged: (id: string, on: boolean) => void;
  onSetAutoLocate: (id: string, on: boolean) => void;
  journalEnabled: boolean;
  onRemove: (id: string) => void;
}

const SLOT_LABEL: Record<ShipSlot, string> = {
  short: `under ${NEUTRON_THRESHOLD_LY} ly, no neutron boosting`,
  long:  `${NEUTRON_THRESHOLD_LY} ly and above, neutron boosted`,
};

/** Paste box for an EDSY export, shown inline under the account row. */
function ShipEditor({ account, slot, onSetShip, onClose }: {
  account: RatAccount;
  slot: ShipSlot;
  onSetShip: (id: string, slot: ShipSlot, ship: ShipParams | undefined) => void;
  onClose: () => void;
}) {
  const existing = account.ships?.[slot];
  // Prefilled from what is already saved, so "replace" starts from the current
  // build rather than a blank box -- usually only the cargo or a module changed.
  const [raw, setRaw]     = useState(existing?.sourceJson ?? '');
  const [error, setError] = useState<string | null>(null);
  const [mult, setMult]   = useState(existing?.superchargeMultiplier?.toString() ?? '');
  const [cargo, setCargo] = useState(existing ? String(existing.cargo) : '');
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Mount only. Selecting the prefilled build means pasting a new one replaces
  // it instead of landing in the middle of the old JSON; doing this on every
  // render would re-select on each keystroke and make the box unusable.
  useEffect(() => {
    if (existing?.sourceJson) taRef.current?.select();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const save = () => {
    try {
      const ship = parseEdsyBuild(raw);
      const check = verifyBuild(ship);
      // EDSY publishes its own max range in the same export. If ours disagrees
      // the estimates would be quietly wrong, so refuse rather than guess.
      if (!check.ok) {
        setError(
          `Parsed range ${check.derived.toFixed(2)} ly but EDSY says ${check.reported?.toFixed(2)} ly. ` +
          `Not saving — the FSD table may be out of date.`,
        );
        return;
      }
      const override = mult.trim() ? Number(mult) : undefined;
      if (override !== undefined && (!Number.isFinite(override) || override <= 0)) {
        setError('Supercharge multiplier must be a positive number.');
        return;
      }
      // Blank means "whatever the build holds"; anything else is what the rat
      // actually flies with, which is usually well under capacity.
      const carried = cargo.trim() ? Number(cargo) : ship.cargoCapacity;
      if (!Number.isFinite(carried) || carried < 0) {
        setError('Cargo must be zero or more.');
        return;
      }
      if (carried > ship.cargoCapacity) {
        setError(`That build only holds ${ship.cargoCapacity}t.`);
        return;
      }
      onSetShip(account.id, slot, {
        ...ship,
        cargo: carried,
        superchargeMultiplier: override ?? ship.superchargeMultiplier,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that build.');
    }
  };

  return (
    <div className="py-1 pl-2 space-y-1">
      <p className="text-[11px] text-slate-500">
        Ship for <span className="text-slate-400">{SLOT_LABEL[slot]}</span>
      </p>
      <textarea
        value={raw}
        onChange={e => { setRaw(e.target.value); setError(null); }}
        onKeyDown={e => { if (e.key === 'Escape') onClose(); }}
        placeholder='Paste the EDSY export here (Export → Journal), e.g. [{"header":…,"data":{"event":"Loadout",…}}]'
        autoFocus
        ref={taRef}
        rows={3}
        className="w-full bg-slate-800 border border-slate-600 focus:border-orange-500 outline-none rounded px-2 py-1 text-[11px] font-mono text-white placeholder-slate-600 resize-y"
      />
      <label className="flex items-center gap-2 text-[11px] text-slate-500">
        Cargo carried
        <input
          value={cargo}
          onChange={e => setCargo(e.target.value)}
          placeholder={existing ? String(existing.cargoCapacity) : 'max'}
          inputMode="numeric"
          className="w-16 bg-slate-800 border border-slate-600 focus:border-orange-500 outline-none rounded px-1 py-0.5 text-[11px] text-white placeholder-slate-600"
        />
        <span className="text-slate-600">
          tonnes{existing ? ` — build holds ${existing.cargoCapacity}t` : ', blank = the build\'s capacity'}
        </span>
      </label>
      {slot === 'long' && (
        <label className="flex items-center gap-2 text-[11px] text-slate-500">
          Neutron multiplier
          <input
            value={mult}
            onChange={e => setMult(e.target.value)}
            placeholder="auto"
            className="w-16 bg-slate-800 border border-slate-600 focus:border-orange-500 outline-none rounded px-1 py-0.5 text-[11px] text-white placeholder-slate-600"
          />
          <span className="text-slate-600">blank = detect from the drive</span>
        </label>
      )}
      {error && <p className="text-[11px] text-red-400 leading-snug">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} className="text-xs text-green-400 hover:text-green-300">Save ship</button>
        <button onClick={onClose} className="text-xs text-slate-500 hover:text-slate-300">Cancel</button>
        {existing && (
          <button
            onClick={() => { onSetShip(account.id, slot, undefined); onClose(); }}
            className="text-xs text-slate-600 hover:text-red-400 ml-auto"
          >Remove</button>
        )}
      </div>
    </div>
  );
}

function AccountRow({ account, onUpdate, onSetShip, onSetSupercharged, onSetAutoLocate, journalEnabled, onRemove }: AccountRowProps) {
  const [editing, setEditing] = useState(false);
  const [shipSlot, setShipSlot] = useState<ShipSlot | null>(null);
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
    <>
    <div className="flex items-center gap-2 group py-1">
      <span className="text-xs text-slate-300 w-36 flex-shrink-0 truncate">{account.cmdr}</span>
      <span className="text-xs text-slate-500 flex-1 truncate">{account.system || <span className="text-slate-700">no system set</span>}</span>
      {/* Zap rather than a ⚡ emoji: emoji render as a colour glyph and ignore
          text-* classes, so the on/off states looked identical. The padding is
          deliberate too -- an 11px glyph with no padding is a miserable target. */}
      <button
        type="button"
        onClick={() => onSetSupercharged(account.id, !account.startSupercharged)}
        aria-pressed={!!account.startSupercharged}
        title={
          account.startSupercharged
            ? 'Sitting supercharged — the first jump of a route gets the neutron boost. Click to turn off.'
            : 'Not supercharged. Turn on if parked on a charged neutron star (e.g. Jackson\'s Lighthouse).'
        }
        className={`flex-shrink-0 rounded px-1 py-0.5 transition-colors ${
          account.startSupercharged
            ? 'text-sky-300 bg-sky-500/15 hover:bg-sky-500/25'
            : 'text-slate-600 hover:text-sky-300 hover:bg-slate-700/50'
        }`}
      >
        <Zap className="w-3.5 h-3.5" fill={account.startSupercharged ? 'currentColor' : 'none'} />
      </button>
      {/* Hidden entirely when the journal feature is off: with nothing polling,
          the toggle would remember a preference that does nothing. */}
      {journalEnabled && (
      <button
        type="button"
        onClick={() => onSetAutoLocate(account.id, !account.autoLocate)}
        aria-pressed={!!account.autoLocate}
        title={
          account.autoLocate
            ? `Tracking this CMDR from the game journal (${positionAge(account.positionAt)}). Click to stop and set the system by hand.`
            : 'Set the system by hand. Click to follow the game journal instead — needs the bridge running, and updates only while you are the CMDR playing.'
        }
        className={`flex-shrink-0 rounded px-1 py-0.5 transition-colors ${
          account.autoLocate
            ? 'text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25'
            : 'text-slate-600 hover:text-emerald-300 hover:bg-slate-700/50'
        }`}
      >
        <MapPin className="w-3.5 h-3.5" fill={account.autoLocate ? 'currentColor' : 'none'} />
      </button>
      )}
      {(['short', 'long'] as ShipSlot[]).map(slot => {
        const ship = account.ships?.[slot];
        return (
          <button
            key={slot}
            onClick={() => setShipSlot(s => (s === slot ? null : slot))}
            title={
              ship
                ? `${slot === 'short' ? 'Short' : 'Long'} range: ${ship.shipName} — ` +
                  `${jumpRange(ship).toFixed(1)} ly with ${ship.cargo}/${ship.cargoCapacity}t cargo` +
                  (slot === 'long' && ship.superchargeMultiplier
                    ? `, ${ship.superchargeMultiplier}x neutron`
                    : '') +
                  '. Click to replace.'
                : `Set the ship for ${SLOT_LABEL[slot]}`
            }
            className={`text-[11px] flex-shrink-0 font-mono ${
              ship ? 'text-orange-400/80 hover:text-orange-300' : 'text-slate-700 hover:text-orange-400'
            }`}
          >
            {slot === 'short' ? '<' : '≥'}1k:{ship ? `${jumpRange(ship).toFixed(0)}ly` : '—'}
          </button>
        );
      })}
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
    {shipSlot && (
      <ShipEditor
        account={account}
        slot={shipSlot}
        onSetShip={onSetShip}
        onClose={() => setShipSlot(null)}
      />
    )}
    </>
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
  onSetShip: (id: string, slot: ShipSlot, ship: ShipParams | undefined) => void;
  onSetSupercharged: (id: string, on: boolean) => void;
  onSetAutoLocate: (id: string, on: boolean) => void;
  journalEnabled: boolean;
  onToggleJournal: (on: boolean) => void;
  onRemove: (id: string) => void;
}

function AccountsPanel({ accounts, onAdd, onUpdate, onSetShip, onSetSupercharged, onSetAutoLocate, journalEnabled, onToggleJournal, onRemove }: AccountsPanelProps) {
  const [adding, setAdding] = useState(false);

  const handleAdd = (cmdr: string, system: string) => {
    onAdd(cmdr, system);
    setAdding(false);
  };

  return (
    <div className="flex-shrink-0 border-t border-slate-700/60 bg-slate-900/70 max-h-52 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-2 sticky top-0 bg-slate-900/90 backdrop-blur-sm z-10">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">My Accounts</span>
        <label
          className="flex items-center gap-1.5 text-[11px] text-slate-500 cursor-pointer ml-auto mr-3"
          title={
            journalEnabled
              ? 'Reading the game journal: commanders are added automatically and their system follows where you fly. Uncheck to manage accounts by hand.'
              : 'Off. Turn on to add the commanders on this machine automatically and keep their system current from the game journal. Needs the bridge running.'
          }
        >
          <input
            type="checkbox"
            checked={journalEnabled}
            onChange={e => onToggleJournal(e.target.checked)}
            className="accent-emerald-500"
          />
          Use game journal
        </label>
        {!adding && (
          <button onClick={() => setAdding(true)} className="text-xs text-orange-400 hover:text-orange-300 transition-colors">
            + Add
          </button>
        )}
      </div>
      <div className="px-4 pb-3 space-y-0.5">
        {accounts.map(a => (
          <AccountRow key={a.id} account={a} onUpdate={onUpdate} onSetShip={onSetShip} onSetSupercharged={onSetSupercharged} onSetAutoLocate={onSetAutoLocate} journalEnabled={journalEnabled} onRemove={onRemove} />
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
  const { accounts, add, update, setShip, setSupercharged, setAutoLocate, setLocation, importDetected, remove } = useRatAccounts();
  const [id64Map, setId64Map] = useState<Map<string, number>>(new Map());
  const [jumpMap, setJumpMap] = useState<Record<string, {
    jumps: number | null;
    status: NonNullable<AccountCardDist['jumpStatus']>;
  }>>({});

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

  /**
   * Auto-translate incoming debrief messages, matching what CaseWindow does for
   * case chatter rather than making the rat click "T" on every line.
   *
   * Only the newest message is considered, and the dependency array is
   * [debriefMessages] alone. That combination is what keeps it safe:
   * translateText() returns null when the text is already English, so nothing is
   * recorded for English lines. Depending on debriefTranslations or
   * translatingIds as well would re-fire when those change, find the message
   * still untranslated, and translate it forever. The trade-off is that a burst
   * arriving in one render only translates its last line -- the manual "T"
   * button backfills anything missed.
   */
  useEffect(() => {
    if (debriefMessages.length === 0) return;
    const last = debriefMessages[debriefMessages.length - 1];
    if (!last?.id || !last.text) return;
    if (last.isSystem || last.isNotice) return;
    if (last.sender?.toLowerCase().includes('[bot]')) return;
    if (debriefTranslations[last.id] || translatingIds.has(last.id)) return;
    translateMessage(last.id, last.text);
  }, [debriefMessages]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const [journalEnabled, setJournalEnabledState] = useState(isJournalEnabled);
  const toggleJournal = (on: boolean) => {
    setJournalEnabled(on);
    setJournalEnabledState(on);
    // Let a re-enable re-scan: commanders may have been added since, and the
    // import only ever fills gaps so running it again is harmless.
    if (!on) importedRef.current = false;
  };

  // Adopt the commanders the journals know about, once per session.
  //
  // Only fills gaps: importDetected skips any CMDR already on the list, so a
  // system typed by hand or a ship whose cargo was tuned is never overwritten.
  // A refit after this runs will not be picked up either -- re-paste the build,
  // which is also the point at which the cargo figure gets confirmed.
  const importedRef = useRef(false);
  useEffect(() => {
    if (!journalEnabled || importedRef.current) return;
    importedRef.current = true;
    const controller = new AbortController();

    void (async () => {
      const scan = await fetchDetectedCommanders(controller.signal);
      if (!scan) return;

      const found = scan.commanders.map(c => {
        let ship: ShipParams | undefined;
        if (c.loadout) {
          try {
            const parsed = parseEdsyBuild(JSON.stringify(c.loadout));
            // Same bar as a pasted build: if our range disagrees with the one the
            // game reported, the parse is wrong and a silent bad estimate is
            // worse than no ship at all.
            if (verifyBuild(parsed).ok) ship = parsed;
          } catch {
            /* unreadable loadout -- add the account without a ship */
          }
        }
        return { cmdr: c.cmdr, system: c.system, positionAt: c.timestamp, ship };
      });

      importDetected(found);
    })();

    return () => controller.abort();
  }, [journalEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live position from the local journal, for accounts that opted in.
  //
  // The journal describes whoever is playing on this machine, so the commander
  // it reports decides which account is updated -- an account for a different
  // CMDR is left alone even with the toggle on, rather than being given someone
  // else's position.
  const trackedCmdrs = accounts
    .filter(a => a.autoLocate && a.cmdr.trim())
    .map(a => `${a.id}:${a.cmdr}`)
    .join('|');

  // Ship type last seen per account, so a refit noticed on the first poll of the
  // session is not mistaken for a swap -- only a change *from* a known ship
  // triggers an update, which also protects hand-tuned cargo from being clobbered
  // by every poll finding the same ship.
  const lastSeenShipRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!journalEnabled || !trackedCmdrs) return;
    const controller = new AbortController();

    const tick = async () => {
      const res = await fetchJournalPosition(controller.signal);
      if (!res.ok) return; // bridge down, or the game has not written one yet
      const { system, cmdr, timestamp, ship, loadout } = res.position;

      const targets = trackedCmdrs.split('|').map(entry => {
        const i = entry.indexOf(':');
        return { id: entry.slice(0, i), cmdr: entry.slice(i + 1) };
      });

      // With no commander in the journal there is nothing to match on, so a
      // single tracked account is assumed to be the one being played. More than
      // one and it is left alone rather than guessed at.
      const matches = cmdr
        ? targets.filter(t => t.cmdr.trim().toLowerCase() === cmdr.trim().toLowerCase())
        : (targets.length === 1 ? targets : []);

      for (const t of matches) {
        setLocation(t.id, system, timestamp);

        if (!ship) continue;
        const lastShip = lastSeenShipRef.current.get(t.id);
        lastSeenShipRef.current.set(t.id, ship);
        if (lastShip === undefined || lastShip === ship || !loadout) continue;

        // Ship changed since we last looked at this account -- pull the fresh
        // build off the new Loadout event, same parser the one-time import uses.
        try {
          const parsed = parseEdsyBuild(JSON.stringify(loadout));
          if (verifyBuild(parsed).ok) setShip(t.id, 'short', parsed);
        } catch {
          /* unreadable loadout -- leave the previous ship in place */
        }
      }
    };

    void tick();
    const timer = window.setInterval(() => void tick(), POSITION_POLL_MS);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [trackedCmdrs, journalEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const visibleCases = cases
    .filter(c => c.status !== 'closed')
    .filter(c => PLATFORM_OPTIONS.some(p => enabledPlatforms.has(p.key) && c.platform.toLowerCase().includes(p.key.toLowerCase())))
    .sort(compareCases);

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

    fetch(`https://www.edsm.net/api-v1/systems?${params}&showCoordinates=1&showId=1`, { signal: controller.signal })
      .then(r => r.json())
      .then((data: EdsmCoordSystem[]) => {
        const coordMap = new Map(data.map(s => [s.name.toLowerCase(), s.coords]));
        setId64Map(new Map(
          data.filter(s => s.id64 != null).map(s => [s.name.toLowerCase(), s.id64 as number]),
        ));
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

  /**
   * Plot a single case/account pair on demand.
   *
   * Not done automatically for every pair: each plot is a queued job on Spansh
   * taking ~10s, so filling a whole cases x accounts matrix would mean dozens of
   * jobs against a free third-party service every time a case appears. Results
   * are cached in spanshService, so re-plotting the same pair is instant.
   */
  const requestJumps = async (caseId: string, accountId: string) => {
    const key = `${caseId}:${accountId}`;
    if (jumpMap[key]?.status === 'plotting') return;

    const account = accounts.find(a => a.id === accountId);
    const kase    = visibleCases.find(c => c.id === caseId);
    const dist    = distMap[caseId]?.[accountId]?.distance;
    if (!account || !kase || dist == null) return;

    // Pick the build the rat would actually fly for a trip this long, falling
    // back to whichever slot is filled if only one is set.
    const slot: ShipSlot = dist >= NEUTRON_THRESHOLD_LY ? 'long' : 'short';
    const ship = account.ships?.[slot] ?? account.ships?.[slot === 'long' ? 'short' : 'long'];
    if (!ship) {
      setJumpMap(m => ({ ...m, [key]: { jumps: null, status: 'no-ship' } }));
      return;
    }

    const from = id64Map.get(account.system?.toLowerCase() ?? '');
    const to   = id64Map.get(kase.system?.toLowerCase() ?? '');
    if (from == null || to == null) {
      setJumpMap(m => ({ ...m, [key]: { jumps: null, status: 'error' } }));
      return;
    }

    setJumpMap(m => ({ ...m, [key]: { jumps: null, status: 'plotting' } }));
    try {
      const jumps = await plotJumps(from, to, dist, ship, {
        startSupercharged: account.startSupercharged,
      });
      setJumpMap(m => ({ ...m, [key]: { jumps, status: 'done' } }));
    } catch {
      setJumpMap(m => ({ ...m, [key]: { jumps: null, status: 'error' } }));
    }
  };

  // Build AccountCardDist[] for a given caseId
  const buildDists = useMemo(() => (caseId: string): AccountCardDist[] =>
    accounts.map(a => ({
      id:       a.id,
      cmdr:     a.cmdr,
      system:   a.system,
      distance: distMap[caseId]?.[a.id]?.distance ?? null,
      status:   distMap[caseId]?.[a.id]?.status   ?? 'loading',
      jumps:      jumpMap[`${caseId}:${a.id}`]?.jumps  ?? null,
      jumpStatus: jumpMap[`${caseId}:${a.id}`]?.status ?? 'idle',
    })),
  [accounts, distMap, jumpMap]);

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
                  onPlotJumps={accountId => requestJumps(c.id, accountId)}
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
            onSetShip={setShip}
            onSetSupercharged={setSupercharged} onSetAutoLocate={setAutoLocate} journalEnabled={journalEnabled} onToggleJournal={toggleJournal}
            onRemove={remove}
          />
        </>
      )}

    </div>
  );
}
