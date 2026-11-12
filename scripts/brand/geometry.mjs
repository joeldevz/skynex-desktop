// The supplied filled silhouette is the source for every generated mark.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const fmt = (n) => Number(n.toFixed(3)).toString();

const suppliedLogo = readFileSync(fileURLToPath(new URL('./skynex-logo.svg', import.meta.url)), 'utf8');
export const SKYNET_S = suppliedLogo.match(/<path\s+fill="#[^"]+"\s+d="([^"]+)"/)?.[1];
if (!SKYNET_S) throw new Error('scripts/brand/skynex-logo.svg has no filled path');
export const S_MARK_TRANSFORM = 'translate(-42 -49) scale(0.4)';
const ribbonSvg = readFileSync(fileURLToPath(new URL('./skynex-logo-ribbon.svg', import.meta.url)), 'utf8');
export const RIBBON_VIEW_BOX = ribbonSvg.match(/viewBox="([^"]+)"/)?.[1];
export const RIBBON_ANIMATION = [...ribbonSvg.matchAll(/<animate\b([^>]*)\/>/g)].map(([, attributes]) => {
  const values = Object.fromEntries([...attributes.matchAll(/([\w]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]));
  const animation = { attributeName: values.attributeName, dur: values.dur, fill: values.fill ?? 'remove', values: values.values?.split(';') ?? [] };
  if (values.calcMode) animation.calcMode = values.calcMode;
  return animation;
});
if (!RIBBON_VIEW_BOX || RIBBON_ANIMATION.length !== 2) throw new Error('scripts/brand/skynex-logo-ribbon.svg has incomplete animation data');

/**
 * Inner markup of the in-app logo for a `viewBox="-50 -50 100 100"` svg.
 * `color` accepts currentColor or a CSS variable for theme contrast.
 */
export const flatLogoInner = ({ color = 'currentColor' } = {}) => (
  `<path d="${SKYNET_S}" transform="${S_MARK_TRANSFORM}" fill="${color}"/>`
);

export const flatLogoSvg = ({ color, size = 512 }) => (
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-50 -50 100 100">`
  + flatLogoInner({ color })
  + '</svg>\n'
);

// ---------------------------------------------------------------------------
// Icon without a tile: Windows, Linux, the VS Code Marketplace, and on a black
// square for phone home screens.

const noTileInner = () => (
  `<path d="${SKYNET_S}" transform="${S_MARK_TRANSFORM}" fill="#73C991"/>`
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

/** Desktop app icon: the supplied mark on a rounded white tile. */
export const desktopIconSvg = ({ size = 1024, tape = false } = {}) => (
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="-53 -53 106 106">`
  + '<defs><clipPath id="desktop-tile"><rect x="-53" y="-53" width="106" height="106" rx="21.2"/></clipPath></defs>'
  + '<rect x="-53" y="-53" width="106" height="106" rx="21.2" fill="#FFFFFF"/>'
  + `<g transform="scale(0.82)"><path d="${SKYNET_S}" transform="${S_MARK_TRANSFORM}" fill="#1F2024"/></g>`
  + (tape ? `<g clip-path="url(#desktop-tile)">${devTape(106)}</g>` : '')
  + '</svg>\n'
);

// ---------------------------------------------------------------------------
// Small glyph, one colour: menu bar, favicon, VS Code, model picker, Android
// notification and themed icon. Drawn on a 32 grid.

export const GLYPH_RING_OPACITY = [0.3, 0.75];
const GLYPH_MARK_TRANSFORM = 'translate(4.24 2.28) scale(0.112)';
const glyphMarkPath = ({ color, opacity = 1 }) => (
  `<path d="${SKYNET_S}" transform="${GLYPH_MARK_TRANSFORM}" fill="${color}" fill-opacity="${fmt(opacity)}"/>`
);

/**
 * Inner markup of the glyph on a 32 grid. `walls` fills the side walls (the
 * menu bar's "unread" state); `rings` overrides the outer and inner ring
 * opacities (the busy breath).
 */
export const glyphInner = ({ color = 'currentColor', walls = 0, rings = GLYPH_RING_OPACITY } = {}) => {
  const breathing = rings.some((value, index) => value !== GLYPH_RING_OPACITY[index]);
  const breathPhase = Math.min(1, Math.max(0, (rings[0] - 0.36) / 0.54));
  const glyphOpacity = breathing ? 0.35 + breathPhase * 0.65 : 1;
  return glyphMarkPath({ color, opacity: glyphOpacity })
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
 * SF Symbols use a monochrome silhouette.
 */
export const glyphSymbolSvg = () => (
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">'
  + `<path d="${SKYNET_S}" transform="${GLYPH_MARK_TRANSFORM}" fill="#000000"/>`
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

export const appIconLayerSvgs = () => {
  return {
    'backplate.png': '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="-53 -53 106 106"><rect x="-53" y="-53" width="106" height="106" rx="21.2" fill="white"/></svg>',
    'shell.png': `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="-53 -53 106 106"><g transform="scale(0.82)"><path d="${SKYNET_S}" transform="${S_MARK_TRANSFORM}" fill="white"/></g></svg>`,
  };
};

/** A solid fill, for every appearance or for the named one. */
const solid = (rgb, appearance) => {
  const value = { solid: `srgb:${rgb.map((c) => c.toFixed(5)).join(',')},1.00000` };
  return appearance ? { appearance, value } : { value };
};
const position = () => [{ idiom: 'square', value: { scale: 1, 'translation-in-points': [0, 0] } }];
const layer = (name, { glass, opacity = [{ value: 1 }], fill }) => ({
  'image-name': `${name}.png`,
  name,
  'glass-specializations': glass,
  'opacity-specializations': opacity,
  'position-specializations': position(),
  'fill-specializations': fill,
});

/**
 * The Icon Composer document uses the same charcoal mark and white rounded
 * tile in every appearance. Icon Composer applies the platform mask.
 */
export const appIconDocument = () => {
  return {
    'fill-specializations': [],
    groups: [{
      layers: [
        layer('backplate', { glass: [{ value: false }], fill: [solid([1, 1, 1])] }),
        layer('shell', { glass: [{ value: false }], fill: [solid([0.122, 0.125, 0.141])] }),
      ],
      shadow: { kind: 'neutral', opacity: 0.5 },
      translucency: { enabled: false, value: 0 },
    }],
    'supported-platforms': { circles: ['watchOS'], squares: 'shared' },
  };
};
