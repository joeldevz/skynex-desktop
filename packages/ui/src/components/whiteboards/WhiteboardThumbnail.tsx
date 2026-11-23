import React from 'react';

import { useThemeSystem } from '@/contexts/useThemeSystem';
import { cn } from '@/lib/utils';
import { boardBounds, isBox, routeBoard, type BoxElement, type Whiteboard, type WhiteboardColor } from '@/lib/whiteboards/model';
import { arrowColor, blockPaint, boardTint, notePaint, sectionPaint, textColor } from './whiteboardColors';
import { boxFontSize } from './whiteboardText';
import { plainText } from '@/lib/whiteboards/richText';

const PADDING = 32;
// Text smaller than this on the thumbnail is drawn as a line: nobody reads it there.
const MIN_READABLE_PX = 5;

/**
 * Board colors are theme expressions (`var()`, `color-mix()`); a canvas needs
 * them resolved. A hidden probe inside the thumbnail resolves each one once
 * per drawing, in the thumbnail's own color context.
 */
const colorResolver = (host: HTMLElement) => {
  const probe = document.createElement('span');
  probe.style.display = 'none';
  host.append(probe);
  const resolved = new Map<string, string>();
  return {
    resolve: (css: string): string => {
      const known = resolved.get(css);
      if (known) return known;
      probe.style.color = '';
      probe.style.color = css;
      const value = getComputedStyle(probe).color;
      resolved.set(css, value);
      return value;
    },
    dispose: () => probe.remove(),
  };
};

/**
 * The words of a card, drawn small: real text when it can be read at this
 * size, otherwise a bar per line, the way a page looks from afar.
 */
const drawWords = (context: CanvasRenderingContext2D, element: BoxElement, ink: string, scale: number, centered: boolean) => {
  const lines = plainText(element.text).split('\n').filter((line) => line.trim()).slice(0, 3);
  if (lines.length === 0) return;
  const size = boxFontSize(element);
  const lineHeight = size * 1.4;
  const inset = 12;
  const width = element.w - inset * 2;
  const top = centered ? element.y + (element.h - lines.length * lineHeight) / 2 : element.y + inset;
  context.save();
  context.beginPath();
  context.rect(element.x, element.y, element.w, element.h);
  context.clip();
  context.fillStyle = ink;
  context.textBaseline = 'top';
  context.textAlign = centered ? 'center' : 'left';
  const readable = size * scale >= MIN_READABLE_PX;
  if (!readable) context.globalAlpha = 0.45;
  lines.forEach((line, index) => {
    const y = top + index * lineHeight;
    const titled = lines.length > 1 && index === 0;
    if (readable) {
      context.font = `${titled ? 700 : 400} ${size}px sans-serif`;
      context.fillText(line, centered ? element.x + element.w / 2 : element.x + inset, y, width);
      return;
    }
    const bar = Math.min(width, line.length * size * 0.5);
    context.fillRect(centered ? element.x + (element.w - bar) / 2 : element.x + inset, y + size * 0.2, bar, size * (titled ? 0.75 : 0.6));
  });
  context.restore();
};

const drawBox = (context: CanvasRenderingContext2D, element: BoxElement, color: (css: string) => string, scale: number) => {
  const { x, y, w, h } = element;
  context.lineWidth = 1.5;
  if (element.kind === 'section') {
    const paint = sectionPaint(element.color);
    context.beginPath();
    context.roundRect(x, y, w, h, 10);
    context.fillStyle = color(paint.fill);
    context.fill();
    context.strokeStyle = color(paint.stroke);
    context.stroke();
    const name = plainText(element.text).split('\n')[0];
    if (name && 13 * scale >= MIN_READABLE_PX) {
      context.fillStyle = color(paint.text);
      context.font = '500 13px sans-serif';
      context.textBaseline = 'bottom';
      context.textAlign = 'left';
      context.fillText(name, x, y - 6, w);
    }
    return;
  }
  if (element.kind === 'note') {
    const paint = notePaint(element.color);
    context.fillStyle = color(paint.fill);
    context.fillRect(x, y, w, h);
    drawWords(context, element, color(paint.text), scale, false);
    return;
  }
  if (element.kind === 'image') {
    context.beginPath();
    context.roundRect(x, y, w, h, 12);
    context.fillStyle = color('color-mix(in oklab, var(--foreground) 14%, var(--surface-elevated))');
    context.fill();
    return;
  }
  if (element.kind === 'text') {
    context.fillStyle = color(textColor(element.color));
    const size = element.size === 'title' ? 32 : element.size === 'heading' ? 22 : element.size === 'small' ? 12 : 15;
    if (size * scale >= MIN_READABLE_PX) {
      context.font = `600 ${size}px sans-serif`;
      context.textBaseline = 'top';
      context.fillText(plainText(element.text).split('\n')[0] ?? '', x, y, w);
    } else {
      context.fillRect(x, y + h / 3, Math.min(w, element.text.length * size * 0.5), size * 0.6);
    }
    return;
  }
  const paint = blockPaint(element.color);
  const form = element.form ?? 'rounded';
  context.beginPath();
  if (form === 'diamond') {
    context.moveTo(x + w / 2, y);
    context.lineTo(x + w, y + h / 2);
    context.lineTo(x + w / 2, y + h);
    context.lineTo(x, y + h / 2);
    context.closePath();
  } else {
    context.roundRect(x, y, w, h, form === 'rect' ? 2 : form === 'pill' ? h / 2 : Math.min(8, h / 4));
  }
  context.fillStyle = color(paint.fill);
  context.fill();
  drawWords(context, element, color(paint.text), scale, true);
};

/** The color a board is mostly drawn in: its cards and notes, by count, first come first. */
const mainColor = (board: Whiteboard): WhiteboardColor | undefined => {
  const counts = new Map<WhiteboardColor, number>();
  for (const element of board.elements) {
    if (element.kind !== 'block' && element.kind !== 'note') continue;
    const color = element.color ?? (element.kind === 'note' ? 'yellow' : 'gray');
    if (color !== 'gray') counts.set(color, (counts.get(color) ?? 0) + 1);
  }
  let best: WhiteboardColor | undefined;
  for (const [color, count] of counts) if (!best || count > (counts.get(best) ?? 0)) best = color;
  return best;
};

/**
 * The whole board drawn small, for the gallery and the board picker: a sheet
 * on a backdrop in the board's main color, cut off at the bottom like a page
 * in a folder. One canvas instead of the board's elements: a gallery of large
 * boards would otherwise keep thousands of elements alive just to be looked
 * at in miniature.
 */
export function WhiteboardThumbnail({ board, className, sheetClassName }: { board: Whiteboard; className?: string; sheetClassName?: string }) {
  const sheetRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const [frame, setFrame] = React.useState({ width: 0, height: 0 });
  // The colors are drawn, not styled: a theme switch draws the board again.
  const { currentTheme } = useThemeSystem();

  React.useLayoutEffect(() => {
    const node = sheetRef.current;
    if (!node) return undefined;
    const update = () => setFrame({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    const canvas = canvasRef.current;
    const host = sheetRef.current;
    const bounds = boardBounds(board.elements);
    if (!canvas || !host || frame.width === 0 || frame.height === 0) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(frame.width * ratio);
    canvas.height = Math.round(frame.height * ratio);
    const context = canvas.getContext('2d');
    if (!context || !bounds) return;
    // Section names sit above their frame: leave room for them at the top.
    const top = PADDING + 24;
    const scale = Math.min(frame.width / (bounds.w + PADDING * 2), frame.height / (bounds.h + top + PADDING), 0.6);
    const resolver = colorResolver(host);
    try {
      context.setTransform(ratio * scale, 0, 0, ratio * scale, 0, 0);
      // Centered across, from the top down: the sheet runs on below the fold.
      context.translate((frame.width / scale - bounds.w) / 2 - bounds.x, top - bounds.y);
      const boxes = board.elements.filter(isBox);
      for (const element of boxes) if (element.kind === 'section') drawBox(context, element, resolver.resolve, scale);
      const routes = routeBoard(board.elements);
      context.lineWidth = 1.25 / Math.max(scale, 0.05) * 0.5;
      for (const element of board.elements) {
        if (element.kind !== 'arrow') continue;
        const route = routes.get(element.id);
        if (!route) continue;
        context.beginPath();
        context.moveTo(route.points[0].x, route.points[0].y);
        for (const point of route.points.slice(1)) context.lineTo(point.x, point.y);
        context.strokeStyle = resolver.resolve(arrowColor(element.color));
        context.stroke();
      }
      for (const element of boxes) if (element.kind !== 'section') drawBox(context, element, resolver.resolve, scale);
    } finally {
      resolver.dispose();
    }
  }, [board.elements, currentTheme, frame.height, frame.width]);

  return (
    <div aria-hidden className={cn('pointer-events-none relative overflow-hidden scrollbar-none', className)} style={{ background: boardTint(mainColor(board)) }}>
      <div
        ref={sheetRef}
        className={cn('absolute inset-x-[11%] -bottom-3 top-[14%] overflow-hidden scrollbar-none rounded-lg bg-background', sheetClassName)}
        style={{ boxShadow: '0 0 0 1px color-mix(in oklab, var(--foreground) 8%, transparent), 0 6px 20px -6px rgb(0 0 0 / 0.35)' }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 size-full" />
      </div>
    </div>
  );
}
