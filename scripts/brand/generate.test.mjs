import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import sharp from 'sharp';

import { textOutputs } from './generate.mjs';
import { encodeIco, svgToPng } from './raster.mjs';
import { glyphSvg, SKYNET_S } from './geometry.mjs';

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
  expect(SKYNET_S.startsWith('M706 322c')).toBe(true);
  expect(visible).toBeGreaterThan(40);
  expect(minX).toBeGreaterThan(0);
  expect(minY).toBeGreaterThan(0);
  expect(maxX).toBeLessThan(31);
  expect(maxY).toBeLessThan(31);
});

test('Android notification vector has scaled S path geometry and visible stroke', () => {
  const vector = textOutputs().get(`${process.cwd()}/packages/mobile/android/app/src/main/res/drawable/ic_stat_notify.xml`);
  expect(vector).toContain('android:scaleX="0.03125"');
  expect(vector).toContain('android:scaleY="0.03125"');
  expect(vector).toContain(`android:pathData="${SKYNET_S}"`);
  expect(vector).toContain('android:strokeColor="#FFFFFFFF"');
  expect(vector).toContain('android:fillColor="#00000000"');
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

test('generated 16px favicon and small ICO frames render the S rather than pixel cube art', async () => {
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
      const expected = await svgToPng(glyphSvg({ size: 32, color: '#73C991', tape }), expectedSize);
      const { data: expectedPixels } = await sharp(expected).raw().toBuffer({ resolveWithObject: true });
      expect(data.equals(expectedPixels)).toBe(true);
      let colored = 0;
      for (let i = 0; i < data.length; i += info.channels) {
        if (data[i + 3] > 0 && data[i + 1] > data[i]) colored += 1;
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
