import React from 'react';

import { cn } from '@/lib/utils';
import {
  elementsInView,
  isBox,
  routeBoard,
  type ArrowRoute,
  type Point,
  type ArrowElement,
  type BoxElement,
  type Rect,
  type TextAlign,
  type WhiteboardElement,
} from '@/lib/whiteboards/model';
import { arrowColor, blockPaint, BOX_SHADOW, notePaint, sectionPaint } from './whiteboardColors';
import { boxFontSize, boxTextStyle, textAlignOf, withSoftBreaks } from './whiteboardText';
import { parseRichText, plainText, withTitleLine, type RichRun } from '@/lib/whiteboards/richText';
import { Icon } from '@/components/icon/Icon';
import { useWhiteboardImage } from '@/lib/whiteboards/images';

/**
 * The body of a block: a flat card in its color. Rectangles, rounded cards
 * and pills are one styled element; only the diamond and the database need
 * SVG for their outline. Every element on a board costs DOM, so the common
 * forms take the least.
 */
function BlockBody({ element, rect }: { element: Extract<BoxElement, { kind: 'block' }>; rect: Rect }) {
  const paint = blockPaint(element.color);
  const { w, h } = rect;
  const form = element.form ?? 'rounded';
  if (form !== 'diamond' && form !== 'database') {
    const radius = form === 'rect' ? 2 : form === 'pill' ? h / 2 : Math.min(8, h / 4);
    return <div aria-hidden className="absolute inset-0" style={{ background: paint.fill, boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${paint.stroke} 22%, transparent)`, borderRadius: radius }} />;
  }
  const stroke = { fill: paint.fill, stroke: `color-mix(in oklab, ${paint.stroke} 30%, transparent)`, strokeWidth: 1 };
  const ry = Math.min(h * 0.14, 14);
  return (
    <svg className="absolute inset-0 overflow-visible" width={w} height={h} aria-hidden>
      {form === 'diamond' ? (
        <polygon points={`${w / 2},1 ${w - 1},${h / 2} ${w / 2},${h - 1} 1,${h / 2}`} strokeLinejoin="round" {...stroke} />
      ) : (
        <>
          <path d={`M 1 ${ry} L 1 ${h - ry} A ${w / 2 - 1} ${ry} 0 0 0 ${w - 1} ${h - ry} L ${w - 1} ${ry}`} {...stroke} />
          <ellipse cx={w / 2} cy={ry} rx={w / 2 - 1} ry={ry - 0.5} {...stroke} />
        </>
      )}
    </svg>
  );
}

/** A sticky note: one element, its corner cut off and folded by a gradient. */
function NoteBody({ element, rect }: { element: Extract<BoxElement, { kind: 'note' }>; rect: Rect }) {
  const paint = notePaint(element.color);
  const fold = Math.min(18, rect.w / 6, rect.h / 6);
  return (
    <div
      aria-hidden
      className="absolute inset-0 rounded-[2px]"
      style={{
        filter: BOX_SHADOW,
        background: `linear-gradient(315deg, transparent ${fold * 0.7}px, ${paint.fold} ${fold * 0.7}px ${fold * 1.42}px, ${paint.fill} ${fold * 1.42}px)`,
      }}
    />
  );
}

function SectionBody({ element, rect }: { element: Extract<BoxElement, { kind: 'section' }>; rect: Rect }) {
  const paint = sectionPaint(element.color);
  return (
    <div
      aria-hidden
      className="absolute inset-0 rounded-[10px]"
      style={{ background: paint.fill, boxShadow: `inset 0 0 0 1px ${paint.stroke}`, width: rect.w, height: rect.h }}
    />
  );
}

/** A picture on the board, read from the server, with its caption on it. */
function ImageBody({ element, rect, boardId, hideCaption }: { element: Extract<BoxElement, { kind: 'image' }>; rect: Rect; boardId?: string; hideCaption: boolean }) {
  const image = useWhiteboardImage(boardId, element.imageId);
  return (
    <div
      className="absolute inset-0 overflow-hidden rounded-xl bg-[var(--surface-elevated)]"
      style={{ width: rect.w, height: rect.h, filter: BOX_SHADOW, boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--foreground) 12%, transparent)' }}
    >
      {image.status === 'ready' ? (
        <img src={image.url} alt={element.text} draggable={false} className="pointer-events-none size-full select-none object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-muted-foreground">
          <Icon name="image" className={image.status === 'failed' ? 'size-8 opacity-30' : 'size-8 animate-pulse opacity-60'} />
        </div>
      )}
      {element.text && !hideCaption ? (
        <div
          className="absolute bottom-2 start-2 max-w-[calc(100%-1rem)] truncate rounded-lg bg-[var(--surface-elevated)]"
          style={{ ...boxTextStyle(element, rect), boxShadow: '0 1px 4px rgb(0 0 0 / 0.25)' }}
          dir="auto"
        >
          {plainText(element.text)}
        </div>
      ) : null}
    </div>
  );
}

type BoxProps = {
  element: BoxElement;
  rect: Rect;
  interactive: boolean;
  hideText: boolean;
  highlighted: boolean;
  boardId?: string;
  cursor?: string;
  onDoubleClick?: (element: WhiteboardElement) => void;
};

const EMPTY_KEEP: ReadonlySet<string> = new Set();

// Text that does not fit its box shrinks this far before it is cut off.
const MIN_TEXT_SCALE = 0.7;

function BoxView({ element, rect, interactive, hideText, highlighted, cursor, onDoubleClick, boardId }: BoxProps) {
  const textStyle = boxTextStyle(element, rect);
  const baseFont = boxFontSize(element);
  const textRef = React.useRef<HTMLDivElement | null>(null);
  const [textScale, setTextScale] = React.useState(1);
  // Long text in a small box steps its size down until it fits, instead of
  // running into the outline.
  React.useLayoutEffect(() => {
    const node = textRef.current;
    if (!node) return;
    let scale = 1;
    node.style.fontSize = `${baseFont}px`;
    while (scale > MIN_TEXT_SCALE && (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)) {
      scale = Math.max(MIN_TEXT_SCALE, scale - 0.05);
      node.style.fontSize = `${baseFont * scale}px`;
    }
    // Left as measured, which is what React renders next; clearing it would drop the size.
    setTextScale(scale);
  }, [baseFont, element.text, rect.w, rect.h, textStyle.padding]);
  return (
    <div
      data-element-id={interactive ? element.id : undefined}
      className={cn(
        'absolute select-none',
        interactive && cursor,
        // The hover and highlight ring is a pseudo-element: no extra node per element.
        interactive && "after:pointer-events-none after:absolute after:-inset-1 after:rounded-[12px] after:opacity-0 after:transition-opacity after:duration-150 after:content-['']",
        interactive && (highlighted
          ? 'after:opacity-100 after:[box-shadow:0_0_0_2px_var(--status-warning),0_0_18px_-2px_color-mix(in_oklab,var(--status-warning)_55%,transparent)]'
          : 'hover:after:opacity-100 after:[box-shadow:0_0_0_1.5px_color-mix(in_oklab,var(--interactive-border-focus)_55%,transparent)]'),
      )}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onDoubleClick={onDoubleClick ? () => onDoubleClick(element) : undefined}
    >
      {element.kind === 'block' ? <BlockBody element={element} rect={rect} /> : null}
      {element.kind === 'note' ? <NoteBody element={element} rect={rect} /> : null}
      {element.kind === 'section' ? <SectionBody element={element} rect={rect} /> : null}
      {element.kind === 'image' ? <ImageBody element={element} rect={rect} boardId={boardId} hideCaption={hideText} /> : null}
      {element.kind === 'image' ? null : element.kind === 'section' ? (
        element.text && !hideText ? (
          <div className="absolute bottom-full start-0 mb-1.5 max-w-full truncate" style={textStyle} dir="auto">
            {plainText(element.text)}
          </div>
        ) : null
      ) : (
        <div
          className={cn(
            'relative flex size-full overflow-hidden scrollbar-none whitespace-pre-wrap break-words',
            element.kind === 'block' ? 'items-center justify-center' : 'items-start justify-start',
          )}
          ref={textRef}
          data-box-text=""
          style={{ ...textStyle, fontSize: baseFont * textScale }}
          dir="auto"
        >
          {hideText ? null : element.kind === 'block' || element.kind === 'note' || element.kind === 'text' ? <BoxText element={element} /> : null}
        </div>
      )}
    </div>
  );
}

const LINE_JUSTIFY = { start: 'flex-start', center: 'center', end: 'flex-end' } satisfies Record<TextAlign, React.CSSProperties['justifyContent']>;

function RichRuns({ runs }: { runs: readonly RichRun[] }) {
  return (
    <>
      {runs.map((run, index) => {
        let node: React.ReactNode = withSoftBreaks(run.text);
        if (run.italic) node = <em>{node}</em>;
        if (run.bold) node = <strong className="font-bold">{node}</strong>;
        // The board opens links itself (a click on a selected box's link); the anchor shows where it goes.
        if (run.href) node = <a href={run.href} className="underline underline-offset-2" draggable={false} onClick={(event) => event.preventDefault()}>{node}</a>;
        return <React.Fragment key={index}>{node}</React.Fragment>;
      })}
    </>
  );
}

/**
 * The words in a box, formatted (lib/whiteboards/richText.ts): bold, italic,
 * links and list lines. In a block or a note with several lines and nothing
 * bold, the first line reads as the title.
 */
function BoxText({ element }: { element: Extract<BoxElement, { kind: 'block' | 'note' | 'text' }> }) {
  const parsed = parseRichText(element.text);
  const lines = element.kind === 'text' ? parsed : withTitleLine(parsed);
  const justify = LINE_JUSTIFY[textAlignOf(element)];
  return (
    <div className="w-full">
      {lines.map((line, index) => (line.list ? (
        <div key={index} className="flex gap-[0.4em]" style={{ justifyContent: justify }}>
          <span className="shrink-0 tabular-nums">{line.list === 'bullet' ? '•' : `${line.number}.`}</span>
          <span className="min-w-0"><RichRuns runs={line.runs} /></span>
        </div>
      ) : (
        <div key={index}>{line.runs.some((run) => run.text) ? <RichRuns runs={line.runs} /> : '\u00a0'}</div>
      )))}
    </div>
  );
}

const ARROWHEAD = 6;
const CORNER = 6;
// Arrows stop this short of the boxes they join, so a line never touches a card.
const ARROW_GAP = 6;

/** The route as an SVG path with gently rounded turns. */
const routePath = (points: readonly Point[]): string => {
  const last = points[points.length - 1];
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const into = Math.min(CORNER, (Math.abs(corner.x - prev.x) + Math.abs(corner.y - prev.y)) / 2);
    const out = Math.min(CORNER, (Math.abs(next.x - corner.x) + Math.abs(next.y - corner.y)) / 2);
    const a = { x: corner.x - Math.sign(corner.x - prev.x) * into, y: corner.y - Math.sign(corner.y - prev.y) * into };
    const b = { x: corner.x + Math.sign(next.x - corner.x) * out, y: corner.y + Math.sign(next.y - corner.y) * out };
    d += ` L ${a.x} ${a.y} Q ${corner.x} ${corner.y} ${b.x} ${b.y}`;
  }
  return `${d} L ${last.x} ${last.y}`;
};

/** `from` moved `by` toward `to`, never past the middle of the run. */
const toward = (from: Point, to: Point, by: number): Point => {
  const length = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  const step = Math.min(by, length / 2);
  return length > 0 ? { x: from.x + ((to.x - from.x) / length) * step, y: from.y + ((to.y - from.y) / length) * step } : from;
};

/** The route pulled back from both boxes by the gap. */
const gappedPoints = (points: readonly Point[]): Point[] => {
  const result = [...points];
  result[0] = toward(points[0], points[1], ARROW_GAP);
  const last = points.length - 1;
  result[last] = toward(points[last], points[last - 1], ARROW_GAP);
  return result;
};

// Arrow labels are 11px text with 8px padding each side, up to 220 wide.
const LABEL_CHAR = 6.5;
const LABEL_MAX = 220;
const LABEL_HEIGHT = 28;

/**
 * Where an arrow's label goes: on its line when the run is long enough to
 * show line on both sides of it, otherwise off the line, above the two boxes
 * for a line that runs across or to the side of one that runs down, so the
 * arrow stays visible.
 */
const arrowLabelPlace = (route: ArrowRoute, text: string, boxesTop: number): Point & { align: 'center' | 'start' } => {
  const width = Math.min(LABEL_MAX, text.length * LABEL_CHAR + 16);
  const visible = route.labelRun.length - 2 * ARROW_GAP - ARROWHEAD;
  if (route.labelRun.horizontal) {
    // Squeezed between two boxes, the label goes over the gap above both, where it hides nothing.
    return visible >= width + 24 ? { ...route.label, align: 'center' } : { x: route.label.x, y: Math.min(route.label.y, boxesTop) - LABEL_HEIGHT / 2 - 4, align: 'center' };
  }
  // A label sits across a line that runs down: it needs room above and below it.
  return visible >= LABEL_HEIGHT + 24 ? { ...route.label, align: 'center' } : { x: route.label.x + 126, y: route.label.y, align: 'start' };
};

/**
 * An arrow's label. Labels are drawn above the boxes, so one that has to sit
 * off its line is never hidden behind a card.
 */
function ArrowLabel({ arrow, route, boxesTop }: { arrow: ArrowElement; route: ArrowRoute; boxesTop: number }) {
  const labelAt = arrowLabelPlace(route, arrow.text, boxesTop);
  return (
    <foreignObject x={labelAt.x - 120} y={labelAt.y - 14} width={240} height={28} className="pointer-events-none overflow-visible">
      <div className={cn('flex h-full items-center', labelAt.align === 'start' ? 'justify-start' : 'justify-center')}>
        <span
          className="max-w-[220px] truncate rounded-md px-2 py-1 text-[11px] font-medium leading-none"
          style={{ background: 'var(--background)', color: 'color-mix(in oklab, var(--foreground) 80%, transparent)' }}
        >
          {plainText(arrow.text)}
        </span>
      </div>
    </foreignObject>
  );
}

function ArrowView({ arrow, route, selected, interactive, onDoubleClick }: {
  arrow: ArrowElement;
  route: ArrowRoute;
  selected: boolean;
  interactive: boolean;
  onDoubleClick?: (element: WhiteboardElement) => void;
}) {
  const color = selected ? 'var(--interactive-border-focus)' : arrowColor(arrow.color);
  const points = gappedPoints(route.points);
  const tip = points[points.length - 1];
  const before = points[points.length - 2];
  const dx = Math.sign(tip.x - before.x);
  const dy = Math.sign(tip.y - before.y);
  const base = { x: tip.x - dx * ARROWHEAD, y: tip.y - dy * ARROWHEAD };
  // An open chevron, drawn with the same stroke as the line.
  const head = `M ${base.x - dy * ARROWHEAD} ${base.y + dx * ARROWHEAD} L ${tip.x} ${tip.y} L ${base.x + dy * ARROWHEAD} ${base.y - dx * ARROWHEAD}`;
  const path = routePath(points);
  return (
    <g>
      <path d={path} fill="none" stroke={color} strokeWidth={selected ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round" />
      <path d={head} fill="none" stroke={color} strokeWidth={selected ? 2 : 1.5} strokeLinecap="round" strokeLinejoin="round" />
      {interactive ? (
        <path
          data-element-id={arrow.id}
          className="pointer-events-auto cursor-pointer"
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth={14}
          onDoubleClick={onDoubleClick ? () => onDoubleClick(arrow) : undefined}
        />
      ) : null}
    </g>
  );
}

export type WhiteboardSceneProps = {
  elements: readonly WhiteboardElement[];
  /** Where a box is drawn, which differs from where it is stored while it is dragged. */
  rectOf?: (element: BoxElement) => Rect;
  interactive?: boolean;
  selection?: ReadonlySet<string>;
  highlighted?: ReadonlySet<string>;
  editingId?: string | null;
  boxCursor?: string;
  /** The board the pictures belong to; without it pictures show their placeholder. */
  boardId?: string;
  /** The part of the board on screen; elements away from it are not drawn. */
  visibleRect?: Rect | null;
  /** Elements drawn wherever they are: the selected, edited or dragged ones. */
  keep?: ReadonlySet<string>;
  onDoubleClick?: (element: WhiteboardElement) => void;
};

/**
 * The elements of a board in board units: sections at the back, arrows over
 * them, then every other box in paint order. The canvas wraps it in its pan
 * and zoom; the gallery draws it small.
 */
export function WhiteboardScene({
  elements,
  rectOf = (element) => element,
  interactive = false,
  selection,
  highlighted,
  editingId = null,
  boxCursor,
  onDoubleClick,
  boardId,
  visibleRect = null,
  keep = EMPTY_KEEP,
}: WhiteboardSceneProps) {
  const drawn = visibleRect ? elementsInView(elements, visibleRect, rectOf, keep) : elements;
  // Every arrow is routed, drawn or not, so each claims its sides in the same order.
  const routes = React.useMemo(() => routeBoard(elements, rectOf), [elements, rectOf]);
  const boxes = drawn.filter(isBox);
  const byId = React.useMemo(() => new Map(elements.filter(isBox).map((element) => [element.id, element])), [elements]);
  const renderBox = (element: BoxElement) => (
    <BoxView
      key={element.id}
      element={element}
      rect={rectOf(element)}
      interactive={interactive}
      hideText={editingId === element.id}
      highlighted={highlighted?.has(element.id) ?? false}
      cursor={boxCursor}
      onDoubleClick={onDoubleClick}
      boardId={boardId}
    />
  );
  return (
    <>
      {boxes.filter((element) => element.kind === 'section').map(renderBox)}
      <svg className="pointer-events-none absolute start-0 top-0 overflow-visible" width={1} height={1} aria-hidden>
        {drawn.map((element) => {
          if (element.kind !== 'arrow') return null;
          const route = routes.get(element.id);
          if (!route) return null;
          return (
            <ArrowView
              key={element.id}
              arrow={element}
              route={route}
              selected={selection?.has(element.id) ?? false}
              interactive={interactive}
              onDoubleClick={onDoubleClick}
            />
          );
        })}
      </svg>
      {boxes.filter((element) => element.kind !== 'section').map(renderBox)}
      <svg className="pointer-events-none absolute start-0 top-0 overflow-visible" width={1} height={1} aria-hidden>
        {drawn.map((element) => {
          if (element.kind !== 'arrow' || !element.text) return null;
          const route = routes.get(element.id);
          const from = byId.get(element.from);
          const to = byId.get(element.to);
          if (!route || !from || !to) return null;
          return <ArrowLabel key={element.id} arrow={element} route={route} boxesTop={Math.min(rectOf(from).y, rectOf(to).y)} />;
        })}
      </svg>
    </>
  );
}
