import { useState } from 'react';
import { ArrowLeft, Search, Loader2 } from 'lucide-react';
import { Button } from '@/app/components/ui/button';
import { fuelRatsApi } from '@/app/services/fuelRatsApi';
import type { RescueSearchCriteria, RescueSearchResult } from '@/app/services/fuelRatsApi';
import { RescueList } from '@/app/components/CaseHistory';

/**
 * Look a case up by hand.
 *
 * The client-history panel answers one fixed question about the case on
 * screen. This answers whatever was typed, over the whole archive -- 184,000
 * rescues at the time of writing -- which is why it paginates rather than
 * fetching everything.
 */

const PAGE_SIZE = 25;

const PLATFORMS = ['', 'pc', 'xb', 'ps'];
const STATUSES = ['', 'open', 'inactive', 'closed'];
// The five the API actually stores. `purge` is what !md sets and is the second
// most common outcome after success -- 23 of the last 100 cases -- so leaving
// it out made the filter quietly unable to find a large slice of the archive.
const OUTCOMES = ['', 'success', 'failure', 'purge', 'invalid', 'other'];

interface CaseSearchPageProps {
  onBack: () => void;
}

export function CaseSearchPage({ onBack }: CaseSearchPageProps) {
  const [form, setForm] = useState<RescueSearchCriteria>({});
  const [result, setResult] = useState<RescueSearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [searched, setSearched] = useState(false);

  const set =(patch: Partial<RescueSearchCriteria>) => setForm({ ...form, ...patch });

  const run = async (nextOffset: number) => {
    setBusy(true);
    setOffset(nextOffset);
    const criteria: RescueSearchCriteria = {
      ...form,
      // Dates arrive from <input type="date"> as YYYY-MM-DD; the API wants a
      // timestamp, and `to` should cover the whole of the chosen day.
      from: form.from ? `${form.from}T00:00:00.000Z` : undefined,
      to: form.to ? `${form.to}T23:59:59.999Z` : undefined,
      limit: PAGE_SIZE,
      offset: nextOffset,
    };
    const r = await fuelRatsApi.searchRescues(criteria);
    setResult(r);
    setSearched(true);
    setBusy(false);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void run(0);
  };

  const shown = result?.cases.length ?? 0;
  const total = result?.total ?? 0;

  return (
    <div className="h-full flex flex-col bg-slate-950 text-slate-200">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-slate-700 bg-slate-900">
        <Button type="button" onClick={onBack} className="bg-slate-700 hover:bg-slate-600 text-white">
          <span className="flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" />
            Back
          </span>
        </Button>
        <h1 className="text-lg font-semibold text-orange-500">Case search</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        <form onSubmit={onSubmit} className="p-4 border-b border-slate-800 bg-slate-900/40">
          <div className="grid gap-3 md:grid-cols-3">
            <Text label="Client or nick" value={form.client} onChange={(v) => set({ client: v })}
                  placeholder="partial name" />
            <Text label="System" value={form.system} onChange={(v) => set({ system: v })}
                  placeholder="partial system" />
            <Text label="Rat (CMDR)" value={form.ratName} onChange={(v) => set({ ratName: v })}
                  placeholder="commander name" />

            <Choice label="Platform" value={form.platform} options={PLATFORMS}
                    onChange={(v) => set({ platform: v || undefined })} />
            <Choice label="Status" value={form.status} options={STATUSES}
                    onChange={(v) => set({ status: v || undefined })} />
            <Choice label="Outcome" value={form.outcome} options={OUTCOMES}
                    onChange={(v) => set({ outcome: v || undefined })} />

            <Text label="From" type="date" value={form.from} onChange={(v) => set({ from: v })} />
            <Text label="To" type="date" value={form.to} onChange={(v) => set({ to: v })} />

            <label className="flex items-end gap-2 pb-1 text-sm text-slate-300">
              <input
                type="checkbox"
                checked={!!form.codeRed}
                onChange={(e) => set({ codeRed: e.target.checked || undefined })}
                className="w-4 h-4"
              />
              Code red only
            </label>
          </div>

          <div className="flex items-center gap-3 mt-4">
            <Button type="submit" disabled={busy} className="bg-orange-600 hover:bg-orange-700 text-white">
              <span className="flex items-center gap-2">
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Search
              </span>
            </Button>
            <Button
              type="button"
              onClick={() => { setForm({}); setResult(null); setSearched(false); }}
              className="bg-slate-700 hover:bg-slate-600 text-white"
            >
              Clear
            </Button>
            <span className="text-xs text-slate-500">
              Leave everything blank for the most recent cases.
            </span>
          </div>
        </form>

        <div className="p-4">
          {result?.error && <p className="text-sm text-red-300">{result.error}</p>}
          {result?.note && <p className="text-sm text-amber-300">{result.note}</p>}

          {searched && !result?.error && !result?.note && shown === 0 && (
            <p className="text-sm text-slate-500">Nothing matched.</p>
          )}

          {shown > 0 && (
            <>
              <p className="text-xs text-slate-500 mb-2">
                Showing {offset + 1}–{offset + shown} of {total}
              </p>
              <RescueList cases={result!.cases} />

              <div className="flex items-center gap-2 mt-4">
                <Button
                  type="button"
                  disabled={busy || offset === 0}
                  onClick={() => void run(Math.max(0, offset - PAGE_SIZE))}
                  className="bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-40"
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  disabled={busy || offset + shown >= total}
                  onClick={() => void run(offset + PAGE_SIZE)}
                  className="bg-slate-700 hover:bg-slate-600 text-white disabled:opacity-40"
                >
                  Next
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Text({
  label, value, onChange, placeholder, type = 'text',
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-400 text-xs">{label}</span>
      <input
        type={type}
        value={value ?? ''}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-200 placeholder:text-slate-600"
      />
    </label>
  );
}

function Choice({
  label, value, options, onChange,
}: {
  label: string;
  value?: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-400 text-xs">{label}</span>
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        className="bg-slate-800 border border-slate-700 rounded px-2 py-1.5 text-slate-200"
      >
        {options.map((o) => (
          <option key={o} value={o}>{o === '' ? 'any' : o}</option>
        ))}
      </select>
    </label>
  );
}
