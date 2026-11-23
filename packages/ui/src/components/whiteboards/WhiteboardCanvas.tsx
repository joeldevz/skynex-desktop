import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { toast } from '@/components/ui';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { stopAgentOnBoard, type WhiteboardAskOutcome } from '@/lib/whiteboards/ask';
import {
  routeBoard,
  boardBounds,
  isBox,
  rectsIntersect,
  type BlockForm,
  type BoxElement,
  type DrawnKind,
  type Point,
  type Rect,
  type CommentAnchor,
  type TextAlign,
  type TextSize,
  type Whiteboard,
  type WhiteboardComment,
  type WhiteboardColor,
  type WhiteboardElement,
  type WhiteboardOp,
} from '@/lib/whiteboards/model';
import { uploadWhiteboardImage } from '@/lib/whiteboards/api';
import { useWhiteboardsStore, type WhiteboardChangeOutcome } from '@/stores/useWhiteboardsStore';
import { AskBox, SelectionBar, ToolDock, WorkingPill, ZoomControls, type CanvasTool } from './WhiteboardChrome';
import { CommentComposer, CommentMarkers, CommentsButton, CommentsPanel, CommentThread } from './WhiteboardComments';
import { commentTargetLabel } from './commentText';
import { agentAnsweredSince, anchorForSelection, boxesInside, commentArea, commentPoint, describeCommentTarget } from '@/lib/whiteboards/comments';
import { WhiteboardScene } from './WhiteboardScene';
import { boxFontSize, boxTextStyle, textAlignOf } from './whiteboardText';
import { WhiteboardTextEditor, type TextEditorHandle } from './WhiteboardTextEditor';
import { isRichTextElement, NO_FORMAT, type TextFormatState } from './textEditing';
import { hasMark, isBulleted, toggleBullets, toggleMark } from '@/lib/whiteboards/richText';
import { openExternalUrl } from '@/lib/url';

type View = { x: number; y: number; zoom: number };
type Corner = 'nw' | 'ne' | 'sw' | 'se';

type Drag =
  | { kind: 'pan'; start: Point; view: View }
  | { kind: 'move'; start: Point; origins: Map<string, Rect>; moved: boolean }
  | { kind: 'resize'; id: string; corner: Corner; start: Point; origin: Rect }
  | { kind: 'marquee'; start: Point; base: ReadonlySet<string> }
  | { kind: 'create'; tool: DrawnKind; start: Point }
  | { kind: 'comment'; start: Point; boxId: string | null };

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const FIT_PADDING = 56;
const MIN_SIZE = 24;
// How long the asked-about area stays marked while nothing comes back.
const ASK_WAIT_MS = 180_000;
// How long what the agent just changed stays lit.
const FLASH_MS = 8_000;
const CORNERS: readonly Corner[] = ['nw', 'ne', 'sw', 'se'];

const DEFAULT_SIZE = {
  block: { w: 200, h: 80 },
  note: { w: 200, h: 160 },
  text: { w: 320, h: 44 },
  section: { w: 520, h: 340 },
} satisfies Record<DrawnKind, { w: number; h: number }>;

// A picture lands at most this wide and tall, in board units; larger ones are scaled down to fit.
const IMAGE_MAX_SIDE = 480;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

const newElementId = (): string => `el_${Math.random().toString(36).slice(2, 12).padEnd(10, '0')}`;

const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

const normalizeRect = (a: Point, b: Point): Rect => ({
  x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
});

const containsRect = (outer: Rect, inner: Rect): boolean => (
  inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h
);

const fitView = (bounds: Rect, width: number, height: number, maxZoom = 1.2): View => {
  const zoom = clampZoom(Math.min(
    (width - FIT_PADDING * 2) / Math.max(bounds.w, 1),
    (height - FIT_PADDING * 2) / Math.max(bounds.h, 1),
    maxZoom,
  ));
  return {
    zoom,
    x: bounds.x - (width / zoom - bounds.w) / 2,
    y: bounds.y - (height / zoom - bounds.h) / 2,
  };
};

const resizeFrom = (origin: Rect, corner: Corner, dx: number, dy: number): Rect => {
  const west = corner === 'nw' || corner === 'sw';
  const north = corner === 'nw' || corner === 'ne';
  const w = Math.max(MIN_SIZE, west ? origin.w - dx : origin.w + dx);
  const h = Math.max(MIN_SIZE, north ? origin.h - dy : origin.h + dy);
  return {
    x: west ? origin.x + origin.w - w : origin.x,
    y: north ? origin.y + origin.h - h : origin.y,
    w,
    h,
  };
};

const firstOfKind = <K extends WhiteboardElement['kind']>(elements: readonly WhiteboardElement[], kind: K): Extract<WhiteboardElement, { kind: K }> | undefined => {
  return elements.find((element): element is Extract<WhiteboardElement, { kind: K }> => element.kind === kind);
};

const elementColor = (element: WhiteboardElement): WhiteboardColor => element.color ?? (element.kind === 'note' ? 'yellow' : 'gray');

/**
 * The board itself: pan, zoom, select, move, resize, add, connect, edit text,
 * recolor, delete and undo, and a request box that hands the selection to the
 * agent. Every change goes through the store, which shows it at once and sends
 * it to the server as element operations against the revision on screen.
 */
export function WhiteboardCanvas({ board, onAsk, firstAsk, compact = false }: {
  board: Whiteboard;
  /** Sends a request to the agent; from a comment, it names the comment so the agent answers in its thread. */
  onAsk?: (text: string, selectedIds: string[], commentId?: string) => Promise<WhiteboardAskOutcome>;
  /** A request made when the board was created, sent once the board is on screen, as if typed in its request box. */
  firstAsk?: { text: string; onSent: () => void };
  compact?: boolean;
}) {
  const { t } = useI18n();
  const applyOps = useWhiteboardsStore((state) => state.applyOps);
  const undoBoard = useWhiteboardsStore((state) => state.undo);
  const { confirm, dialog } = useConfirmDialog();

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const [size, setSize] = React.useState({ width: 0, height: 0 });
  const [view, setView] = React.useState<View>({ x: 0, y: 0, zoom: 1 });
  const [tool, setTool] = React.useState<CanvasTool>('select');
  const [selection, setSelection] = React.useState<ReadonlySet<string>>(new Set());
  const [preview, setPreview] = React.useState<ReadonlyMap<string, Rect>>(new Map());
  const [marquee, setMarquee] = React.useState<Rect | null>(null);
  const [draft, setDraft] = React.useState<Rect | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editingText, setEditingText] = React.useState('');
  const [arrowFrom, setArrowFrom] = React.useState<string | null>(null);
  const [askOpen, setAskOpen] = React.useState(false);
  // A request the agent is working on; one from a comment waits for the agent's answer in that thread.
  const [asking, setAsking] = React.useState<{ revision: number; area: Rect | null; at: number; sessionId: string; comment?: { id: string; entries: number } } | null>(null);
  const [openCommentId, setOpenCommentId] = React.useState<string | null>(null);
  const [commentDraft, setCommentDraft] = React.useState<{ anchor: CommentAnchor; selectedIds: string[] } | null>(null);
  const [commentsOpen, setCommentsOpen] = React.useState(false);
  // The area being marked with the comment tool.
  const [commentRect, setCommentRect] = React.useState<Rect | null>(null);
  const [showResolved, setShowResolved] = React.useState(false);
  const addComment = useWhiteboardsStore((state) => state.addComment);
  const replyToComment = useWhiteboardsStore((state) => state.replyToComment);
  const resolveComment = useWhiteboardsStore((state) => state.resolveComment);
  const removeComment = useWhiteboardsStore((state) => state.deleteComment);
  const focusedComment = useWhiteboardsStore((state) => state.focusedComment);
  const [flash, setFlash] = React.useState<ReadonlySet<string>>(new Set());
  const dragRef = React.useRef<Drag | null>(null);
  // Fingers on the board, for a two-finger pinch; and the last tap, for a double tap.
  const touchesRef = React.useRef(new Map<number, Point>());
  const pinchRef = React.useRef<{ distance: number; center: Point; view: View } | null>(null);
  const lastTapRef = React.useRef<{ id: string; at: number } | null>(null);
  // The press that opened an editor must not take focus from it.
  const keepEditorFocusRef = React.useRef(false);
  const fittedBoardRef = React.useRef<string | null>(null);
  const seenRevisionRef = React.useRef(board.revision);

  // What is on screen is drawn from a deferred copy of the view: a pan moves
  // the board at once, and the elements entering it follow a beat later at
  // lower priority, with half a screen of margin so the edges are never bare.
  // The drawn area snaps to a coarse grid (quarter screens, zoom by halves),
  // so a pan redraws the scene only when it crosses a step, not every frame.
  const deferredView = React.useDeferredValue(view);
  const zoomStep = 2 ** Math.floor(Math.log2(deferredView.zoom));
  const stepW = size.width / zoomStep;
  const stepH = size.height / zoomStep;
  const cellX = stepW > 0 ? Math.floor(deferredView.x / (stepW / 4)) : 0;
  const cellY = stepH > 0 ? Math.floor(deferredView.y / (stepH / 4)) : 0;
  const allBounds = React.useMemo(() => boardBounds(board.elements), [board.elements]);
  const visibleRect = React.useMemo(() => {
    if (stepW === 0 || stepH === 0 || !allBounds) return null;
    // Half a screen (at the lower zoom step, so at least that) on every side of the view.
    const rect = { x: cellX * (stepW / 4) - stepW / 2, y: cellY * (stepH / 4) - stepH / 2, w: stepW * 2.25, h: stepH * 2.25 };
    // A board that fits in it is drawn whole: nothing to leave out, nothing to recompute.
    const fits = allBounds.x >= rect.x && allBounds.y >= rect.y && allBounds.x + allBounds.w <= rect.x + rect.w && allBounds.y + allBounds.h <= rect.y + rect.h;
    return fits ? null : rect;
  }, [allBounds, cellX, cellY, stepH, stepW]);

  const elementsById = React.useMemo(() => new Map(board.elements.map((element) => [element.id, element])), [board.elements]);
  const rectOf = React.useCallback((element: BoxElement): Rect => preview.get(element.id) ?? element, [preview]);

  // Selection follows the board: an element another client deleted leaves it.
  React.useEffect(() => {
    setSelection((current) => {
      const kept = [...current].filter((id) => elementsById.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [elementsById]);

  React.useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const update = () => setSize({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const fitTo = React.useCallback((bounds: Rect | null, maxZoom?: number) => {
    if (!bounds || size.width === 0 || size.height === 0) return;
    setView(fitView(bounds, size.width, size.height, maxZoom));
  }, [size.height, size.width]);

  // Opening a board shows all of it, so nothing waits out of sight.
  React.useLayoutEffect(() => {
    if (size.width === 0 || fittedBoardRef.current === board.id) return;
    const bounds = boardBounds(board.elements);
    if (bounds) fitTo(bounds);
    else setView({ x: -size.width / 2, y: -size.height / 2, zoom: 1 });
    fittedBoardRef.current = board.id;
  }, [board.elements, board.id, fitTo, size.height, size.width]);

  const lastChangeBounds = React.useMemo(() => {
    const ids = new Set(board.lastChange?.elementIds ?? []);
    return boardBounds(board.elements.filter((element) => ids.has(element.id)));
  }, [board.elements, board.lastChange]);

  // What the agent changes lights up for a moment, so the eye finds it.
  React.useEffect(() => {
    const change = board.lastChange;
    if (!change || change.revision <= seenRevisionRef.current) return undefined;
    seenRevisionRef.current = change.revision;
    if (change.actor !== 'agent' || change.elementIds.length === 0) return undefined;
    setFlash(new Set(change.elementIds));
    const timer = window.setTimeout(() => setFlash(new Set()), FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [board.lastChange]);

  // The agent answered a request from this board: show what it changed.
  React.useEffect(() => {
    if (!asking || !board.lastChange || board.lastChange.actor !== 'agent' || board.lastChange.revision <= asking.revision) return;
    // A request from a comment is done when the agent answers in its thread; its edits only show where it worked.
    setAsking(asking.comment ? { ...asking, revision: board.lastChange.revision } : null);
    if (lastChangeBounds) fitTo(lastChangeBounds, 1);
  }, [asking, board.lastChange, fitTo, lastChangeBounds]);
  React.useEffect(() => {
    const comment = asking?.comment ? board.comments.find((item) => item.id === asking.comment?.id) : undefined;
    if (asking?.comment && (!comment || agentAnsweredSince(comment, asking.comment.entries))) setAsking(null);
  }, [asking, board.comments]);
  React.useEffect(() => {
    if (!asking) return undefined;
    const timer = window.setTimeout(() => setAsking(null), Math.max(0, asking.at + ASK_WAIT_MS - Date.now()));
    return () => window.clearTimeout(timer);
  }, [asking]);

  /** Brings a comment's area, element or point into view. */
  const showComment = React.useCallback((comment: WhiteboardComment) => {
    const area = commentArea(comment);
    const element = comment.anchor.elementId ? elementsById.get(comment.anchor.elementId) : undefined;
    if (area) fitTo(area, 1);
    else if (element && isBox(element)) fitTo(element, 1);
    else fitTo({ x: comment.anchor.x - 160, y: comment.anchor.y - 120, w: 320, h: 240 }, 1);
  }, [elementsById, fitTo]);

  // "View thread" in the chat: open that comment here once, with its marker in view.
  React.useEffect(() => {
    if (!focusedComment || focusedComment.boardId !== board.id || size.width === 0) return;
    const comment = board.comments.find((item) => item.id === focusedComment.commentId);
    useWhiteboardsStore.getState().focusComment(null);
    if (!comment) return;
    showComment(comment);
    setCommentDraft(null);
    setOpenCommentId(comment.id);
  }, [board.comments, board.id, focusedComment, showComment, size.width]);

  const toBoard = React.useCallback((clientX: number, clientY: number): Point => {
    const rect = containerRef.current?.getBoundingClientRect();
    return {
      x: view.x + (clientX - (rect?.left ?? 0)) / view.zoom,
      y: view.y + (clientY - (rect?.top ?? 0)) / view.zoom,
    };
  }, [view]);

  const commit = React.useCallback(async (ops: WhiteboardOp[]): Promise<WhiteboardChangeOutcome> => {
    const outcome = await applyOps(board.id, ops);
    if (outcome === 'conflict') toast.info(t('whiteboards.canvas.conflict'));
    else if (outcome === 'failed') toast.error(t('whiteboards.canvas.failed'));
    else if (outcome === 'needs-confirmation') {
      const accepted = await confirm({
        title: t('whiteboards.canvas.replaceTitle'),
        message: t('whiteboards.canvas.replaceMessage'),
        action: t('whiteboards.canvas.replaceAction'),
        destructive: true,
      });
      if (accepted) return applyOps(board.id, ops, { confirmReplace: true });
    }
    return outcome;
  }, [applyOps, board.id, confirm, t]);

  const deleteSelection = React.useCallback(() => {
    if (selection.size === 0) return;
    void commit([...selection].filter((id) => elementsById.has(id)).map((id) => ({ op: 'delete' as const, id })));
    setSelection(new Set());
  }, [commit, elementsById, selection]);

  const recolorSelection = React.useCallback((color: WhiteboardColor) => {
    // Pictures keep their own colors.
    const ops: WhiteboardOp[] = [...selection]
      .filter((id) => { const element = elementsById.get(id); return element !== undefined && element.kind !== 'image'; })
      .map((id) => ({ op: 'update', id, set: { color } }));
    if (ops.length > 0) void commit(ops);
  }, [commit, elementsById, selection]);

  const reformSelection = React.useCallback((form: BlockForm) => {
    const ops: WhiteboardOp[] = [...selection]
      .filter((id) => elementsById.get(id)?.kind === 'block')
      .map((id) => ({ op: 'update', id, set: { form } }));
    if (ops.length > 0) void commit(ops);
  }, [commit, elementsById, selection]);

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  /**
   * Pictures picked, pasted or dropped onto the board: each is stored for the
   * board, then placed where it was dropped (or in the middle of the view),
   * fitting in IMAGE_MAX_SIDE on both sides, keeping its proportions.
   */
  const addImageFiles = React.useCallback(async (files: readonly File[], at?: Point) => {
    const pictures = files.filter((file) => IMAGE_TYPES.has(file.type));
    if (pictures.length === 0) {
      if (files.length > 0) toast.error(t('whiteboards.canvas.imageFailed'));
      return;
    }
    const center = at ?? { x: view.x + size.width / 2 / view.zoom, y: view.y + size.height / 2 / view.zoom };
    const added: string[] = [];
    for (const [index, file] of pictures.slice(0, 10).entries()) {
      try {
        const image = await uploadWhiteboardImage(board.id, file);
        const scale = Math.min(1, IMAGE_MAX_SIDE / image.width, IMAGE_MAX_SIDE / image.height);
        const w = Math.max(MIN_SIZE, Math.round(image.width * scale));
        const h = Math.max(MIN_SIZE, Math.round(image.height * scale));
        const id = newElementId();
        const offset = index * 32;
        const outcome = await commit([{ op: 'add', element: { id, kind: 'image', imageId: image.imageId, text: '', x: Math.round(center.x - w / 2 + offset), y: Math.round(center.y - h / 2 + offset), w, h } }]);
        if (outcome === 'saved') added.push(id);
      } catch {
        toast.error(t('whiteboards.canvas.imageFailed'));
      }
    }
    if (added.length > 0) {
      setSelection(new Set(added));
      setTool('select');
    }
  }, [board.id, commit, size.height, size.width, t, view]);

  // The selected boxes whose text carries formatting: blocks, notes and texts.
  const richSelection = React.useMemo(() => [...selection].map((id) => elementsById.get(id)).filter(isRichTextElement), [elementsById, selection]);

  const resizeTextSelection = React.useCallback((textSize: TextSize) => {
    const ops: WhiteboardOp[] = richSelection.map((element) => ({ op: 'update', id: element.id, set: { size: textSize } }));
    if (ops.length > 0) void commit(ops);
  }, [commit, richSelection]);

  const alignSelection = React.useCallback((align: TextAlign) => {
    const ops: WhiteboardOp[] = richSelection.map((element) => ({ op: 'update', id: element.id, set: { align } }));
    if (ops.length > 0) void commit(ops);
  }, [commit, richSelection]);

  /** Bold, italic or bullets on the whole text of every selected box, or off when all of it has them. */
  const reformatSelection = React.useCallback((change: 'bold' | 'italic' | 'bullets') => {
    const texts = richSelection.map((element) => element.text);
    const on = change === 'bullets' ? !texts.every(isBulleted) : !texts.every((text) => hasMark(text, change));
    const ops: WhiteboardOp[] = richSelection.flatMap((element) => {
      const already = change === 'bullets' ? isBulleted(element.text) : hasMark(element.text, change);
      if (already === on) return [];
      const text = change === 'bullets' ? toggleBullets(element.text) : toggleMark(element.text, change);
      return [{ op: 'update', id: element.id, set: { text } }];
    });
    if (ops.length > 0) void commit(ops);
  }, [commit, richSelection]);

  const undo = React.useCallback(async () => {
    const outcome = await undoBoard(board.id);
    if (outcome === 'conflict') toast.info(t('whiteboards.canvas.undoConflict'));
    else if (outcome === 'failed') toast.error(t('whiteboards.canvas.failed'));
  }, [board.id, t, undoBoard]);

  // Long text in a small box is drawn smaller to fit (WhiteboardScene); the
  // editor opens at the size and height the text is drawn at, so it does not jump.
  const [editingDrawn, setEditingDrawn] = React.useState<{ fontSize: number; height: number } | null>(null);
  const startEditing = React.useCallback((element: WhiteboardElement) => {
    const drawn = containerRef.current?.querySelector(`[data-element-id="${CSS.escape(element.id)}"] [data-box-text]`);
    const words = drawn?.firstElementChild;
    const fontSize = drawn ? Number.parseFloat(getComputedStyle(drawn).fontSize) : Number.NaN;
    // offsetHeight is in board units: the zoom is a transform, which layout sizes ignore.
    setEditingDrawn(Number.isFinite(fontSize) && fontSize > 0 && words instanceof HTMLElement ? { fontSize, height: words.offsetHeight } : null);
    setEditingId(element.id);
    setEditingText(element.text);
  }, []);

  const textEditorRef = React.useRef<TextEditorHandle | null>(null);
  const [editingFormat, setEditingFormat] = React.useState<TextFormatState>(NO_FORMAT);
  const finishRichEditing = React.useCallback((save: boolean, text: string) => {
    const element = editingId ? elementsById.get(editingId) : undefined;
    setEditingId(null);
    setEditingFormat(NO_FORMAT);
    if (save && element && element.text !== text) void commit([{ op: 'update', id: element.id, set: { text } }]);
  }, [commit, editingId, elementsById]);

  const finishEditing = React.useCallback((save: boolean) => {
    const element = editingId ? elementsById.get(editingId) : undefined;
    setEditingId(null);
    if (save && element && element.text !== editingText) {
      void commit([{ op: 'update', id: element.id, set: { text: editingText } }]);
    }
  }, [commit, editingId, editingText, elementsById]);

  const zoomAround = React.useCallback((factor: number) => {
    setView((current) => {
      const zoom = clampZoom(current.zoom * factor);
      const focus = { x: current.x + size.width / 2 / current.zoom, y: current.y + size.height / 2 / current.zoom };
      return {
        zoom,
        x: focus.x - (focus.x - current.x) * (current.zoom / zoom),
        y: focus.y - (focus.y - current.y) * (current.zoom / zoom),
      };
    });
  }, [size.height, size.width]);

  // Wheel scrolls the board; with Ctrl or Cmd, or a pinch, it zooms around the pointer.
  React.useEffect(() => {
    const node = containerRef.current;
    if (!node) return undefined;
    const onWheel = (event: WheelEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('[data-board-chrome]')) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const rect = node.getBoundingClientRect();
        setView((current) => {
          const zoom = clampZoom(current.zoom * Math.exp(-event.deltaY * 0.01));
          const anchor = { x: current.x + (event.clientX - rect.left) / current.zoom, y: current.y + (event.clientY - rect.top) / current.zoom };
          return { zoom, x: anchor.x - (anchor.x - current.x) * (current.zoom / zoom), y: anchor.y - (anchor.y - current.y) * (current.zoom / zoom) };
        });
        return;
      }
      setView((current) => ({ ...current, x: current.x + event.deltaX / current.zoom, y: current.y + event.deltaY / current.zoom }));
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, []);

  const startPinch = () => {
    const [a, b] = [...touchesRef.current.values()];
    if (!a || !b) return;
    // A second finger turns whatever the first one started into a pinch.
    dragRef.current = null;
    setPreview(new Map());
    setMarquee(null);
    setDraft(null);
    pinchRef.current = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, view };
  };

  const movePinch = () => {
    const pinch = pinchRef.current;
    const [a, b] = [...touchesRef.current.values()];
    const rect = containerRef.current?.getBoundingClientRect();
    if (!pinch || !a || !b || !rect) return;
    const zoom = clampZoom(pinch.view.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.distance);
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const anchor = { x: pinch.view.x + (pinch.center.x - rect.left) / pinch.view.zoom, y: pinch.view.y + (pinch.center.y - rect.top) / pinch.view.zoom };
    setView({ zoom, x: anchor.x - (center.x - rect.left) / zoom, y: anchor.y - (center.y - rect.top) / zoom });
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    keepEditorFocusRef.current = false;
    if (editingId) return;
    if (event.button !== 0 && event.button !== 1) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-board-chrome]')) return;
    // A press on the board puts away an open comment card, like a click outside a popover.
    setCommentDraft(null);
    setOpenCommentId(null);
    const touch = event.pointerType === 'touch';
    if (touch) {
      touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchesRef.current.size === 2) {
        event.currentTarget.setPointerCapture(event.pointerId);
        startPinch();
        return;
      }
      if (touchesRef.current.size > 2) return;
    }
    containerRef.current?.focus({ preventScroll: true });
    const point = toBoard(event.clientX, event.clientY);
    const handle = target?.closest('[data-resize-for]');
    const elementId = target?.closest('[data-element-id]')?.getAttribute('data-element-id') ?? null;
    const element = elementId ? elementsById.get(elementId) : undefined;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);

    // A finger on empty board moves the board, the way every map and canvas on a phone does.
    if (event.button === 1 || tool === 'hand' || (touch && tool === 'select' && !element && !handle)) {
      dragRef.current = { kind: 'pan', start: { x: event.clientX, y: event.clientY }, view };
      if (touch && tool === 'select') setSelection(new Set());
      return;
    }
    if (tool === 'arrow') {
      if (!element || !isBox(element)) {
        setArrowFrom(null);
        return;
      }
      if (!arrowFrom) {
        setArrowFrom(element.id);
        return;
      }
      if (arrowFrom !== element.id) {
        const id = newElementId();
        void commit([{ op: 'add', element: { id, kind: 'arrow', from: arrowFrom, to: element.id, text: '' } }]);
        setSelection(new Set([id]));
      }
      setArrowFrom(null);
      setTool('select');
      return;
    }
    if (tool === 'comment') {
      // A drag marks an area to comment on; a click pins the comment to the box under it, or to the point.
      setOpenCommentId(null);
      setCommentDraft(null);
      dragRef.current = { kind: 'comment', start: point, boxId: element && isBox(element) ? element.id : null };
      setCommentRect(null);
      return;
    }
    if (tool !== 'select') {
      dragRef.current = { kind: 'create', tool, start: point };
      setDraft({ x: point.x, y: point.y, w: 0, h: 0 });
      return;
    }
    if (handle) {
      const resized = elementsById.get(handle.getAttribute('data-resize-for') ?? '');
      const corner = CORNERS.find((entry) => entry === handle.getAttribute('data-corner'));
      if (resized && isBox(resized) && corner) {
        dragRef.current = { kind: 'resize', id: resized.id, corner, start: point, origin: { x: resized.x, y: resized.y, w: resized.w, h: resized.h } };
      }
      return;
    }
    const additive = event.shiftKey || event.metaKey || event.ctrlKey;
    // A link in a box that is already selected opens; the first press only selects the box.
    const link = target?.closest('a[href]')?.getAttribute('href');
    if (link && element && selection.has(element.id) && !additive && tool === 'select') {
      setDragging(false);
      void openExternalUrl(link);
      return;
    }
    // A second press on the same element edits it. The board captures the
    // pointer, so the browser's own dblclick never reaches the element; this
    // counts presses instead, for mouse, pen and touch alike. The mouse press
    // that follows (for touch, after the finger lifts) would move focus to the
    // board and close the new editor at once; `keepEditorFocusRef` stops it.
    if (element && !additive) {
      const last = lastTapRef.current;
      lastTapRef.current = { id: element.id, at: event.timeStamp };
      if (last && last.id === element.id && event.timeStamp - last.at < 350) {
        lastTapRef.current = null;
        setDragging(false);
        keepEditorFocusRef.current = true;
        startEditing(element);
        return;
      }
    }
    if (element) {
      let next: Set<string>;
      if (additive) {
        next = new Set(selection);
        if (next.has(element.id)) next.delete(element.id);
        else next.add(element.id);
      } else {
        next = selection.has(element.id) ? new Set(selection) : new Set([element.id]);
      }
      setSelection(next);
      // Moving a section takes what sits inside it along.
      const origins = new Map<string, Rect>();
      for (const id of next) {
        const selected = elementsById.get(id);
        if (!selected || !isBox(selected)) continue;
        origins.set(id, { x: selected.x, y: selected.y, w: selected.w, h: selected.h });
        if (selected.kind === 'section') {
          for (const inner of board.elements) {
            if (isBox(inner) && inner.id !== id && containsRect(selected, inner)) origins.set(inner.id, { x: inner.x, y: inner.y, w: inner.w, h: inner.h });
          }
        }
      }
      dragRef.current = { kind: 'move', start: point, origins, moved: false };
      return;
    }
    dragRef.current = { kind: 'marquee', start: point, base: additive ? selection : new Set() };
    if (!additive) setSelection(new Set());
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' && touchesRef.current.has(event.pointerId)) {
      touchesRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinchRef.current) {
        movePinch();
        return;
      }
    }
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'pan') {
      setView({ ...drag.view, x: drag.view.x - (event.clientX - drag.start.x) / drag.view.zoom, y: drag.view.y - (event.clientY - drag.start.y) / drag.view.zoom });
      return;
    }
    const point = toBoard(event.clientX, event.clientY);
    if (drag.kind === 'move') {
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      if (!drag.moved && Math.hypot(dx, dy) * view.zoom < 3) return;
      drag.moved = true;
      setPreview(new Map([...drag.origins].map(([id, rect]) => [id, { ...rect, x: rect.x + dx, y: rect.y + dy }])));
      return;
    }
    if (drag.kind === 'resize') {
      setPreview(new Map([[drag.id, resizeFrom(drag.origin, drag.corner, point.x - drag.start.x, point.y - drag.start.y)]]));
      return;
    }
    const rect = normalizeRect(drag.start, point);
    if (drag.kind === 'comment') {
      setCommentRect(rect);
      return;
    }
    if (drag.kind === 'create') {
      setDraft(rect);
      return;
    }
    setMarquee(rect);
    const next = new Set(drag.base);
    for (const element of board.elements) {
      if (isBox(element) && (element.kind === 'section' ? containsRect(rect, element) : rectsIntersect(rect, element))) next.add(element.id);
    }
    for (const element of board.elements) {
      if (element.kind === 'arrow' && next.has(element.from) && next.has(element.to)) next.add(element.id);
    }
    setSelection(next);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    touchesRef.current.delete(event.pointerId);
    if (pinchRef.current) {
      if (touchesRef.current.size < 2) pinchRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      setDragging(false);
      return;
    }
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag) return;
    if (drag.kind === 'comment') {
      const area = commentRect && commentRect.w * view.zoom > 8 && commentRect.h * view.zoom > 8 ? commentRect : null;
      const box = drag.boxId ? elementsById.get(drag.boxId) : undefined;
      setCommentRect(null);
      setTool('select');
      if (area) {
        const rounded = { x: Math.round(area.x), y: Math.round(area.y), w: Math.round(area.w), h: Math.round(area.h) };
        const inside = boxesInside(board.elements, rounded);
        setSelection(new Set(inside.map((element) => element.id)));
        setCommentDraft({ anchor: rounded, selectedIds: inside.map((element) => element.id) });
      } else if (box && isBox(box)) {
        setSelection(new Set([box.id]));
        setCommentDraft({ anchor: { elementId: box.id, x: box.x + box.w, y: box.y }, selectedIds: [box.id] });
      } else {
        setCommentDraft({ anchor: { x: Math.round(drag.start.x), y: Math.round(drag.start.y) }, selectedIds: [] });
      }
      return;
    }
    if (drag.kind === 'move' && drag.moved) {
      const ops: WhiteboardOp[] = [];
      for (const [id, rect] of preview) ops.push({ op: 'update', id, set: { x: Math.round(rect.x), y: Math.round(rect.y) } });
      if (ops.length > 0) void commit(ops);
    } else if (drag.kind === 'resize') {
      const rect = preview.get(drag.id);
      if (rect) void commit([{ op: 'update', id: drag.id, set: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) } }]);
    } else if (drag.kind === 'create') {
      const dragged = draft && draft.w * view.zoom > 6 && draft.h * view.zoom > 6 ? draft : null;
      const defaults = DEFAULT_SIZE[drag.tool];
      const rect = dragged ?? { x: drag.start.x - defaults.w / 2, y: drag.start.y - defaults.h / 2, w: defaults.w, h: defaults.h };
      const id = newElementId();
      const geometry = { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(Math.max(MIN_SIZE, rect.w)), h: Math.round(Math.max(MIN_SIZE, rect.h)) };
      const element = drag.tool === 'text'
        ? { id, kind: 'text' as const, ...geometry, text: '', size: 'heading' as const }
        : drag.tool === 'note'
          ? { id, kind: 'note' as const, ...geometry, text: '', color: 'yellow' as const }
          : drag.tool === 'section'
            ? { id, kind: 'section' as const, ...geometry, text: t('whiteboards.canvas.newSection') }
            : { id, kind: 'block' as const, ...geometry, text: '' };
      void commit([{ op: 'add', element }]);
      setSelection(new Set([id]));
      setTool('select');
      if (element.kind !== 'section') {
        setEditingId(id);
        setEditingText('');
      }
    }
    setPreview(new Map());
    setMarquee(null);
    setDraft(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (target && (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable)) return;
    if ((event.key === 'Delete' || event.key === 'Backspace') && selection.size > 0) {
      event.preventDefault();
      deleteSelection();
    } else if (event.key === 'Escape') {
      setCommentDraft(null);
      setOpenCommentId(null);
      setArrowFrom(null);
      setTool('select');
      setSelection(new Set());
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
      event.preventDefault();
      void undo();
    } else if (event.key === 'Enter' && selection.size === 1) {
      const element = elementsById.get([...selection][0]);
      if (element) {
        event.preventDefault();
        startEditing(element);
      }
    }
  };

  const submitAsk = async (text: string): Promise<boolean> => {
    if (!onAsk) return false;
    const selectedIds = [...selection];
    const area = boardBounds(board.elements.filter((element) => selection.has(element.id)));
    const outcome = await onAsk(text, selectedIds);
    if (outcome.kind === 'failed') {
      toast.error(t('whiteboards.canvas.askFailed'));
      return false;
    }
    setAskOpen(false);
    if (outcome.kind === 'sent') setAsking({ revision: board.revision, area, at: Date.now(), sessionId: outcome.sessionId });
    return true;
  };

  /** Sends a comment entry to the agent, naming the comment so it answers in the thread. */
  // Skynex works where a comment points: its area, what it is about, or around its point. Never the whole board.
  const commentWorkArea = (anchor: CommentAnchor, selectedIds: readonly string[]): Rect => commentArea({ anchor })
    ?? boardBounds(board.elements.filter((element) => selectedIds.includes(element.id)))
    ?? { x: anchor.x - 60, y: anchor.y - 60, w: 120, h: 120 };

  const askFromComment = async (commentId: string, text: string, selectedIds: string[], entries: number, area: Rect) => {
    if (!onAsk) return;
    const outcome = await onAsk(text, selectedIds, commentId);
    if (outcome.kind === 'failed') toast.error(t('whiteboards.canvas.askFailed'));
    if (outcome.kind === 'sent') setAsking({ revision: board.revision, area, at: Date.now(), sessionId: outcome.sessionId, comment: { id: commentId, entries } });
  };

  const submitComment = async (text: string, sent: boolean): Promise<boolean> => {
    const draftComment = commentDraft;
    if (!draftComment) return false;
    const id = await addComment(board.id, draftComment.anchor, text, sent);
    if (!id) {
      toast.error(t('whiteboards.comments.failed'));
      return false;
    }
    setCommentDraft(null);
    setOpenCommentId(id);
    if (sent) await askFromComment(id, text, draftComment.selectedIds, 1, commentWorkArea(draftComment.anchor, draftComment.selectedIds));
    return true;
  };

  const replyInThread = async (comment: WhiteboardComment, text: string, sent: boolean): Promise<boolean> => {
    if (!(await replyToComment(board.id, comment.id, text, sent))) {
      toast.error(t('whiteboards.comments.failed'));
      return false;
    }
    const area = commentArea(comment);
    const anchored = area ? boxesInside(board.elements, area).map((element) => element.id) : comment.anchor.elementId && elementsById.has(comment.anchor.elementId) ? [comment.anchor.elementId] : [];
    if (sent) await askFromComment(comment.id, text, anchored, comment.entries.length + 1, commentWorkArea(comment.anchor, anchored));
    return true;
  };

  const commentOnSelection = () => {
    const anchor = anchorForSelection(selectedElements, selectionBounds);
    if (!anchor) return;
    setOpenCommentId(null);
    setCommentDraft({ anchor, selectedIds: selectedElements.map((element) => element.id) });
  };

  // The first request goes out once, through the request box's own path, so the
  // board shows the agent working on it like any other request.
  const firstAskSent = React.useRef<object | null>(null);
  const sendFirstAsk = React.useEffectEvent((ask: { text: string; onSent: () => void }) => {
    if (firstAskSent.current === ask) return;
    firstAskSent.current = ask;
    ask.onSent();
    void submitAsk(ask.text);
  });
  React.useEffect(() => {
    if (firstAsk) sendFirstAsk(firstAsk);
  }, [firstAsk]);

  const keepDrawn = React.useMemo(
    () => new Set<string>([...selection, ...preview.keys(), ...(editingId ? [editingId] : []), ...(arrowFrom ? [arrowFrom] : [])]),
    [arrowFrom, editingId, preview, selection],
  );
  const selectedBoxes = board.elements.filter((element): element is BoxElement => isBox(element) && selection.has(element.id));
  const selectionBounds = boardBounds(selectedBoxes.map((element) => ({ ...element, ...rectOf(element) })));
  const selectedElements = [...selection].map((id) => elementsById.get(id)).filter((element): element is WhiteboardElement => Boolean(element));
  const singleBox = selectedBoxes.length === 1 && selection.size === 1 ? selectedBoxes[0] : undefined;
  const editingElement = editingId ? elementsById.get(editingId) : undefined;
  const richEditing = isRichTextElement(editingElement) ? editingElement : undefined;
  const firstRich = richSelection[0];
  // An open comment card takes the place of the quick-edit bar.
  const showSelectionBar = tool === 'select' && !dragging && (!editingId || Boolean(richEditing)) && selectedElements.length > 0 && !commentDraft && !openCommentId;
  const hint = tool === 'arrow' ? t(arrowFrom ? 'whiteboards.canvas.arrowEndHint' : 'whiteboards.canvas.arrowStartHint') : tool === 'comment' ? t('whiteboards.canvas.commentHint') : null;
  const toScreen = (point: Point): Point => ({ x: (point.x - view.x) * view.zoom, y: (point.y - view.y) * view.zoom });

  const pointOfComment = (comment: Pick<WhiteboardComment, 'anchor'>): Point => commentPoint(comment, elementsById, rectOf);
  const shownComments = board.comments.filter((comment) => showResolved || !comment.resolved || comment.id === openCommentId);
  const openComment = openCommentId ? board.comments.find((comment) => comment.id === openCommentId) : undefined;
  const openCount = board.comments.filter((comment) => !comment.resolved).length;
  // Comment cards are a sheet over the bottom only where the board is too narrow for a card by its marker.
  const sheetCards = size.width < 560;
  const CARD_WIDTH = 304;
  /**
   * A comment card sits beside its marker, and flips to the left near the
   * right edge. On an area it sits inside the area's bottom-right corner, the
   * way Claude's whiteboards open it, since that is where its marker is.
   */
  const commentCardStyle = (comment: Pick<WhiteboardComment, 'anchor'>, height: number): React.CSSProperties => {
    const at = toScreen(pointOfComment(comment));
    const clampTop = (top: number) => Math.min(Math.max(8, top), Math.max(8, size.height - height - 8));
    if (commentArea(comment)) return { left: Math.max(8, at.x - CARD_WIDTH - 12), top: clampTop(at.y - Math.min(height, 120) + 20) };
    const left = at.x + 16 + CARD_WIDTH > size.width - 8 ? Math.max(8, at.x - CARD_WIDTH - 16) : at.x + 16;
    return { left, top: clampTop(at.y - 8) };
  };
  const commentAbout = (comment: Pick<WhiteboardComment, 'anchor'>, selectedIds?: readonly string[]): string => {
    const area = commentArea(comment);
    const ids = selectedIds ?? (area ? boxesInside(board.elements, area).map((element) => element.id) : comment.anchor.elementId ? [comment.anchor.elementId] : []);
    const about = ids.map((id) => elementsById.get(id)).filter((element): element is WhiteboardElement => Boolean(element));
    return commentTargetLabel(t, describeCommentTarget(about, board.elements, area));
  };

  // The quick-edit bar sits above what is selected, or below it near the top edge.
  let selectionBarStyle: React.CSSProperties = {};
  if (showSelectionBar) {
    const anchor = selectionBounds ?? (() => {
      const arrow = selectedElements.find((element) => element.kind === 'arrow');
      const from = arrow ? elementsById.get(arrow.from) : undefined;
      const to = arrow ? elementsById.get(arrow.to) : undefined;
      if (!from || !to || !isBox(from) || !isBox(to)) return null;
      const middle = routeBoard(board.elements, rectOf).get(arrow?.id ?? '')?.label ?? { x: 0, y: 0 };
      return { x: middle.x, y: middle.y, w: 0, h: 0 };
    })();
    if (anchor) {
      const barHeight = size.width < 480 ? 76 : 40;
      const top = toScreen({ x: anchor.x, y: anchor.y });
      const bottom = toScreen({ x: anchor.x, y: anchor.y + anchor.h });
      const centerX = toScreen({ x: anchor.x + anchor.w / 2, y: 0 }).x;
      selectionBarStyle = {
        // On a narrow screen the bar takes the width and centers; elsewhere it follows the selection.
        left: size.width < 480 ? size.width / 2 : Math.min(Math.max(centerX, 180), Math.max(180, size.width - 180)),
        // Two rows on a narrow screen, so the bar sits higher above the selection.
        top: top.y - barHeight - 16 < 8 ? bottom.y + 14 : top.y - barHeight - 16,
      };
    }
  }

  // Labels of arrows and sections are edited in a small field; box text is edited in place.
  const labelField: React.CSSProperties = {
    background: 'var(--surface-elevated)',
    color: 'var(--foreground)',
    boxShadow: '0 0 0 1.5px var(--interactive-border-focus)',
    caretColor: 'var(--interactive-border-focus)',
  };
  const editorStyle = (): React.CSSProperties => {
    if (!editingElement) return {};
    if (editingElement.kind === 'arrow') {
      const from = elementsById.get(editingElement.from);
      const to = elementsById.get(editingElement.to);
      const middle = from && to && isBox(from) && isBox(to) ? routeBoard(board.elements).get(editingElement.id)?.label ?? { x: 0, y: 0 } : { x: 0, y: 0 };
      return { ...labelField, left: middle.x - 100, top: middle.y - 16, width: 200, height: 32, fontSize: 12, textAlign: 'center', padding: '6px 10px', borderRadius: 999 };
    }
    if (editingElement.kind === 'image') {
      return { ...labelField, left: editingElement.x + 8, top: editingElement.y + editingElement.h - 40, width: Math.min(editingElement.w - 16, 320), height: 30, fontSize: 12, fontWeight: 500, padding: '6px 10px', borderRadius: 8 };
    }
    if (editingElement.kind === 'section') {
      return { ...labelField, left: editingElement.x - 4, top: editingElement.y - 34, width: Math.min(editingElement.w, 360), height: 28, fontSize: 13, fontWeight: 500, padding: '5px 8px', borderRadius: 6 };
    }
    const text = boxTextStyle(editingElement);
    const fontSize = editingDrawn?.fontSize ?? boxFontSize(editingElement);
    const textHeight = editingDrawn?.height ?? Math.max(1, editingText.split('\n').length) * fontSize * 1.4;
    const style: React.CSSProperties = {
      ...text,
      fontSize,
      left: editingElement.x,
      top: editingElement.y,
      width: Math.max(editingElement.w, 120),
      height: Math.max(editingElement.h, 40),
      borderRadius: 12,
      // The caret takes the ink of the text: an accent caret disappears on pastel cards.
      caretColor: text.color,
    };
    // A block's text sits in its middle; the editor starts where the text will be.
    if (editingElement.kind === 'block') style.paddingTop = Math.max(8, (editingElement.h - textHeight) / 2);
    return style;
  };

  return (
    <div className="relative size-full min-h-0 overflow-hidden bg-background">
      <div
        ref={containerRef}
        tabIndex={0}
        role="application"
        aria-label={board.title}
        className={cn(
          'absolute inset-0 outline-none',
          tool === 'hand' ? (dragging ? 'cursor-grabbing' : 'cursor-grab') : tool === 'select' ? 'cursor-default' : 'cursor-crosshair',
        )}
        style={{
          // Fingers pan, pinch and drag the board itself; the page must not scroll or zoom under them.
          touchAction: 'none',
          backgroundImage: 'radial-gradient(color-mix(in oklab, var(--foreground) 13%, transparent) 1.1px, transparent 1.3px)',
          backgroundSize: `${22 * view.zoom}px ${22 * view.zoom}px`,
          backgroundPosition: `${-view.x * view.zoom}px ${-view.y * view.zoom}px`,
        }}
        onPointerDown={handlePointerDown}
        onMouseDown={(event) => {
          if (!keepEditorFocusRef.current) return;
          keepEditorFocusRef.current = false;
          event.preventDefault();
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onKeyDown={handleKeyDown}
        onPaste={(event) => {
          if (editingId) return;
          const files = [...event.clipboardData.files];
          if (files.length === 0) return;
          event.preventDefault();
          void addImageFiles(files);
        }}
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes('Files')) event.preventDefault();
        }}
        onDrop={(event) => {
          const files = [...event.dataTransfer.files];
          if (files.length === 0) return;
          event.preventDefault();
          void addImageFiles(files, toBoard(event.clientX, event.clientY));
        }}
      >
        <div dir="ltr" className="absolute start-0 top-0 origin-top-left" style={{ transform: `scale(${view.zoom}) translate(${-view.x}px, ${-view.y}px)` }}>
          <WhiteboardScene
            elements={board.elements}
            rectOf={rectOf}
            interactive
            selection={selection}
            highlighted={new Set([...flash, ...(arrowFrom ? [arrowFrom] : [])])}
            editingId={editingId}
            boxCursor={tool === 'select' ? 'cursor-move' : tool === 'arrow' ? 'cursor-crosshair' : undefined}
            onDoubleClick={startEditing}
            boardId={board.id}
            visibleRect={visibleRect}
            keep={keepDrawn}
          />
          {[commentRect, commentDraft ? commentArea(commentDraft) : null, openComment && !commentDraft ? commentArea(openComment) : null].map((area, index) => (area ? (
            <div key={index} className="pointer-events-none absolute"
              style={{ left: area.x, top: area.y, width: area.w, height: area.h, outline: `${1 / view.zoom}px dashed var(--status-warning)` }}>
              <span className="absolute rounded-full" style={{ left: -4 / view.zoom, top: -4 / view.zoom, width: 8 / view.zoom, height: 8 / view.zoom, background: 'var(--status-warning)' }} />
            </div>
          ) : null))}
          <CommentMarkers
            comments={shownComments}
            pointOf={pointOfComment}
            zoom={view.zoom}
            openId={openCommentId}
            onOpen={(id) => {
              setCommentDraft(null);
              setCommentsOpen(false);
              setOpenCommentId((current) => (current === id ? null : id));
            }}
          />

          {selectionBounds && tool === 'select' ? (
            <div className="pointer-events-none absolute" style={{
              left: selectionBounds.x - 6 / view.zoom,
              top: selectionBounds.y - 6 / view.zoom,
              width: selectionBounds.w + 12 / view.zoom,
              height: selectionBounds.h + 12 / view.zoom,
              borderRadius: 12 / view.zoom,
              boxShadow: `0 0 0 ${1.5 / view.zoom}px var(--interactive-border-focus)`,
            }}>
              {singleBox && !editingId ? CORNERS.map((corner) => (
                <div
                  key={corner}
                  data-resize-for={singleBox.id}
                  data-corner={corner}
                  className={cn(
                    'pointer-events-auto absolute rounded-full bg-[var(--surface-elevated)]',
                    corner === 'nw' || corner === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize',
                  )}
                  style={{
                    width: 10 / view.zoom,
                    height: 10 / view.zoom,
                    left: corner === 'nw' || corner === 'sw' ? -5 / view.zoom : undefined,
                    right: corner === 'ne' || corner === 'se' ? -5 / view.zoom : undefined,
                    top: corner === 'nw' || corner === 'ne' ? -5 / view.zoom : undefined,
                    bottom: corner === 'sw' || corner === 'se' ? -5 / view.zoom : undefined,
                    boxShadow: `0 0 0 ${1.5 / view.zoom}px var(--interactive-border-focus), 0 1px 3px rgb(0 0 0 / 0.25)`,
                  }}
                />
              )) : null}
            </div>
          ) : null}

          {marquee ? (
            <div className="pointer-events-none absolute rounded-md"
              style={{
                left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h,
                background: 'color-mix(in oklab, var(--interactive-border-focus) 10%, transparent)',
                boxShadow: `0 0 0 ${1 / view.zoom}px var(--interactive-border-focus)`,
              }} />
          ) : null}
          {draft ? (
            <div className="pointer-events-none absolute rounded-xl"
              style={{
                left: draft.x, top: draft.y, width: draft.w, height: draft.h,
                background: 'color-mix(in oklab, var(--interactive-border-focus) 8%, transparent)',
                outline: `${1.5 / view.zoom}px dashed var(--interactive-border-focus)`,
              }} />
          ) : null}
          {asking ? (
            <div className="pointer-events-none absolute"
              style={asking.area
                ? { left: asking.area.x - 16, top: asking.area.y - 16, width: asking.area.w + 32, height: asking.area.h + 32 }
                : { left: view.x + 24 / view.zoom, top: view.y + 24 / view.zoom, width: (size.width - 48) / view.zoom, height: (size.height - 48) / view.zoom }}>
              <div className="absolute inset-0 animate-pulse rounded-[20px]" style={{
                background: 'color-mix(in oklab, var(--status-warning) 9%, transparent)',
                outline: `${2 / view.zoom}px dashed var(--status-warning)`,
              }} />
              <div className="absolute start-0 flex items-center gap-1 rounded-full font-medium"
                style={{
                  top: -28 / view.zoom,
                  fontSize: 11 / view.zoom,
                  padding: `${3 / view.zoom}px ${8 / view.zoom}px`,
                  background: 'var(--status-warning)',
                  color: 'var(--status-warning-foreground)',
                }}>
                {t('whiteboards.canvas.agentLabel')}
              </div>
            </div>
          ) : null}
          {richEditing ? (
            <WhiteboardTextEditor
              key={richEditing.id}
              ref={textEditorRef}
              element={richEditing}
              label={t('whiteboards.canvas.editText')}
              style={editorStyle()}
              onFormat={setEditingFormat}
              onDone={finishRichEditing}
            />
          ) : editingElement ? (
            <textarea
              data-board-chrome
              autoFocus
              value={editingText}
              aria-label={t('whiteboards.canvas.editText')}
              onChange={(event) => setEditingText(event.target.value)}
              onBlur={() => finishEditing(true)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  finishEditing(false);
                } else if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  finishEditing(true);
                }
              }}
              className="absolute z-10 resize-none overflow-hidden bg-transparent outline-none"
              style={editorStyle()}
            />
          ) : null}
        </div>

        {board.elements.length === 0 && !draft ? (
          <div className="pointer-events-none absolute inset-x-0 top-[30%] mx-auto flex max-w-sm flex-col items-center gap-3 px-6 text-center">
            <div className="oc-tile-inset flex size-12 items-center justify-center rounded-2xl text-muted-foreground">
              <Icon name="artboard" className="size-6" />
            </div>
            <div className="typography-ui-header font-semibold text-foreground">{t('whiteboards.canvas.emptyTitle')}</div>
            <div className="typography-ui-label text-muted-foreground">{t('whiteboards.canvas.empty')}</div>
          </div>
        ) : null}
      </div>

      {showSelectionBar && selectionBarStyle.top !== undefined ? (
        <SelectionBar
          style={selectionBarStyle}
          colors={new Set(selectedElements.map(elementColor))}
          showColors={selectedElements.some((element) => element.kind !== 'image')}
          form={firstOfKind(selectedElements, 'block')?.form ?? (firstOfKind(selectedElements, 'block') ? 'rounded' : null)}
          onColor={recolorSelection}
          onForm={firstOfKind(selectedElements, 'block') ? reformSelection : null}
          size={firstRich ? firstRich.size ?? 'body' : null}
          onSize={firstRich ? resizeTextSelection : null}
          editing={Boolean(richEditing)}
          format={richEditing ? {
            bold: editingFormat.bold,
            italic: editingFormat.italic,
            bulleted: editingFormat.bulleted,
            align: textAlignOf(richEditing),
            onBold: () => textEditorRef.current?.toggle('bold'),
            onItalic: () => textEditorRef.current?.toggle('italic'),
            onBullets: () => textEditorRef.current?.toggle('insertUnorderedList'),
            onAlign: (align) => void commit([{ op: 'update', id: richEditing.id, set: { align } }]),
            link: {
              active: editingFormat.link,
              onStart: () => textEditorRef.current?.keepSelection(),
              onApply: (href) => textEditorRef.current?.link(href) ?? false,
              onEnd: () => textEditorRef.current?.focus(),
            },
          } : firstRich ? {
            bold: richSelection.every((element) => hasMark(element.text, 'bold')),
            italic: richSelection.every((element) => hasMark(element.text, 'italic')),
            bulleted: richSelection.every((element) => isBulleted(element.text)),
            align: textAlignOf(firstRich),
            onBold: () => reformatSelection('bold'),
            onItalic: () => reformatSelection('italic'),
            onBullets: () => reformatSelection('bullets'),
            onAlign: alignSelection,
          } : null}
          onComment={commentOnSelection}
          onDelete={deleteSelection}
        />
      ) : null}

      {commentDraft ? (
        <CommentComposer
          target={commentDraft.anchor.elementId || (!commentArea(commentDraft) && commentDraft.selectedIds.length > 0) ? commentAbout(commentDraft, commentDraft.selectedIds) : null}
          style={commentCardStyle(commentDraft, 120)}
          compact={sheetCards}
          onSubmit={submitComment}
          onClose={() => setCommentDraft(null)}
        />
      ) : null}
      {openComment && !commentDraft ? (
        <CommentThread
          key={openComment.id}
          comment={openComment}
          target={commentAbout(openComment)}
          working={asking?.comment?.id === openComment.id}
          style={commentCardStyle(openComment, 380)}
          compact={sheetCards}
          onReply={(text, sent) => replyInThread(openComment, text, sent)}
          onResolve={(resolved) => {
            void resolveComment(board.id, openComment.id, resolved).then((done) => {
              if (!done) toast.error(t('whiteboards.comments.failed'));
              else if (resolved) setOpenCommentId(null);
            });
          }}
          onDelete={() => {
            void removeComment(board.id, openComment.id).then((done) => {
              if (!done) toast.error(t('whiteboards.comments.failed'));
              else setOpenCommentId(null);
            });
          }}
          onClose={() => setOpenCommentId(null)}
        />
      ) : null}
      {commentsOpen ? (
        <CommentsPanel
          comments={board.comments}
          showResolved={showResolved}
          onShowResolved={setShowResolved}
          onPick={(id) => {
            const comment = board.comments.find((item) => item.id === id);
            setCommentsOpen(false);
            setCommentDraft(null);
            if (!comment) return;
            showComment(comment);
            setOpenCommentId(id);
          }}
          onClose={() => setCommentsOpen(false)}
        />
      ) : null}

      <div data-board-chrome className="absolute end-3 top-3 flex items-start gap-2">
        <CommentsButton count={openCount} open={commentsOpen} onClick={() => setCommentsOpen((open) => !open)} />
        <ZoomControls
          zoom={view.zoom}
          onZoomIn={() => zoomAround(1.25)}
          onZoomOut={() => zoomAround(1 / 1.25)}
          onFit={() => fitTo(boardBounds(board.elements))}
          onLastChange={board.lastChange && lastChangeBounds ? () => fitTo(lastChangeBounds, 1) : undefined}
        />
      </div>

      <div data-board-chrome className="pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-2 px-3 [&>*]:pointer-events-auto">
        {hint ? <div className="oc-surface-floating oc-glass-floating rounded-full px-3 py-1 typography-meta text-muted-foreground">{hint}</div> : null}
        {asking ? (
          <WorkingPill onStop={() => {
            void stopAgentOnBoard(asking.sessionId);
            setAsking(null);
          }} />
        ) : null}
        {askOpen && onAsk ? <AskBox selectionCount={selection.size} onSubmit={submitAsk} onClose={() => setAskOpen(false)} /> : null}
        <ToolDock
          tool={tool}
          onTool={(next) => {
            setTool(next);
            setArrowFrom(null);
          }}
          canUndo={board.canUndo}
          onUndo={() => void undo()}
          askOpen={askOpen}
          onAsk={onAsk ? () => setAskOpen((open) => !open) : undefined}
          onImage={() => fileInputRef.current?.click()}
          compact={compact}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            void addImageFiles(files);
          }}
        />
      </div>
      {dialog}
    </div>
  );
}
