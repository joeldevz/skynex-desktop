import { z } from 'zod';

/**
 * Workspace whiteboards as the server stores them
 * (docs/specs/workspace-whiteboards/contract.md). The UI and the agent tool
 * change a board through the same element operations; the server owns ids,
 * revisions and undo.
 */

export const WHITEBOARD_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink'] as const;
export type WhiteboardColor = (typeof WHITEBOARD_COLORS)[number];

export const BLOCK_FORMS = ['rect', 'rounded', 'diamond', 'database', 'pill'] as const;
export type BlockForm = (typeof BLOCK_FORMS)[number];

export const TEXT_SIZES = ['title', 'heading', 'body', 'small'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** How the lines of a box's text line up. Blocks default to center, notes and texts to start. */
export const TEXT_ALIGNS = ['start', 'center', 'end'] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

const colorSchema = z.enum(WHITEBOARD_COLORS);
const boxFields = {
  id: z.string().min(1),
  rev: z.number().int(),
  x: z.number().finite(),
  y: z.number().finite(),
  w: z.number().finite(),
  h: z.number().finite(),
  text: z.string(),
  color: colorSchema.optional(),
};

const elementSchema = z.discriminatedUnion('kind', [
  z.object({ ...boxFields, kind: z.literal('block'), form: z.enum(BLOCK_FORMS).optional(), size: z.enum(TEXT_SIZES).optional(), align: z.enum(TEXT_ALIGNS).optional() }),
  z.object({ ...boxFields, kind: z.literal('note'), size: z.enum(TEXT_SIZES).optional(), align: z.enum(TEXT_ALIGNS).optional() }),
  z.object({ ...boxFields, kind: z.literal('text'), size: z.enum(TEXT_SIZES).optional(), align: z.enum(TEXT_ALIGNS).optional() }),
  z.object({ ...boxFields, kind: z.literal('section') }),
  // A picture stored beside the board; `text` is its caption.
  z.object({ ...boxFields, kind: z.literal('image'), imageId: z.string().min(1) }),
  z.object({
    id: z.string().min(1), rev: z.number().int(), kind: z.literal('arrow'),
    from: z.string().min(1), to: z.string().min(1), text: z.string(), color: colorSchema.optional(),
  }),
]);

const commentSchema = z.object({
  id: z.string().min(1),
  /** The element the comment is pinned to and the point it keeps if that element goes, or an area (w, h from that point). */
  anchor: z.object({ elementId: z.string().min(1).optional(), x: z.number().finite(), y: z.number().finite(), w: z.number().finite().optional(), h: z.number().finite().optional() }),
  resolved: z.boolean(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  entries: z.array(z.object({
    id: z.string().min(1),
    author: z.enum(['user', 'agent']),
    text: z.string(),
    at: z.number().finite(),
    /** A user entry that was also sent to the agent as a request. */
    sent: z.boolean().optional(),
  })).min(1),
});

export const whiteboardSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  title: z.string(),
  revision: z.number().int(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  elements: z.array(elementSchema),
  lastChange: z.object({
    revision: z.number().int(),
    actor: z.enum(['user', 'agent']),
    elementIds: z.array(z.string()),
    at: z.number().finite(),
  }).nullable(),
  canUndo: z.boolean(),
  // A server from before comments sends none.
  comments: z.array(commentSchema).default([]),
});

export type Whiteboard = z.infer<typeof whiteboardSchema>;
export type WhiteboardElement = z.infer<typeof elementSchema>;
export type WhiteboardComment = z.infer<typeof commentSchema>;
export type CommentAnchor = WhiteboardComment['anchor'];
export type BoxElement = Exclude<WhiteboardElement, { kind: 'arrow' }>;
type BoxKind = BoxElement['kind'];
/** Boxes drawn with a tool; images come from a file instead. */
export type DrawnKind = Exclude<BoxKind, 'image'>;
export type ArrowElement = Extract<WhiteboardElement, { kind: 'arrow' }>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ElementInput = DistributiveOmit<WhiteboardElement, 'rev' | 'id'> & { id?: string };
export type ElementPatch = Partial<{
  x: number; y: number; w: number; h: number; text: string; color: WhiteboardColor;
  form: BlockForm; size: TextSize; align: TextAlign; from: string; to: string;
}>;

export type WhiteboardOp =
  | { op: 'add'; element: ElementInput }
  | { op: 'update'; id: string; set: ElementPatch }
  | { op: 'delete'; id: string };

export const isBox = (element: WhiteboardElement): element is BoxElement => element.kind !== 'arrow';

/** An added element as the server stores it. */
export const elementFromInput = (input: ElementInput, id: string, rev: number): WhiteboardElement => ({ ...input, id, rev });

/** An element with the fields of `set` its kind has; the others are ignored, as the server rejects them. */
export const patchElement = (element: WhiteboardElement, set: ElementPatch): WhiteboardElement => {
  if (element.kind === 'arrow') {
    return { ...element, from: set.from ?? element.from, to: set.to ?? element.to, text: set.text ?? element.text, color: set.color ?? element.color };
  }
  const box = {
    x: set.x ?? element.x, y: set.y ?? element.y, w: set.w ?? element.w, h: set.h ?? element.h,
    text: set.text ?? element.text, color: set.color ?? element.color,
  };
  if (element.kind === 'image') return { ...element, x: box.x, y: box.y, w: box.w, h: box.h, text: box.text };
  if (element.kind === 'block') return { ...element, ...box, form: set.form ?? element.form };
  if (element.kind === 'text') return { ...element, ...box, size: set.size ?? element.size };
  return { ...element, ...box };
};

export type Point = { x: number; y: number };
export type Rect = Point & { w: number; h: number };

export const rectsIntersect = (a: Rect, b: Rect): boolean => (
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
);

/** The rectangle around every box of the board, or null for an empty board. */
export const boardBounds = (elements: readonly WhiteboardElement[]): Rect | null => {
  const boxes = elements.filter(isBox);
  if (boxes.length === 0) return null;
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.w));
  const maxY = Math.max(...boxes.map((box) => box.y + box.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
};

type Side = 'left' | 'right' | 'top' | 'bottom';

/** An arrow drawn as straight runs with right-angle turns, the way diagrams are drawn by hand. */
export type ArrowRoute = {
  points: Point[];
  /** Where a label sits: the middle of the longest run. */
  label: Point;
  /** That run: its length, and whether it runs across (horizontal) or down. */
  labelRun: { length: number; horizontal: boolean };
};

const anchor = (box: Rect, side: Side, at?: number): Point => {
  if (side === 'left') return { x: box.x, y: at ?? box.y + box.h / 2 };
  if (side === 'right') return { x: box.x + box.w, y: at ?? box.y + box.h / 2 };
  if (side === 'top') return { x: at ?? box.x + box.w / 2, y: box.y };
  return { x: at ?? box.x + box.w / 2, y: box.y + box.h };
};

const crosses = (a: Point, b: Point, box: Rect): boolean => {
  // Runs are horizontal or vertical; a run crosses a box when it passes through its inside.
  const inset = 2;
  if (a.y === b.y) {
    return a.y > box.y + inset && a.y < box.y + box.h - inset && Math.max(a.x, b.x) > box.x + inset && Math.min(a.x, b.x) < box.x + box.w - inset;
  }
  return a.x > box.x + inset && a.x < box.x + box.w - inset && Math.max(a.y, b.y) > box.y + inset && Math.min(a.y, b.y) < box.y + box.h - inset;
};

type Candidate = { points: Point[]; fromSide: Side; toSide: Side; bends: number };

const candidates = (from: Rect, to: Rect): Candidate[] => {
  const fc = { x: from.x + from.w / 2, y: from.y + from.h / 2 };
  const tc = { x: to.x + to.w / 2, y: to.y + to.h / 2 };
  const horizontalSide: [Side, Side] = tc.x >= fc.x ? ['right', 'left'] : ['left', 'right'];
  const verticalSide: [Side, Side] = tc.y >= fc.y ? ['bottom', 'top'] : ['top', 'bottom'];
  const list: Candidate[] = [];
  const overlapY = Math.min(from.y + from.h, to.y + to.h) - Math.max(from.y, to.y);
  const overlapX = Math.min(from.x + from.w, to.x + to.w) - Math.max(from.x, to.x);
  const gapX = horizontalSide[0] === 'right' ? to.x - (from.x + from.w) : from.x - (to.x + to.w);
  const gapY = verticalSide[0] === 'bottom' ? to.y - (from.y + from.h) : from.y - (to.y + to.h);
  // Side by side: one straight run across the shared band, when the band is
  // a good part of both boxes. A sliver of overlap would draw a line hugging
  // their corners; a turn reads better there.
  const straightY = Math.max(24, Math.min(from.h, to.h) / 2);
  const straightX = Math.max(24, Math.min(from.w, to.w) / 2);
  if (overlapY >= straightY && gapX > 0) {
    const y = Math.max(from.y, to.y) + overlapY / 2;
    list.push({ points: [anchor(from, horizontalSide[0], y), anchor(to, horizontalSide[1], y)], fromSide: horizontalSide[0], toSide: horizontalSide[1], bends: 0 });
  }
  if (overlapX >= straightX && gapY > 0) {
    const x = Math.max(from.x, to.x) + overlapX / 2;
    list.push({ points: [anchor(from, verticalSide[0], x), anchor(to, verticalSide[1], x)], fromSide: verticalSide[0], toSide: verticalSide[1], bends: 0 });
  }
  // One turn: across then down, or down then across.
  const hStart = anchor(from, horizontalSide[0]);
  const hEnd = anchor(to, verticalSide[1]);
  if ((horizontalSide[0] === 'right' ? hEnd.x > hStart.x : hEnd.x < hStart.x) && (verticalSide[1] === 'top' ? hStart.y < hEnd.y : hStart.y > hEnd.y)) {
    list.push({ points: [hStart, { x: hEnd.x, y: hStart.y }, hEnd], fromSide: horizontalSide[0], toSide: verticalSide[1], bends: 1 });
  }
  const vStart = anchor(from, verticalSide[0]);
  const vEnd = anchor(to, horizontalSide[1]);
  if ((verticalSide[0] === 'bottom' ? vEnd.y > vStart.y : vEnd.y < vStart.y) && (horizontalSide[1] === 'left' ? vStart.x < vEnd.x : vStart.x > vEnd.x)) {
    list.push({ points: [vStart, { x: vStart.x, y: vEnd.y }, vEnd], fromSide: verticalSide[0], toSide: horizontalSide[1], bends: 1 });
  }
  // Two turns through the gap between them, when there is one.
  if (gapX > 16) {
    const midX = horizontalSide[0] === 'right' ? from.x + from.w + gapX / 2 : from.x - gapX / 2;
    const a = anchor(from, horizontalSide[0]);
    const b = anchor(to, horizontalSide[1]);
    list.push({ points: [a, { x: midX, y: a.y }, { x: midX, y: b.y }, b], fromSide: horizontalSide[0], toSide: horizontalSide[1], bends: 2 });
  }
  if (gapY > 16) {
    const midY = verticalSide[0] === 'bottom' ? from.y + from.h + gapY / 2 : from.y - gapY / 2;
    const a = anchor(from, verticalSide[0]);
    const b = anchor(to, verticalSide[1]);
    list.push({ points: [a, { x: a.x, y: midY }, { x: b.x, y: midY }, b], fromSide: verticalSide[0], toSide: verticalSide[1], bends: 2 });
  }
  if (list.length === 0) {
    // Overlapping boxes: a short straight run between their centers is all there is.
    list.push({ points: [fc, tc], fromSide: horizontalSide[0], toSide: horizontalSide[1], bends: 0 });
  }
  return list;
};

const labelPoint = (points: readonly Point[]): Pick<ArrowRoute, 'label' | 'labelRun'> => {
  let best = { length: -1, at: points[0], horizontal: true };
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (length > best.length) best = { length, at: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, horizontal: a.y === b.y };
  }
  return { label: best.at, labelRun: { length: best.length, horizontal: best.horizontal } };
};

/**
 * Routes every arrow of a board with straight runs and right-angle turns.
 * Each picks, among a straight run, one turn or two, the route that crosses
 * no other box, does not share a side another arrow already uses on the same
 * box, and turns least; arrows are routed in board order, so earlier ones
 * claim their sides first.
 */
export const routeArrows = (
  arrows: ReadonlyArray<{ id: string; from: string; to: string }>,
  /** Every box an arrow can end on, by id. */
  boxes: ReadonlyMap<string, Rect>,
  /** Boxes a route should go around; sections are containers, not in the way. */
  obstaclesOf: (id: string) => boolean = () => true,
): Map<string, ArrowRoute> => {
  const used = new Map<string, Set<Side>>();
  const usedOn = (id: string) => {
    let sides = used.get(id);
    if (!sides) {
      sides = new Set();
      used.set(id, sides);
    }
    return sides;
  };
  const routes = new Map<string, ArrowRoute>();
  for (const arrow of arrows) {
    const from = boxes.get(arrow.from);
    const to = boxes.get(arrow.to);
    if (!from || !to) continue;
    // Only boxes near the route can be in its way.
    const spanX = Math.min(from.x, to.x) - 40;
    const spanY = Math.min(from.y, to.y) - 40;
    const span = { x: spanX, y: spanY, w: Math.max(from.x + from.w, to.x + to.w) + 40 - spanX, h: Math.max(from.y + from.h, to.y + to.h) + 40 - spanY };
    const obstacles: Rect[] = [];
    for (const [id, box] of boxes) {
      if (id !== arrow.from && id !== arrow.to && obstaclesOf(id) && rectsIntersect(box, span)) obstacles.push(box);
    }
    let best: { candidate: Candidate; score: number } | null = null;
    for (const candidate of candidates(from, to)) {
      let score = candidate.bends;
      for (let i = 1; i < candidate.points.length; i += 1) {
        for (const box of obstacles) if (crosses(candidate.points[i - 1], candidate.points[i], box)) score += 10;
      }
      if (usedOn(arrow.from).has(candidate.fromSide)) score += 3;
      if (usedOn(arrow.to).has(candidate.toSide)) score += 3;
      if (!best || score < best.score) best = { candidate, score };
    }
    if (!best) continue;
    usedOn(arrow.from).add(best.candidate.fromSide);
    usedOn(arrow.to).add(best.candidate.toSide);
    routes.set(arrow.id, { points: best.candidate.points, ...labelPoint(best.candidate.points) });
  }
  return routes;
};

/** Routes for every arrow of a board, with boxes where they are drawn; sections are never in the way. */
export const routeBoard = (elements: readonly WhiteboardElement[], rectOf: (element: BoxElement) => Rect = (element) => element): Map<string, ArrowRoute> => {
  const boxRects = new Map<string, Rect>();
  const sections = new Set<string>();
  for (const element of elements) {
    if (!isBox(element)) continue;
    boxRects.set(element.id, rectOf(element));
    if (element.kind === 'section') sections.add(element.id);
  }
  return routeArrows(elements.filter((element): element is ArrowElement => element.kind === 'arrow'), boxRects, (id) => !sections.has(id));
};

const TITLE_FROM_REQUEST = 60;

/**
 * A board title from what the user asked to draw: its first line, cut at a
 * word within 60 characters. "el flujo de login con 2FA" is already a title.
 */
export const boardTitleFrom = (request: string): string => {
  const line = request.split('\n').map((entry) => entry.trim().replace(/\s+/g, ' ')).find(Boolean) ?? '';
  if (line.length <= TITLE_FROM_REQUEST) return line;
  const cut = line.slice(0, TITLE_FROM_REQUEST);
  const space = cut.lastIndexOf(' ');
  return `${(space > TITLE_FROM_REQUEST / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:]+$/, '')}…`;
};

/**
 * The elements worth drawing for a view of the board: boxes that touch it,
 * arrows whose ends span it, and always the ones in `keep` (selected,
 * edited, dragged), so interaction never loses what it holds. The rest stay
 * out of the DOM until the view reaches them.
 */
export const elementsInView = (
  elements: readonly WhiteboardElement[],
  view: Rect,
  rectOf: (element: BoxElement) => Rect,
  keep: ReadonlySet<string>,
): WhiteboardElement[] => {
  const boxes = new Map<string, Rect>();
  for (const element of elements) if (isBox(element)) boxes.set(element.id, rectOf(element));
  return elements.filter((element) => {
    if (keep.has(element.id)) return true;
    if (element.kind !== 'arrow') {
      const rect = boxes.get(element.id);
      return rect ? rectsIntersect(rect, view) : false;
    }
    const from = boxes.get(element.from);
    const to = boxes.get(element.to);
    if (!from || !to) return false;
    // A curve stays within the box spanning its two ends, give or take its bend.
    const x = Math.min(from.x, to.x) - 48;
    const y = Math.min(from.y, to.y) - 48;
    const span = { x, y, w: Math.max(from.x + from.w, to.x + to.w) + 48 - x, h: Math.max(from.y + from.h, to.y + to.h) + 48 - y };
    return rectsIntersect(span, view);
  });
};

/**
 * What the agent reads with a request made from the board: which board, and
 * the elements the user pointed at by id and text, so a change lands on them
 * without the user describing them.
 */
export const describeSelectionForAgent = (board: Whiteboard, selectedIds: readonly string[]): string => {
  const byId = new Map(board.elements.map((element) => [element.id, element]));
  const selected = selectedIds.map((id) => byId.get(id)).filter((element): element is WhiteboardElement => Boolean(element));
  const lines = [
    `Whiteboard "${board.title}" (boardId ${board.id}, workspace ${board.workspaceId}, revision ${board.revision}). Use the skynex_whiteboard tool to read and change it.`,
  ];
  if (selected.length === 0) {
    lines.push('Nothing on the board is selected: the request is about the whole board.');
  } else {
    lines.push('The request is about these selected elements:');
    for (const element of selected) {
      const text = element.text.trim().replace(/\s+/g, ' ').slice(0, 160);
      lines.push(element.kind === 'arrow'
        ? `- ${element.id} (arrow ${element.from} -> ${element.to})${text ? `: ${text}` : ''}`
        : `- ${element.id} (${element.kind})${text ? `: ${text}` : ''}`);
    }
  }
  return lines.join('\n');
};
