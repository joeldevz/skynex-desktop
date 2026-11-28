import { expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';

const pendingPreference = () => {
  let resolve: (value: { enabled: boolean; available: boolean }) => void = () => { throw new Error('Preference promise not initialized'); };
  const promise = new Promise<{ enabled: boolean; available: boolean }>((finish) => { resolve = finish; });
  return { promise, resolve };
};

test('shows the disclosure and saves opt-out while collection is unavailable', async () => {
  const dom = new Window({ url: 'http://127.0.0.1:51999' });
  const calls: Array<{ command: string; args: { enabled?: boolean } }> = [];
  const writes = pendingPreference();
  const reads = pendingPreference();
  Object.assign(dom, {
    __OPENCHAMBER_ELECTRON__: { runtime: 'electron' },
    __OPENCHAMBER_LOCAL_ORIGIN__: dom.location.origin,
    __OPENCHAMBER_API_BASE_URL__: dom.location.origin,
    __OPENCHAMBER_DESKTOP__: { invoke: async (command: string, args: { enabled?: boolean }) => {
      if (command === 'desktop_set_locale') return null;
      calls.push({ command, args });
      if (command === 'desktop_get_product_analytics_settings') return reads.promise;
      if (command === 'desktop_set_product_analytics_enabled') return writes.promise;
      throw new Error(`Unexpected desktop command: ${command}`);
    } },
  });
  const globals = {
    window: dom, document: dom.document, navigator: dom.navigator,
    HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, Event: dom.Event,
    CustomEvent: dom.CustomEvent, MutationObserver: dom.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    fetch: async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), dom.location.href);
      if (url.pathname === '/api/fs/home') return Response.json({ home: '/test' });
      if (url.pathname === '/api/location') return Response.json({ data: { directory: '/test' } });
      if (url.pathname === '/api/session') return Response.json({ data: [], cursor: {} });
      return new Response(null, { status: 404 });
    },
  };
  const previous = Object.keys(globals).map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  for (const [name, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  try {
    const { createRoot } = await import('react-dom/client');
    const { I18nProvider } = await import('@/lib/i18n');
    const { ProductAnalyticsSettings } = await import('./ProductAnalyticsSettings');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(
        <I18nProvider>
          <ProductAnalyticsSettings />
        </I18nProvider>,
      ));
      const row = container.querySelector<HTMLElement>('[data-settings-item="general.product-analytics"]');
      if (!row) throw new Error('Analytics preference row missing');
      expect(row.getAttribute('aria-disabled')).toBe('true');
      await act(async () => reads.resolve({ enabled: true, available: false }));
      expect(row.getAttribute('aria-disabled')).toBeNull();
      expect(row.getAttribute('aria-pressed')).toBe('true');
      expect(row.textContent).toContain('PostHog EU');
      expect(row.textContent).toContain('the Skynex version, and the operating system family');
      expect(row.textContent).toContain('Inactive because configuration is missing or enterprise policy blocks it');

      await act(async () => row.click());
      expect(row.getAttribute('aria-disabled')).toBe('true');
      expect(row.getAttribute('aria-pressed')).toBe('true');
      await act(async () => row.click());
      await act(async () => writes.resolve({ enabled: false, available: false }));
      expect(row.getAttribute('aria-disabled')).toBeNull();
      expect(row.getAttribute('aria-pressed')).toBe('false');
      expect(calls).toEqual([
        { command: 'desktop_get_product_analytics_settings', args: {} },
        { command: 'desktop_set_product_analytics_enabled', args: { enabled: false } },
      ]);
    } finally {
      await act(async () => root.unmount());
    }
  } finally {
    await dom.happyDOM.close();
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
