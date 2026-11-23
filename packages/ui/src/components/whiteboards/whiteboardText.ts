import type React from 'react';

import type { BoxElement, Rect, TextAlign, TextSize } from '@/lib/whiteboards/model';
import { blockPaint, notePaint, sectionPaint, textColor } from './whiteboardColors';

const TEXT_STYLE = {
  title: { fontSize: 32, fontWeight: 700, letterSpacing: '-0.015em', lineHeight: 1.15 },
  heading: { fontSize: 22, fontWeight: 650, letterSpacing: '-0.01em', lineHeight: 1.2 },
  body: { fontSize: 15, fontWeight: 400, letterSpacing: 0, lineHeight: 1.45 },
  small: { fontSize: 12, fontWeight: 400, letterSpacing: 0, lineHeight: 1.4 },
} satisfies Record<TextSize, React.CSSProperties>;

const textStyleFor = (size: TextSize | undefined): React.CSSProperties => TEXT_STYLE[size ?? 'body'];

// Cards and notes read at a glance: their sizes step less than a free text's.
const BLOCK_FONT = { title: 22, heading: 17, body: 13, small: 11 } satisfies Record<TextSize, number>;
const NOTE_FONT = { title: 24, heading: 18, body: 14, small: 12 } satisfies Record<TextSize, number>;

/** How the lines of a box's text line up: as set, else blocks center and notes and texts start. */
export const textAlignOf = (element: BoxElement): TextAlign => {
  if (element.kind === 'block') return element.align ?? 'center';
  if (element.kind === 'note' || element.kind === 'text') return element.align ?? 'start';
  return 'start';
};

const px = (vertical: number, horizontal: number, bottom = vertical): string => `${Math.round(vertical)}px ${Math.round(horizontal)}px ${Math.round(bottom)}px`;

/**
 * The room a block's text keeps from its outline. Each form keeps the text
 * inside the part of the shape that is really there: clear of a pill's round
 * ends, inside a diamond's middle, under a database's lid.
 */
const blockInsets = (form: Extract<BoxElement, { kind: 'block' }>['form'], rect: Rect): string => {
  if (form === 'pill') return px(8, Math.max(20, rect.h * 0.38));
  if (form === 'diamond') return px(rect.h * 0.22, rect.w * 0.21);
  if (form === 'database') {
    const lid = Math.min(rect.h * 0.14, 14);
    return px(lid * 2 + 6, 16, lid + 8);
  }
  if (form === 'rect') return px(10, 14);
  return px(12, 18);
};

/** How the text of a box is laid out, shared by the box and its text editor. */
export const boxTextStyle = (element: BoxElement, rect: Rect = element): React.CSSProperties => {
  if (element.kind === 'text') return { ...textStyleFor(element.size), color: textColor(element.color), textAlign: textAlignOf(element), padding: '2px 4px' };
  if (element.kind === 'note') return { fontSize: NOTE_FONT[element.size ?? 'body'], lineHeight: 1.45, color: notePaint(element.color).text, textAlign: textAlignOf(element), padding: px(14, 16, 20) };
  if (element.kind === 'image') return { fontSize: 12, fontWeight: 500, lineHeight: 1.3, color: 'var(--foreground)', textAlign: 'start', padding: '4px 10px' };
  if (element.kind === 'section') return { fontSize: 13, fontWeight: 500, lineHeight: 1.3, color: sectionPaint(element.color).text, textAlign: 'start', padding: '0' };
  return {
    fontSize: BLOCK_FONT[element.size ?? 'body'],
    fontWeight: 400,
    lineHeight: 1.4,
    color: blockPaint(element.color).text,
    textAlign: textAlignOf(element),
    padding: blockInsets(element.form ?? 'rounded', rect),
  };
};

/** The font size a box's text is set in, which the text editor sizes its lines by. */
export const boxFontSize = (element: BoxElement): number => {
  if (element.kind === 'text') return TEXT_STYLE[element.size ?? 'body'].fontSize;
  if (element.kind === 'image') return 12;
  if (element.kind === 'note') return NOTE_FONT[element.size ?? 'body'];
  if (element.kind === 'block') return BLOCK_FONT[element.size ?? 'body'];
  return 13;
};

/**
 * Text as shown on the board, with soft break points after path and name
 * separators, so `/api/whiteboards` or `skynex_whiteboard` wraps at a slash
 * or an underscore instead of in the middle of a word. Display only: the
 * stored text never changes.
 */
export const withSoftBreaks = (text: string): string => text.replace(/([/_.:\\-])(?=[^\s/_.:\\-])/g, '$1\u200B');
