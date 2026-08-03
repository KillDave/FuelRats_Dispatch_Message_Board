import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, History, AlertTriangle, Loader2, ExternalLink } from 'lucide-react';
import { fuelRatsApi } from '@/app/services/fuelRatsApi';
import type { HistoryRescue, RescueSearchResult } from '@/app/services/fuelRatsApi';
import { useDispatcher } from '@/app/hooks/useDispatcher';

/**
 * Past rescues, for the panel on a live case and for the search page.
 *
 * Both show the same rows, so the rendering lives here once. What differs is
 * only how the list was arrived at: one asks about the client of the case in
 * front of you, the other asks whatever was typed into a form.
 */

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}

function outcomeTone(rescue: HistoryRescue): string {
  if (rescue.status !== 'closed') return 'text-sky-300 border-sky-500/50 bg-sky-500/10';
  switch (rescue.outcome) {
    case 'success':
      return 'text-emerald-300 border-emerald-500/50 bg-emerald-500/10';
    case 'failure':
      return 'text-red-300 border-red-500/50 bg-red-500/10';
    // `other`, `invalid` and a null outcome on a closed case all mean the
    // rescue did not simply succeed, which is the thing worth noticing.
    default:
      return 'text-amber-300 border-amber-500/50 bg-amber-500/10';
  }
}

function outcomeLabel(rescue: HistoryRescue): string {
  if (rescue.status !== 'closed') return rescue.status;
  return rescue.outcome ?? 'closed';
}

/** One past rescue, with everything the API returned behind a toggle. */
export function RescueRow({ rescue }: { rescue: HistoryRescue }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-slate-700/70 rounded bg-slate-900/50">
      <div className="flex items-start">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex-1 min-w-0 text-left px-2.5 py-2 hover:bg-slate-800/50 rounded"
      >
        <div className="flex items-center gap-2 flex-wrap">
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
          )}
          <span className="text-xs text-slate-400 font-mono">{formatWhen(rescue.createdAt)}</span>
          {rescue.caseNumber !== null && (
            <span className="text-xs text-slate-500">#{rescue.caseNumber}</span>
          )}
          <span
            className={`text-[11px] font-semibold border rounded px-1.5 py-0.5 ${outcomeTone(rescue)}`}
          >
            {outcomeLabel(rescue)}
          </span>
          {rescue.codeRed && (
            <span className="text-[11px] font-semibold text-red-300 border border-red-500/50 bg-red-500/10 rounded px-1.5 py-0.5 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              CODE RED
            </span>
          )}
        </div>

        <div className="mt-1 pl-5 text-xs text-slate-300 truncate">{rescue.system || '—'}</div>

        <div className="mt-0.5 pl-5 flex items-center gap-2 text-[11px] text-slate-500 flex-wrap">
          <span className="uppercase">{rescue.platform}</span>
          {rescue.expansion && <span>{rescue.expansion}</span>}
          {rescue.rats.length > 0 && (
            <>
              <span>·</span>
              <span className="text-slate-400">
                {rescue.rats.map((r) => (r === rescue.firstLimpet ? `${r} (FL)` : r)).join(', ')}
              </span>
            </>
          )}
        </div>
      </button>

        {/* Outside the toggle button: an anchor cannot be nested in one. */}
        <a
          href={paperworkUrl(rescue.id)}
          target="_blank"
          rel="noreferrer"
          title="Open paperwork"
          className="px-2 py-2.5 text-slate-500 hover:text-orange-400 flex-shrink-0"
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>

      {open && (
        <div className="px-2.5 pb-2.5 pt-1 border-t border-slate-700/70 space-y-2">
          <Field label="Client">
            {rescue.client}
            {rescue.clientNick && rescue.clientNick !== rescue.client && (
              <span className="text-slate-500"> · nick {rescue.clientNick}</span>
            )}
          </Field>
          {rescue.clientLanguage && <Field label="Language">{rescue.clientLanguage}</Field>}
          {rescue.landmark && (
            <Field label="Landmark">
              {rescue.landmark.name} · {rescue.landmark.distance.toFixed(1)} ly
            </Field>
          )}
          {rescue.title && <Field label="Operation">{rescue.title}</Field>}
          {rescue.notes && <Field label="Notes">{rescue.notes}</Field>}
          <Field label="Opened">{formatWhen(rescue.createdAt)}</Field>
          <Field label="Last update">{formatWhen(rescue.updatedAt)}</Field>
          <Field label="Rescue ID">
            <span className="font-mono text-[11px]">{rescue.id}</span>
          </Field>
          <Field label="Paperwork">
            <a
              href={paperworkUrl(rescue.id)}
              target="_blank"
              rel="noreferrer"
              className="text-orange-400 hover:text-orange-300 inline-flex items-center gap-1 break-all"
            >
              {paperworkUrl(rescue.id)}
              <ExternalLink className="w-3 h-3 flex-shrink-0" />
            </a>
          </Field>

          {rescue.quotes.length > 0 && (
            <details className="mt-1">
              <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-200">
                Case log — {rescue.quotes.length}{' '}
                {rescue.quotes.length === 1 ? 'entry' : 'entries'}
              </summary>
              <div className="mt-1.5 space-y-1 max-h-48 overflow-y-auto">
                {rescue.quotes.map((q, i) => (
                  <div key={i} className="text-[11px] leading-snug">
                    <span className="text-slate-500 font-mono">
                      {q.createdAt?.slice(11, 19)}
                    </span>{' '}
                    <span className="text-slate-400">{q.author}</span>
                    <div className="text-slate-300 pl-1 break-words">{q.message}</div>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/*
            The complete record, not a chosen subset. The fields above are the
            ones worth reading at a glance; this is everything the API sent,
            for when the question is "what does it actually say".
          */}
          <details className="mt-1">
            <summary className="text-[11px] text-slate-400 cursor-pointer hover:text-slate-200">
              Full API record
            </summary>
            {Object.keys(rescue.ratsById).length > 0 && (
              <div className="mt-1.5 text-[11px] text-slate-500">
                Rat ids in this record:{' '}
                {Object.entries(rescue.ratsById)
                  .map(([id, name]) => `${name} = ${id}`)
                  .join(' · ')}
              </div>
            )}
            <pre className="mt-1.5 p-2 rounded bg-slate-950/80 border border-slate-700/70 text-[10.5px] leading-snug text-slate-300 overflow-x-auto max-h-56 overflow-y-auto">
              {JSON.stringify(rescue.raw, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

/** The paperwork page for a rescue. */
export function paperworkUrl(id: string): string {
  return `https://fuelrats.com/paperwork/${id}`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="text-slate-500 w-24 flex-shrink-0">{label}</span>
      <span className="text-slate-300 min-w-0 break-words">{children}</span>
    </div>
  );
}

export function RescueList({ cases }: { cases: HistoryRescue[] }) {
  return (
    <div className="space-y-1.5">
      {cases.map((c) => (
        <RescueRow key={c.id} rescue={c} />
      ))}
    </div>
  );
}

interface ClientHistoryProps {
  clientName: string;
  ircNick?: string;
  /** The case being viewed, so it is not listed as its own history. */
  currentApiId?: string;
}

/**
 * Previous rescues for the client of the case on screen.
 *
 * Fetched once when the client changes, not on every render: the answer only
 * moves when a new case closes, and a panel that re-queried whenever React
 * re-drew would be the one way to make this expensive.
 */
export function ClientHistory({ clientName, ircNick, currentApiId }: ClientHistoryProps) {
  const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle');
  const [result, setResult] = useState<RescueSearchResult | null>(null);
  const [expanded, setExpanded] = useState(false);
  const access = useDispatcher();

  useEffect(() => {
    let cancelled = false;
    // Nothing is fetched until the account is known to be a dispatcher, so a
    // refusal costs no request and leaks nothing on the way to being refused.
    if (!clientName || access !== 'allowed') return;

    setState('loading');
    fuelRatsApi
      .fetchClientHistory(clientName, ircNick, { limit: 10, excludeId: currentApiId })
      .then((r) => {
        if (!cancelled) {
          setResult(r);
          setState('done');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clientName, ircNick, currentApiId, access]);

  const count = result?.cases.length ?? 0;

  // Hidden outright for anyone who is not a drilled dispatch -- not greyed
  // out, and not explained. Past cases carry clients' own words and
  // dispatchers' private notes, so this is a narrower audience than the board
  // as a whole, and someone without the group has no reason to know the panel
  // is there. `unknown` hides it too: a lookup that could not be confirmed is
  // not a reason to show the data anyway.
  if (access !== 'allowed') return null;

  return (
    // flex-shrink-0 so the header keeps its height, and the body below scrolls
    // rather than the panel growing and pushing the chat out of the window.
    <div className="border-t border-slate-700 bg-slate-900/40 flex-shrink-0">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/40"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronRight className="w-4 h-4 text-slate-500" />
        )}
        <History className="w-4 h-4 text-slate-400" />
        <span className="text-sm text-slate-300">Previous cases</span>

        {state === 'loading' && <Loader2 className="w-3.5 h-3.5 text-slate-500 animate-spin" />}

        {state === 'done' && (
          <span
            className={`text-xs font-semibold rounded px-1.5 py-0.5 border ${
              count > 0
                ? 'text-amber-300 border-amber-500/50 bg-amber-500/10'
                : 'text-slate-400 border-slate-600 bg-slate-700/30'
            }`}
          >
            {result?.error ? 'unavailable' : count === 0 ? 'none found' : count}
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 max-h-72 overflow-y-auto">
          {result?.error && <p className="text-xs text-red-300">{result.error}</p>}

          {!result?.error && count === 0 && state === 'done' && (
            <p className="text-xs text-slate-500">
              No earlier cases found for this client.
            </p>
          )}

          {count > 0 && (
            <>
              {/*
                Stated rather than implied. A client is free text with no
                account behind it, and `client` and `clientNick` disagree on
                roughly a quarter of cases, so this is a name match and not a
                confirmed identity.
              */}
              <p className="text-[11px] text-slate-500 mb-2">
                Matched by name on <span className="text-slate-400">client</span> and{' '}
                <span className="text-slate-400">clientNick</span> — a different commander
                using the same name would appear here too.
              </p>
              <RescueList cases={result!.cases} />
              {result!.total > count && (
                <p className="text-[11px] text-slate-500 mt-2">
                  Showing {count} of {result!.total}.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
