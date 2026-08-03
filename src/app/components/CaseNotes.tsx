import type { Injection } from './DispatchBoard';

/**
 * The case's quote log -- the same record the rescue page shows under "Quotes".
 *
 * These were previously folded into the chat log, which lost them twice over: a
 * note read as though the dispatcher had simply said it in channel, and in rat
 * mode the chat was truncated to the last few lines so older entries -- usually
 * the ones pinning down where the client actually is -- scrolled away entirely.
 */

/**
 * Most entries wrap someone else's line: `!grab` stores the client verbatim with
 * the bot's translation appended, and MechaSqueak records rat call-ins the same
 * way. The trailing group is deliberately anchored to the literal "(Translation:"
 * so an ordinary parenthetical -- `#7 1j (Using Horizons)` -- stays in the body.
 */
const QUOTED = /^<([^>]+)>\s*([\s\S]+?)(?:\s*\(Translation:\s*([\s\S]+)\))?$/;

function parseNote(text: string) {
  const m = text.match(QUOTED);
  if (!m) return { speaker: undefined, body: text, translation: undefined };
  return { speaker: m[1], body: m[2].trim(), translation: m[3]?.trim() };
}

const time = (d: Date) =>
  d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/**
 * MechaSqueak logs a quote each time the client's client leaves or rejoins the
 * rescue channel, verbatim and with no `<nick>` wrapper. A flaky connection
 * turns that into a run of near-identical lines that says nothing beyond "still
 * bouncing" -- collapsed into one row reporting the final state and how many
 * messages were folded in.
 */
const PRESENCE_TEXT: Record<string, 'left' | 'rejoined'> = {
  'Client left the rescue channel': 'left',
  'Client rejoined the rescue channel': 'rejoined',
};

type NoteEntry = { kind: 'note'; note: Injection; index: number };
type PresenceGroupEntry = { kind: 'presence-group'; notes: Injection[]; indices: number[]; finalState: 'left' | 'rejoined' };

function groupNotes(injections: Injection[]): (NoteEntry | PresenceGroupEntry)[] {
  const result: (NoteEntry | PresenceGroupEntry)[] = [];
  let i = 0;
  while (i < injections.length) {
    const state = PRESENCE_TEXT[injections[i].text.trim()];
    if (!state) {
      result.push({ kind: 'note', note: injections[i], index: i });
      i++;
      continue;
    }
    const indices = [i];
    let j = i + 1;
    while (j < injections.length && PRESENCE_TEXT[injections[j].text.trim()]) {
      indices.push(j);
      j++;
    }
    if (indices.length === 1) {
      result.push({ kind: 'note', note: injections[i], index: i });
    } else {
      const notes = indices.map(idx => injections[idx]);
      result.push({ kind: 'presence-group', notes, indices, finalState: PRESENCE_TEXT[notes[notes.length - 1].text.trim()]! });
    }
    i = j;
  }
  return result;
}

export function CaseNotes({
  injections,
  compact = false,
  showIndex = false,
  onEditQuote,
}: {
  injections: Injection[];
  compact?: boolean;
  showIndex?: boolean;
  /** Dispatch-only: clicking a quote offers to !sub its text. Not offered for collapsed presence groups. */
  onEditQuote?: (index: number, currentText: string) => void;
}) {
  if (injections.length === 0) return null;

  return (
    <div className={`space-y-1.5 ${compact ? 'text-xs' : 'text-sm'}`}>
      {groupNotes(injections).map(entry => {
        if (entry.kind === 'presence-group') {
          const last = entry.notes[entry.notes.length - 1];
          return (
            <div key={last.id} className="flex gap-2">
              <span className="text-slate-600 font-mono text-xs flex-shrink-0 pt-0.5">{time(last.createdAt)}</span>
              {showIndex && (
                <span className="text-slate-600 font-mono text-xs flex-shrink-0 pt-0.5">
                  #{entry.indices[0]}–{entry.indices[entry.indices.length - 1]}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="break-words text-slate-500 italic">
                  Client {entry.finalState} the rescue channel ({entry.notes.length} messages)
                </p>
              </div>
            </div>
          );
        }

        const { note, index } = entry;
        const { speaker, body, translation } = parseNote(note.text);
        const clickable = !!onEditQuote;
        return (
          <div
            key={note.id}
            className={`flex gap-2 -mx-1 px-1 rounded ${clickable ? 'cursor-pointer hover:bg-slate-700/40' : ''}`}
            onClick={clickable ? () => onEditQuote(index, note.text) : undefined}
          >
            <span className="text-slate-600 font-mono text-xs flex-shrink-0 pt-0.5">{time(note.createdAt)}</span>
            {showIndex && (
              <span className="text-slate-600 font-mono text-xs flex-shrink-0 pt-0.5">#{index}</span>
            )}
            <div className="min-w-0 flex-1">
              {/* Everything the API sends as a quote is rendered the same way.
                  Judging which lines matter needs a vocabulary of call-in tokens
                  that only holds until someone types something new, and getting
                  it wrong buries the one fact a rat needed. */}
              <p className="break-words text-amber-200/90">
                {/* A quoted line is that person's own words, so attribute it to
                    them rather than to whoever ran the command. */}
                {speaker && <span className="text-slate-500">&lt;{speaker}&gt; </span>}
                {body}
              </p>
              {translation && (
                <p className="text-cyan-300/80 italic break-words">⟫ {translation}</p>
              )}
              {/* Who recorded a line is only worth a row of its own when it adds
                  something. A bot relaying a rat's own call-in adds nothing and
                  the speaker is already shown, so on a case that is mostly
                  call-ins this would otherwise repeat "MechaSqueak[BOT]" a dozen
                  times. A person grabbing someone else's line is a deliberate
                  act and is worth recording. */}
              {(!speaker || !note.isBot) && (
                <p className="text-slate-600 text-xs">
                  — {speaker ? `grabbed by ${note.author}` : note.author}
                  {note.lastAuthor && <span title="Edited"> (edited by {note.lastAuthor})</span>}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
