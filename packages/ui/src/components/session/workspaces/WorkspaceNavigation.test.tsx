import { expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import type { Workspace } from '@/lib/workspaces/model';
import type { OpenSessionReference } from '@/stores/useOpenSessionsStore';

const workspaces: readonly Workspace[] = [
  { id: 'product', name: 'Product', description: '', defaults: {},
    folders: [{ id: 'app', path: '/projects/app', role: 'Application' }] },
  { id: 'research', name: 'Research', description: '', defaults: {},
    folders: [{ id: 'notes', path: '/elsewhere/notes', role: 'Reference' }] },
];

const sessions: readonly OpenSessionReference[] = [
  { sessionId: 'app-session', title: 'App work', primaryDirectory: '/projects/app',
    scope: { version: 1, workspaceId: 'product', workspaceName: 'Product', description: '',
      primaryDirectory: '/projects/app', folders: workspaces[0].folders } },
  { sessionId: 'notes-session', title: 'Notes work', primaryDirectory: '/elsewhere/notes',
    scope: { version: 1, workspaceId: 'research', workspaceName: 'Research', description: '',
      primaryDirectory: '/elsewhere/notes', folders: workspaces[1].folders } },
];

async function withNavigation(run: (ui: {
  render(): Promise<void>;
  button(name: string): HTMLButtonElement;
  container: HTMLDivElement;
}) => Promise<void>) {
  const dom = new Window({ url: 'http://workspace-navigation.test' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document,
    navigator: dom.navigator, localStorage: dom.localStorage,
    Node: dom.Node, NodeFilter: dom.NodeFilter, Element: dom.Element,
    Document: dom.Document, DocumentFragment: dom.DocumentFragment, ShadowRoot: dom.ShadowRoot,
    HTMLElement: dom.HTMLElement, HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement, HTMLButtonElement: dom.HTMLButtonElement,
    Event: dom.Event, FocusEvent: dom.FocusEvent, CustomEvent: dom.CustomEvent,
    MouseEvent: dom.MouseEvent, PointerEvent: dom.PointerEvent, KeyboardEvent: dom.KeyboardEvent,
    MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  try {
    const { createRoot } = await import('react-dom/client');
    const { I18nProvider } = await import('@/lib/i18n');
    const { WorkspaceNavigation } = await import('./WorkspaceNavigation');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await run({ container,
        render: async () => { await act(async () => root.render(<I18nProvider><WorkspaceNavigation /></I18nProvider>)); },
        button: (name) => {
          const found = [...container.querySelectorAll<HTMLButtonElement>('button')]
            .find((node) => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === name);
          if (!found) throw new Error(`Missing button ${name}`);
          return found;
        },
      });
    } finally {
      await act(async () => root.unmount());
    }
  } finally {
    try {
      await dom.happyDOM.close();
    } finally {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  }
}

// The navigation reads its stores directly; the fixture seeds them and records
// what the user's clicks ask of them.
async function fixture() {
  const { useWorkspacesStore } = await import('@/stores/useWorkspacesStore');
  const { openSessionsStore } = await import('@/stores/useOpenSessionsStore');
  const { useSessionUIStore } = await import('@/sync/session-ui-store');
  const { useConfigStore } = await import('@/stores/useConfigStore');
  const { switchRuntimeEndpoint } = await import('@/lib/runtime-switch');
  switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: 'workspace-navigation-test' });
  const sessionSelections: string[] = [];
  const closes: Array<[string, string]> = [];
  useConfigStore.setState({ isConnected: false });
  useWorkspacesStore.setState({ catalog: { version: 1, workspaces }, status: 'ready', selectedWorkspaceId: null });
  openSessionsStore.setState({ sessions, hydration: 'ready',
    closeSession: async (id, confirmation) => { closes.push([id, confirmation]); return { kind: 'retained', reason: 'activity-unknown' }; } });
  useSessionUIStore.setState({ currentSessionId: 'app-session', openSessionFailure: null,
    setCurrentSession: (id) => { if (id) sessionSelections.push(id); } });
  return { sessionSelections, closes, selectedWorkspace: () => useWorkspacesStore.getState().selectedWorkspaceId };
}

test('C1/C3 workspaces precede global open sessions and selecting a workspace keeps the session rows', async () => {
  await withNavigation(async (ui) => {
    const f = await fixture();
    await ui.render();
    const headings = [...ui.container.querySelectorAll('h2')].map((node) => node.textContent?.trim());
    expect(headings).toEqual(['Workspaces', 'Open sessions']);
    const assertSessionRows = () => {
      expect(ui.button('App work').textContent).toContain('Product');
      expect(ui.button('Notes work').textContent).toContain('Research');
    };
    assertSessionRows();
    await act(async () => ui.button('Research').click());
    expect(f.selectedWorkspace()).toBe('research');
    expect(f.sessionSelections).toEqual([]);
    assertSessionRows();
    await act(async () => ui.button('App work').click());
    expect(f.sessionSelections).toEqual(['app-session']);
    expect(f.selectedWorkspace()).toBeNull();
    expect(f.closes).toEqual([]);
  });
});

test('C1/C3/C7 create workspace, direct session and close actions stay separate', async () => {
  await withNavigation(async (ui) => {
    const f = await fixture();
    await ui.render();
    await act(async () => ui.button('New workspace').click());
    expect(document.body.textContent).toContain('New workspace');
    expect(f.sessionSelections).toEqual([]);
    await act(async () => ui.button('Close Notes work').click());
    expect(f.closes).toEqual([['notes-session', 'unconfirmed']]);
    expect(ui.button('Notes work').textContent).toContain('Notes work');
    await act(async () => ui.button('Notes work').click());
    expect(f.sessionSelections).toEqual(['notes-session']);
    expect(f.sessionSelections).toEqual(['notes-session']);
    expect(f.selectedWorkspace()).toBeNull();
  });
});
