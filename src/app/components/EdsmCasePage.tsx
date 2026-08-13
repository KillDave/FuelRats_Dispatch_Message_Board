import { useState, useEffect } from 'react';
import { AlertTriangle, Star, Globe, Building2, Loader2, ChevronDown, ChevronUp, ExternalLink } from 'lucide-react';
import { CopyableSystem } from './CopyableSystem';
import { fetchEdsmSystemData, edsmSystemUrl, type EdsmSystemData } from '../services/edsmService';
import { parseEdsmPopoutInfo, type EdsmPopoutCaseInfo } from '../services/edsmPopout';

const borderByStatus: Record<string, string> = {
  'code-red': 'border-red-500',
  'open': 'border-blue-500',
  'assigned': 'border-yellow-500',
  'inactive': 'border-slate-500',
};

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
    <button onClick={onToggle} className="flex items-center gap-1.5 w-full text-left group mb-2">
      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 flex-1">
        {icon}{label}{count !== undefined && <span className="text-slate-600 normal-case">({count})</span>}
      </span>
      {collapsed
        ? <ChevronDown className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />
        : <ChevronUp className="w-3 h-3 text-slate-600 group-hover:text-slate-400" />}
    </button>
  );
}

/**
 * Rendered in its own standalone browser window (opened via openEdsmPopout),
 * not embedded in the main app tree -- so it reads its case info straight off
 * the URL hash rather than through props, and closes itself rather than
 * calling back into a parent that isn't there.
 */
export function EdsmCasePage() {
  const [caseInfo] = useState<EdsmPopoutCaseInfo | null>(() => parseEdsmPopoutInfo(window.location.hash));
  const [elapsed, setElapsed] = useState(0);
  const [data, setData] = useState<EdsmSystemData | null>(null);
  const [status, setStatus] = useState<'loading' | 'done' | 'error'>('loading');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [stationSort, setStationSort] = useState<'alpha' | 'distance'>('alpha');
  const toggleSection = (key: string) =>
    setCollapsed((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  const isCollapsed = (key: string) => collapsed.has(key);

  useEffect(() => {
    if (!caseInfo) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(caseInfo.createdAt).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [caseInfo]);

  useEffect(() => {
    if (!caseInfo || !caseInfo.system || caseInfo.system === 'Unknown') {
      setStatus('error');
      return;
    }
    const controller = new AbortController();
    setStatus('loading');
    fetchEdsmSystemData(caseInfo.system, controller.signal)
      .then((d) => { setData(d); setStatus('done'); })
      .catch((err) => {
        if (err?.name === 'AbortError') return;
        setStatus('error');
      });
    return () => controller.abort();
  }, [caseInfo]);

  if (!caseInfo) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <p className="text-sm text-red-400">This window wasn't opened with a case to show.</p>
      </div>
    );
  }

  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  const elapsedStr = `${mins}:${secs.toString().padStart(2, '0')}`;

  const stars = (data?.bodies ?? []).filter((b) => b.type === 'Star').sort((a, b) => a.distanceToArrival - b.distanceToArrival);
  const planets = (data?.bodies ?? []).filter((b) => b.type === 'Planet').sort((a, b) => a.distanceToArrival - b.distanceToArrival);
  const statusBorder = borderByStatus[caseInfo.status] ?? 'border-slate-500';

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Header bar */}
      <div className={`flex items-center gap-4 px-6 py-3 border-b-2 flex-shrink-0 bg-slate-900/80 ${statusBorder}`}>
        <span className="text-orange-400 font-bold text-2xl flex-shrink-0">{caseInfo.id.split('-')[1]}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-bold text-lg">{caseInfo.clientName}</span>
            {caseInfo.ircNick && caseInfo.ircNick !== caseInfo.clientName && (
              <span className="text-sm text-slate-500 font-mono" title="Client IRC nick">({caseInfo.ircNick})</span>
            )}
            {caseInfo.oxygenStatus && (
              <span className="flex items-center gap-1 text-sm text-red-400 font-bold animate-pulse">
                <AlertTriangle className="w-4 h-4" /> CODE RED
              </span>
            )}
            {caseInfo.status === 'inactive' && (
              <span className="text-xs font-semibold text-slate-300 border border-slate-500/60 bg-slate-500/20 rounded px-1.5 py-0.5">
                INACTIVE
              </span>
            )}
            {!caseInfo.clientInChannel && (
              <span className="text-xs font-semibold text-red-300 border border-red-500/60 bg-red-500/10 rounded px-1.5 py-0.5">
                DISCONNECTED
              </span>
            )}
            <span className="text-xs border rounded px-1.5 py-0.5 text-slate-400 border-slate-600">
              {getPlatformShort(caseInfo.platform)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm mt-0.5 text-slate-400">
            <CopyableSystem system={caseInfo.system} />
            {caseInfo.landmark && (
              <span className="text-slate-500">· {caseInfo.landmark.distance.toFixed(1)}ly from {caseInfo.landmark.name}</span>
            )}
            {caseInfo.language && !caseInfo.language.toLowerCase().startsWith('en') && (
              <span className="text-xs text-amber-300/90 border border-amber-500/40 bg-amber-500/10 rounded px-1.5 py-0.5">
                {caseInfo.language}
              </span>
            )}
            <span className="font-mono text-slate-600">· {elapsedStr}</span>
          </div>
        </div>
        <button
          onClick={() => window.close()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded transition-colors flex-shrink-0 text-slate-400 hover:text-white hover:bg-slate-700/60"
        >
          Close Window
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-6 space-y-6">
          <div className="flex justify-end">
            <a
              href={edsmSystemUrl(caseInfo.system)}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
            >
              View {caseInfo.system} on EDSM <ExternalLink className="w-3 h-3" />
            </a>
          </div>

          {status === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading system data from EDSM…
            </div>
          )}
          {status === 'error' && (
            <div className="text-sm text-red-400">Failed to load system data from EDSM.</div>
          )}

          {status === 'done' && data && (
            <>
              {/* Star + Nearest Station summary row */}
              <div className="grid grid-cols-2 gap-4">
                <section>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Primary Star</h3>
                  <div className="bg-slate-900/60 border border-slate-700/60 rounded-lg p-3">
                    {data.scoopable === true && (
                      <span className="text-sm text-white border border-red-500/60 bg-red-500/10 rounded px-2 py-1">Scoopable</span>
                    )}
                    {data.scoopable === false && (
                      <div className="space-y-2">
                        <span className="text-sm text-white border border-slate-500/60 bg-slate-500/10 rounded px-2 py-1">Not Scoopable</span>
                        <div className="text-sm text-slate-400">
                          {data.nearestScoopableStar ? (
                            <div className="flex items-center gap-2 flex-wrap">
                              <span>
                                Closest fuel system: <CopyableSystem system={data.nearestScoopableStar.name} className="text-slate-200" />
                                <span className="text-slate-500"> ({data.nearestScoopableStar.distance.toFixed(1)}ly)</span>
                              </span>
                              <a
                                href={edsmSystemUrl(data.nearestScoopableStar.name)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
                              >
                                EDSM <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          ) : (
                            <span className="text-slate-600">No scoopable system found nearby</span>
                          )}
                        </div>
                      </div>
                    )}
                    {data.scoopable === undefined && <span className="text-sm text-slate-600">Unknown</span>}
                  </div>
                </section>

                <section>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Stations{data.orbitalStations.length > 0 && (
                      <span className="text-slate-600 normal-case"> ({data.orbitalStations.length})</span>
                    )}
                  </h3>
                  {/* Capped height because a busy system can have a dozen of these,
                      and this sits beside the star panel in a two-column row. */}
                  <div className="bg-slate-900/60 border border-slate-700/60 rounded-lg p-3 space-y-2 max-h-40 overflow-y-auto">
                    {data.orbitalStations.map((s) => (
                      <div key={s.name} className="text-sm flex items-center gap-2">
                        <span className="text-slate-500 font-mono text-xs w-6">{s.isLPad ? 'L' : 'S/M'}</span>
                        <span className="text-slate-200 flex-1">{s.name}</span>
                        <span className="text-slate-500 font-mono text-xs">{formatLs(s.distanceToArrival)}</span>
                      </div>
                    ))}
                    {data.orbitalStations.length === 0 && (
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
                      {stars.map((s) => (
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
              {data.allStations.length > 0 && (
                <section>
                  <div className="flex items-center mb-2">
                    <SectionHeader icon={<Building2 className="w-3 h-3" />} label="Stations in System" count={data.allStations.length} collapsed={isCollapsed('stations')} onToggle={() => toggleSection('stations')} />
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
                      {[...data.allStations]
                        .sort((a, b) => stationSort === 'alpha' ? a.name.localeCompare(b.name) : a.distanceToArrival - b.distanceToArrival)
                        .map((s) => (
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
                      {planets.map((p) => (
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
