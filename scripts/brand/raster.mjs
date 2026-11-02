// Turning drawings in geometry.mjs into PNG through sharp (librsvg), and
// Windows .ico containers.

import sharp from 'sharp';

/**
 * Renders an SVG string to a PNG buffer of `size` x `size`. The density makes
 * librsvg draw at the target size instead of scaling a bitmap of the SVG's own
 * width.
 */
export const svgToPng = (svg, size) => {
  const width = Number(/<svg[^>]*\swidth="([\d.]+)"/.exec(svg)?.[1]);
  if (!width) throw new Error('SVG needs a numeric width to render');
  return sharp(Buffer.from(svg), { density: (72 * size) / width })
    .resize(size, size)
    .png()
    .toBuffer();
};

export const solidSquare = (size, background) => sharp({ create: { width: size, height: size, channels: 4, background } })
  .png()
  .toBuffer();

/**
 * Lays `png` over a square of `background` with `inset` px free on every side.
 * `round` is a corner radius in px, or 'circle'.
 */
export const composeOnSquare = async ({ png, size, background, inset = 0, round = null }) => {
  const inner = await sharp(png).resize(size - inset * 2, size - inset * 2).toBuffer();
  const base = round
    ? sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${round === 'circle'
      ? `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${background}"/>`
      : `<rect width="${size}" height="${size}" rx="${round}" fill="${background}"/>`}</svg>`))
    : sharp({ create: { width: size, height: size, channels: 4, background } });
  return base.composite([{ input: inner, left: inset, top: inset }]).png().toBuffer();
};

// ---------------------------------------------------------------------------
// .ico with PNG-compressed entries (Windows Vista and later read them).

export const encodeIco = (entries) => {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(16 * entries.length);
  let offset = header.length + directory.length;
  entries.forEach(({ size, png }, i) => {
    const at = i * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, at);
    directory.writeUInt8(size >= 256 ? 0 : size, at + 1);
    directory.writeUInt8(0, at + 2);
    directory.writeUInt8(0, at + 3);
    directory.writeUInt16LE(1, at + 4);
    directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(png.length, at + 8);
    directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  return Buffer.concat([header, directory, ...entries.map(({ png }) => png)]);
};
