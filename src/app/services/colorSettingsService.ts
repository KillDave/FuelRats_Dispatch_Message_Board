const BUBBLE_COLORS_STORAGE = 'fr_bubble_colors';

export type MessageRole = 'dispatcher' | 'client' | 'rat';

export interface BubbleColors {
  dispatcher: string;
  client: string;
  rat: string;
}

/**
 * What the role colour paints: the whole bubble, or just the nickname on it.
 *
 * A tinted bubble is easy to pick out from across the room, which is the point
 * during a call. It is also a lot of colour on a screen somebody stares at for
 * a whole shift, and it fights with the parts of a message that carry their own
 * meaning -- notices, translations -- because those are already coloured text
 * sitting on top of it.
 */
export type ColorTarget = 'bubble' | 'nick';

export interface ColorSettings {
  target: ColorTarget;
  bubble: BubbleColors;
  nick: BubbleColors;
  // Message body and translation-line colours are independent of `target`:
  // they read the message itself rather than identify who sent it, so they
  // stay on regardless of whether the bubble or the nickname is doing the
  // identifying.
  text: BubbleColors;
  translation: BubbleColors;
  // The one shared bubble colour used in Text Only mode, where role is read
  // off the nickname instead and every bubble is otherwise the same.
  neutralBubble: string;
}

export const DEFAULT_BUBBLE_COLORS: BubbleColors = {
  dispatcher: '#1e293b', // slate-800, matches the current default bubble
  client: '#7c2d12', // amber-950-ish
  rat: '#2c3c56', // slightly brighter than dispatcher color
};

/**
 * Nicknames get their own palette rather than reusing the bubble one.
 *
 * The two are not interchangeable and sharing them would be a trap: the bubble
 * colours are deliberately dark, because they sit behind white text, and the
 * dispatcher's #1e293b painted onto a nickname would be all but invisible on
 * the very bubble it names. Somebody switching modes would find their careful
 * palette had turned illegible and no obvious reason why.
 *
 * Dispatcher keeps orange-400, which is what every nickname was before this
 * existed, so turning nick mode on and changing nothing else leaves the
 * dispatcher's own messages looking exactly as they did.
 */
export const DEFAULT_NICK_COLORS: BubbleColors = {
  dispatcher: '#fb923c', // orange-400, the colour every nickname used to be
  client: '#fca5a5', // red-300
  rat: '#7dd3fc', // sky-300
};

export const DEFAULT_TEXT_COLORS: BubbleColors = {
  dispatcher: '#e2e8f0', // slate-200, the original message-text colour
  client: '#e2e8f0',
  rat: '#e2e8f0',
};

export const DEFAULT_TRANSLATION_COLORS: BubbleColors = {
  dispatcher: '#67e8f9', // cyan-300, the original translation-text colour
  client: '#67e8f9',
  rat: '#67e8f9',
};

/** The bubble everything sits on when the colour has gone to the nickname. */
export const NEUTRAL_BUBBLE = DEFAULT_BUBBLE_COLORS.dispatcher;

export const DEFAULT_COLOR_SETTINGS: ColorSettings = {
  target: 'bubble',
  bubble: DEFAULT_BUBBLE_COLORS,
  nick: DEFAULT_NICK_COLORS,
  text: DEFAULT_TEXT_COLORS,
  translation: DEFAULT_TRANSLATION_COLORS,
  neutralBubble: NEUTRAL_BUBBLE,
};

function readPalette(source: unknown, fallback: BubbleColors): BubbleColors {
  const from = (source ?? {}) as Partial<BubbleColors>;
  return {
    dispatcher: from.dispatcher || fallback.dispatcher,
    client: from.client || fallback.client,
    rat: from.rat || fallback.rat,
  };
}

export function getColorSettings(): ColorSettings {
  const raw = localStorage.getItem(BUBBLE_COLORS_STORAGE);
  if (!raw) return structuredClone(DEFAULT_COLOR_SETTINGS);
  try {
    const parsed = JSON.parse(raw);
    return {
      target: parsed.target === 'nick' ? 'nick' : 'bubble',
      // The bubble palette lives at the top level rather than under a `bubble`
      // key, because that is where it was before nick colours existed and
      // moving it would silently reset everybody's saved colours.
      bubble: readPalette(parsed, DEFAULT_BUBBLE_COLORS),
      nick: readPalette(parsed.nick, DEFAULT_NICK_COLORS),
      text: readPalette(parsed.text, DEFAULT_TEXT_COLORS),
      translation: readPalette(parsed.translation, DEFAULT_TRANSLATION_COLORS),
      neutralBubble: parsed.neutralBubble || NEUTRAL_BUBBLE,
    };
  } catch {
    return structuredClone(DEFAULT_COLOR_SETTINGS);
  }
}

export function setColorSettings(settings: ColorSettings): void {
  localStorage.setItem(
    BUBBLE_COLORS_STORAGE,
    JSON.stringify({
      ...settings.bubble,
      target: settings.target,
      nick: settings.nick,
      text: settings.text,
      translation: settings.translation,
      neutralBubble: settings.neutralBubble,
    })
  );
}

/**
 * Classifies a message sender against a case's known dispatcher/client/rat
 * identities, reusing the same matching rules already used elsewhere
 * (CaseWindow's translation-skip and last-spoke-order logic) so bubble
 * coloring agrees with those checks.
 */
export function classifyMessageRole(
  sender: string,
  caseData: {
    assignedRats: string[];
    ratIrcNicks?: Record<string, string>;
    ircNick?: string;
    clientName?: string;
  }
): MessageRole {
  const senderLower = sender.toLowerCase();

  const isRat = caseData.assignedRats.some((rat) => {
    const nick = caseData.ratIrcNicks?.[rat] ?? rat;
    return nick.toLowerCase() === senderLower || rat.toLowerCase() === senderLower;
  });
  if (isRat) return 'rat';

  const clientNick = caseData.ircNick || caseData.clientName;
  if (clientNick && clientNick.toLowerCase() === senderLower) return 'client';

  if (sender === 'Dispatch') return 'dispatcher';

  // Fall back to dispatcher for anything unmatched (e.g. the local
  // dispatcher's own IRC nick), rather than leaving a message unstyled.
  return 'dispatcher';
}
