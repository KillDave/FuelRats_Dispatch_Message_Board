import { useState } from 'react';
import type { ShipParams } from '../services/spanshService';

/**
 * Which build to plot with. Rats commonly fly a shorter-ranged, better-equipped
 * ship for nearby cases and swap to a stripped long-range explorer for anything
 * far out, so an account can hold one of each and the plotter picks by distance.
 */
export type ShipSlot = 'short' | 'long';

export interface RatAccount {
  id: string;
  cmdr: string;
  system: string;
  /**
   * Ship parameters derived from pasted EDSY exports, needed to plot jumps.
   * Stored parsed rather than raw so a change to the FSD table cannot silently
   * alter an estimate the rat has already acted on -- re-paste to update.
   */
  ships?: Partial<Record<ShipSlot, ShipParams>>;
  /**
   * Parked on a neutron star with the drive already charged, so the first jump
   * of the route gets the boost. Belongs to the account rather than the ship
   * because it describes where the rat is sitting, not what they fly.
   */
  startSupercharged?: boolean;
  /**
   * Keep `system` in step with where EDSM says this commander is. Opt-in per
   * account: it overwrites whatever was typed, which is only wanted for an
   * account whose EDMC is actually running.
   */
  autoLocate?: boolean;
  /** EDSM's timestamp for the last position applied, for showing staleness. */
  positionAt?: string;
}

export interface AccountCardDist {
  id: string;
  cmdr: string;
  system: string;
  distance: number | null;
  status: 'loading' | 'done' | 'error' | 'no-system';
  /** Populated on demand: Spansh has to plot the route to know this. */
  jumps?: number | null;
  jumpStatus?: 'idle' | 'plotting' | 'done' | 'error' | 'no-ship';
}

const KEY = 'ratboard-my-accounts';

function load(): RatAccount[] {
  try {
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as RatAccount[]) : [];
  } catch {
    return [];
  }
}

export function useRatAccounts() {
  const [accounts, setAccounts] = useState<RatAccount[]>(load);

  const save = (next: RatAccount[]) => {
    setAccounts(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  };

  return {
    accounts,
    add:    (cmdr: string, system: string) =>
      save([...accounts, { id: crypto.randomUUID(), cmdr, system }]),
    // cmdr/system and the ship are edited from different places, so updating one
    // must not clear the other.
    update: (id: string, cmdr: string, system: string) =>
      save(accounts.map(a => (a.id === id ? { ...a, cmdr, system } : a))),
    setShip: (id: string, slot: ShipSlot, ship: ShipParams | undefined) =>
      save(accounts.map(a => {
        if (a.id !== id) return a;
        const ships = { ...a.ships, [slot]: ship };
        if (!ship) delete ships[slot];
        return { ...a, ships };
      })),
    setSupercharged: (id: string, on: boolean) =>
      save(accounts.map(a => (a.id === id ? { ...a, startSupercharged: on } : a))),
    /**
     * Add commanders found in the game journals.
     *
     * Only ever adds. An account already on the list is left completely alone --
     * its system may have been typed deliberately, and its ship will usually have
     * been tuned (cargo especially) in a way the raw Loadout does not capture.
     */
    importDetected: (found: {
      cmdr: string;
      system?: string;
      positionAt?: string;
      ship?: ShipParams;
    }[]) => {
      const have = new Set(accounts.map(a => a.cmdr.trim().toLowerCase()));
      const additions = found
        .filter(f => f.cmdr.trim() && !have.has(f.cmdr.trim().toLowerCase()))
        .map(f => ({
          id: crypto.randomUUID(),
          cmdr: f.cmdr.trim(),
          system: f.system ?? '',
          positionAt: f.positionAt,
          autoLocate: true,
          ships: f.ship ? { short: f.ship } : undefined,
        }));
      if (additions.length) save([...accounts, ...additions]);
      return additions.length;
    },
    setAutoLocate: (id: string, on: boolean) =>
      save(accounts.map(a => (a.id === id ? { ...a, autoLocate: on } : a))),
    /**
     * Applied from EDSM. A no-op when the system is unchanged so a poll that
     * finds the rat where it left them does not churn state every minute.
     */
    setLocation: (id: string, system: string, positionAt?: string) =>
      save(accounts.map(a =>
        a.id === id && (a.system !== system || a.positionAt !== positionAt)
          ? { ...a, system, positionAt }
          : a,
      )),
    remove: (id: string) =>
      save(accounts.filter(a => a.id !== id)),
  };
}
