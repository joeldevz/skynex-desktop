import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import '@/stores/useDirectoryStore';
import { I18nContext, type I18nContextValue } from '@/lib/i18n/react-context';
import { invalidateSettingsCache } from '@/lib/persistence';
import { useDesktopRestartDrafts } from './desktopRestartDrafts';
import { toast } from '@/components/ui/toast';

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
let enterprise = false;
let hasPassword = false;
let delayWrite: (() => Promise<void>) | null = null;
const rawError = 'A UI password is required before starting a public tunnel. Restart OpenChamber with --ui-password.';
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), dom.location.href);
  if (url.pathname === '/api/config/settings') {
    if (init?.method === 'PUT') {
      writes.push(String(init.body));
      await delayWrite?.();
      return Response.json({}, { status: saveFails ? 500 : 200 });
    }
    return Response.json({ hasDesktopUiPassword: hasPassword }, { status: loadFails ? 500 : 200 });
  }
  if (url.pathname.endsWith('/tunnel/check')) return Response.json({ installed: true, available: true });
  if (url.pathname.endsWith('/tunnel/status')) return Response.json({ active: false, url: null, enterpriseMode: enterprise });
  if (url.pathname.endsWith('/tunnel/providers')) return Response.json({ providers: [] });
  if (url.pathname.endsWith('/tunnel/start')) return Response.json({ ok: false, code: 'ui_password_required', error: rawError }, { status: 403 });
  return Response.json({}, { status: 404 });
};

const { createRoot } = await import('react-dom/client');
const { DesktopNetworkSettings } = await import('./DesktopNetworkSettings');
const { TunnelSettings } = await import('./TunnelSettings');
const { getRuntimeKey } = await import('@/lib/runtime-switch');
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
const button = (key: string): HTMLButtonElement => {
  const found = Array.from(container.querySelectorAll('button')).find((entry) => entry.textContent === key);
  if (!found) throw new Error(`Button not found: ${key}`);
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
const saveKey = 'settings.openchamber.desktopNetwork.actions.saveAndRestart';
beforeEach(() => {
  loadFails = false; saveFails = false; restartFails = false; enterprise = false; hasPassword = false; delayWrite = null;
  writes.length = 0; commands.length = 0;
  Object.assign(window, {
    __OPENCHAMBER_ELECTRON__: { runtime: 'electron' },
    __OPENCHAMBER_LOCAL_ORIGIN__: dom.location.origin,
    __OPENCHAMBER_API_BASE_URL__: dom.location.origin,
    __OPENCHAMBER_DESKTOP__: { invoke: async (command: string) => {
      commands.push(command);
      if (command === 'desktop_restart' && restartFails) throw new Error('synthetic restart failure');
      return null;
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

describe('inline tunnel password', () => {
  test('cannot save an empty password when none is configured', async () => {
    await render(<DesktopNetworkSettings variant="tunnel" />);
    expect(password().value).toBe('');
    expect(button(saveKey).disabled).toBe(true);
    await act(async () => { button(saveKey).click(); });
    expect(writes).toEqual([]);
    expect(commands).not.toContain('desktop_restart');
  });
  test('shows a write-only password editor without LAN or removal controls', async () => {
    hasPassword = true;
    await render(<DesktopNetworkSettings variant="tunnel" />);
    expect(password().value).toBe('');
    expect(container.querySelector('[data-settings-item="tunnel.ui-password"]')).not.toBeNull();
    expect(container.querySelector('[data-settings-item="sessions.desktop-lan-access"]')).toBeNull();
    expect(container.textContent).not.toContain('settings.openchamber.desktopPassword.actions.removePassword');
    expect(button(saveKey).disabled).toBe(true);
  });
  test('waits for a password-only save before restart and clears the draft', async () => {
    await render(<DesktopNetworkSettings variant="tunnel" />);
    await typePassword();
    let release = () => {};
    delayWrite = () => new Promise<void>((resolve) => { release = resolve; });
    await act(async () => { button(saveKey).click(); });
    await settle(400);
    expect(writes.map((body) => JSON.parse(body))).toEqual([{ desktopUiPassword: 'test-only-password' }]);
    expect(commands).not.toContain('desktop_restart');
    await act(async () => { release(); });
    await settle();
    expect(commands.filter((command) => command === 'desktop_restart')).toHaveLength(1);
    expect(password().value).toBe('');
    expect(useDesktopRestartDrafts.getState().patches.network).toBeUndefined();
  });
  test('retains a rejected password write without restarting', async () => {
    saveFails = true;
    await render(<DesktopNetworkSettings variant="tunnel" />);
    await typePassword();
    await act(async () => { button(saveKey).click(); }); await settle(400);
    expect(password().value).toBe('test-only-password');
    expect(container.textContent).toContain('settings.openchamber.desktopNetwork.error.saveFailed');
    expect(commands).not.toContain('desktop_restart');
  });
  test('can retry a failed restart without re-entering or rewriting the password', async () => {
    restartFails = true;
    await render(<DesktopNetworkSettings variant="tunnel" />); await typePassword();
    await act(async () => { button(saveKey).click(); }); await settle(400);
    expect(password().value).toBe('');
    expect(container.textContent).toContain('settings.openchamber.desktopNetwork.error.savedRestartFailed');
    expect(button(saveKey).disabled).toBe(false);
    restartFails = false;
    await act(async () => { button(saveKey).click(); }); await settle(400);
    expect(writes).toHaveLength(1);
    expect(commands.filter((command) => command === 'desktop_restart')).toHaveLength(2);
  });
  test('blocks writes after a failed load', async () => {
    loadFails = true;
    await render(<DesktopNetworkSettings variant="tunnel" />);
    expect(password().disabled).toBe(true);
    expect(button(saveKey).disabled).toBe(true);
    expect(writes).toEqual([]);
  });
  test('never exposes the editor on a remote desktop or browser', async () => {
    Object.assign(window, { __OPENCHAMBER_API_BASE_URL__: 'https://remote.example' });
    expect(getRuntimeKey()).not.toBe('local');
    await render(<DesktopNetworkSettings variant="tunnel" />);
    expect(container.querySelector('input')).toBeNull();
    Object.assign(window, { __OPENCHAMBER_ELECTRON__: undefined });
    await render(<DesktopNetworkSettings variant="tunnel" />);
    expect(container.querySelector('input')).toBeNull();
    expect(writes).toEqual([]); expect(commands).toEqual([]);
  });
  test('rechecks the local runtime before saving', async () => {
    await render(<DesktopNetworkSettings variant="tunnel" />); await typePassword();
    Object.assign(window, { __OPENCHAMBER_API_BASE_URL__: 'https://remote.example' });
    await act(async () => { button(saveKey).click(); }); await settle(400);
    expect(writes).toEqual([]); expect(commands).not.toContain('desktop_restart');
  });
  test('does not restart the client after the runtime changes during a save', async () => {
    await render(<DesktopNetworkSettings variant="tunnel" />); await typePassword();
    let release = () => {};
    delayWrite = () => new Promise<void>((resolve) => { release = resolve; });
    await act(async () => { button(saveKey).click(); }); await settle(400);
    expect(writes).toHaveLength(1);
    Object.assign(window, { __OPENCHAMBER_API_BASE_URL__: 'https://remote.example' });
    await act(async () => { release(); }); await settle();
    expect(commands).not.toContain('desktop_restart');
  });
  test('unmount clears the transient password draft', async () => {
    await render(<DesktopNetworkSettings variant="tunnel" />); await typePassword();
    expect(useDesktopRestartDrafts.getState().patches.network?.desktopUiPassword).toBe('test-only-password');
    await render(null);
    expect(useDesktopRestartDrafts.getState().patches.network).toBeUndefined();
  });
  test('keeps LAN controls on General settings', async () => {
    await render(<DesktopNetworkSettings />);
    expect(container.querySelector('[data-settings-item="sessions.desktop-lan-access"]')).not.toBeNull();
  });
  test('renders the editor directly on Tunnel settings and gives password-specific guidance', async () => {
    await render(<TunnelSettings />);
    expect(container.querySelector('[data-settings-item="tunnel.ui-password"]')).not.toBeNull();
    const toastCount = toast.getHistory().length;
    await act(async () => { button('settings.openchamber.tunnel.actions.startTunnel').click(); }); await settle();
    expect(container.textContent).toContain('settings.openchamber.tunnel.password.requiredLocal');
    expect(container.textContent).not.toContain(rawError);
    expect(document.activeElement).toBe(password());
    expect(toast.getHistory()).toHaveLength(toastCount);
  });
  test('remote tunnel guidance never offers local credentials', async () => {
    Object.assign(window, { __OPENCHAMBER_API_BASE_URL__: 'https://remote.example' });
    await render(<TunnelSettings />);
    await act(async () => { button('settings.openchamber.tunnel.actions.startTunnel').click(); }); await settle();
    expect(container.textContent).toContain('settings.openchamber.tunnel.password.requiredRemote');
    expect(container.querySelector('[data-settings-item="tunnel.ui-password"]')).toBeNull();
    expect(writes).toEqual([]); expect(commands).not.toContain('desktop_restart');
  });
  test('enterprise tunnel refusal has no password editor', async () => {
    enterprise = true;
    await render(<TunnelSettings />);
    expect(container.textContent).toContain('settings.openchamber.tunnel.enterpriseMode');
    expect(container.querySelector('input')).toBeNull();
  });
});
