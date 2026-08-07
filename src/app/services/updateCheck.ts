/**
 * Is a newer release out, and can this machine install it by itself?
 *
 * The board cannot update itself -- it is a page. FRBoard.exe can, because it
 * is the process serving that page and it ships beside the installer. So the
 * check happens here and the work is handed to the bridge, which spawns the
 * installer and relaunches the board when it is done.
 *
 * Nothing is shown unless there is genuinely something newer. A banner that
 * says "you are up to date" is noise on every load for the sake of one moment
 * a month.
 */

// Whichever repository this build was made from -- see scripts/repo.mjs. Not
// hard-coded, because this project is a fork: a build made from some other
// checkout must check that checkout's releases, or it would offer to replace
// itself with somebody else's binaries.
const RELEASES_API = `https://api.github.com/repos/${__REPO__}/releases/latest`;

/**
 * How long an answer is reused, and how often the board asks again.
 *
 * Half an hour. A board left open for a whole shift should notice a release
 * that lands during it -- that is the entire point of the badge -- and a
 * check every thirty minutes costs two requests an hour against GitHub's
 * allowance of sixty.
 *
 * The cache is what makes the timer cheap: several tabs, or a reload, share
 * one answer rather than each asking.
 */
export const CHECK_INTERVAL_MS = 30 * 60 * 1000;

/**
 * How long an answer is reused.
 *
 * Deliberately far shorter than the interval above, and they were the same
 * number until somebody published a release, reloaded the board, and was told
 * nothing had changed. The cache had answered "you are current" a few minutes
 * earlier and, being valid for the same half hour as the timer, went on saying
 * so -- a reload could not get past it, which is exactly when somebody reaches
 * for one.
 *
 * The cache is only there so that several tabs, or a burst of reloads, do not
 * each ask GitHub. Two minutes does that, and leaves a reload meaning what
 * people expect it to mean. Even reloading every two minutes for an hour costs
 * thirty of the sixty requests GitHub allows.
 */
const CACHE_MS = 2 * 60 * 1000;
const CACHE_KEY = 'fr_update_check';

/** Where the bridge listens. Same default the rest of the board uses. */
function bridgeBase(): string {
  return localStorage.getItem('fr_deepl_proxy_url') || 'http://localhost:8081';
}

export interface UpdateInfo {
  /** Tag of the newest release, e.g. "v2.0.2". */
  latest: string;
  url: string;
}

/**
 * Compare two versions numerically, component by component.
 *
 * String comparison gets this wrong in a way that matters here: "1.1.81" sorts
 * before "1.1.8" as text, and this project has shipped both.
 */
function parts(version: string): number[] {
  return (version.match(/\d+/g) ?? ['0']).map(Number);
}

function isNewer(candidate: string, current: string): boolean {
  const a = parts(candidate);
  const b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

/** The newest release, or null when this is already it. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { at, latest, url } = JSON.parse(cached) as { at: number } & UpdateInfo;
      if (Date.now() - at < CACHE_MS) {
        return isNewer(latest, __APP_VERSION__) ? { latest, url } : null;
      }
    }
  } catch {
    /* a corrupt cache is not worth failing over */
  }

  try {
    const res = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) return null;
    const body = await res.json();
    const latest = String(body.tag_name ?? '');
    const url = String(body.html_url ?? '');
    if (!latest) return null;

    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), latest, url }));
    return isNewer(latest, __APP_VERSION__) ? { latest, url } : null;
  } catch {
    // Offline, rate-limited, or GitHub having a moment. None of those are
    // worth telling a dispatcher about mid-case.
    return null;
  }
}

export type UpdateResult = { ok: true } | { ok: false; error: string };

/**
 * Ask the bridge to install the update.
 *
 * It replies before doing the work, because the work kills it: the installer
 * stops FRBoard.exe so the file can be replaced, then starts it again. The
 * page therefore loses its connections a second or two after this resolves,
 * which is expected rather than a fault.
 */
export async function startUpdate(): Promise<UpdateResult> {
  try {
    const res = await fetch(`${bridgeBase()}/update`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: String(body.error ?? `bridge answered ${res.status}`) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: `could not reach the bridge: ${err}` };
  }
}
