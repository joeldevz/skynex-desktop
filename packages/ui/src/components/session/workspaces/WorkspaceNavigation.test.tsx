import { expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import type { Workspace } from '@/lib/workspaces/model';
import type { OpenSessionReference, MembershipResult } from '@/stores/useOpenSessionsStore';
import type { Session } from '@/lib/opencode/model';

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
  render(key?: number): Promise<void>;
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
    Touch: dom.Touch, TouchEvent: dom.TouchEvent,
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
        render: async (key) => { await act(async () => root.render(<I18nProvider><WorkspaceNavigation key={key} /></I18nProvider>)); },
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
async function fixture(reorderResult: MembershipResult = { kind: 'saved' }) {
  const { useWorkspacesStore } = await import('@/stores/useWorkspacesStore');
  const { openSessionsStore } = await import('@/stores/useOpenSessionsStore');
  const { useSessionUIStore } = await import('@/sync/session-ui-store');
  const { useConfigStore } = await import('@/stores/useConfigStore');
  const { useUIStore } = await import('@/stores/useUIStore');
  const { switchRuntimeEndpoint } = await import('@/lib/runtime-switch');
  switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: 'workspace-navigation-test' });
  const sessionSelections: string[] = [];
  const closes: Array<[string, string]> = [];
  const reorders: Array<[string, string]> = [];
  useConfigStore.setState({ isConnected: false });
  useUIStore.setState({ workspaceSidebarSplitRatio: 0.5 });
  useWorkspacesStore.setState({ catalog: { version: 1, workspaces }, status: 'ready', selectedWorkspaceId: null });
  openSessionsStore.setState({ sessions, hydration: 'ready',
    reorderSession: async (id, overId) => { reorders.push([id, overId]); return reorderResult; },
    closeSession: async (id, confirmation) => { closes.push([id, confirmation]); return { kind: 'retained', reason: 'activity-unknown' }; } });
  useSessionUIStore.setState({ currentSessionId: 'app-session', openSessionFailure: null,
    setCurrentSession: (id) => { if (id) sessionSelections.push(id); } });
  return { sessionSelections, closes, reorders, selectedWorkspace: () => useWorkspacesStore.getState().selectedWorkspaceId };
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
    expect(ui.container.querySelectorAll('button[aria-label^="Reorder "]')).toHaveLength(0);
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

test('workspace and open-session sections scroll independently', async () => {
  await withNavigation(async (ui) => {
    await fixture();
    await ui.render();
    const workspaceSection = [...ui.container.querySelectorAll('section')]
      .find((section) => section.getAttribute('aria-label') === 'Workspaces');
    const sessionSection = [...ui.container.querySelectorAll('section')]
      .find((section) => section.getAttribute('aria-label') === 'Open sessions');
    expect(workspaceSection?.querySelector('.overflow-y-auto')).toBeTruthy();
    expect(sessionSection?.querySelector('.overflow-y-auto')).toBeTruthy();
    expect(workspaceSection?.querySelector('.overflow-y-auto')).not.toBe(sessionSection?.querySelector('.overflow-y-auto'));
  });
});

function splitHandle(container: HTMLElement) {
  const handle = container.querySelector<HTMLDivElement>('[role="separator"][aria-orientation="horizontal"]');
  const grid = handle?.parentElement;
  if (!handle || !grid) throw new Error('Missing workspace height separator');
  grid.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 320, bottom: 1008, width: 320, height: 1008, toJSON: () => ({}) });
  let captured: number | null = null;
  handle.setPointerCapture = (id) => { captured = id; };
  handle.hasPointerCapture = (id) => captured === id;
  handle.releasePointerCapture = () => { captured = null; };
  return { handle, grid };
}

test('height drag previews only geometry and saves once on release, retaining membership and scroll', async () => {
  await withNavigation(async (ui) => {
    const f = await fixture();
    const { useUIStore } = await import('@/stores/useUIStore');
    const { openSessionsStore } = await import('@/stores/useOpenSessionsStore');
    const membership = openSessionsStore.getState().sessions;
    await ui.render();
    const { handle, grid } = splitHandle(ui.container);
    const scrollers = ui.container.querySelectorAll<HTMLElement>('section > .overflow-y-auto');
    for (const scroller of scrollers) scroller.scrollTop = 30;
    const writes: number[] = [];
    const unsubscribe = useUIStore.subscribe((state, previous) => {
      if (state.workspaceSidebarSplitRatio !== previous.workspaceSidebarSplitRatio) writes.push(state.workspaceSidebarSplitRatio);
    });
    try {
      expect(handle.getAttribute('aria-valuenow')).toBe('50');
      await act(async () => handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientY: 500, button: 0, bubbles: true })));
      await act(async () => handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 2, clientY: 800, bubbles: true })));
      expect(handle.getAttribute('aria-valuenow')).toBe('50');
      for (const clientY of [510, 550, 700]) {
        await act(async () => handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientY, bubbles: true })));
      }
      expect(grid.style.gridTemplateRows).toContain('0.7fr');
      expect(handle.getAttribute('aria-valuenow')).toBe('70');
      expect(useUIStore.getState().workspaceSidebarSplitRatio).toBe(0.5);
      expect(writes).toEqual([]);
      await ui.render();
      expect(grid.style.gridTemplateRows).toContain('0.7fr');
      await act(async () => handle.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true })));
      await act(async () => handle.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true })));
      expect(writes).toEqual([0.7]);
      expect(openSessionsStore.getState().sessions).toBe(membership);
      expect(f.sessionSelections).toEqual([]);
      expect(f.closes).toEqual([]);
      for (const scroller of scrollers) expect(scroller.scrollTop).toBe(30);
      await ui.render(1);
      expect(splitHandle(ui.container).handle.getAttribute('aria-valuenow')).toBe('70');
    } finally {
      unsubscribe();
    }
  });
});

test('touch resizing keeps both sections available and commits the shown position on cancellation', async () => {
  await withNavigation(async (ui) => {
    await fixture();
    const { useUIStore } = await import('@/stores/useUIStore');
    await ui.render();
    const { handle } = splitHandle(ui.container);
    await act(async () => handle.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 3, pointerType: 'touch', clientY: 500, bubbles: true })));
    await act(async () => handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, pointerType: 'touch', clientY: -1000, bubbles: true })));
    expect(handle.getAttribute('aria-valuenow')).toBe('10');
    await act(async () => handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, pointerType: 'touch', clientY: 3000, bubbles: true })));
    expect(handle.getAttribute('aria-valuenow')).toBe('90');
    await act(async () => handle.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 3, pointerType: 'touch', bubbles: true })));
    expect(useUIStore.getState().workspaceSidebarSplitRatio).toBe(0.9);
    await act(async () => handle.dispatchEvent(new PointerEvent('pointermove', { pointerId: 3, clientY: 0, bubbles: true })));
    expect(handle.getAttribute('aria-valuenow')).toBe('90');
  });
});

for (const direction of ['ltr', 'rtl']) {
  test(`height separator supports keyboard resizing without reversing vertical keys in ${direction}`, async () => {
    await withNavigation(async (ui) => {
      await fixture();
      document.documentElement.dir = direction;
      await ui.render();
      const { handle } = splitHandle(ui.container);
      handle.focus();
      for (const [key, expected] of [['ArrowUp', '48'], ['ArrowDown', '50'], ['Home', '10'], ['End', '90']]) {
        await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
        expect(handle.getAttribute('aria-valuenow')).toBe(expected);
      }
      expect(handle.tabIndex).toBe(0);
      expect(document.activeElement).toBe(handle);
    });
  });
}

test('workspace and global visibility controls only filter the list, preserving open membership', async () => {
  await withNavigation(async (ui) => {
    const { openSessionsStore } = await import('@/stores/useOpenSessionsStore');
    const membership = openSessionsStore.getState().sessions;
    await ui.render();

    await act(async () => ui.button('Hide open sessions for Product').click());
    expect(() => ui.button('App work')).toThrow();
    expect(ui.button('Notes work')).toBeTruthy();
    expect(openSessionsStore.getState().sessions).toBe(membership);

    await act(async () => ui.button('Show open sessions for Product').click());
    expect(ui.button('App work')).toBeTruthy();
    expect(openSessionsStore.getState().sessions).toBe(membership);

    await act(async () => ui.button('Hide all open sessions').click());
    expect(() => ui.button('App work')).toThrow();
    expect(() => ui.button('Notes work')).toThrow();
    expect(openSessionsStore.getState().sessions).toBe(membership);

    await act(async () => ui.button('Show open sessions for Product').click());
    expect(ui.button('App work')).toBeTruthy();
    expect(() => ui.button('Notes work')).toThrow();
    expect(openSessionsStore.getState().sessions).toBe(membership);

    await act(async () => ui.button('Show all open sessions').click());
    expect(ui.button('App work')).toBeTruthy();
    expect(ui.button('Notes work')).toBeTruthy();
    expect(openSessionsStore.getState().sessions).toBe(membership);
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

test('C3 keyboard drag reorders stable session ids without selecting or closing a row', async () => {
  await withNavigation(async (ui) => {
    const f = await fixture();
    const { useGlobalSessionsStore } = await import('@/stores/useGlobalSessionsStore');
    useGlobalSessionsStore.getState().upsertSession({
      id: 'app-session', directory: '/projects/app', projectID: 'app', title: 'App work', cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: 1, updated: 1, idle: 10, viewed: 5 },
    } satisfies Session);
    await ui.render();
    for (const [index, name] of ['App work', 'Notes work'].entries()) {
      const row = ui.button(name).closest('li')!;
      row.getBoundingClientRect = () => ({ x: 0, y: index * 48, top: index * 48, left: 0, right: 240, bottom: index * 48 + 40, width: 240, height: 40, toJSON: () => ({}) });
    }
    const handle = ui.button('App work');
    await act(async () => {
      handle.focus();
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
    });
    await act(async () => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
    });
    await act(async () => {
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true }));
      await Promise.resolve();
    });
    expect(f.reorders).toEqual([['app-session', 'notes-session']]);
    expect(f.sessionSelections).toEqual([]);
    expect(f.closes).toEqual([]);
    expect(useGlobalSessionsStore.getState().entityById.get('app-session')?.time.viewed).toBe(5);
    useGlobalSessionsStore.getState().resetForRuntimeSwitch();
  });
});

test('C3 mouse drag reorders stable session ids and a rejected reorder leaves both rows with an error', async () => {
  await withNavigation(async (ui) => {
    const f = await fixture({ kind: 'retained', reason: 'persistence-failed' });
    await ui.render();
    for (const [index, name] of ['App work', 'Notes work'].entries()) {
      const row = ui.button(name).closest('li')!;
      row.getBoundingClientRect = () => ({ x: 0, y: index * 48, top: index * 48, left: 0, right: 240, bottom: index * 48 + 40, width: 240, height: 40, toJSON: () => ({}) });
    }
    const handle = ui.button('App work');
    await act(async () => {
      handle.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, clientX: 10, clientY: 20 }));
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 30 }));
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 10, clientY: 70 }));
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true, clientX: 10, clientY: 70 }));
      await Promise.resolve();
    });
    expect(f.reorders).toEqual([['app-session', 'notes-session']]);
    expect(ui.button('App work')).toBeTruthy();
    expect(ui.button('Notes work')).toBeTruthy();
    expect(ui.container.querySelector('[role="alert"]')?.textContent?.trim()).not.toBe('');
    expect(f.sessionSelections).toEqual([]);
    expect(f.closes).toEqual([]);
  });
});

test('C5 touch drag reorders stable session ids after the long-press activation delay', async () => {
  await withNavigation(async (ui) => {
    const f = await fixture();
    await ui.render();
    for (const [index, name] of ['App work', 'Notes work'].entries()) {
      const row = ui.button(name).closest('li')!;
      row.getBoundingClientRect = () => ({ x: 0, y: index * 48, top: index * 48, left: 0, right: 240, bottom: index * 48 + 40, width: 240, height: 40, toJSON: () => ({}) });
    }
    const handle = ui.button('App work');
    const start = new Touch({ identifier: 1, target: handle, clientX: 10, clientY: 20 });
    const end = new Touch({ identifier: 1, target: ui.button('Notes work'), clientX: 10, clientY: 70 });
    await act(async () => {
      handle.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [start], changedTouches: [start] }));
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    await act(async () => {
      document.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, cancelable: true, touches: [end], changedTouches: [end] }));
    });
    await act(async () => {
      document.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [end] }));
      await Promise.resolve();
    });
    expect(f.reorders).toEqual([['app-session', 'notes-session']]);
    expect(f.sessionSelections).toEqual([]);
    expect(f.closes).toEqual([]);
  });
});
