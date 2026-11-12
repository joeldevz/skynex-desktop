import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nProvider } from '@/lib/i18n';
import { OpenChamberLogo } from './OpenChamberLogo';
import { OPEN_CHAMBER_LOGO_ART as ART } from './openChamberLogoArt';

const browser = new Window({ url: 'http://localhost/' });
Object.assign(globalThis, {
  window: browser, document: browser.document, navigator: browser.navigator,
  HTMLElement: browser.HTMLElement, getComputedStyle: browser.getComputedStyle.bind(browser),
  IS_REACT_ACT_ENVIRONMENT: true,
});

let root: Root;
let host: HTMLDivElement;

const render = (element: React.ReactElement) => act(async () => {
  root.render(<I18nProvider>{element}</I18nProvider>);
});
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

test('the logo renders the generated Skynex S mark in the active theme color', async () => {
  await render(<OpenChamberLogo />);
  const mark = host.querySelector('svg > path');
  expect(mark?.getAttribute('d')).toBe(ART.mark);
  expect(mark?.getAttribute('transform')).toBeNull();
  expect(mark?.getAttribute('fill')).toBe('black');
  expect(host.querySelector('svg')?.getAttribute('viewBox')).toBe(ART.viewBox);
});

test('multiple logos render the generated mark without shared SVG identifiers', async () => {
  await render(<><OpenChamberLogo /><OpenChamberLogo /></>);
  expect([...host.querySelectorAll('svg > path')].map((path) => path.getAttribute('d'))).toEqual([ART.mark, ART.mark]);
});

test('a static splash keeps the animated splash frame during startup handoff', async () => {
  await render(<OpenChamberLogo variant="splash" />);
  expect(host.querySelector('svg')?.getAttribute('viewBox')).toBe(ART.animatedViewBox);
  expect(host.querySelector('animate')).toBeNull();
});

test('animated logos use the supplied one-shot ribbon frames and reduced-motion still mark', async () => {
  await render(<OpenChamberLogo isAnimated variant="splash" />);
  const svg = host.querySelector('svg');
  expect(svg?.getAttribute('viewBox')).toBe(ART.animatedViewBox);
  expect(host.querySelector('.skynex-logo-still')?.getAttribute('d')).toBe(ART.mark);
  const animations = [...host.querySelectorAll('animate')];
  expect(animations.map((animation) => [
    animation.getAttribute('attributeName'), animation.getAttribute('dur'), animation.getAttribute('calcMode'), animation.getAttribute('fill'),
  ])).toEqual([
    ['d', '1.6s', 'discrete', 'freeze'],
    ['opacity', '0.18s', null, 'freeze'],
  ]);
  expect(animations[0]?.getAttribute('values')?.split(';').at(-1)).toBe(ART.mark);
  expect(host.querySelector('style')?.textContent).toContain('prefers-reduced-motion:reduce');
});
