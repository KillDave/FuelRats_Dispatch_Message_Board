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
  /**
   * Everywhere in the system a ship can dock without landing, nearest first.
   *
   * This is the answer to "where do I send the client", so it deliberately
   * excludes surface ports. allStations below is still the complete list.
   */
  orbitalStations: EdsmStation[];
  allStations: EdsmStation[];
  bodies: EdsmBody[];
  nearestScoopableStar?: NearestScoopableStar;
}

const isFC = (t: string) => t === 'Fleet Carrier';
const isLPad = (t: string) => !['Outpost', 'Planetary Outpost'].includes(t);

/**
 * Anything sitting on a planet rather than in orbit.
 *
 * Covers Planetary Outpost, Planetary Port, Planetary Settlement, Planetary
 * Engineer Base and Odyssey Settlement -- EDSM spells these several ways and
 * adds more over time, so this matches on the words rather than listing types.
 *
 * These are excluded from the nearest-station picks because a client who needs
 * a station needs somewhere they can dock without landing. A settlement 73ls
 * away is not a useful answer when it means putting a ship on a surface. The
 * full station list further down the window still shows them.
 */
const isPlanetary = (t: string) => /planetary|settlement/i.test(t);

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

  const orbitalStations: EdsmStation[] = stations
    .filter((s) => !isPlanetary(s.type))
    .map((s) => ({ ...s, isLPad: isLPad(s.type) }))
    .sort((a, b) => a.distanceToArrival - b.distanceToArrival);

  const nearestScoopableStar = scoopable === false ? await fetchNearestScoopableStar(system, signal) : undefined;

  return {
    scoopable,
    orbitalStations,
    allStations,
    bodies: bodyData?.bodies ?? [],
    nearestScoopableStar,
  };
}
