import { useState } from 'react';

export interface RatAccount {
  id: string;
  cmdr: string;
  system: string;
}

export interface AccountCardDist {
  id: string;
  cmdr: string;
  system: string;
  distance: number | null;
  status: 'loading' | 'done' | 'error' | 'no-system';
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
    update: (id: string, cmdr: string, system: string) =>
      save(accounts.map(a => (a.id === id ? { ...a, cmdr, system } : a))),
    remove: (id: string) =>
      save(accounts.filter(a => a.id !== id)),
  };
}
