export interface EdsmBody {
  name: string;
  type: string;
  subType: string;
  distanceToArrival: number;
  isScoopable?: boolean;
  isLandable?: boolean;
}

export interface EdsmStation {
  name: string;
  distanceToArrival: number;
  type: string;
  isLPad: boolean;
}

interface EdsmStationRef {
  name: string;
  distanceToArrival: number;
  type: string;
}

export interface NearestScoopableStar {
  name: string;
  distance: number;
}

export interface EdsmSystemData {
  scoopable?: boolean;
  nearestLStation?: EdsmStationRef;
  nearestSmStation?: EdsmStationRef;
  allStations: EdsmStation[];
  bodies: EdsmBody[];
  nearestScoopableStar?: NearestScoopableStar;
}

const isFC = (t: string) => t === 'Fleet Carrier';
const isLPad = (t: string) => !['Outpost', 'Planetary Outpost'].includes(t);

export function edsmSystemUrl(system: string): string {
  return `https://www.edsm.net/en/system?systemName=${encodeURIComponent(system)}`;
}

/**
 * sphere-systems doesn't support showPrimaryStar, so this is a two-step
 * lookup: get nearby system names+distances, then bulk-query their primary
 * stars for scoopability. Mirrors the fallback DispatchBoard already runs
 * per-case to backfill Case.nearestScoopableStar.
 */
async function fetchNearestScoopableStar(system: string, signal?: AbortSignal): Promise<NearestScoopableStar | undefined> {
  const sphereRes = await fetch(
    `https://www.edsm.net/api-v1/sphere-systems?systemName=${encodeURIComponent(system)}&radius=50`,
    { signal }
  );
  const nearbySystems: { name: string; distance: number }[] = await sphereRes.json();
  const candidates = nearbySystems
    .filter((s) => s.name !== system)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 15);
  if (candidates.length === 0) return undefined;

  const params = new URLSearchParams({ showPrimaryStar: '1' });
  candidates.forEach((s) => params.append('systemName[]', s.name));
  const bulkRes = await fetch(`https://www.edsm.net/api-v1/systems?${params}`, { signal });
  const bulkData: { name: string; primaryStar?: { isScoopable?: boolean } }[] = await bulkRes.json();

  return bulkData
    .filter((s) => s.primaryStar?.isScoopable === true)
    .map((s) => {
      const c = candidates.find((c) => c.name === s.name);
      return c ? { name: s.name, distance: c.distance } : null;
    })
    .filter((x): x is NearestScoopableStar => x !== null)
    .sort((a, b) => a.distance - b.distance)[0];
}

export async function fetchEdsmSystemData(system: string, signal?: AbortSignal): Promise<EdsmSystemData> {
  const sys = encodeURIComponent(system);
  const [starData, stationData, bodyData] = await Promise.all([
    fetch(`https://www.edsm.net/api-v1/system?systemName=${sys}&showPrimaryStar=1`, { signal }).then((r) => r.json()),
    fetch(`https://www.edsm.net/api-system-v1/stations?systemName=${sys}`, { signal }).then((r) => r.json()),
    fetch(`https://www.edsm.net/api-system-v1/bodies?systemName=${sys}`, { signal }).then((r) => r.json()),
  ]);

  const scoopable: boolean | undefined =
    typeof starData?.primaryStar?.isScoopable === 'boolean' ? starData.primaryStar.isScoopable : undefined;

  const rawStations: EdsmStationRef[] = stationData?.stations ?? [];
  const stations = rawStations.filter((s) => !isFC(s.type));
  const allStations: EdsmStation[] = stations
    .map((s) => ({ ...s, isLPad: isLPad(s.type) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const lStations = stations.filter((s) => isLPad(s.type));
  const smStations = stations.filter((s) => !isLPad(s.type));
  const nearestL = lStations.reduce<EdsmStationRef | undefined>(
    (a, b) => (!a || b.distanceToArrival < a.distanceToArrival ? b : a),
    undefined
  );
  const nearestSm = smStations.reduce<EdsmStationRef | undefined>(
    (a, b) => (!a || b.distanceToArrival < a.distanceToArrival ? b : a),
    undefined
  );

  const nearestScoopableStar = scoopable === false ? await fetchNearestScoopableStar(system, signal) : undefined;

  return {
    scoopable,
    nearestLStation: nearestL,
    nearestSmStation:
      nearestSm && (!nearestL || nearestSm.distanceToArrival < nearestL.distanceToArrival) ? nearestSm : undefined,
    allStations,
    bodies: bodyData?.bodies ?? [],
    nearestScoopableStar,
  };
}
