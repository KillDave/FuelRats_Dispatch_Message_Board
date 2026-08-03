import { useEffect, useState } from 'react';
import { authService } from '@/app/services/authService';

export type DispatcherAccess = 'checking' | 'allowed' | 'denied' | 'unknown';

/**
 * Whether this account is a Drilled Dispatch.
 *
 * Answered once per page load and shared, rather than per component: the two
 * places that gate on it -- the case-history panel and the search page -- would
 * otherwise each hit /profile, and the panel mounts once per open case.
 *
 * `unknown` is distinct from `denied` on purpose. Failing to reach the API is
 * not the same as being told no, and a feature that says "you are not a
 * dispatcher" because the network blipped would send someone to ask an
 * overseer about a problem they do not have. Both hide the feature; only one
 * of them says why in those terms.
 */

let cached: Promise<boolean> | null = null;

function lookup(): Promise<boolean> {
  // Never cached while signed out. The hook runs on first render, which for
  // anyone arriving at the login screen happens before a token exists -- and
  // caching that "no" would keep the feature hidden for the rest of the page
  // even after they signed in.
  if (!authService.isAuthenticated()) {
    return Promise.resolve(false);
  }
  if (!cached) {
    cached = authService.isDispatcher();
  }
  return cached;
}

/** Forget the cached answer — call after sign-out so the next account is asked. */
export function resetDispatcherCache(): void {
  cached = null;
}

export function useDispatcher(): DispatcherAccess {
  // Read every render so that signing in re-runs the check. Without this the
  // effect fires once on mount and a user who signs in without a page reload
  // is judged on the state before they had a token.
  const signedIn = authService.isAuthenticated();
  const [state, setState] = useState<DispatcherAccess>('checking');

  useEffect(() => {
    let cancelled = false;

    if (!signedIn) {
      setState('denied');
      return;
    }

    setState('checking');
    lookup()
      .then((ok) => {
        if (!cancelled) setState(ok ? 'allowed' : 'denied');
      })
      .catch((e) => {
        // The next mount should try again rather than inherit a failure.
        cached = null;
        console.error('[dispatcher gate] group lookup failed:', e);
        if (!cancelled) setState('unknown');
      });

    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  return state;
}
