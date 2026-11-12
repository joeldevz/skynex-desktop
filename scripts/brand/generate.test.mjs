import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import sharp from 'sharp';

import { textOutputs } from './generate.mjs';
import { encodeIco, svgToPng } from './raster.mjs';
import { appIconDocument, appIconLayerSvgs, desktopIconSvg, flatLogoSvg, glyphSvg, noTileIconSvg, RIBBON_ANIMATION, RIBBON_VIEW_BOX, SKYNET_S } from './geometry.mjs';

test('every generated text file matches scripts/brand', () => {
  const stale = [...textOutputs()]
    .filter(([path, text]) => !existsSync(path) || readFileSync(path, 'utf8') !== text)
    .map(([path]) => relative(process.cwd(), path));
  expect(stale).toEqual([]);
});

test('web splash accessible label and default PWA names use Skynex', () => {
  const html = readFileSync('packages/web/index.html', 'utf8');
  expect(html).toContain("const defaultAppName = 'Skynex'");
  expect(html).toContain("const defaultShortName = 'Skynex'");
  expect(html).toContain('aria-label="Skynex loading icon"');
});

test('the generated glyph renders the full S inside its 32px canvas', async () => {
  const png = await svgToPng(glyphSvg({ color: '#73C991' }), 32);
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  let minX = info.width; let minY = info.height; let maxX = -1; let maxY = -1; let visible = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      if (data[i + 3] === 0) continue;
      visible += 1;
      minX = Math.min(minX, x); minY = Math.min(minY, y);
      maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
    }
  }
  expect(SKYNET_S).toBe(readFileSync('scripts/brand/skynex-logo.svg', 'utf8').match(/<path\s+fill="#[^"]+"\s+d="([^"]+)"/)?.[1]);
  expect(visible).toBeGreaterThan(40);
  expect(minX).toBeGreaterThan(0);
  expect(minY).toBeGreaterThan(0);
  expect(maxX).toBeLessThan(31);
  expect(maxY).toBeLessThan(31);
});

test('Android notification vector uses the supplied filled path scaled onto its icon grid', () => {
  const vector = textOutputs().get(`${process.cwd()}/packages/mobile/android/app/src/main/res/drawable/ic_stat_notify.xml`);
  expect(vector).toContain('android:scaleX="0.112"');
  expect(vector).toContain('android:scaleY="0.112"');
  expect(vector).toContain(`android:pathData="${SKYNET_S}"`);
  expect(vector).toContain('android:fillColor="#FFFFFFFF"');
  expect(vector).not.toContain('android:strokeColor=');
});

test('ribbon geometry and discrete opacity entrance come from the supplied source SVG', () => {
  const source = readFileSync('scripts/brand/skynex-logo-ribbon.svg', 'utf8');
  expect(RIBBON_VIEW_BOX).toBe('-26 -25 262 296');
  expect(RIBBON_ANIMATION.map(({ attributeName, dur, calcMode, fill }) => ({ attributeName, dur, calcMode, fill }))).toEqual([
    { attributeName: 'd', dur: '1.6s', calcMode: 'discrete', fill: 'freeze' },
    { attributeName: 'opacity', dur: '0.18s', calcMode: undefined, fill: 'freeze' },
  ]);
  expect(RIBBON_ANIMATION[0].values.at(-1)).toBe(SKYNET_S);
  expect(source).toContain('prefers-reduced-motion:reduce');
  for (const file of [
    'packages/web/index.html',
    'packages/electron/early-startup.mjs',
    'packages/vscode/src/webviewHtml.ts',
    'packages/web/server/lib/opencode/static-routes-runtime.js',
  ]) {
    const markup = readFileSync(file, 'utf8').split('<!-- brand:flat-logo:start -->')[1]?.split('<!-- brand:flat-logo:end -->')[0];
    expect(markup).toContain('skynex-logo-animated-frame');
    expect(markup).toContain('skynex-logo-still');
    expect(markup).toContain('dur="1.6s" calcMode="discrete" fill="freeze"');
    expect(markup).toContain(`viewBox="${RIBBON_VIEW_BOX}"><path class="skynex-logo-still"`);
  }
});

test('static generated logo and app icon preserve the supplied filled silhouette', () => {
  for (const svg of [flatLogoSvg({ color: 'currentColor' }), noTileIconSvg()]) {
    expect(svg).toContain(`d="${SKYNET_S}"`);
    expect(svg).toContain('fill=');
    expect(svg).not.toContain('stroke=');
  }
  for (const file of ['packages/web/public/logo-dark-512x512.svg', 'packages/electron/resources/icons/app-icon.svg']) {
    const svg = readFileSync(file, 'utf8');
    expect(svg).toContain(`d="${SKYNET_S}"`);
    expect(svg).not.toContain('stroke=');
  }
});

test('desktop icons use a rounded white tile and the scaled charcoal supplied mark', async () => {
  const svg = desktopIconSvg();
  expect(svg).toContain('rx="21.2"');
  expect(svg).toContain('transform="scale(0.82)"');
  expect(svg).toContain(`d="${SKYNET_S}"`);
  expect(svg).toContain('fill="#1F2024"');
  expect(Object.keys(appIconLayerSvgs())).toEqual(['backplate.png', 'shell.png']);
  expect(appIconDocument()['fill-specializations']).toEqual([]);
  expect(appIconDocument().groups[0].layers.map(({ name }) => name)).toEqual(['backplate', 'shell']);

  for (const [file, size] of [['icon.png', 1024], ['app-icon.png', 512]]) {
    const image = sharp(readFileSync(`packages/electron/resources/icons/${file}`));
    const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(size);
    const pixel = (x, y) => [...data.subarray((y * size + x) * info.channels, (y * size + x) * info.channels + 4)];
    expect(pixel(0, 0)[3]).toBe(0);
    expect(pixel(Math.round(size * 0.1), Math.round(size * 0.1))).toEqual([255, 255, 255, 255]);
    expect(pixel(Math.round(size * 0.5), Math.round(size * 0.5))).toEqual([31, 32, 36, 255]);
  }
});

test('generated 18px tray states have visible unread badge and breathing opacity changes', async () => {
  const tray = 'packages/electron/resources/icons/tray';
  const pixels = async (name) => sharp(readFileSync(`${tray}/trayTemplate-${name}.png`)).raw().toBuffer();
  const idle = await pixels('idle');
  const unseen = await pixels('unseen');
  const breathLow = await pixels('breath-00');
  const breathHigh = await pixels('breath-15');
  const differences = (before, after) => {
    let changed = 0;
    let largest = 0;
    for (let i = 3; i < before.length; i += 4) {
      const delta = Math.abs(before[i] - after[i]);
      if (delta > 60) changed += 1;
      largest = Math.max(largest, delta);
    }
    return { changed, largest };
  };

  const unreadDelta = differences(idle, unseen);
  const breathingDelta = differences(breathLow, breathHigh);
  let badgePixels = 0;
  for (let y = 0; y <= 5; y += 1) {
    for (let x = 12; x <= 17; x += 1) {
      const i = (y * 18 + x) * 4 + 3;
      if (Math.abs(idle[i] - unseen[i]) > 60) badgePixels += 1;
    }
  }
  expect(unreadDelta.changed).toBeGreaterThan(5);
  expect(unreadDelta.largest).toBeGreaterThan(150);
  expect(badgePixels).toBeGreaterThan(6);
  expect(breathingDelta.changed).toBeGreaterThan(20);
  expect(breathingDelta.largest).toBeGreaterThan(60);
});

test('generated 16px favicon keeps its glyph and small desktop ICO frames keep the tile design', async () => {
  const smallPng = readFileSync('packages/web/public/favicon-16.png');
  const { data: smallPixels } = await sharp(smallPng).raw().toBuffer({ resolveWithObject: true });
  const expectedSmall = await svgToPng(glyphSvg({ size: 32, color: '#73C991' }), 16);
  const { data: expectedSmallPixels } = await sharp(expectedSmall).raw().toBuffer({ resolveWithObject: true });
  expect(smallPixels.equals(expectedSmallPixels)).toBe(true);
  let accentPixels = 0;
  for (let i = 0; i < smallPixels.length; i += 4) {
    if (smallPixels[i + 1] > 100 && smallPixels[i + 1] > smallPixels[i]) accentPixels += 1;
  }
  expect(accentPixels).toBeGreaterThan(5);

  for (const [file, tape] of [['icon.ico', false], ['dev-icon.ico', true]]) {
    const ico = readFileSync(`packages/electron/resources/icons/${file}`);
    for (const expectedSize of [16, 20, 24]) {
      const count = ico.readUInt16LE(4);
      const frameIndex = Array.from({ length: count }, (_, i) => i).find((i) => (ico.readUInt8(6 + 16 * i) || 256) === expectedSize);
      expect(frameIndex).toBeDefined();
      const entry = 6 + 16 * frameIndex;
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      const png = ico.subarray(offset, offset + length);
      const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
      const expected = await svgToPng(desktopIconSvg({ tape }), expectedSize);
      const { data: expectedPixels } = await sharp(expected).raw().toBuffer({ resolveWithObject: true });
      expect(data.equals(expectedPixels)).toBe(true);
      let colored = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i + 3] > 0 && data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60) colored += 1;
      }
      expect(colored).toBeGreaterThan(5);
    }
  }
});

test('an .ico directory points at each PNG with its size', () => {
  const pngs = [{ size: 16, png: Buffer.from('a') }, { size: 256, png: Buffer.from('bcd') }];
  const ico = encodeIco(pngs);
  expect(ico.readUInt16LE(2)).toBe(1);
  expect(ico.readUInt16LE(4)).toBe(2);
  expect(ico.readUInt8(6)).toBe(16);
  // 256 px is written as 0.
  expect(ico.readUInt8(6 + 16)).toBe(0);
  const offset = ico.readUInt32LE(6 + 16 + 12);
  expect(ico.subarray(offset, offset + 3).toString()).toBe('bcd');
});
