import { randomBytes } from 'node:crypto';
import { z } from 'zod';

export const WHITEBOARD_LIMITS = Object.freeze({ elements: 800, ops: 400, history: 30, text: 4000 });
const color = z.enum(['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink']);
const id = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const common = { id: id.optional(), text: z.string().max(WHITEBOARD_LIMITS.text), color: color.optional() };
const size = z.enum(['title', 'heading', 'body', 'small']);
// How the lines of a box's text line up; each kind has its own default (blocks center, notes and texts start).
const align = z.enum(['start', 'center', 'end']);
const xywh = { x: z.number().finite().min(-1_000_000).max(1_000_000), y: z.number().finite().min(-1_000_000).max(1_000_000), w: z.number().finite().min(8).max(20_000), h: z.number().finite().min(8).max(20_000) };
const elementInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...common, kind: z.literal('block'), ...xywh, form: z.enum(['rect', 'rounded', 'diamond', 'database', 'pill']).optional(), size: size.optional(), align: align.optional() }),
  z.strictObject({ ...common, kind: z.literal('note'), ...xywh, size: size.optional(), align: align.optional() }),
  z.strictObject({ ...common, kind: z.literal('text'), ...xywh, size: size.optional(), align: align.optional() }),
  z.strictObject({ ...common, kind: z.literal('section'), ...xywh }),
  z.strictObject({ id: id.optional(), kind: z.literal('arrow'), from: id, to: id, text: z.string().max(WHITEBOARD_LIMITS.text), color: color.optional() }),
  // A picture stored beside the board (images.js); `text` is its caption.
  z.strictObject({ id: id.optional(), kind: z.literal('image'), ...xywh, imageId: z.string().regex(/^img_[a-f0-9]{24}$/), text: z.string().max(WHITEBOARD_LIMITS.text) }),
]);
const elementSchema = z.discriminatedUnion('kind', elementInputSchema.options.map((schema) => schema.extend({ id: id, rev: z.number().int().positive() })));
const opSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('add'), element: elementInputSchema }),
  z.strictObject({ op: z.literal('update'), id, set: z.union([
    z.strictObject({ text: z.string().max(WHITEBOARD_LIMITS.text).optional(), color: color.optional(), x: xywh.x.optional(), y: xywh.y.optional(), w: xywh.w.optional(), h: xywh.h.optional(), form: z.enum(['rect', 'rounded', 'diamond', 'database', 'pill']).optional(), size: size.optional(), align: align.optional() }),
    z.strictObject({ text: z.string().max(WHITEBOARD_LIMITS.text).optional(), color: color.optional(), from: id.optional(), to: id.optional() }),
  ]) }),
  z.strictObject({ op: z.literal('delete'), id }),
]);

export class WhiteboardError extends Error {
  constructor(code, message, status = 400, board) {
    super(message);
    this.name = 'WhiteboardError';
    this.code = code;
    this.status = status;
    if (board) this.board = board;
  }
}

const invalid = (message = 'Invalid whiteboard data') => new WhiteboardError('invalid', message, 400);
export const createBoardId = () => `wb_${randomBytes(12).toString('hex')}`;
export const createElementId = () => `el_${randomBytes(7).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '0').slice(0, 10)}`;
export const parseElementInput = (value) => {
  const parsed = elementInputSchema.safeParse(value);
  if (!parsed.success) throw invalid();
  return parsed.data;
};
export const validateBoard = (board) => {
  if (!board || !Array.isArray(board.elements) || board.elements.length > WHITEBOARD_LIMITS.elements) throw invalid('Malformed whiteboard');
  const parsed = board.elements.map((element) => elementSchema.safeParse(element));
  if (parsed.some((result) => !result.success)) throw invalid('Malformed whiteboard');
  const ids = new Set(parsed.map(({ data }) => data.id));
  if (ids.size !== parsed.length || parsed.some(({ data }) => data.kind === 'arrow' && (!ids.has(data.from) || !ids.has(data.to)))) throw invalid('Malformed whiteboard');
  validateArrowTargets(parsed.map(({ data }) => data));
  return { ...board, elements: parsed.map(({ data }) => data), history: Array.isArray(board.history) ? board.history.slice(-WHITEBOARD_LIMITS.history) : [] };
};

const validateArrowTargets = (elements) => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  if (elements.some((element) => element.kind === 'arrow' && (byId.get(element.from)?.kind === 'arrow' || byId.get(element.to)?.kind === 'arrow' || !byId.has(element.from) || !byId.has(element.to)))) throw invalid('Arrows must connect existing non-arrow elements');
};
const publicBoard = (board) => {
  const { history, comments, agentRevisions: _agentRevisions, ...visible } = board;
  // Boards stored before comments existed have none.
  return { ...visible, comments: comments ?? [], canUndo: history.length > 0 };
};

export const applyOps = (source, ops, { baseRevision, actor, confirmReplace = false, now = Date.now() }) => {
  const board = validateBoard(source);
  if (!Number.isInteger(baseRevision) || !Array.isArray(ops) || ops.length > WHITEBOARD_LIMITS.ops || !['user', 'agent'].includes(actor)) throw invalid();
  if (baseRevision > board.revision) throw new WhiteboardError('conflict', 'Board revision is newer than the stored board', 409, publicBoard(board));
  const elements = board.elements.map((item) => ({ ...item }));
  const existingIds = new Set(elements.map(({ id: elementId }) => elementId));
  const deletedExistingIds = new Set();
  const before = new Map();
  const touched = new Set();
  const elementIds = [];
  for (const raw of ops) {
    const parsed = opSchema.safeParse(raw);
    if (!parsed.success) throw invalid();
    const op = parsed.data;
    if (op.op === 'add') {
      const value = parseElementInput(op.element);
      const elementId = value.id ?? createElementId();
      if (elements.some((item) => item.id === elementId)) throw invalid('Element id already exists');
      if (value.kind === 'arrow' && !elements.some((item) => item.id === value.from && item.kind !== 'arrow') || value.kind === 'arrow' && !elements.some((item) => item.id === value.to && item.kind !== 'arrow')) throw invalid('Arrows must reference existing non-arrow elements');
      elements.push({ ...value, id: elementId, rev: board.revision + 1 });
      before.set(elementId, { before: null, index: elements.length - 1 }); touched.add(elementId); elementIds.push(elementId);
    } else if (op.op === 'update') {
      const index = elements.findIndex((item) => item.id === op.id);
      if (index < 0) throw new WhiteboardError('not-found', 'Element not found', 404);
      if (elements[index].rev > baseRevision) throw new WhiteboardError('conflict', 'Element changed since it was read', 409, publicBoard(board));
      if (!before.has(op.id)) before.set(op.id, { before: { ...elements[index] }, index });
      const next = { ...elements[index], ...op.set, rev: board.revision + 1 };
      const legal = next.kind === 'image' ? ['id', 'kind', 'rev', 'x', 'y', 'w', 'h', 'text', 'imageId'] : next.kind === 'block' ? ['id', 'kind', 'rev', 'x', 'y', 'w', 'h', 'text', 'color', 'form', 'size', 'align'] : next.kind === 'text' || next.kind === 'note' ? ['id', 'kind', 'rev', 'x', 'y', 'w', 'h', 'text', 'color', 'size', 'align'] : next.kind === 'arrow' ? ['id', 'kind', 'rev', 'from', 'to', 'text', 'color'] : ['id', 'kind', 'rev', 'x', 'y', 'w', 'h', 'text', 'color'];
      if (Object.keys(next).some((key) => !legal.includes(key)) || !elementSchema.safeParse(next).success) throw invalid();
      elements[index] = next; touched.add(op.id); elementIds.push(op.id);
    } else {
      const target = elements.find((item) => item.id === op.id);
      if (!target) throw new WhiteboardError('not-found', 'Element not found', 404);
      if (target.rev > baseRevision) throw new WhiteboardError('conflict', 'Element changed since it was read', 409, publicBoard(board));
      if (existingIds.has(op.id)) deletedExistingIds.add(op.id);
      for (const item of elements.filter((candidate) => candidate.id === op.id || (candidate.kind === 'arrow' && (candidate.from === op.id || candidate.to === op.id)))) {
        if (item.rev > baseRevision) throw new WhiteboardError('conflict', 'Element changed since it was read', 409, publicBoard(board));
        if (!before.has(item.id)) before.set(item.id, { before: { ...item }, index: elements.indexOf(item) });
        touched.add(item.id); elementIds.push(item.id);
      }
      for (let i = elements.length - 1; i >= 0; i -= 1) if (touched.has(elements[i].id) && (elements[i].id === op.id || elements[i].kind === 'arrow' && (elements[i].from === op.id || elements[i].to === op.id))) elements.splice(i, 1);
    }
    if (elements.length > WHITEBOARD_LIMITS.elements) throw invalid('A board can contain at most 800 elements');
  }
  if (board.elements.length >= 3 && deletedExistingIds.size === existingIds.size && !confirmReplace) throw new WhiteboardError('needs-confirmation', 'Deleting every element requires confirmReplace: true', 409, publicBoard(board));
  validateArrowTargets(elements);
  const revision = board.revision + 1;
  const nextBoard = { ...board, revision, updatedAt: now, elements, lastChange: { revision, actor, elementIds: [...new Set(elementIds)], at: now }, history: [...board.history, { revision, before: [...before.entries()].map(([elementId, previous]) => ({ id: elementId, ...previous, expectedPresent: elements.some((item) => item.id === elementId) })) }].slice(-WHITEBOARD_LIMITS.history) };
  return { board: nextBoard, inverse: nextBoard.history.at(-1), elementIds: nextBoard.lastChange.elementIds };
};

export const undoLast = (source, { now = Date.now(), actor = 'user' } = {}) => {
  const board = validateBoard(source);
  const inverse = board.history.at(-1);
  if (!inverse) throw new WhiteboardError('conflict', 'Nothing to undo', 409, publicBoard(board));
  const elements = board.elements.map((element) => ({ ...element }));
  for (const entry of inverse.before) {
    const currentIndex = elements.findIndex(({ id: elementId }) => elementId === entry.id);
    const current = currentIndex < 0 ? null : elements[currentIndex];
    if ((current !== null) !== entry.expectedPresent) throw new WhiteboardError('conflict', 'Element changed after the recorded change', 409, publicBoard(board));
    if (current && current.rev !== inverse.revision) throw new WhiteboardError('conflict', 'Element changed after the recorded change', 409, publicBoard(board));
    if (entry.before === null) {
      if (currentIndex >= 0) elements.splice(currentIndex, 1);
    } else {
      const restored = { ...entry.before, rev: board.revision + 1 };
      if (currentIndex >= 0) elements[currentIndex] = restored;
      else elements.splice(Math.min(entry.index, elements.length), 0, restored);
    }
  }
  validateArrowTargets(elements);
  const revision = board.revision + 1;
  const next = { ...board, revision, updatedAt: now, elements, history: board.history.slice(0, -1), lastChange: { revision, actor, elementIds: inverse.before.map(({ id: elementId }) => elementId), at: now } };
  return { board: next, elementIds: next.lastChange.elementIds };
};

// An arrow's label is drawn on its line, about 6.5 board units per character
// up to 220, plus room for the arrowhead and the gaps at both ends.
const LABEL_UNITS_PER_CHAR = 6.5;
const LABEL_MAX = 220;
const ARROW_ENDS = 48;
const LABEL_HEIGHT_ROOM = 60;

/**
 * Labelled arrows whose boxes sit too close for the label to show beside the
 * line, among those touching `ids` (all arrows when none are given). The
 * agent reads these after it writes and moves the boxes apart; the user's
 * own layout is never moved for them.
 */
export const crowdedArrowLabels = (elements, ids) => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  const touched = ids ? new Set(ids) : null;
  const crowded = [];
  for (const arrow of elements) {
    if (arrow.kind !== 'arrow' || !arrow.text.trim()) continue;
    if (touched && !touched.has(arrow.id) && !touched.has(arrow.from) && !touched.has(arrow.to)) continue;
    const from = byId.get(arrow.from);
    const to = byId.get(arrow.to);
    if (!from || !to || from.kind === 'arrow' || to.kind === 'arrow') continue;
    const overlapY = Math.min(from.y + from.h, to.y + to.h) - Math.max(from.y, to.y);
    const overlapX = Math.min(from.x + from.w, to.x + to.w) - Math.max(from.x, to.x);
    const gapX = Math.max(to.x - (from.x + from.w), from.x - (to.x + to.w));
    const gapY = Math.max(to.y - (from.y + from.h), from.y - (to.y + to.h));
    // Side by side the label lies along the line; one above the other it sits across it.
    const across = overlapY > 0 && gapX >= 0 ? 'x' : overlapX > 0 && gapY >= 0 ? 'y' : null;
    if (!across) continue;
    const label = Math.min(LABEL_MAX, arrow.text.trim().length * LABEL_UNITS_PER_CHAR);
    const needed = Math.ceil(across === 'x' ? label + ARROW_ENDS : LABEL_HEIGHT_ROOM);
    const gap = across === 'x' ? gapX : gapY;
    if (gap < needed) crowded.push({ arrowId: arrow.id, from: arrow.from, to: arrow.to, text: arrow.text.trim(), gap: Math.round(gap), needed, axis: across });
  }
  return crowded;
};

/** What the agent is told about crowded labels, one line per arrow. */
export const describeCrowdedLabels = (crowded) => crowded.map(({ arrowId, from, to, text, gap, needed, axis }) => (
  `Arrow ${arrowId} ("${text}") from ${from} to ${to}: its label needs about ${needed} units ${axis === 'x' ? 'across' : 'down'} between the boxes, they are ${gap} apart. Move ${to} ${axis === 'x' ? 'sideways' : 'down'} (and what follows it) by at least ${needed - gap}.`
));

export const publicWhiteboard = publicBoard;
export const whiteboardSchemas = Object.freeze({ elementInputSchema, elementSchema, opSchema });
