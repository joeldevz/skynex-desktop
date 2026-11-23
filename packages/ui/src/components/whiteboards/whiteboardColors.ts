import type { WhiteboardColor } from '@/lib/whiteboards/model';

/**
 * Board colors are content the user and the agent choose, drawn from the
 * theme's own hues so a board stays readable in every theme. Sticky notes are
 * the one exception: they are paper, light in every theme with dark ink, the
 * way people expect a sticky note to look.
 */
const HUE = {
  gray: 'var(--surface-muted-foreground)',
  red: 'var(--status-error)',
  orange: 'color-mix(in oklab, var(--status-warning) 55%, var(--status-error))',
  // Themes' warning hue leans orange; a touch of the success hue brings it to yellow.
  yellow: 'color-mix(in oklab, var(--status-warning) 72%, var(--status-success))',
  green: 'var(--status-success)',
  blue: 'var(--status-info)',
  purple: 'var(--pr-merged)',
  pink: 'color-mix(in oklab, var(--status-error) 55%, var(--pr-merged))',
} satisfies Record<WhiteboardColor, string>;

const colorHue = (color: WhiteboardColor | undefined): string => HUE[color ?? 'gray'];

const isNeutral = (color: WhiteboardColor | undefined): boolean => color === undefined || color === 'gray';

type Paint = { fill: string; stroke: string; text: string };

/**
 * A color at a set lightness, keeping its hue and softening its chroma. The
 * theme palette is bright in dark themes and deep in light ones; pinning the
 * lightness gives boards the same pastel cards in both.
 */
const tone = (hue: string, lightness: number, chroma: number): string => `oklch(from ${hue} ${lightness} min(c, ${chroma}) h)`;

/**
 * A block: a solid pastel card in its hue with dark ink, readable at a
 * glance in dark and light themes alike, the way diagram tools draw them.
 * The neutral one is a light gray card.
 */
export const blockPaint = (color: WhiteboardColor | undefined): Paint => {
  const hue = colorHue(color);
  const chroma = isNeutral(color) ? 0.012 : 0.095;
  return {
    fill: tone(hue, 0.87, chroma),
    stroke: tone(hue, 0.62, chroma),
    text: tone(hue, 0.24, Math.min(chroma, 0.04)),
  };
};

/** A sticky note: light paper in its hue, dark ink, a folded corner one shade deeper. */
export const notePaint = (color: WhiteboardColor | undefined): Paint & { fold: string } => {
  const hue = colorHue(color ?? 'yellow');
  return {
    fill: tone(hue, 0.92, 0.09),
    stroke: tone(hue, 0.86, 0.09),
    text: tone(hue, 0.26, 0.04),
    fold: tone(hue, 0.84, 0.1),
  };
};

/** A section: a quiet frame with a hairline, named above its top edge. */
export const sectionPaint = (color: WhiteboardColor | undefined): Paint => (isNeutral(color)
  ? {
    fill: 'color-mix(in oklab, var(--foreground) 3%, transparent)',
    stroke: 'color-mix(in oklab, var(--foreground) 22%, transparent)',
    text: 'color-mix(in oklab, var(--foreground) 80%, transparent)',
  }
  : {
    fill: `color-mix(in oklab, ${colorHue(color)} 6%, transparent)`,
    stroke: `color-mix(in oklab, ${colorHue(color)} 45%, transparent)`,
    text: `color-mix(in oklab, ${colorHue(color)} 60%, var(--foreground))`,
  });

/** The backdrop behind a board's thumbnail: a deep wash of its main color, or a quiet gray. */
export const boardTint = (color: WhiteboardColor | undefined): string => (isNeutral(color)
  ? 'color-mix(in oklab, var(--foreground) 10%, var(--background))'
  : `color-mix(in oklab, ${colorHue(color)} 30%, var(--background))`);

export const textColor = (color: WhiteboardColor | undefined): string => (isNeutral(color)
  ? 'var(--foreground)'
  : `color-mix(in oklab, ${colorHue(color)} 75%, var(--foreground))`);

export const arrowColor = (color: WhiteboardColor | undefined): string => (isNeutral(color)
  ? 'color-mix(in oklab, var(--foreground) 88%, transparent)'
  : colorHue(color));


/** Lifts boxes off the canvas the way the app's raised controls lift. */
export const BOX_SHADOW = 'drop-shadow(0 1px 1px rgb(0 0 0 / 0.12)) drop-shadow(0 4px 10px rgb(0 0 0 / 0.10))';

