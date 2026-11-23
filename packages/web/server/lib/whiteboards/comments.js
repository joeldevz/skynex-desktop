import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { WhiteboardError } from './model.js';

/**
 * Comments on a board: notes pinned to an element or to a point, each a thread
 * of entries written by the user or by the agent. They live in the board's
 * file next to its elements but are not elements: they never enter element
 * operations, undo or the board's last change.
 */
// Per entry, per thread and per board: `totalText` bounds everything a board's
// comments hold together, so the board file and every answer that carries it
// stay small whatever the thread counts allow. `changesPerMinute` bounds how
// fast a board's comments can change, whoever asks.
export const COMMENT_LIMITS = Object.freeze({ comments: 200, entries: 100, text: 4000, totalText: 200_000, changesPerMinute: 30 });

const token = () => randomBytes(8).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '0').slice(0, 10);
const elementId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const coordinate = z.number().finite().min(-1_000_000).max(1_000_000);
const commentId = z.string().regex(/^cm_[a-z0-9]{10}$/);
const words = z.string().max(COMMENT_LIMITS.text).refine((value) => value.trim().length > 0);
const extent = z.number().finite().min(8).max(20_000);
// Where a comment points: an element when it has one, and always the point
// where its marker was put, which it keeps if that element is deleted. A
// comment on an area of the board (w and h, from the point as top-left
// corner) marks where the agent should create what it asks for.
const anchorSchema = z.strictObject({ elementId: elementId.optional(), x: coordinate, y: coordinate, w: extent.optional(), h: extent.optional() })
  .refine((anchor) => (anchor.w === undefined) === (anchor.h === undefined) && !(anchor.elementId && anchor.w !== undefined));

const entrySchema = z.strictObject({
  id: z.string().regex(/^ce_[a-z0-9]{10}$/),
  author: z.enum(['user', 'agent']),
  text: words,
  at: z.number().finite(),
  // The entry was also sent to the agent as a request.
  sent: z.boolean().optional(),
  // The board revision the entry was written at: what changed after it is the agent's answer to it.
  revision: z.number().int().positive().optional(),
});

const commentSchema = z.strictObject({
  id: commentId,
  anchor: anchorSchema,
  resolved: z.boolean(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  entries: z.array(entrySchema).min(1).max(COMMENT_LIMITS.entries),
});

export const commentsSchema = z.array(commentSchema).max(COMMENT_LIMITS.comments);
export const commentIdSchema = commentId;
export const commentInputSchema = z.strictObject({ anchor: anchorSchema, text: words, sent: z.boolean().optional() });
export const replyInputSchema = z.strictObject({ text: words, sent: z.boolean().optional() });

const invalid = (message) => new WhiteboardError('invalid', message, 400);

const entry = (text, actor, now, sent, revision) => {
  const value = { id: `ce_${token()}`, author: actor, text: text.trim(), at: now, revision };
  if (actor === 'user' && sent) value.sent = true;
  return value;
};

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * An area comment asks for something to be made in its area. When the agent
 * answers it, what it changed since the first unanswered entry must reach that area;
 * otherwise the answer is refused with where to put things, so the agent
 * moves them first. Answers after only deleting, or changing nothing, pass.
 */
const requirePlacedInArea = (board, comment) => {
  const { x, y, w, h } = comment.anchor;
  if (w === undefined || h === undefined) return;
  // The baseline is the first user entry the agent has not answered yet: only
  // the agent's own (checked) answer moves it, never a later note or a
  // client's claim that something was sent.
  const lastAnswer = comment.entries.map((item) => item.author).lastIndexOf('agent');
  const asked = comment.entries.slice(lastAnswer + 1).find((item) => item.author === 'user' && item.revision !== undefined);
  if (!asked) return;
  const area = { x, y, w, h };
  // Only what the agent itself changed counts: a box a person draws in the area meanwhile is not its answer.
  const agentMade = new Set(board.agentRevisions ?? []);
  const changedBoxes = board.elements.filter((element) => element.kind !== 'arrow' && element.rev > asked.revision && agentMade.has(element.rev));
  if (changedBoxes.length === 0 || changedBoxes.some((element) => overlaps(element, area))) return;
  throw invalid(`Comment ${comment.id} marks the area x ${x}, y ${y}, ${w} wide, ${h} high, and nothing you changed since it was asked is there. Move what you made so it starts inside that area (it may grow past it, without covering other elements), then reply again.`);
};

// A comment change is a change of the board: its revision moves, so every client reloads it.
const changed = (board, comments, now) => ({ ...board, comments, revision: board.revision + 1, updatedAt: now });

const commentsOf = (board) => board.comments ?? [];

const textHeld = (board) => commentsOf(board).reduce((total, comment) => total + comment.entries.reduce((sum, item) => sum + item.text.length, 0), 0);

const requireRoom = (board, text) => {
  if (textHeld(board) + text.trim().length > COMMENT_LIMITS.totalText) throw invalid('This board\'s comments are full; resolve and delete some first');
};

const findComment = (board, id) => {
  const comment = commentsOf(board).find((item) => item.id === id);
  if (!comment) throw new WhiteboardError('not-found', 'Comment not found', 404);
  return comment;
};

export const addComment = (board, input, { actor, now }) => {
  const parsed = commentInputSchema.safeParse(input);
  if (!parsed.success) throw invalid('Invalid comment');
  const { anchor, text, sent } = parsed.data;
  if (anchor.elementId && !board.elements.some((element) => element.id === anchor.elementId)) throw invalid('The comment points at an element that is not on the board');
  if (commentsOf(board).length >= COMMENT_LIMITS.comments) throw invalid(`A board keeps at most ${COMMENT_LIMITS.comments} comments; resolve and delete some first`);
  requireRoom(board, text);
  const comment = { id: `cm_${token()}`, anchor, resolved: false, createdAt: now, updatedAt: now, entries: [entry(text, actor, now, sent, board.revision + 1)] };
  return { board: changed(board, [...commentsOf(board), comment], now), commentId: comment.id };
};

export const replyToComment = (board, id, input, { actor, now }) => {
  const parsed = replyInputSchema.safeParse(input);
  if (!parsed.success) throw invalid('Invalid reply');
  const comment = findComment(board, id);
  if (comment.entries.length >= COMMENT_LIMITS.entries) throw invalid(`A comment keeps at most ${COMMENT_LIMITS.entries} replies`);
  requireRoom(board, parsed.data.text);
  if (actor === 'agent') requirePlacedInArea(board, comment);
  // Answering a resolved thread opens it again.
  const next = { ...comment, resolved: false, updatedAt: now, entries: [...comment.entries, entry(parsed.data.text, actor, now, parsed.data.sent, board.revision + 1)] };
  return { board: changed(board, commentsOf(board).map((item) => (item.id === id ? next : item)), now), commentId: id };
};

export const setCommentResolved = (board, id, resolved, { now }) => {
  if (typeof resolved !== 'boolean') throw invalid('Invalid comment state');
  const comment = findComment(board, id);
  const next = { ...comment, resolved, updatedAt: now };
  return { board: changed(board, commentsOf(board).map((item) => (item.id === id ? next : item)), now), commentId: id };
};

export const deleteComment = (board, id, { now }) => {
  findComment(board, id);
  return { board: changed(board, commentsOf(board).filter((item) => item.id !== id), now), commentId: id };
};
