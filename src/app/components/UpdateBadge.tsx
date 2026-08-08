import { useEffect, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { checkForUpdate, startUpdate, CHECK_INTERVAL_MS, type UpdateInfo } from '@/app/services/updateCheck';

/**
 * A quiet "update available" chip, beside the connection status.
 *
 * Renders nothing at all unless a newer release exists, so it costs no space
 * on the overwhelming majority of loads. It sits next to the API and IRC
 * indicators because that row is already where someone looks to see whether
 * things are healthy, and because it is out of the way of the case list.
 *
 * Clicking it does the whole update: the bridge runs the installer, which
 * replaces the board and the executable, puts the current IRC script in place
 * and starts the board again. The page will drop its connections partway
 * through -- that is the board being restarted underneath it, not a fault.
 */
export function UpdateBadge() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [state, setState] = useState<'idle' | 'working' | 'restarting' | 'failed'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Rechecked on a timer, not just at mount. The board is typically opened
    // once and left for a whole shift, so a release that lands during it would
    // otherwise go unnoticed until the next restart -- which is exactly the
    // case this is meant to cover.
    //
    // A reload also asks again, because the cached answer expires long before
    // this timer does. It used not to, and "just refresh the page" was then
    // advice that could not work.
    //
    // Polling is not the same as interrupting: nothing moves, nothing pops up,
    // a chip simply appears next to the status dots and waits to be noticed.
    const tick = () =>
      void checkForUpdate().then((found) => {
        if (!cancelled) setUpdate(found);
      });

    tick();
    const timer = window.setInterval(tick, CHECK_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  if (!update) return null;

  const run = async () => {
    setState('working');
    setError(null);
    const result = await startUpdate();
    if (!result.ok) {
      setError(result.error);
      setState('failed');
      return;
    }
    // The bridge answers before it restarts, so from here the page is just
    // waiting to be served by a newer build.
    setState('restarting');
  };

  if (state === 'restarting') {
    return (
      <div className="flex items-center gap-1.5" title="The board is restarting on the new version">
        <Loader2 className="w-3 h-3 text-sky-400 animate-spin" />
        <span className="text-xs text-sky-400">updating, reload shortly</span>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={state === 'working'}
      title={
        state === 'failed'
          ? `Update failed: ${error}\nDownload it yourself from ${update.url}`
          : `${update.latest} is available -- click to install it and restart the board`
      }
      className={`flex items-center gap-1.5 rounded px-1.5 py-0.5 -my-0.5 text-xs leading-none transition-colors ${
        state === 'failed'
          ? 'text-red-400 hover:bg-red-500/10'
          : 'text-amber-300 hover:bg-amber-500/10'
      }`}
    >
      {state === 'working' ? (
        <Loader2 className="w-3 h-3 animate-spin" />
      ) : (
        <Download className="w-3 h-3" />
      )}
      <span className="text-xs">
        {state === 'failed' ? 'update failed' : update.latest}
      </span>
    </button>
  );
}
