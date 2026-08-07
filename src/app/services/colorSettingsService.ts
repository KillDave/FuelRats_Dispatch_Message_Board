const BUBBLE_COLORS_STORAGE = 'fr_bubble_colors';

export type MessageRole = 'dispatcher' | 'client' | 'rat';

export interface BubbleColors {
  dispatcher: string;
  client: string;
  rat: string;
}

export const DEFAULT_BUBBLE_COLORS: BubbleColors = {
  dispatcher: '#1e293b', // slate-800, matches the current default bubble
  client: '#7c2d12', // amber-950-ish
  rat: '#2c3c56', // slightly brighter than dispatcher color
};

export function getBubbleColors(): BubbleColors {
  const raw = localStorage.getItem(BUBBLE_COLORS_STORAGE);
  if (!raw) return { ...DEFAULT_BUBBLE_COLORS };
  try {
    const parsed = JSON.parse(raw);
    return {
      dispatcher: parsed.dispatcher || DEFAULT_BUBBLE_COLORS.dispatcher,
      client: parsed.client || DEFAULT_BUBBLE_COLORS.client,
      rat: parsed.rat || DEFAULT_BUBBLE_COLORS.rat,
    };
  } catch {
    return { ...DEFAULT_BUBBLE_COLORS };
  }
}

export function setBubbleColors(colors: BubbleColors): void {
  localStorage.setItem(BUBBLE_COLORS_STORAGE, JSON.stringify(colors));
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
