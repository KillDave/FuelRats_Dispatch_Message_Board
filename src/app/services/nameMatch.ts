/**
 * Matching IRC nicks and CMDR names against each other.
 *
 * The same person turns up as "Dr Leo", "Dr_Leo" and "dr.leo" depending on
 * where the name came from, so runs of space, dot and underscore are treated
 * as interchangeable. Everything else in the name is matched literally.
 */

const SEPARATORS = /[. _]+/g;

/** Escape every character that means something in a regular expression. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/**
 * Regex source for a name, lowercased, with separators made interchangeable.
 * Safe to embed in a larger pattern: the name's own characters are escaped.
 */
export function namePatternSource(name: string): string {
  return name
    .toLowerCase()
    .split(SEPARATORS)
    .map(escapeRegExp)
    .join('[. _]*');
}

/** MechaSqueak's exact nick. Anything merely containing the name is not the bot. */
export const MECHASQUEAK_NICK = 'mechasqueak[bot]';

export function isMechaSqueak(nick: string | undefined | null): boolean {
  return nick?.toLowerCase() === MECHASQUEAK_NICK;
}
