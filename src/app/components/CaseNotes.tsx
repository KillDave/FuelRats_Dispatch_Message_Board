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

export function CaseNotes({ injections, compact = false }: { injections: Injection[]; compact?: boolean }) {
  if (injections.length === 0) return null;

  return (
    <div className={`space-y-1.5 ${compact ? 'text-xs' : 'text-sm'}`}>
      {injections.map(note => {
        const { speaker, body, translation } = parseNote(note.text);
        return (
          <div key={note.id} className="flex gap-2">
            <span className="text-slate-600 font-mono text-xs flex-shrink-0 pt-0.5">{time(note.createdAt)}</span>
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
