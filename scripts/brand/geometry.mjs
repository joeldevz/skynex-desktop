// The Skynex mark as code: every drawing of the logo is built here.
//
// Units are the cube's own: half-width 41.568, half-height 48, centred on the
// origin. The roof is the rhombus around (0, -24); the tiers are smaller
// rhombi with the same centre.

const HX = 41.568;
const ROOF_HY = 24;
const ROOF_CY = -24;

const fmt = (n) => Number(n.toFixed(3)).toString();

export const SKYNET_S = 'M706 322c-45-67-117-103-211-103-115 0-191 57-191 145 0 78 55 116 198 145l44 9c136 28 184 69 184 145 0 93-82 150-216 150-102 0-183-37-239-109';
export const S_MARK_TRANSFORM = 'scale(0.1) translate(-512 -512)';

const polygon = (points) => `M${points.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join(' L')} Z`;

const rhombusPoints = (scale, { cx = 0, cy = ROOF_CY, hx = HX, hy = ROOF_HY } = {}) => [
  [cx, cy - hy * scale],
  [cx + hx * scale, cy],
  [cx, cy + hy * scale],
  [cx - hx * scale, cy],
];

/** Roof rhombus, or a tier inside it, at `scale` of the roof. */
export const rhombus = (scale, frame) => polygon(rhombusPoints(scale, frame));

/** The same rhombus wound the other way, to cut a hole with the nonzero rule. */
const rhombusReversed = (scale, frame) => {
  const [top, right, bottom, left] = rhombusPoints(scale, frame);
  return polygon([top, left, bottom, right]);
};

/** A ring between two rhombi of the same centre. */
const rhombusRing = (outer, inner, frame) => `${rhombus(outer, frame)} ${rhombusReversed(inner, frame)}`;

const SHELL_PATHS = [
  'M0 -48 L-41.568 -24 L0 0 L41.568 -24 Z',
  'M-41.568 -24 L-41.568 24 L0 48 L41.568 24 L41.568 -24',
  'M0 0 L0 48',
];
// Inner shading of the open shell: the triangles of the back walls a viewer
// sees through the missing front walls.
const LEFT_SHADE = 'M-41.568 -24 L-41.568 24 L0 0 Z';
const RIGHT_SHADE = 'M41.568 -24 L0 0 L41.568 24 Z';
const FLOOR_SHADE = 'M0 0 L-41.568 24 L0 48 L41.568 24 Z';
const OUTER_HEXAGON = 'M0 -51.12 L44.27 -25.56 L44.27 25.56 L0 51.12 L-44.27 25.56 L-44.27 -25.56 Z';

/** Tier scales, outer to core. */
export const TIER_SCALES = [0.8, 0.58, 0.36];

const shellStrokes = (color, width) => (
  `<g fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round">`
  + SHELL_PATHS.map((d) => `<path d="${d}"/>`).join('')
  + '</g>'
);

const wallGradients = (idPrefix, color, strength) => {
  const stop = (offset, opacity) => `<stop offset="${offset}" stop-color="${color}" stop-opacity="${fmt(opacity * strength)}"/>`;
  return (
    `<linearGradient id="${idPrefix}l" gradientUnits="userSpaceOnUse" x1="-42" y1="-20" x2="-2" y2="12">${stop(0, 0.08)}${stop(0.72, 0.46)}${stop(1, 0.64)}</linearGradient>`
    + `<linearGradient id="${idPrefix}r" gradientUnits="userSpaceOnUse" x1="40" y1="3" x2="3" y2="-16">${stop(0, 0.23)}${stop(0.68, 0.56)}${stop(1, 0.72)}</linearGradient>`
  );
};

// Light pooling on the floor the open front shows; the app icon only.
const floorGradient = (id, color, strength) => {
  const stop = (offset, opacity) => `<stop offset="${offset}" stop-color="${color}" stop-opacity="${fmt(opacity * strength)}"/>`;
  return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="-13" cy="34" r="54" gradientTransform="translate(-13 34) rotate(-24) scale(1 0.7) translate(13 -34)">${stop(0, 0.015)}${stop(0.76, 0.19)}${stop(1, 0.35)}</radialGradient>`;
};

// ---------------------------------------------------------------------------
// In-app logo: the open shell in one colour (the theme's text colour), wall
// shading, a faint roof and three tiers. Shown on every splash, About, sign-in
// and empty state.

/** Resting tier opacities, outer to core, and while each tier is lit. */
export const FLAT_TIER_OPACITY = [0.22, 0.27, 0.85];
export const FLAT_TIER_REST = [0.12, 0.15, 0.38];
export const FLAT_TIER_LIT = [0.55, 0.48, 0.85];
const FLAT_ROOF_OPACITY = 0.08;
const FLAT_STROKE = 2.2;
const FLAT_WALL_STRENGTH = 0.31;

export const FLAT_LOGO = {
  viewBox: '-50 -50 100 100',
  leftShade: LEFT_SHADE,
  rightShade: RIGHT_SHADE,
  roof: rhombus(1),
  roofOpacity: FLAT_ROOF_OPACITY,
  tiers: TIER_SCALES.map((scale) => rhombus(scale)),
  shell: SHELL_PATHS,
  stroke: FLAT_STROKE,
  wallStrength: FLAT_WALL_STRENGTH,
  wallStops: {
    left: { x1: -42, y1: -20, x2: -2, y2: 12, stops: [[0, 0.08], [0.72, 0.46], [1, 0.64]] },
    right: { x1: 40, y1: 3, x2: 3, y2: -16, stops: [[0, 0.23], [0.68, 0.56], [1, 0.72]] },
  },
};

/**
 * Inner markup of the in-app logo for a `viewBox="-50 -50 100 100"` svg.
 * `color` is any SVG paint (`currentColor`, a CSS variable). Tier paths carry
 * `data-tier` (0 outer .. 2 core) so a page script can light them in turn.
 */
export const flatLogoInner = ({ color = 'currentColor', idPrefix = 'oc-logo-' } = {}) => (
  `<path d="${SKYNET_S}" transform="${S_MARK_TRANSFORM}" fill="none" stroke="${color}" stroke-width="86" stroke-linecap="round" stroke-linejoin="round"/>`
);

export const flatLogoSvg = ({ color, size = 512 }) => (
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-50 -50 100 100">`
  + flatLogoInner({ color })
  + '</svg>\n'
);

// ---------------------------------------------------------------------------
// Icon without a tile: Windows, Linux, the VS Code Marketplace, and on a black
// square for phone home screens. The open shell of the dark app icon: the
// cube's inside is dark grey, the back walls and floor show through the open
// front with the same shading, opaque grey tiers, white edges, and a thin
// black outer outline so it reads on light and dark taskbars alike.

const NO_TILE = {
  outline: '#000000',
  inside: '#2a2b2f',
  tiers: ['#787a80', '#9fa1a6', '#d4d5d8'],
  tierOpacity: 0.85,
  edge: '#f5f5f7',
};
const CUBE_SILHOUETTE = 'M0 -48 L41.568 -24 L41.568 24 L0 48 L-41.568 24 L-41.568 -24 Z';

const noTileInner = () => (
  `<path d="${SKYNET_S}" transform="${S_MARK_TRANSFORM}" fill="none" stroke="#73C991" stroke-width="86" stroke-linecap="round" stroke-linejoin="round"/>`
);

// Construction tape across the lower cube, the full width of a picture `view`
// units wide: marks an unpackaged development copy.
const devTape = (view) => {
  const stripe = view * 0.0625;
  return (
    `<defs><pattern id="tape-stripes" width="${fmt(stripe)}" height="${fmt(stripe)}" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
    + `<rect width="${fmt(stripe)}" height="${fmt(stripe)}" fill="#1b1b1b"/><rect width="${fmt(stripe / 2)}" height="${fmt(stripe)}" fill="#d6a23c"/></pattern></defs>`
    + `<g transform="rotate(-9)"><rect x="${fmt(-view * 0.55)}" y="${fmt(view * 0.145)}" width="${fmt(view * 1.1)}" height="${fmt(view * 0.146)}" fill="url(#tape-stripes)"/></g>`
  );
};

/** The tape alone on a transparent square, to lay over a finished icon. */
export const devTapeSvg = ({ size = 1024 } = {}) => (
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-53 -53 106 106">${devTape(106)}</svg>\n`
);

/**
 * `cubeShare` is the cube's height as a share of the square (1 = touches the
 * edges). `background` fills the square; `tape` adds the development-copy tape.
 */
export const noTileIconSvg = ({ size = 1024, background = null, cubeShare = 1, tape = false } = {}) => {
  const view = 106 / cubeShare;
  const half = view / 2;
  const back = background ? `<rect x="${fmt(-half)}" y="${fmt(-half)}" width="${fmt(view)}" height="${fmt(view)}" fill="${background}"/>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${fmt(-half)} ${fmt(-half)} ${fmt(view)} ${fmt(view)}">`
    + back + noTileInner() + (tape ? devTape(view) : '')
    + '</svg>\n'
  );
};

// ---------------------------------------------------------------------------
// Small glyph, one colour: menu bar, favicon, VS Code, model picker, Android
// notification and themed icon. Drawn on a 32 grid.

export const GLYPH_STROKE = 1.4;
export const GLYPH_RING_OPACITY = [0.3, 0.75];
const GLYPH_MARK_TRANSFORM = 'translate(16 16) scale(0.03125) translate(-512 -512)';
const glyphMarkPath = ({ color, width, opacity = 1 }) => (
  `<path d="${SKYNET_S}" transform="${GLYPH_MARK_TRANSFORM}" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${fmt(opacity)}" stroke-linecap="round" stroke-linejoin="round"/>`
);

/**
 * Inner markup of the glyph on a 32 grid. `walls` fills the side walls (the
 * menu bar's "unread" state); `rings` overrides the outer and inner ring
 * opacities (the busy breath).
 */
export const glyphInner = ({ color = 'currentColor', stroke = GLYPH_STROKE, walls = 0, rings = GLYPH_RING_OPACITY } = {}) => {
  const breathing = rings.some((value, index) => value !== GLYPH_RING_OPACITY[index]);
  const breathPhase = Math.min(1, Math.max(0, (rings[0] - 0.36) / 0.54));
  const glyphOpacity = breathing ? 0.35 + breathPhase * 0.65 : 1;
  return glyphMarkPath({ color, width: stroke * 42, opacity: glyphOpacity })
    + (walls > 0 ? `<circle cx="27" cy="6.5" r="3.8" fill="${color}" fill-opacity="0.95"/>` : '');
};

/** `zoom` enlarges the glyph inside its square, around the cube's centre. */
export const glyphSvg = ({ size = 32, style = '', zoom = 1, tape = false, ...options } = {}) => {
  const side = 32 / zoom;
  const view = zoom === 1 ? '0 0 32 32' : `${fmt(16 - side / 2)} ${fmt(16.25 - side / 2)} ${fmt(side)} ${fmt(side)}`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${view}">`
    + style + glyphInner(options) + (tape ? devTape(32) : '')
    + '</svg>\n'
  );
};

// The menu bar slot is 18 pt; the old cube filled it edge to edge, and the
// thinner glyph next to other menu bar icons looked small at the 32 grid.
export const MENU_BAR_GLYPH_ZOOM = 1.05;

/**
 * The glyph for an SF Symbol: symbols are one colour, so the two rings become
 * one solid ring, and the strokes are bolder to hold up at symbol sizes.
 */
export const glyphSymbolSvg = () => (
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
  + `<path d="${SKYNET_S}" transform="${GLYPH_MARK_TRANSFORM}" fill="none" stroke="#000000" stroke-width="58.8" stroke-linecap="round" stroke-linejoin="round"/>`
  + '</svg>\n'
);

/** Menu bar busy breath: frame `i` of 16, eased in and out. */
export const glyphBreathRings = (i) => {
  const e = 0.1 + 0.9 * (1 - Math.cos((Math.PI * i) / 15)) / 2;
  return [GLYPH_RING_OPACITY[0] + 0.6 * e, GLYPH_RING_OPACITY[1] + 0.25 * e];
};
export const GLYPH_UNSEEN_WALLS = 0.6;

// ---------------------------------------------------------------------------
// macOS and iOS app icon: an Icon Composer document. Layer art is white on a
// transparent 1024 canvas; colour comes from the document, so Clear and Tinted
// get real layers to work with.

const LAYER_SCALE = 9.6;
const layerSvg = (inner, defs = '') => (
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><defs>${defs}</defs>`
  + `<g transform="translate(512 512) scale(${LAYER_SCALE})">${inner}</g></svg>`
);

export const appIconLayerSvgs = () => {
  return {
    'shell.png': layerSvg(`<path d="${SKYNET_S}" transform="${S_MARK_TRANSFORM}" fill="none" stroke="white" stroke-width="86" stroke-linecap="round" stroke-linejoin="round"/>`),
  };
};

/** A solid fill, for every appearance or for the named one. */
const solid = (rgb, appearance) => {
  const value = { solid: `srgb:${rgb.map((c) => c.toFixed(5)).join(',')},1.00000` };
  return appearance ? { appearance, value } : { value };
};
const position = () => [{ idiom: 'square', value: { scale: 1.15, 'translation-in-points': [-0.65, -3.25] } }];
const layer = (name, { glass, opacity = [{ value: 1 }], fill }) => ({
  'image-name': `${name}.png`,
  name,
  'glass-specializations': glass,
  'opacity-specializations': opacity,
  'position-specializations': position(),
  'fill-specializations': fill,
});

/**
 * The Icon Composer document. The S mark uses one glass layer over light and
 * dark automatic tiles.
 */
export const appIconDocument = () => {
  const white = [0.96, 0.96, 0.97];
  const lineGrey = [0.22, 0.22, 0.23];
  const shellFill = [solid(lineGrey), solid(white, 'dark'), solid(white, 'tinted')];
  const shellGlass = [{ value: false }, { appearance: 'dark', value: true }, { appearance: 'tinted', value: true }];
  return {
    'fill-specializations': [
      { value: { 'automatic-gradient': 'srgb:0.95000,0.95000,0.96000,1.00000' } },
      solid([0.075, 0.075, 0.085], 'dark'),
    ],
    groups: [{
      layers: [layer('shell', { glass: shellGlass, fill: shellFill })],
      shadow: { kind: 'neutral', opacity: 0.5 },
      translucency: { enabled: true, value: 0.5 },
    }],
    'supported-platforms': { circles: ['watchOS'], squares: 'shared' },
  };
};
