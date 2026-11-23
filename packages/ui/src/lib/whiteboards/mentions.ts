/**
 * The @Skynex mention in board comments, like @Claude in Claude's
 * whiteboards: a comment that mentions Skynex is sent to it. Plain text in
 * the stored comment; the field and the thread draw it as a tag.
 */
export const SKYNEX_MENTION = '@Skynex';

const MENTION = /(^|\s)@skynex(?![\w-])/i;
const MENTIONS = /(^|\s)(@skynex)(?![\w-])/gi;

/** Whether the text mentions Skynex, which sends the comment to it. */
export const mentionsSkynex = (text: string): boolean => MENTION.test(text);

/** The text with the mention at its start, when it has none yet. */
export const addSkynexMention = (text: string): string => (mentionsSkynex(text) ? text : `${SKYNEX_MENTION} ${text.trimStart()}`);

/** The text without any mention of Skynex. */
export const removeSkynexMention = (text: string): string => text.replace(MENTIONS, '$1').replace(/^\s+/, '').replace(/ {2,}/g, ' ');

/**
 * The mention being typed where the caret is: an `@` at the start of a word
 * and the letters after it, while they can still become `@skynex`.
 */
export const mentionQueryAt = (text: string, caret: number): { start: number; query: string } | null => {
  const match = /(^|\s)@([\w-]*)$/.exec(text.slice(0, caret));
  if (!match) return null;
  const query = match[2] ?? '';
  // Letters that cannot become the name, or the whole name already typed, need no menu.
  if (!'skynex'.startsWith(query.toLowerCase()) || query.toLowerCase() === 'skynex') return null;
  return { start: caret - query.length - 1, query };
};

/** The text with the mention being typed completed, and where the caret goes after it. */
export const completeMention = (text: string, start: number, caret: number) => {
  const rest = text.slice(caret).replace(/^[\w-]*/, '');
  const inserted = `${SKYNEX_MENTION} `;
  return { text: `${text.slice(0, start)}${inserted}${rest.replace(/^ /, '')}`, caret: start + inserted.length };
};

/** The text cut into plain pieces and mentions, for drawing the mentions as tags. */
export const mentionPieces = (text: string): Array<{ text: string; mention: boolean }> => {
  const pieces: Array<{ text: string; mention: boolean }> = [];
  let at = 0;
  for (const match of text.matchAll(MENTIONS)) {
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    if (start > at) pieces.push({ text: text.slice(at, start), mention: false });
    pieces.push({ text: match[2] ?? '', mention: true });
    at = start + (match[2]?.length ?? 0);
  }
  if (at < text.length) pieces.push({ text: text.slice(at), mention: false });
  return pieces;
};
