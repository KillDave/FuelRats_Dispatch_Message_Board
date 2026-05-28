import { useState, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Case } from './DispatchBoard';

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
}

export function RatCaseCard({ caseData, onSelect }: RatCaseCardProps) {
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
            <span>{caseData.system}</span>
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
    </button>
  );
}
