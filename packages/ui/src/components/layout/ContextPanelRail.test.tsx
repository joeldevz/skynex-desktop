import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';

test('horizontal toolbar retains panel selection and commits a horizontal reorder only on drop', async () => {
  const win = new Window({ url: 'http://localhost' });
  const analytics: Array<{ command: string; args: { feature: string; action: string } }> = [];
  Object.assign(win, {
    __OPENCHAMBER_ELECTRON__: { runtime: 'electron' },
    __OPENCHAMBER_LOCAL_ORIGIN__: 'http://localhost',
    __OPENCHAMBER_API_BASE_URL__: 'http://localhost',
    __OPENCHAMBER_DESKTOP__: { invoke: async (command: string, args: typeof analytics[number]['args']) => {
      if (command === 'desktop_record_product_analytics_feature') analytics.push({ command, args });
      return null;
    } },
  });
  const values = {
    window: win, document: win.document, navigator: win.navigator, location: win.location,
    Node: win.Node, Element: win.Element, HTMLElement: win.HTMLElement,
    HTMLButtonElement: win.HTMLButtonElement, HTMLInputElement: win.HTMLInputElement,
    SVGElement: win.SVGElement, Document: win.Document, DocumentFragment: win.DocumentFragment,
    DOMRect: win.DOMRect, Event: win.Event, CustomEvent: win.CustomEvent,
    MouseEvent: win.MouseEvent, KeyboardEvent: win.KeyboardEvent,
    MutationObserver: win.MutationObserver, ResizeObserver: win.ResizeObserver,
    localStorage: win.localStorage, getComputedStyle: win.getComputedStyle.bind(win),
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win), IS_REACT_ACT_ENVIRONMENT: true,
  };
  const previous = Object.keys(values).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(async () => new Promise<Response>(() => {}), originalFetch);

  const { createRoot } = await import('react-dom/client');
  const { I18nProvider } = await import('@/lib/i18n');
  const { RuntimeAPIContext } = await import('@/contexts/runtimeAPIContext');
  const { createWebAPIs } = await import('../../../../web/src/api/index');
  const { SyncProvider } = await import('@/sync/sync-context');
  const { OpenCode } = await import('@opencode/client');
  const { useSessionUIStore } = await import('@/sync/session-ui-store');
  const { useUIStore } = await import('@/stores/useUIStore');
  const { CONTEXT_SURFACES } = await import('@/lib/surfaces/registry');
  const { ContextPanelRail } = await import('./ContextPanelRail');
  const directory = '/toolbar-test';
  const initialOrder = CONTEXT_SURFACES.map((surface) => surface.id);
  useSessionUIStore.getState().openNewSessionDraft({ directoryOverride: directory, preserveDirectoryOverride: true });
  useUIStore.setState({ contextRailOrder: initialOrder, contextRailHiddenSurfaces: [], contextPanelByDirectory: {}, whiteboardsEnabled: true });
  const sdk = OpenCode.make({ baseUrl: 'http://toolbar.test', fetch: () => new Promise<Response>(() => {}) });
  const apis = createWebAPIs();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(
      <SyncProvider sdk={sdk} directory={directory}>
        <I18nProvider><RuntimeAPIContext.Provider value={apis}><ContextPanelRail /></RuntimeAPIContext.Provider></I18nProvider>
      </SyncProvider>,
    ));
    const buttons = [...container.querySelectorAll<HTMLButtonElement>('button[data-context-surface]')];
    expect(container.querySelector('[data-context-surface="memory"]')).toBeNull();
    const configure = container.querySelector('nav button');
    if (!(configure instanceof HTMLButtonElement)) throw new Error('Expected leading configure button');
    expect(configure.hasAttribute('data-context-surface')).toBe(false);
    await act(async () => configure.click());
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape', code: 'Escape' })));
    expect(buttons.length).toBeGreaterThan(2);
    expect(analytics).toEqual([]);
    for (const [surface, feature] of [['terminal', 'terminal'], ['browser', 'browser'], ['whiteboard', 'whiteboards']]) {
      const button = container.querySelector<HTMLButtonElement>(`button[data-context-surface="${surface}"]`);
      if (!button) throw new Error(`Expected ${surface} button`);
      await act(async () => button.click());
      expect(button.getAttribute('aria-pressed')).toBe('true');
      await act(async () => button.click());
      expect(button.getAttribute('aria-pressed')).toBe('false');
      expect(analytics.at(-1)).toEqual({
        command: 'desktop_record_product_analytics_feature', args: { feature, action: 'opened' },
      });
    }
    expect(analytics).toHaveLength(3);
    const first = buttons[0];
    const second = buttons[1];
    if (!first || !second) throw new Error('Expected two surface buttons');
    await act(async () => first.click());
    expect(first.getAttribute('aria-pressed')).toBe('true');
    await act(async () => first.click());
    expect(first.getAttribute('aria-pressed')).toBe('false');

    buttons.forEach((button, index) => {
      const rect = () => new DOMRect(index * 32, 0, 28, 28);
      button.getBoundingClientRect = rect;
      const sortable = button.closest('nav > div');
      if (!sortable) throw new Error('Expected sortable toolbar item');
      sortable.getBoundingClientRect = rect;
    });
    const before = [...useUIStore.getState().contextRailOrder];
    await act(async () => first.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, clientX: 14, clientY: 14 })));
    await act(async () => document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 26, clientY: 14 })));
    await act(async () => document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 46, clientY: 14 })));
    expect(useUIStore.getState().contextRailOrder).toEqual(before);
    await act(async () => document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })));
    const after = useUIStore.getState().contextRailOrder;
    expect(after.findIndex((id) => id === first.dataset.contextSurface)).toBeGreaterThan(after.findIndex((id) => id === second.dataset.contextSurface));
    expect(useUIStore.getState().contextRailHiddenSurfaces).toEqual([]);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    globalThis.fetch = originalFetch;
    await win.happyDOM.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
