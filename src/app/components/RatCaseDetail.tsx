import { useState, useEffect } from 'react';
import { X, AlertTriangle, Star, Globe, Building2, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import type { Case } from './DispatchBoard';
import { CopyableSystem } from './CopyableSystem';

interface EdsmBody {
  name: string;
  type: 'Star' | 'Planet' | string;
  subType: string;
  distanceToArrival: number;
  isScoopable?: boolean;
  isLandable?: boolean;
}

interface EdsmStation {
  name: string;
  distanceToArrival: number;
  type: string;
  isLPad: boolean;
}

interface RatData {
  scoopable?: boolean;
  nearestScoopableStar?: { name: string; distance: number };
  nearestLStation?: { name: string; distanceToArrival: number; type: string };
  nearestSmStation?: { name: string; distanceToArrival: number; type: string };
  allStations: EdsmStation[];
  bodies: EdsmBody[];
  status: 'idle' | 'loading' | 'done' | 'error';
}

interface RatCaseDetailProps {
  caseData: Case;
  isClosed?: boolean;
  onClose: () => void;
}

const borderByStatus: Record<string, string> = {
  'code-red': 'border-red-500',
  'open': 'border-blue-500',
  'assigned': 'border-yellow-500',
  'inactive': 'border-slate-500',
};

const isFC = (t: string) => t === 'Fleet Carrier';
const isLPad = (t: string) => !['Outpost', 'Planetary Outpost'].includes(t);

function formatLs(ls: number): string {
  if (ls >= 1_000_000) return `${(ls / 1_000_000).toFixed(2)}Mls`;
  if (ls >= 1_000) return `${(ls / 1_000).toFixed(1)}kls`;
  return `${ls.toFixed(1)}ls`;
}

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

function SectionHeader({
  icon,
  label,
  count,
  collapsed,
  onToggle,
}: {
  icon: React.ReactNode;
  label: string;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-1.5 w-full text-left group mb-2"
    >
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 flex-1">
        {icon}{label}{count !== undefined && <span className="text-slate-600 normal-case">({count})</span>}
      </span>
      {collapsed
        ? <ChevronDown className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />
        : <ChevronUp className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />}
    </button>
  );
}

export function RatCaseDetail({ caseData, isClosed = false, onClose }: RatCaseDetailProps) {
  const [elapsed, setElapsed] = useState(0);
  const [ratData, setRatData] = useState<RatData>({ bodies: [], allStations: [], status: 'idle' });
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [stationSort, setStationSort] = useState<'alpha' | 'distance'>('alpha');
  const toggleSection = (key: string) =>
    setCollapsed(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const isCollapsed = (key: string) => collapsed.has(key);

  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(caseData.createdAt).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [caseData.createdAt]);

  useEffect(() => {
    if (!caseData.system || caseData.system === 'Unknown') return;

    const controller = new AbortController();
    const { signal } = controller;

    setRatData({ bodies: [], allStations: [], status: 'loading' });
    const sys = encodeURIComponent(caseData.system);

    Promise.all([
      fetch(`https://www.edsm.net/api-v1/system?systemName=${sys}&showPrimaryStar=1`, { signal }).then(r => r.json()),
      fetch(`https://www.edsm.net/api-system-v1/stations?systemName=${sys}`, { signal }).then(r => r.json()),
      fetch(`https://www.edsm.net/api-system-v1/bodies?systemName=${sys}`, { signal }).then(r => r.json()),
    ]).then(([starData, stationData, bodyData]) => {
      const scoopable: boolean | undefined = typeof starData?.primaryStar?.isScoopable === 'boolean'
        ? starData.primaryStar.isScoopable : undefined;

      const rawStations: { name: string; distanceToArrival: number; type: string }[] = stationData?.stations ?? [];
      const stations = rawStations.filter(s => !isFC(s.type));
      const allStations: EdsmStation[] = stations
        .map(s => ({ ...s, isLPad: isLPad(s.type) }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const lStations = stations.filter(s => isLPad(s.type));
      const smStations = stations.filter(s => !isLPad(s.type));
      const nearestL = lStations.reduce<typeof stations[0] | undefined>((a, b) => !a || b.distanceToArrival < a.distanceToArrival ? b : a, undefined);
      const nearestSm = smStations.reduce<typeof stations[0] | undefined>((a, b) => !a || b.distanceToArrival < a.distanceToArrival ? b : a, undefined);

      setRatData({
        scoopable,
        nearestLStation: nearestL,
        nearestSmStation: nearestSm && (!nearestL || nearestSm.distanceToArrival < nearestL.distanceToArrival) ? nearestSm : undefined,
        allStations,
        bodies: bodyData?.bodies ?? [],
        status: 'done',
      });
    }).catch(err => {
      if (err.name === 'AbortError') return; // cancelled — a newer fetch is already in flight
      setRatData(prev => ({ ...prev, status: 'error' }));
    });

    return () => controller.abort();
  }, [caseData.system]);

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  const recentMessages = caseData.messages.filter(m => !m.isSystem).slice(-5);
  const stars = ratData.bodies.filter(b => b.type === 'Star').sort((a, b) => a.distanceToArrival - b.distanceToArrival);
  const planets = ratData.bodies.filter(b => b.type === 'Planet').sort((a, b) => a.distanceToArrival - b.distanceToArrival);
  const statusBorder = borderByStatus[caseData.status] ?? 'border-slate-500';

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-black/40">
      {/* Header bar */}
      <div className={`flex items-center gap-4 px-6 py-3 border-b-2 flex-shrink-0 ${isClosed ? 'bg-green-700/80 border-green-500' : `bg-slate-900/80 ${statusBorder}`}`}>
        {isClosed && (
          <span className="font-bold text-sm text-white bg-green-600 rounded px-2 py-0.5 flex-shrink-0">CASE CLOSED</span>
        )}
        <span className="text-orange-400 font-bold text-2xl">{caseData.id.split('-')[1]}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-bold text-lg">{caseData.clientName}</span>
            {caseData.oxygenStatus && (
              <span className="flex items-center gap-1 text-sm text-red-400 font-bold animate-pulse">
                <AlertTriangle className="w-4 h-4" /> CODE RED
              </span>
            )}
            <span className={`text-xs border rounded px-1.5 py-0.5 ${isClosed ? 'text-green-100 border-green-400/60' : 'text-slate-400 border-slate-600'}`}>
              {getPlatformShort(caseData.platform)}
            </span>
          </div>
          <div className={`flex items-center gap-2 text-sm mt-0.5 ${isClosed ? 'text-green-100' : 'text-slate-400'}`}>
            <CopyableSystem system={caseData.system} />
            {caseData.landmark && (
              <span className={isClosed ? 'text-green-200/80' : 'text-slate-500'}>· {caseData.landmark.distance.toFixed(1)}ly from {caseData.landmark.name}</span>
            )}
            <span className={`font-mono ${isClosed ? 'text-green-200/70' : 'text-slate-600'}`}>· {elapsedStr}</span>
          </div>
        </div>
        <button
          onClick={onClose}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors flex-shrink-0 ${isClosed ? 'text-green-100 hover:text-white hover:bg-green-600/60' : 'text-slate-400 hover:text-white hover:bg-slate-700/60'}`}
        >
          <X className="w-4 h-4" />
          Back
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto p-6 space-y-6">

          {/* Recent chat */}
          {recentMessages.length > 0 && (
            <section>
              <SectionHeader icon={null} label="Recent Chat" count={recentMessages.length} collapsed={isCollapsed('chat')} onToggle={() => toggleSection('chat')} />
              {!isCollapsed('chat') && (
                <div className="bg-slate-900/60 border border-slate-700/60 rounded-lg p-3 space-y-1.5">
                  {recentMessages.map(msg => (
                    <div key={msg.id} className="text-sm">
                      <div className="flex gap-2">
                        <span className="text-slate-500 flex-shrink-0">&lt;{msg.sender}&gt;</span>
                        <span className="text-slate-300">{msg.text}</span>
                      </div>
                      {/* Translations are attached to the message by whichever mode
                          fetched them, so showing them here costs nothing -- without
                          this a rat sees only the original text for a case the
                          dispatcher has already had translated. Styled to match
                          CaseWindow so the same message reads the same in both modes. */}
                      {msg.translation && (
                        <p className="text-cyan-300 italic break-words mt-0.5 ml-1">⟫ {msg.translation}</p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* Loading / error */}
          {ratData.status === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading system data from EDSM…
            </div>
          )}
          {ratData.status === 'error' && (
            <div className="text-sm text-red-400">Failed to load system data from EDSM.</div>
          )}

          {ratData.status === 'done' && (
            <>
              {/* Star + Nearest Station summary row */}
              <div className="grid grid-cols-2 gap-4">
                <section>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Primary Star</h3>
                  <div className="bg-slate-900/60 border border-slate-700/60 rounded-lg p-3">
                    {ratData.scoopable === true && (
                      <span className="text-sm text-white border border-red-500/60 bg-red-500/10 rounded px-2 py-1">Scoopable</span>
                    )}
                    {ratData.scoopable === false && (
                      <div className="space-y-2">
                        <span className="text-sm text-white border border-slate-500/60 bg-slate-500/10 rounded px-2 py-1">Not Scoopable</span>
                        {ratData.nearestScoopableStar && (
                          <div className="text-sm text-slate-400 mt-2">
                            Nearest: <span className="text-slate-200">{ratData.nearestScoopableStar.name} ({ratData.nearestScoopableStar.distance.toFixed(1)}ly)</span>
                          </div>
                        )}
                      </div>
                    )}
                    {ratData.scoopable === undefined && <span className="text-sm text-slate-600">Unknown</span>}
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Nearest Station</h3>
                  <div className="bg-slate-900/60 border border-slate-700/60 rounded-lg p-3 space-y-2">
                    {ratData.nearestLStation && (
                      <div className="text-sm flex items-center gap-2">
                        <span className="text-slate-500 font-mono text-xs w-6">L</span>
                        <span className="text-slate-200 flex-1">{ratData.nearestLStation.name}</span>
                        <span className="text-slate-500 font-mono text-xs">{formatLs(ratData.nearestLStation.distanceToArrival)}</span>
                      </div>
                    )}
                    {ratData.nearestSmStation && (
                      <div className="text-sm flex items-center gap-2">
                        <span className="text-slate-500 font-mono text-xs w-6">S/M</span>
                        <span className="text-slate-200 flex-1">{ratData.nearestSmStation.name}</span>
                        <span className="text-slate-500 font-mono text-xs">{formatLs(ratData.nearestSmStation.distanceToArrival)}</span>
                      </div>
                    )}
                    {!ratData.nearestLStation && !ratData.nearestSmStation && (
                      <span className="text-sm text-slate-600">None found in system</span>
                    )}
                  </div>
                </section>
              </div>

              {/* Stars in system */}
              {stars.length > 0 && (
                <section>
                  <SectionHeader icon={<Star className="w-3 h-3" />} label="Stars in System" count={stars.length} collapsed={isCollapsed('stars')} onToggle={() => toggleSection('stars')} />
                  {!isCollapsed('stars') && (
                    <div className="bg-slate-900/60 border border-slate-700/60 rounded-lg divide-y divide-slate-700/40">
                      {stars.map(s => (
                        <div key={s.name} className="flex items-center gap-3 px-3 py-2 text-sm">
                          <span className="text-slate-200 flex-1">{s.name}</span>
                          <span className="text-slate-500 text-xs">{s.subType}</span>
                          {s.distanceToArrival > 0 && (
                            <span className="text-slate-500 font-mono text-xs w-20 text-right">{formatLs(s.distanceToArrival)}</span>
                          )}
                          {s.isScoopable
                            ? <span className="text-green-400 text-xs font-semibold w-16 text-right">✓ Scoop</span>
                            : <span className="text-slate-600 text-xs w-16 text-right">No scoop</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {/* All stations in system */}
              {ratData.allStations.length > 0 && (
                <section>
                  <div className="flex items-center mb-2">
                    <SectionHeader icon={<Building2 className="w-3 h-3" />} label="Stations in System" count={ratData.allStations.length} collapsed={isCollapsed('stations')} onToggle={() => toggleSection('stations')} />
                    {!isCollapsed('stations') && (
                      <div className="flex items-center border border-slate-700 rounded overflow-hidden ml-2 flex-shrink-0">
                        <button
                          onClick={() => setStationSort('alpha')}
                          className={`px-2 py-0.5 text-xs transition-colors ${stationSort === 'alpha' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                          A–Z
                        </button>
                        <button
                          onClick={() => setStationSort('distance')}
                          className={`px-2 py-0.5 text-xs transition-colors ${stationSort === 'distance' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-slate-300'}`}
                        >
                          Dist
                        </button>
                      </div>
                    )}
                  </div>
                  {!isCollapsed('stations') && (
                    <div className="bg-slate-900/60 border border-slate-700/60 rounded-lg divide-y divide-slate-700/40">
                      {[...ratData.allStations]
                        .sort((a, b) => stationSort === 'alpha' ? a.name.localeCompare(b.name) : a.distanceToArrival - b.distanceToArrival)
                        .map(s => (
                          <div key={s.name} className="flex items-center gap-3 px-3 py-2 text-sm">
                            <span className={`font-mono text-xs w-6 flex-shrink-0 ${s.isLPad ? 'text-blue-400' : 'text-slate-500'}`}>
                              {s.isLPad ? 'L' : 'S/M'}
                            </span>
                            <span className="text-slate-200 flex-1">{s.name}</span>
                            <span className="text-slate-500 text-xs">{s.type}</span>
                            <span className="text-slate-500 font-mono text-xs w-20 text-right">{formatLs(s.distanceToArrival)}</span>
                          </div>
                        ))}
                    </div>
                  )}
                </section>
              )}

              {/* Planets */}
              {planets.length > 0 && (
                <section>
                  <SectionHeader icon={<Globe className="w-3 h-3" />} label="Planets" count={planets.length} collapsed={isCollapsed('planets')} onToggle={() => toggleSection('planets')} />
                  {!isCollapsed('planets') && (
                    <div className="bg-slate-900/60 border border-slate-700/60 rounded-lg divide-y divide-slate-700/40">
                      {planets.map(p => (
                        <div key={p.name} className="flex items-center gap-3 px-3 py-2 text-sm">
                          <span className={`text-slate-200 flex-1 ${!p.isLandable ? 'text-slate-500' : ''}`}>{p.name}</span>
                          <span className="text-slate-500 text-xs">{p.subType}</span>
                          <span className="text-slate-500 font-mono text-xs w-20 text-right">{formatLs(p.distanceToArrival)}</span>
                          {p.isLandable
                            ? <span className="text-green-400 text-xs font-semibold w-16 text-right">✓ Landable</span>
                            : <span className="text-slate-700 text-xs w-16 text-right">—</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
