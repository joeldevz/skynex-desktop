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
  expect(mark?.getAttribute('transform')).toBe(ART.transform);
  expect(mark?.getAttribute('stroke')).toBe('black');
});

test('multiple logos render the generated mark without shared SVG identifiers', async () => {
  await render(<><OpenChamberLogo /><OpenChamberLogo /></>);
  expect([...host.querySelectorAll('svg > path')].map((path) => path.getAttribute('d'))).toEqual([ART.mark, ART.mark]);
});
