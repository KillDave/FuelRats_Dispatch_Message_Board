/**
 * Supercruise travel time, ported from SwiftSqueak/NumberFormatter.swift.
 *
 * Shared so dispatch and rat mode cannot drift apart on the same case -- a rat
 * being told a different ETA than the dispatcher watching them is worse than
 * showing no ETA at all.
 */

const SC_ACCEL_RATE = 0.244343173;
const SC_ACCEL_MIDPOINT = 24.3043969;
const SC_VERTICAL_OFFSET = -90.9763924;

function scSpeed(t: number, maxSpeed: number): number {
  return maxSpeed / (1 + Math.exp(-SC_ACCEL_RATE * (t - SC_ACCEL_MIDPOINT))) + SC_VERTICAL_OFFSET;
}

function scDistanceTravelled(time: number, maxSpeed: number, steps = 200): number {
  const dt = time / steps;
  let dist = 0;
  for (let i = 0; i < steps; i++) {
    dist += 0.5 * (Math.max(0, scSpeed(i * dt, maxSpeed)) + Math.max(0, scSpeed((i + 1) * dt, maxSpeed))) * dt;
  }
  return dist;
}

/**
 * Seconds to cross `ls` in supercruise. Pass `scoMaxSpeed` for an SCO-equipped
 * ship; without it the piecewise fit for standard supercruise is used.
 */
export function distanceToSeconds(ls: number, scoMaxSpeed?: number): number {
  if (scoMaxSpeed !== undefined) {
    let low = 0, high = 400_000;
    while (high - low > 0.5) {
      const mid = (low + high) / 2;
      if (scDistanceTravelled(mid, scoMaxSpeed) < ls) low = mid; else high = mid;
    }
    return (low + high) / 2;
  }
  if (ls < 100_000) return 8.9034 * Math.pow(ls, 0.3292);
  if (ls < 1_907_087) return -8e-23 * ls ** 4 + 4e-16 * ls ** 3 - 8e-10 * ls ** 2 + 0.0014 * ls + 264.79;
  return (ls - 5_265_389.609) / 2001 + 3412;
}

export const SCO_SHIPS = [
  { key: 'cobra', label: 'Cobra Mk V', speed: 7000 },
  { key: 'mandalay', label: 'Mandalay', speed: 4200 },
  { key: 'caspian', label: 'Caspian', speed: 2900 },
] as const;

export type ScoShipKey = typeof SCO_SHIPS[number]['key'];

/** Countdown as m:ss, floored at zero. */
export function formatCountdown(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

/** Green when just started, red as the clock runs out. */
export function etaColor(remaining: number, total: number): string {
  const pct = total > 0 ? 1 - remaining / total : 1;
  return `hsl(${Math.round(pct * 120)}, 80%, 55%)`;
}
