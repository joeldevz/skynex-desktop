import { expect, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import type { OpenSessionReference, SessionCloseResult } from '@/stores/useOpenSessionsStore';

export interface OpenSessionCollectionContract {
  sessions: readonly OpenSessionReference[];
  selectedId: string | null;
  onSelect(sessionId: string): void;
  onClose(sessionId: string, confirmation: 'unconfirmed' | 'stop-confirmed'): Promise<SessionCloseResult>;
}

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
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
    await run({ container,
      render: async (props) => { await act(async () => root.render(<I18nProvider><OpenSessionCollection {...props} /></I18nProvider>)); },
      button: (name) => {
        const found = [...document.querySelectorAll<HTMLButtonElement>('button')]
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
