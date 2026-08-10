import type { Case } from '../components/DispatchBoard';
import { TIMER_START_RE, TIMER_STOP_RE } from './codeRedTimerService';

/**
 * What a message in the rescue channel does to a case.
 *
 * This lived inline in DispatchBoard's IRC handler, which meant it existed in
 * exactly one place that the client test page cannot reach. The page could
 * therefore show a rat saying "fr+" and register nothing, and the same for a
 * distance report, a jump call and the O2 countdown -- a sandbox that looked
 * like the board and quietly did not behave like it, which is worse than no
 * sandbox at all.
 *
 * Pure, so both callers get the same answer and neither can drift from it.
 * Nick learning stays in DispatchBoard: it depends on a ref holding the last
 * rat command and on MechaSqueak's quoting, none of which is about reading this
 * message.
 */

export interface RatMessageContext {
  text: string;
  nick?: string;
  timestamp: Date;
  /** The assigned rat this line was attributed to, if it was. */
  matchedRatName?: string | null;
  isAssignedRat: boolean;
  /** CMDR -> IRC nick, as it stands after any learning from this message. */
  ratIrcNicks: Record<string, string>;
}

export interface RatMessageEffects {
  scDistance: Case['scDistance'];
  jumpCalls: Case['jumpCalls'];
  ratProgress: Case['ratProgress'];
  codeRedTimer: Case['codeRedTimer'];
}

/** fr±, wr±/tm±, bc±/inst±, fuel+ */
const STATUS_PATTERNS: [RegExp, 'fr' | 'wr' | 'bc' | 'fuel', '+' | '-' | true][] = [
  [/\bfr\s*\+/i, 'fr', '+'],
  [/\bfr\s*-/i, 'fr', '-'],
  [/\b(?:wr|tm)\s*\+/i, 'wr', '+'],
  [/\b(?:wr|tm)\s*-/i, 'wr', '-'],
  [/\b(?:bc|inst)\s*\+/i, 'bc', '+'],
  [/\b(?:bc|inst)\s*-/i, 'bc', '-'],
  [/\bfuel\s*\+/i, 'fuel', true],
];

export function readRatMessage(c: Case, ctx: RatMessageContext): RatMessageEffects {
  const { text, nick, timestamp, matchedRatName, isAssignedRat, ratIrcNicks } = ctx;
  const caseNum = parseInt(c.id.split('-')[1], 10);

  // --- supercruise distance: "#N ... 0.41ly" -------------------------------
  //
  // Bot lines are skipped because MechaSqueak's announcements carry a system
  // distance -- "97.6 LY from Sol" -- which is not how far the rat still has
  // to fly.
  const isBotNick = nick?.toLowerCase().includes('mechasqueak') ?? false;
  let scDistance = c.scDistance;
  if (!isBotNick && new RegExp(`#${caseNum}\\b`).test(text)) {
    const distMatch = text.match(/([\d]*\.?[\d]+)\s*(Mls|kls|ls|ly|au)\b/i);
    if (distMatch) {
      const val = parseFloat(distMatch[1]);
      const unit = distMatch[2].toLowerCase();
      const ls = unit === 'ly' ? val * 31_557_600
        : unit === 'au' ? val * 499
        : unit === 'kls' ? val * 1_000
        : unit === 'mls' ? val * 1_000_000
        : val;
      scDistance = { ls, timestamp };
    }
  }

  // --- jump calls: "#N Xj" or "Xj #N" --------------------------------------
  let jumpCalls = c.jumpCalls ?? {};
  const jumpPattern = new RegExp(`(?:#${caseNum}\\s+(\\d+)j|(\\d+)j\\s+#${caseNum})\\b`, 'i');
  const jumpMatch = text.match(jumpPattern);
  if (jumpMatch && nick) {
    jumpCalls = {
      ...jumpCalls,
      [nick]: { jumps: parseInt(jumpMatch[1] ?? jumpMatch[2], 10), text, timestamp },
    };
  } else if (nick && /\b(?:stdn|stand\s*down)\b/i.test(text)) {
    // Standing down retracts the call: they are not on their way any more, so a
    // countdown still ticking towards their arrival is worse than showing
    // nothing. Checked as an else so a message somehow carrying both still
    // registers the newer jump count.
    //
    // Only for someone never assigned, though. An assigned rat's count is part
    // of the case record and standing down does not unmake the trip; an
    // unassigned caller was only offering, so it is noise once they withdraw.
    // The nick is checked against the learned map too, since name matching can
    // miss.
    const nickIsAssigned = isAssignedRat
      || Object.values(ratIrcNicks).some((n) => n?.toLowerCase() === nick.toLowerCase());
    if (!nickIsAssigned && jumpCalls[nick]) {
      const rest = { ...jumpCalls };
      delete rest[nick];
      jumpCalls = rest;
    }
  }

  // --- rat status reports ---------------------------------------------------
  let ratProgress = c.ratProgress ?? {};
  const ratKey = matchedRatName ?? nick;
  if (ratKey) {
    const updated = { ...(ratProgress[ratKey] ?? {}) };
    // fuel is a case-level first-delivery flag -- only the first rat to report
    // it is marked.
    const fuelAlreadyClaimed = Object.values(ratProgress).some((p) => p.fuel);
    let changed = false;
    for (const [pattern, key, value] of STATUS_PATTERNS) {
      if (pattern.test(text)) {
        if (key === 'fuel' && fuelAlreadyClaimed) continue;
        (updated as Record<string, unknown>)[key] = value;
        changed = true;
      }
    }
    if (changed) {
      ratProgress = { ...ratProgress, [ratKey]: updated };
    }
  }

  // --- the O2 countdown -----------------------------------------------------
  //
  // Only from an assigned rat, and only once a duration has been grabbed.
  // Quitting to the menu is not necessarily the case ending -- the rat may
  // still be a long way out -- so a stop pauses rather than clears, and picks
  // back up if wr/bc/open comes again.
  let codeRedTimer = c.codeRedTimer;
  if (codeRedTimer && isAssignedRat) {
    if (TIMER_START_RE.test(text) && !codeRedTimer.running) {
      codeRedTimer = { ...codeRedTimer, running: true, runningSince: timestamp };
    } else if (TIMER_STOP_RE.test(text) && codeRedTimer.running) {
      const elapsed = codeRedTimer.runningSince
        ? (timestamp.getTime() - codeRedTimer.runningSince.getTime()) / 1000
        : 0;
      codeRedTimer = {
        ...codeRedTimer,
        running: false,
        runningSince: undefined,
        accumulatedSeconds: codeRedTimer.accumulatedSeconds + elapsed,
      };
    }
  }

  return { scDistance, jumpCalls, ratProgress, codeRedTimer };
}
