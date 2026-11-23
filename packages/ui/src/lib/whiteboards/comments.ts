import { plainText } from './richText';
import { isBox, rectsIntersect, type BoxElement, type CommentAnchor, type Point, type Rect, type WhiteboardComment, type WhiteboardElement } from './model';

/** The area a comment marks, when it marks one. */
export const commentArea = (comment: Pick<WhiteboardComment, 'anchor'>): Rect | null => {
  const { x, y, w, h } = comment.anchor;
  return w !== undefined && h !== undefined ? { x, y, w, h } : null;
};

/**
 * Where a comment's marker sits: the top-right corner of the element it is
 * pinned to, as drawn now, or the point it was put at when it has no element
 * or its element is gone.
 */
export const commentPoint = (
  comment: Pick<WhiteboardComment, 'anchor'>,
  elementsById: ReadonlyMap<string, WhiteboardElement>,
  rectOf: (element: BoxElement) => Rect,
): Point => {
  const area = commentArea(comment);
  // An area's marker sits by its bottom-right corner, where its card opens.
  if (area) return { x: area.x + area.w, y: area.y + area.h };
  const element = comment.anchor.elementId ? elementsById.get(comment.anchor.elementId) : undefined;
  if (element && isBox(element)) {
    const rect = rectOf(element);
    return { x: rect.x + rect.w, y: rect.y };
  }
  return { x: comment.anchor.x, y: comment.anchor.y };
};

/** The anchor of a new comment on what is selected: one box pins it to that box, anything else to a point. */
export const anchorForSelection = (selected: readonly WhiteboardElement[], bounds: Rect | null): CommentAnchor | null => {
  const [only] = selected;
  if (selected.length === 1 && only && isBox(only)) return { elementId: only.id, x: only.x + only.w, y: only.y };
  if (!bounds) return null;
  return { x: bounds.x + bounds.w, y: bounds.y };
};

/** What a comment is about, for the line above its text: a named element, a section and what it holds, a group, an area, or a point. */
export type CommentTarget =
  | { kind: 'element'; elementKind: WhiteboardElement['kind']; name: string; contains: number }
  | { kind: 'group'; count: number }
  | { kind: 'area'; contains: number }
  | { kind: 'point' };

export const describeCommentTarget = (selected: readonly WhiteboardElement[], elements: readonly WhiteboardElement[], area: Rect | null = null): CommentTarget => {
  if (area) return { kind: 'area', contains: selected.length };
  const [only] = selected;
  if (selected.length === 0 || !only) return { kind: 'point' };
  if (selected.length > 1) return { kind: 'group', count: selected.length };
  const name = plainText(only.text).split('\n').find((line) => line.trim())?.trim() ?? '';
  const contains = only.kind === 'section'
    ? elements.filter((element) => element.id !== only.id && isBox(element) && rectsIntersect(element, only)
      && element.x >= only.x && element.y >= only.y && element.x + element.w <= only.x + only.w && element.y + element.h <= only.y + only.h).length
    : 0;
  return { kind: 'element', elementKind: only.kind, name: name.length > 60 ? `${name.slice(0, 59)}…` : name, contains };
};

/** Whether the agent has answered since the thread had `entries` entries. */
export const agentAnsweredSince = (comment: WhiteboardComment, entries: number): boolean => (
  comment.entries.slice(entries).some((entry) => entry.author === 'agent')
);

/** The boxes inside an area: what a comment on that area is about. */
export const boxesInside = (elements: readonly WhiteboardElement[], area: Rect): WhiteboardElement[] => elements.filter((element) => isBox(element)
  && element.x >= area.x && element.y >= area.y && element.x + element.w <= area.x + area.w && element.y + element.h <= area.y + area.h);
