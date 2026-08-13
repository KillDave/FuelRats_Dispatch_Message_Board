import type { Injection } from '../components/DispatchBoard';
import { parseNote } from '../components/CaseNotes';

/**
 * Matches "7min", "4 minutes O2", "19min o2", "5 minutes just about", and
 * "3minutes 50 seconds" (230s). The seconds group only matches immediately
 * after the minutes match, so "It said 3 min and I had the 15 second wait
 * timer" picks up 3 min and leaves the unrelated 15 seconds alone.
 */
const DURATION_RE = /(\d+(?:\.\d+)?)\s*min(?:ute)?s?\s*(?:(\d+(?:\.\d+)?)\s*sec(?:ond)?s?)?/i;

/**
 * The same figure written as a clock: "3:32 o2", "12:05".
 *
 * Dispatchers write it this way constantly -- it is how the badge itself
 * displays the number, so reading one back off the badge and injecting it is
 * the obvious thing to do, and it used to parse as nothing at all.
 *
 * Guarded at both ends. The leading class stops it matching the tail of a
 * longer number, and the trailing one stops it taking "06:09" out of a full
 * "06:09:15" timestamp, where the first two fields are an hour and a minute
 * and mean nothing like what this is looking for.
 *
 * Two digits of minutes is the limit on purpose: a canister runs to about
 * twenty-five, so a larger number is not an O2 reading and is much more likely
 * to be a time of day somebody happened to mention.
 */
const CLOCK_RE = /(?:^|[^\d:])(\d{1,2}):([0-5]\d)(?!\d|:)/g;

/**
 * A clock is only an O2 reading when something nearby says so.
 *
 * "6 minutes" can only be a duration, so the worded pattern needs no such
 * proof. "6:32" is a duration or a time of day with equal ease, and dispatchers
 * inject meetup times constantly -- "meetup time 6:32 utc" read as six and a
 * half minutes of air would overwrite a correct countdown with a number that
 * was never about oxygen at all.
 *
 * The cost is a bare "3:32" with nothing else in the note, which no longer
 * counts. That is the right way round: a missed reading is visible and can be
 * typed into the badge, while a wrong one looks exactly like a right one.
 */
const O2_CONTEXT_RE = /\bo2\b|\boxygen\b/i;

/**
 * Words that make a nearby clock something other than a reading of the air.
 *
 * Meetup times are the ones that actually bite: dispatchers inject them all
 * the time, they are written exactly like an O2 figure, and half of them carry
 * no timezone at all.
 */
const NOT_O2_RE = /\b(?:meet\s?up|meet|eta|arrive|arrival|utc|gmt|am|pm|[ecmp][sd]t|cest?|server)\b/i;

/**
 * Clauses, because proximity is the only thing that separates the two numbers
 * in "6:32 meetup, 3:32 o2".
 *
 * Looking at the note as a whole cannot work: it contains "o2", so the note
 * qualifies, and then whichever clock comes first wins -- which is the meetup.
 * Requiring the o2 to sit in the *same* clause as the clock is what ties the
 * label to the number it labels.
 */
const CLAUSE_SPLIT_RE = /[,;/|]|\s[-–]\s/;

export function parseDurationSeconds(text: string): number | null {
  const m = text.match(DURATION_RE);
  if (m) {
    const minutes = parseFloat(m[1]);
    const seconds = m[2] ? parseFloat(m[2]) : 0;
    return Math.round(minutes * 60 + seconds);
  }

  // Tried second so that nothing which already worked can change meaning: a
  // note carrying both forms keeps reading the worded one, as it always has.
  for (const clause of text.split(CLAUSE_SPLIT_RE)) {
    if (!O2_CONTEXT_RE.test(clause) || NOT_O2_RE.test(clause)) continue;

    for (const clock of clause.matchAll(CLOCK_RE)) {
      return parseInt(clock[1], 10) * 60 + parseInt(clock[2], 10);
    }
  }

  return null;
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
    // A ternary rather than `translation && ...`: parseNote trims the
    // translation group, so a note carrying "(Translation: )" hands back an
    // empty string. `&&` yields that "" unchanged, `??` does not catch it
    // because it is neither null nor undefined, and the empty string sails out
    // of here as the timer's baseSeconds.
    const seconds = (translation ? parseDurationSeconds(translation) : null)
      ?? parseDurationSeconds(body);
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
export const TIMER_START_RE = /\b(?:wr|tm)\s*\+|\b(?:bc|inst)\s*\+|\bopen\b|\bsysconf\b/i;

/** Fuel delivered, or the client quit to the main menu (may resume later). */
export const TIMER_STOP_RE = /\bfuel\s*\+|\bmm(?:conf(?:irm)?)?\b(?!\s*-)|\bmain\s*menu/i;