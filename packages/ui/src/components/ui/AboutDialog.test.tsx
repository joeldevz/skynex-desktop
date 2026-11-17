import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';

test('About refreshes the server Skynex CLI version on each opening and shows unknown for older servers', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom, document: dom.document, navigator: dom.navigator, location: dom.location, localStorage: dom.localStorage,
    Element: dom.Element, HTMLElement: dom.HTMLElement, Node: dom.Node,
    Event: dom.Event, CustomEvent: dom.CustomEvent, KeyboardEvent: dom.KeyboardEvent, MouseEvent: dom.MouseEvent,
    MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [name, value] of Object.entries(globals)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const previousFetch = globalThis.fetch;
  let infoRequests = 0;
  globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/api/system/info')) {
      infoRequests++;
      if (infoRequests === 6) throw new Error('transport unavailable');
      if (infoRequests === 4) return new Response('{', { headers: { 'content-type': 'application/json' } });
      if (infoRequests === 5) return new Response('{}', { status: 503 });
      const body = [
        { openchamberVersion: '0.1.3', skynexCliVersion: '0.4.0' },
        { openchamberVersion: '0.1.3' },
        { openchamberVersion: '0.1.3', skynexCliVersion: 42 },
      ][infoRequests - 1] ?? {};
      return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('/api/opencode/upgrade-status')) {
      return new Response(JSON.stringify({ currentVersion: '2.0.0' }), { headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  }, previousFetch);

  const { createRoot } = await import('react-dom/client');
  const { I18nProvider } = await import('@/lib/i18n');
  const { AboutDialog } = await import('./AboutDialog');
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let open = true;
  const render = () => act(async () => root.render(<I18nProvider>
    <AboutDialog open={open} onOpenChange={(nextOpen) => { open = nextOpen; }} />
  </I18nProvider>));
  try {
    await render();
    expect(document.body.textContent).toContain('Skynex CLI version 0.4.0');
    expect(infoRequests).toBe(1);
    open = false;
    await render();
    open = true;
    await render();
    expect(infoRequests).toBe(2);
    expect(document.body.textContent).toContain('Skynex CLI version unknown');
    expect(document.body.textContent).toContain('Skynex version 0.1.3');
    expect(document.body.textContent).toContain('OpenCode version 2.0.0');
    for (let request = 3; request <= 6; request++) {
      open = false;
      await render();
      open = true;
      await render();
      expect(infoRequests).toBe(request);
      expect(document.body.textContent).toContain('Skynex CLI version unknown');
    }
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = previousFetch;
    dom.happyDOM.cancelAsync();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
