import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Case } from './DispatchBoard';
import type { AccountCardDist } from '../hooks/useRatAccounts';
import { CopyableSystem } from './CopyableSystem';

const borderByStatus: Record<string, string> = {
  'code-red': 'border-l-red-500',
  'open': 'border-l-blue-500',
  'assigned': 'border-l-yellow-500',
  'inactive': 'border-l-slate-500',
  'closed': 'border-l-slate-700',
};

function getPlatformShort(platform: string): string {
  const p = platform.toLowerCase();
  if (p.includes('legacy')) return 'LEG';
  if (p.includes('xbox')) return 'XB';
  if (p.includes('playstation')) return 'PS';
  if (p.includes('odyssey')) return 'ODY';
  if (p.includes('horizons')) return 'HOR';
  if (p.includes('pc')) return 'PC';
  return platform;
}

export interface RatCaseCardProps {
  caseData: Case;
  onSelect: () => void;
  accountDistances?: AccountCardDist[];
  /** Omit to hide the jump column entirely. */
  onPlotJumps?: (accountId: string) => void;
}

export function RatCaseCard({ caseData, onSelect, accountDistances = [], onPlotJumps }: RatCaseCardProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(caseData.createdAt).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [caseData.createdAt]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  return (
    <button
      className={`w-full bg-slate-900/80 border border-slate-700/60 border-l-4 rounded-lg overflow-hidden text-left hover:bg-slate-800/60 transition-colors ${borderByStatus[caseData.status] ?? 'border-l-slate-600'}`}
      onClick={onSelect}
    >
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="text-orange-400 font-bold text-lg w-8 flex-shrink-0">
          {caseData.id.split('-')[1]}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-semibold truncate">{caseData.clientName}</span>
            {caseData.oxygenStatus && (
              <span className="flex items-center gap-1 text-xs text-red-400 font-bold animate-pulse">
                <AlertTriangle className="w-3 h-3" /> CODE RED
              </span>
            )}
            <span className="text-xs text-slate-500 border border-slate-600 rounded px-1.5 py-0.5">
              {getPlatformShort(caseData.platform)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-400 mt-0.5 flex-wrap">
            <CopyableSystem system={caseData.system} />
            {caseData.landmark && (
              <span className="text-slate-500">· {caseData.landmark.distance.toFixed(1)}ly from {caseData.landmark.name}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0 text-xs text-slate-500">
          {caseData.assignedRats.length > 0 && (
            <span>{caseData.assignedRats.length} rat{caseData.assignedRats.length !== 1 ? 's' : ''}</span>
          )}
          <span className="font-mono">{elapsedStr}</span>
        </div>
      </div>

      {/* Account distances */}
      {accountDistances.length > 0 && (
        <div className="border-t border-slate-700/40 px-4 py-2 space-y-1">
          {accountDistances.map(a => (
            <div key={a.id} className="flex items-center gap-2 text-xs">
              <span className="text-slate-400 w-36 flex-shrink-0 truncate">{a.cmdr}</span>
              <span className="text-slate-600 flex-1 truncate">{a.system || '—'}</span>
              <span className="font-mono flex-shrink-0 w-24 text-right">
                {a.status === 'loading'   ? <span className="text-slate-600 animate-pulse">···</span>
                : a.status === 'no-system' ? <span className="text-slate-600">—</span>
                : a.status === 'error'     ? <span className="text-red-400/60">unknown</span>
                : <span className="text-orange-300">{a.distance!.toFixed(1)} ly</span>}
              </span>
              {/* Jumps are plotted on request: each one is a ~10s job on Spansh,
                  so doing every case x account pair automatically would hammer
                  a free third-party service. Results are cached once fetched. */}
              {a.status === 'done' && onPlotJumps && (
                <span className="font-mono flex-shrink-0 w-16 text-right">
                  {a.jumpStatus === 'plotting' ? <span className="text-slate-600 animate-pulse">···</span>
                  : a.jumpStatus === 'done'     ? <span className="text-sky-300">{a.jumps}j</span>
                  : a.jumpStatus === 'no-ship'  ? <span className="text-slate-700" title="Add an EDSY build to this account">no ship</span>
                  : a.jumpStatus === 'error'    ? <span className="text-red-400/60">failed</span>
                  : <span
                      role="button"
                      tabIndex={0}
                      title="Plot this route with Spansh"
                      onClick={e => { e.stopPropagation(); onPlotJumps(a.id); }}
                      onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); onPlotJumps(a.id); } }}
                      className="text-slate-600 hover:text-sky-300 cursor-pointer transition-colors"
                    >plot</span>}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </button>
  );
}
