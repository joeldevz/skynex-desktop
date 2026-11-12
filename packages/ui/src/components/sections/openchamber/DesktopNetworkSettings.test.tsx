import { afterAll, afterEach, beforeEach, expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import '@/stores/useDirectoryStore';
import { I18nContext, type I18nContextValue } from '@/lib/i18n/react-context';
import { invalidateSettingsCache } from '@/lib/persistence';
import { useDesktopRestartDrafts } from './desktopRestartDrafts';

const dom = new Window({ url: 'http://127.0.0.1:51999' });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [name, value] of Object.entries({
  window: dom, document: dom.document, navigator: dom.navigator,
  HTMLElement: dom.HTMLElement, HTMLInputElement: dom.HTMLInputElement,
  Element: dom.Element, Node: dom.Node, Event: dom.Event, CustomEvent: dom.CustomEvent,
  MutationObserver: dom.MutationObserver, localStorage: dom.localStorage,
  getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true,
})) {
  globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}
const originalFetch = globalThis.fetch;
const writes: string[] = [];
const commands: string[] = [];
let loadFails = false;
let saveFails = false;
let restartFails = false;
let hasPassword = false;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), dom.location.href);
  if (url.pathname === '/api/config/settings') {
    if (init?.method === 'PUT') {
      writes.push(String(init.body));
      return Response.json({}, { status: saveFails ? 500 : 200 });
    }
    return Response.json({ hasDesktopUiPassword: hasPassword }, { status: loadFails ? 500 : 200 });
  }
  return Response.json({}, { status: 404 });
};

const { createRoot } = await import('react-dom/client');
const { DesktopNetworkSettings } = await import('./DesktopNetworkSettings');
const context: I18nContextValue = {
  locale: 'en', direction: 'ltr', locales: ['en'], setLocale: () => {}, label: (locale) => locale, t: (key) => key,
};
let container = document.createElement('div');
let root = createRoot(container);
const settle = async (ms = 0) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); }); };
const render = async (element: React.ReactNode) => {
  await act(async () => { root.render(<I18nContext.Provider value={context}>{element}</I18nContext.Provider>); });
  await settle();
};
const button = (): HTMLButtonElement => {
  const found = Array.from(container.querySelectorAll('button')).find((entry) => entry.textContent === 'settings.openchamber.desktopNetwork.actions.saveAndRestart');
  if (!found) throw new Error(`Save button not found: ${Array.from(container.querySelectorAll('button')).map((entry) => entry.textContent).join('|')}`);
  return found;
};
const password = (): HTMLInputElement => {
  const found = container.querySelector<HTMLInputElement>('input[type="password"]');
  if (!found) throw new Error('Password input not found');
  return found;
};
const typePassword = async () => {
  const input = password();
  const setter = Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('Native input setter unavailable');
  await act(async () => {
    setter.call(input, 'test-only-password');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

beforeEach(() => {
  loadFails = false; saveFails = false; restartFails = false; hasPassword = false;
  writes.length = 0; commands.length = 0;
  Object.assign(window, {
    __OPENCHAMBER_ELECTRON__: { runtime: 'electron' },
    __OPENCHAMBER_LOCAL_ORIGIN__: dom.location.origin,
    __OPENCHAMBER_API_BASE_URL__: dom.location.origin,
    __OPENCHAMBER_DESKTOP__: { invoke: async (command: string) => {
      commands.push(command);
      if (command === 'desktop_restart' && restartFails) throw new Error('synthetic restart failure');
      return command === 'desktop_restart' ? true : null;
    } },
  });
  invalidateSettingsCache();
  useDesktopRestartDrafts.setState({ patches: {}, blocked: {} });
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});
afterAll(async () => {
  globalThis.fetch = originalFetch;
  await dom.happyDOM.close();
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

test('tunnel password is write-only and cannot save an empty draft', async () => {
  await render(<DesktopNetworkSettings variant="tunnel" />);
  expect(password().value).toBe('');
  expect(container.querySelector('[data-settings-item="tunnel.ui-password"]')).not.toBeNull();
  expect(container.querySelector('[data-settings-item="sessions.desktop-lan-access"]')).toBeNull();
  expect(button().disabled).toBe(true);
  await act(async () => { button().click(); });
  expect(writes).toEqual([]);
  expect(commands).not.toContain('desktop_restart');
});

test('saves the tunnel password before restarting', async () => {
  await render(<DesktopNetworkSettings variant="tunnel" />);
  await typePassword();
  await act(async () => { button().click(); });
  await settle(400);
  expect(writes.map((body) => JSON.parse(body))).toEqual([{ desktopUiPassword: 'test-only-password' }]);
  expect(commands).toContain('desktop_restart');
  expect(password().value).toBe('');

});

test('retains a rejected tunnel password write without restarting', async () => {
  saveFails = true;
  await render(<DesktopNetworkSettings variant="tunnel" />);
  await typePassword();
  await act(async () => { button().click(); });
  await settle(400);
  expect(password().value).toBe('test-only-password');
  expect(commands).not.toContain('desktop_restart');
});

test('blocks tunnel password writes when settings could not be loaded', async () => {
  loadFails = true;
  await render(<DesktopNetworkSettings variant="tunnel" />);
  expect(password().disabled).toBe(true);
  expect(button().disabled).toBe(true);
  expect(writes).toEqual([]);
});
