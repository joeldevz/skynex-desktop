import { expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import type { MembershipResult, OpenSessionReference, SessionCloseResult } from '@/stores/useOpenSessionsStore';
import type { Session, SessionStatus } from '@/lib/opencode/model';

export interface OpenSessionCollectionContract {
  sessions: readonly OpenSessionReference[];
  selectedId: string | null;
  onSelect(sessionId: string): void;
  onClose(sessionId: string, confirmation: 'unconfirmed' | 'stop-confirmed'): Promise<SessionCloseResult>;
  onReorder?(sessionId: string, overId: string): Promise<{ kind: 'saved' } | { kind: 'retained'; reason: string }>;
  onReopen?(reference: OpenSessionReference): Promise<MembershipResult>;
}

const authoritativeSession = (time: Partial<Session['time']> = {}, extra: Partial<Session> = {}): Session => ({
  id: 'one', directory: '/projects/app', projectID: 'app', title: 'Saved app session', cost: 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  time: { created: 1, updated: 1, ...time }, ...extra,
});

const sessions: readonly OpenSessionReference[] = [
  { sessionId: 'one', title: 'Saved app session', primaryDirectory: '/projects/app', scope: {
    version: 1, workspaceId: 'product', workspaceName: 'Product', description: '', primaryDirectory: '/projects/app',
    folders: [{ id: 'app', path: '/projects/app', role: 'Application' }, { id: 'notes', path: '/reference/notes', role: 'Unlinked reference' }],
  } },
  { sessionId: 'two', title: 'Saved unloaded session', primaryDirectory: '/elsewhere/research', scope: {
    version: 1, workspaceId: 'research', workspaceName: 'Research', description: '', primaryDirectory: '/elsewhere/research',
    folders: [{ id: 'research', path: '/elsewhere/research', role: 'Research' }],
  } },
];

async function withCollection(run: (ui: {
  render(props: OpenSessionCollectionContract): Promise<void>;
  button(name: string): HTMLButtonElement;
  container: HTMLDivElement;
}) => Promise<void>) {
  const dom = new Window({ url: 'http://open-sessions.test' });
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
    const { OpenSessionCollection } = await import('./OpenSessionCollection');
    const { Toaster, toast } = await import('sonner');
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
    await run({ container,
      render: async (props) => { await act(async () => root.render(<I18nProvider><OpenSessionCollection {...props} /><Toaster /></I18nProvider>)); },
      button: (name) => {
        const found = [...document.querySelectorAll<HTMLButtonElement>('button')]
          .find((node) => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === name);
        if (!found) throw new Error(`Missing button ${name}`);
        return found;
      },
    });
    } finally {
      toast.dismiss();
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

test('pending permission overrides running and unread, and clears only after the live reply', async () => {
  const { applyGlobalBlockingRequestEvents, resetGlobalBlockingRequests } = await import('@/sync/global-blocking-requests');
  const { replaceGlobalSessionStatusById } = await import('@/sync/global-session-status');
  const { useGlobalSessionsStore } = await import('@/stores/useGlobalSessionsStore');
  useGlobalSessionsStore.getState().applySnapshot([authoritativeSession({ idle: 10, viewed: 5 })], [], 'ready');
  replaceGlobalSessionStatusById(new Map([['one', { status: { type: 'busy' }, directory: '/projects/app' }]]));
  try {
    await withCollection(async (ui) => {
      const props: OpenSessionCollectionContract = { sessions, selectedId: null, onSelect: () => {}, onClose: async () => ({ kind: 'closed' }) };
      await ui.render(props);
      await act(async () => applyGlobalBlockingRequestEvents('/projects/app', [{ type: 'permission.asked', properties: { id: 'p1', sessionID: 'one', action: 'bash', resources: ['command'] } }]));
      expect(ui.button('Saved app session').querySelector('[aria-label="Permission required"]')).not.toBeNull();
      expect(ui.button('Saved unloaded session').querySelector('[aria-label="Permission required"]')).toBeNull();
      expect(ui.button('Saved app session').querySelector('[aria-label="Active"]')).toBeNull();
      await act(async () => applyGlobalBlockingRequestEvents('/projects/app', [{ type: 'permission.replied', properties: { requestID: 'p1', sessionID: 'one' } }]));
      expect(ui.button('Saved app session').querySelector('[aria-label="Permission required"]')).toBeNull();
      expect(useGlobalSessionsStore.getState().entityById.get('one')?.time.viewed).toBe(5);
    });
  } finally {
    resetGlobalBlockingRequests();
    replaceGlobalSessionStatusById(new Map());
    useGlobalSessionsStore.getState().resetForRuntimeSwitch();
  }
});

for (const stopped of [false, true]) {
  test(`successful ${stopped ? 'stop-and-close' : 'idle close'} offers undo of the exact membership without selecting or restarting`, async () => {
    await withCollection(async (ui) => {
      const reopened: OpenSessionReference[] = [];
      const closed: string[] = [];
      const selected: string[] = [];
      const props: OpenSessionCollectionContract = { sessions, selectedId: 'two', onSelect: (id) => { selected.push(id); },
        onClose: async (_id, confirmation) => {
          closed.push(confirmation);
          return stopped && confirmation === 'unconfirmed' ? { kind: 'confirmation-required' } : { kind: 'closed' };
        },
        onReopen: async (reference) => { reopened.push(reference); return { kind: 'saved' }; },
      };
      await ui.render(props);
      await act(async () => ui.button('Close Saved unloaded session').click());
      if (stopped) await act(async () => ui.button('Stop and close').click());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      expect(document.body.textContent).toContain('Closed "Saved unloaded session"');
      await ui.render({ ...props, sessions: [sessions[0]] });
      await act(async () => ui.button('Undo').click());
      expect(reopened).toEqual([sessions[1]]);
      expect(selected).toEqual([]);
      expect(closed).toEqual(stopped ? ['unconfirmed', 'stop-confirmed'] : ['unconfirmed']);
    });
  });
}

test('failed close does not offer undo', async () => {
  await withCollection(async (ui) => {
    await ui.render({ sessions, selectedId: null, onSelect: () => {}, onClose: async () => ({ kind: 'retained', reason: 'persistence-failed' }), onReopen: async () => ({ kind: 'saved' }) });
    await act(async () => ui.button('Close Saved unloaded session').click());
    expect(document.body.textContent).not.toContain('Closed "Saved unloaded session"');
    expect(ui.container.querySelector('[role="alert"]')?.textContent).not.toBe('');
  });
});

for (const throws of [false, true]) {
  test(`undo reports a ${throws ? 'thrown' : 'retained'} reopen failure without selecting a session`, async () => {
    await withCollection(async (ui) => {
      const selected: string[] = [];
      let attempts = 0;
      await ui.render({ sessions, selectedId: null, onSelect: (id) => { selected.push(id); }, onClose: async () => ({ kind: 'closed' }),
        onReopen: async () => {
          attempts++;
          if (throws) throw new Error('Offline');
          return { kind: 'retained', reason: 'persistence-failed' };
        },
      });
      await act(async () => ui.button('Close Saved unloaded session').click());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      await act(async () => ui.button('Undo').click());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      expect(attempts).toBe(1);
      expect(selected).toEqual([]);
      expect(document.body.textContent).toContain('could not be saved to open sessions');
    });
  });
}

test('undo from an old runtime cannot reopen a session in the newly selected server', async () => {
  const { switchRuntimeEndpoint, getRuntimeKey } = await import('@/lib/runtime-switch');
  const before = getRuntimeKey();
  try {
    await withCollection(async (ui) => {
      const reopened: OpenSessionReference[] = [];
      await ui.render({ sessions, selectedId: null, onSelect: () => {}, onClose: async () => ({ kind: 'closed' }), onReopen: async (reference) => { reopened.push(reference); return { kind: 'saved' }; } });
      await act(async () => ui.button('Close Saved unloaded session').click());
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: 'undo-other-server' });
      await act(async () => ui.button('Undo').click());
      expect(reopened).toEqual([]);
    });
  } finally {
    switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: before });
  }
});

test('C3 global rows retain saved workspace labels and unloaded sessions remain directly selectable', async () => {
  await withCollection(async (ui) => {
    const selected: string[] = [];
    const closed: string[] = [];
    const props: OpenSessionCollectionContract = { sessions, selectedId: 'one',
      onSelect: (id) => { selected.push(id); },
      onClose: async (id) => { closed.push(id); return { kind: 'closed' }; } };
    await ui.render(props);
    expect(ui.container.textContent).toContain('Product');
    expect(ui.container.textContent).toContain('Research');
    // Rows name the workspace only; the saved folders still route the session (sidebar DOCUMENTATION.md).
    expect(ui.container.textContent).not.toContain('/projects/app');
    await act(async () => ui.button('Saved unloaded session').click());
    expect(selected).toEqual(['two']);
    await ui.render({ ...props, selectedId: 'two' });
    expect(ui.button('Saved app session').textContent).toContain('Saved app session');
    expect(ui.button('Saved unloaded session').textContent).toContain('Saved unloaded session');
    expect(closed).toEqual([]);
  });
});

test('C1 an authoritative completed unread top-level session has an accessible marker that clears when viewed', async () => {
  const { useGlobalSessionsStore } = await import('@/stores/useGlobalSessionsStore');
  useGlobalSessionsStore.getState().applySnapshot([authoritativeSession({ idle: 10, viewed: 5 })], [], 'ready');
  try {
    await withCollection(async (ui) => {
      const props: OpenSessionCollectionContract = { sessions, selectedId: null, onSelect: () => {}, onClose: async () => ({ kind: 'closed' }) };
      await ui.render(props);
      const row = ui.button('Saved app session');
      expect([...row.querySelectorAll('[aria-label], [title]')].some((node) =>
        /new response|unreviewed/i.test(`${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('title') ?? ''}`))).toBe(true);
      expect(useGlobalSessionsStore.getState().entityById.get('one')?.time.viewed).toBe(5);
      useGlobalSessionsStore.getState().upsertSession(authoritativeSession({ idle: 10, viewed: 10 }));
      await ui.render(props);
      expect([...ui.button('Saved app session').querySelectorAll('[aria-label], [title]')].some((node) =>
        /new response|unreviewed/i.test(`${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('title') ?? ''}`))).toBe(false);
    });
  } finally {
    useGlobalSessionsStore.getState().resetForRuntimeSwitch();
  }
});

test('C1 reviewed, absent, child, and archived sessions have no unread marker', async () => {
  const { useGlobalSessionsStore } = await import('@/stores/useGlobalSessionsStore');
  const cases: Array<{ name: string; session?: Session }> = [
    { name: 'reviewed', session: authoritativeSession({ idle: 10, viewed: 10 }) },
    { name: 'absent' },
    { name: 'child', session: authoritativeSession({ idle: 10, viewed: 5 }, { parentID: 'parent' }) },
    { name: 'archived', session: authoritativeSession({ idle: 10, viewed: 5, archived: 20 }) },
  ];
  try {
    await withCollection(async (ui) => {
      const props: OpenSessionCollectionContract = { sessions, selectedId: null, onSelect: () => {}, onClose: async () => ({ kind: 'closed' }) };
      for (const scenario of cases) {
        useGlobalSessionsStore.getState().applySnapshot(scenario.session ? [scenario.session] : [], [], 'ready');
        await ui.render(props);
        expect([...ui.button('Saved app session').querySelectorAll('[aria-label], [title]')].some((node) =>
          /new response|unreviewed/i.test(`${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('title') ?? ''}`))).toBe(false);
      }
    });
  } finally {
    useGlobalSessionsStore.getState().resetForRuntimeSwitch();
  }
});

test('C1 running activity takes precedence over the completed unread marker', async () => {
  const { useGlobalSessionsStore } = await import('@/stores/useGlobalSessionsStore');
  const { replaceGlobalSessionStatusById } = await import('@/sync/global-session-status');
  const { useSessionActivityTimingStore } = await import('@/sync/session-activity-timing');
  useGlobalSessionsStore.getState().applySnapshot([authoritativeSession({ idle: 10, viewed: 5 })], [], 'ready');
  replaceGlobalSessionStatusById(new Map([['one', { status: { type: 'busy' } as SessionStatus, directory: '/projects/app' }]]));
  useSessionActivityTimingStore.setState({ startedAt: new Map([['one', Date.now() - 60_000]]), settledMs: new Map() });
  try {
    await withCollection(async (ui) => {
      await ui.render({ sessions, selectedId: null, onSelect: () => {}, onClose: async () => ({ kind: 'closed' }) });
      const row = ui.button('Saved app session');
      expect([...row.querySelectorAll('[aria-label], [title]')].some((node) =>
        /active|running/i.test(`${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('title') ?? ''}`))).toBe(true);
      expect([...row.querySelectorAll('[aria-label], [title]')].some((node) =>
        /new response|unreviewed/i.test(`${node.getAttribute('aria-label') ?? ''} ${node.getAttribute('title') ?? ''}`))).toBe(false);
      expect(row.textContent).toMatch(/1m/);
      expect(ui.container.querySelector('[aria-label="Close Saved app session"]')?.className).toContain('group-hover:opacity-100');
    });
  } finally {
    replaceGlobalSessionStatusById(new Map());
    useSessionActivityTimingStore.setState({ startedAt: new Map(), settledMs: new Map() });
    useGlobalSessionsStore.getState().resetForRuntimeSwitch();
  }
});

test('C7 idle close waits for successful parent membership update before removing its row', async () => {
  await withCollection(async (ui) => {
    const closes: Array<[string, string]> = [];
    const props: OpenSessionCollectionContract = { sessions, selectedId: 'two', onSelect: () => {},
      onClose: async (id, confirmation) => { closes.push([id, confirmation]); return { kind: 'closed' }; } };
    await ui.render(props);
    await act(async () => ui.button('Close Saved unloaded session').click());
    expect(closes).toEqual([['two', 'unconfirmed']]);
    expect(ui.button('Saved unloaded session').textContent).toContain('Saved unloaded session');
    await ui.render({ ...props, sessions: [sessions[0]], selectedId: 'one' });
    expect(ui.container.textContent).not.toContain('Saved unloaded session');
    expect(ui.button('Saved app session').textContent).toContain('Saved app session');
  });
});

test('C8 active close asks once, cancel leaves membership intact, confirm targets the exact session', async () => {
  await withCollection(async (ui) => {
    const closes: Array<[string, string]> = [];
    const props: OpenSessionCollectionContract = { sessions, selectedId: 'two', onSelect: () => {},
      onClose: async (id, confirmation) => {
        closes.push([id, confirmation]);
        return confirmation === 'unconfirmed' ? { kind: 'confirmation-required' } : { kind: 'closed' };
      } };
    await ui.render(props);
    await act(async () => ui.button('Close Saved app session').click());
    expect(closes).toEqual([['one', 'unconfirmed']]);
    expect(document.querySelector('[role="dialog"], [role="alertdialog"]')?.textContent).toContain('Saved app session');
    await act(async () => ui.button('Cancel').click());
    expect(closes).toEqual([['one', 'unconfirmed']]);
    expect(ui.button('Saved app session').textContent).toContain('Saved app session');
    await act(async () => ui.button('Close Saved app session').click());
    await act(async () => ui.button('Stop and close').click());
    expect(closes).toEqual([['one', 'unconfirmed'], ['one', 'unconfirmed'], ['one', 'stop-confirmed']]);
    expect(ui.button('Saved app session').textContent).toContain('Saved app session');
  });
});

for (const reason of ['stop-failed', 'persistence-failed'] as const) {
  test(`C9 ${reason} remains visible and preserves both open rows`, async () => {
    await withCollection(async (ui) => {
      const closes: Array<[string, string]> = [];
      await ui.render({ sessions, selectedId: 'two', onSelect: () => {},
        onClose: async (id, confirmation) => {
          closes.push([id, confirmation]);
          return confirmation === 'unconfirmed' ? { kind: 'confirmation-required' } : { kind: 'retained', reason };
        } });
      await act(async () => ui.button('Close Saved app session').click());
      await act(async () => ui.button('Stop and close').click());
      expect(closes).toEqual([['one', 'unconfirmed'], ['one', 'stop-confirmed']]);
      const message = document.querySelector('[role="alert"]')?.textContent ?? '';
      expect(message).toMatch(reason === 'stop-failed' ? /could not stop|unable to stop|failed to stop/i : /stopped.*(could not close|unable to close|could not save)/i);
      expect(ui.button('Saved app session').textContent).toContain('Saved app session');
      expect(ui.button('Saved unloaded session').textContent).toContain('Saved unloaded session');
    });
  });
}
