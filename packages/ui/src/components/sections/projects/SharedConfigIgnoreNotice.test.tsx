import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '@/lib/i18n';
import { switchRuntimeEndpoint } from '@/lib/runtime-switch';
import type { SharedConfigIgnoreFixResult, SharedConfigIgnoreStatus } from '@/lib/openchamberConfig';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { Window } from 'happy-dom';
import { SharedConfigIgnoreNotice } from './SharedConfigIgnoreNotice';

// A real DOM, so text, queries and clicks behave as in the browser.
const installDom = () => {
  const dom = new Window({ url: 'http://shared-ignore.test' });
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator,
    Node: dom.Node, Element: dom.Element, HTMLElement: dom.HTMLElement, HTMLButtonElement: dom.HTMLButtonElement,
    Event: dom.Event, MouseEvent: dom.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const container = document.createElement('div');
  document.body.append(container);
  return {
    container,
    restore: async () => {
      await dom.happyDOM.close();
      for (const [key, descriptor] of saved) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
};

const project = { id: 'project-1', path: '/repo/project' };
const originalFetch = globalThis.fetch;
let runtime = 0;

// The fake server answers the two shared-ignore routes and records each request.
const serve = (status: SharedConfigIgnoreStatus, fix: SharedConfigIgnoreFixResult | null) => {
  const requests: string[] = [];
  // SAFETY: the stub implements fetch's call signature, the only part runtimeFetch uses.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (input instanceof Request ? input.method : init?.method) ?? 'GET';
    if (!url.includes('/config/shared-ignore')) return new Response(null, { status: 503 });
    requests.push(`${method} ${url.endsWith('/fix') ? 'fix' : 'status'}`);
    return Response.json(url.endsWith('/fix') ? fix : status);
  }) as typeof fetch;
  return requests;
};

const mount = async () => {
  const dom = installDom();
  const root = createRoot(dom.container);
  await act(async () => root.render(<I18nProvider><SharedConfigIgnoreNotice projectId={project.id} /></I18nProvider>));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  return {
    dom,
    close: async () => { await act(async () => root.unmount()); await dom.restore(); },
  };
};

describe('SharedConfigIgnoreNotice', () => {
  beforeEach(() => {
    switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: `shared-ignore-${++runtime}` });
    useProjectsStore.setState({ projects: [project] });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('reads the status without fixing, then fixes once on click and hides once committable', async () => {
    const requests = serve(
      { kind: 'ignored', source: '.gitignore', line: 4, pattern: '.skynex/', fixable: true },
      { kind: 'updated', status: { kind: 'committable' } },
    );
    const view = await mount();
    try {
      expect(requests).toEqual(['GET status']);
      expect(view.dom.container.textContent).toContain('Git ignores .skynex/project.json');
      const button = view.dom.container.querySelector('button');
      expect(button?.textContent).toContain('Add exception');
      await act(async () => { button?.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
      expect(requests).toEqual(['GET status', 'POST fix']);
      expect(view.dom.container.textContent).toBe('');
    } finally { await view.close(); }
  });

  test('a rule outside the root .gitignore names its file and line and offers no fix', async () => {
    const requests = serve({ kind: 'ignored', source: '.git/info/exclude', line: 7, pattern: '.skynex/', fixable: false }, null);
    const view = await mount();
    try {
      expect(view.dom.container.textContent).toContain('.git/info/exclude:7');
      expect(view.dom.container.querySelector('button')).toBeNull();
      expect(requests).toEqual(['GET status']);
    } finally { await view.close(); }
  });

  test('a refused fix stays visible as an error', async () => {
    serve(
      { kind: 'ignored', source: '.gitignore', line: 4, pattern: '.skynex/', fixable: true },
      { kind: 'refused', reason: 'changed' },
    );
    const view = await mount();
    try {
      await act(async () => { view.dom.container.querySelector('button')?.click(); await new Promise((resolve) => setTimeout(resolve, 30)); });
      expect(view.dom.container.querySelector('[role="alert"]')?.textContent).not.toBe('');
      expect(view.dom.container.textContent).toContain('Git ignores .skynex/project.json');
    } finally { await view.close(); }
  });

  test('a failed status request shows a muted check failure', async () => {
    globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
    const view = await mount();
    try {
      expect(view.dom.container.textContent).toContain('Couldn’t check whether Git ignores .skynex/project.json.');
      expect(view.dom.container.querySelector('[role="alert"]')).toBeNull();
    } finally { await view.close(); }
  });

  test('a project outside a repository shows no notice', async () => {
    serve({ kind: 'unknown', reason: 'not-a-repository' }, null);
    const view = await mount();
    try {
      expect(view.dom.container.textContent).toBe('');
    } finally { await view.close(); }
  });
});
