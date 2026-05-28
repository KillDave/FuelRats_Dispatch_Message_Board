import { useState, useEffect, useRef } from 'react';
import type { Case } from './DispatchBoard';
import { RatCaseCard } from './RatCaseCard';
import { RatCaseDetail } from './RatCaseDetail';

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

interface RatBoardProps {
  cases: Case[];
}

export function RatBoard({ cases }: RatBoardProps) {
  const [enabledPlatforms, setEnabledPlatforms] = useState<Set<string>>(loadEnabledPlatforms);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [isClosed, setIsClosed] = useState(false);
  const frozenCaseRef = useRef<Case | null>(null);

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

  const liveCase = selectedCaseId ? cases.find(c => c.id === selectedCaseId) ?? null : null;

  // Keep a frozen copy of the last known case data
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

  // Show detail view using live data, or frozen data with closed banner
  if (selectedCaseId && (liveCase || frozenCaseRef.current)) {
    return (
      <div className="flex-1 flex flex-col min-h-0 relative z-10">
        <RatCaseDetail
          caseData={(liveCase ?? frozenCaseRef.current)!}
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
      </div>

      {/* Case list */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-3xl mx-auto space-y-3">
          {visibleCases.map(c => (
            <RatCaseCard
              key={c.id}
              caseData={c}
              onSelect={() => { frozenCaseRef.current = null; setIsClosed(false); setSelectedCaseId(c.id); }}
            />
          ))}
          {visibleCases.length === 0 && (
            <div className="text-center text-slate-500 pt-20 text-sm">No active cases</div>
          )}
        </div>
      </div>
    </div>
  );
}
