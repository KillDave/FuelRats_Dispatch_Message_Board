import type { Injection } from '../components/DispatchBoard';
import { parseNote } from '../components/CaseNotes';

/**
 * Matches "7min", "4 minutes O2", "19min o2", "5 minutes just about", and
 * "3minutes 50 seconds" (230s). The seconds group only matches immediately
 * after the minutes match, so "It said 3 min and I had the 15 second wait
 * timer" picks up 3 min and leaves the unrelated 15 seconds alone.
 */
const DURATION_RE = /(\d+(?:\.\d+)?)\s*min(?:ute)?s?\s*(?:(\d+(?:\.\d+)?)\s*sec(?:ond)?s?)?/i;

export function parseDurationSeconds(text: string): number | null {
  const m = text.match(DURATION_RE);
  if (!m) return null;
  const minutes = parseFloat(m[1]);
  const seconds = m[2] ? parseFloat(m[2]) : 0;
  return Math.round(minutes * 60 + seconds);
}

const normalize = (s: string) => s.toLowerCase().replace(/[. _]+/g, '[. _]*');

/**
 * The newest note (not a bot entry) that carries a parseable O2 estimate.
 * A `!grab`'d client quote counts only when the speaker is the client
 * themselves. A freeform `!inject` note -- no `<nick>` wrapper, a dispatcher
 * or rat typing a paraphrase like "o2 23 min" -- counts regardless of who
 * typed it, since there's no attached speaker to check against the client.
 * Translation is tried first, since a non-English original like "3 minutos"
 * won't match the English duration patterns but its attached "(Translation:
 * Around 3 minutes)" will.
 */
export function findLatestGrabDuration(
  injections: Injection[],
  clientName: string,
  ircNick?: string
): { injectionId: string; seconds: number } | null {
  const clientPattern = new RegExp(`^(?:${normalize(clientName)}${ircNick ? `|${normalize(ircNick)}` : ''})$`, 'i');

  for (let i = injections.length - 1; i >= 0; i--) {
    const injection = injections[i];
    if (injection.isBot) continue;
    const { speaker, body, translation } = parseNote(injection.text);
    if (speaker && !clientPattern.test(speaker)) continue; // a grabbed quote from someone other than the client
    const seconds = (translation && parseDurationSeconds(translation)) ?? parseDurationSeconds(body);
    if (seconds !== null) return { injectionId: injection.id, seconds };
  }
  return null;
}

/**
 * A dispatcher's typed correction: "7:30", "7", or "7m 30s" -- whatever they
 * type into the badge when the regex read the client's line wrong. Tried as
 * mm:ss first since that's what the badge itself displays.
 */
export function parseManualInput(text: string): number | null {
  const clockMatch = text.trim().match(/^(\d+):([0-5]?\d)$/);
  if (clockMatch) return parseInt(clockMatch[1], 10) * 60 + parseInt(clockMatch[2], 10);

  const bareNumber = text.trim().match(/^(\d+(?:\.\d+)?)$/);
  if (bareNumber) return Math.round(parseFloat(bareNumber[1]) * 60);

  return parseDurationSeconds(text);
}

/** A rat reporting they've reached the client: wing request, beacon, or "open". */
export const TIMER_START_RE = /\b(?:wr|tm)\s*\+|\b(?:bc|inst)\s*\+|\bopen\b/i;

/** Fuel delivered, or the client quit to the main menu (may resume later). */
export const TIMER_STOP_RE = /\bfuel\s*\+|\bmm\s*\+|\bmm\s*confirm|\bmain\s*menu/i;
