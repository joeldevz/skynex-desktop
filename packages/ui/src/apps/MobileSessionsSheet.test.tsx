import { expect, mock, test } from 'bun:test';
import React, { act } from 'react';
import { Window } from 'happy-dom';
import type { OpenSessionReference } from '@/stores/useOpenSessionsStore';
import type { Workspace } from '@/lib/workspaces/model';

const reference: OpenSessionReference = {
  sessionId: 'mobile-session',
  title: 'Mobile work',
  primaryDirectory: '/projects/mobile',
  scope: {
    version: 1, workspaceId: 'mobile', workspaceName: 'Mobile', description: '',
    primaryDirectory: '/projects/mobile', folders: [{ id: 'mobile', path: '/projects/mobile', role: 'Application' }],
  },
};

const workspaces: readonly Workspace[] = [{
  id: 'mobile', name: 'Mobile', description: '', defaults: {},
  folders: [{ id: 'mobile', path: '/projects/mobile', role: 'Application' }],
}];

// Supply only the live-session hook required by the sheet. The mounted sheet,
// SessionSidebar, WorkspaceNavigation, stores and selection path remain real.
mock.module('@/sync/sync-context', () => ({ useAllLiveSessions: () => [], setActiveSession: () => {} }));
mock.module('@/components/session/DirectoryExplorerDialog', () => ({ DirectoryExplorerDialog: () => null }));

async function withSheet(run: (ui: {
  render(open: boolean, withFooter?: boolean): Promise<void>;
  button(name: string): HTMLButtonElement;
  container: HTMLDivElement;
  closeRequests: boolean[];
}) => Promise<void>) {
  const dom = new Window({ url: 'http://mobile-sessions-sheet.test' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom, document: dom.document, navigator: dom.navigator, localStorage: dom.localStorage,
    Node: dom.Node, NodeFilter: dom.NodeFilter, Element: dom.Element, Document: dom.Document,
    DocumentFragment: dom.DocumentFragment, ShadowRoot: dom.ShadowRoot, HTMLElement: dom.HTMLElement,
    HTMLInputElement: dom.HTMLInputElement, HTMLTextAreaElement: dom.HTMLTextAreaElement,
    HTMLButtonElement: dom.HTMLButtonElement, Event: dom.Event, FocusEvent: dom.FocusEvent,
    CustomEvent: dom.CustomEvent, MouseEvent: dom.MouseEvent, PointerEvent: dom.PointerEvent,
    KeyboardEvent: dom.KeyboardEvent, MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom), requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  try {
    const [{ createRoot }, { I18nProvider }, { MobileSessionsSheet }, { useWorkspacesStore },
      { openSessionsStore }, { useConfigStore }, { useSessionUIStore }, { switchRuntimeEndpoint, getRuntimeKey }] = await Promise.all([
      import('react-dom/client'), import('@/lib/i18n'), import('./MobileSessionsSheet'),
      import('@/stores/useWorkspacesStore'), import('@/stores/useOpenSessionsStore'),
      import('@/stores/useConfigStore'), import('@/sync/session-ui-store'), import('@/lib/runtime-switch'),
    ]);
    switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: 'mobile-sheet-test' });
    useWorkspacesStore.setState({ catalog: { version: 1, workspaces }, status: 'ready', selectedWorkspaceId: null });
    openSessionsStore.setState({ runtimeKey: getRuntimeKey(), sessions: [reference], hydration: 'ready' });
    useConfigStore.setState({ isConnected: false });
    useSessionUIStore.setState({ currentSessionId: null, openSessionFailure: null });
    const closeRequests: boolean[] = [];
    const footer = { instanceLabel: null, onOpenSettings: () => {}, onOpenScheduled: () => {}, onOpenArchive: () => {}, onOpenUsage: () => {}, onOpenIntegrations: () => {}, onOpenShortcuts: () => {}, onOpenAbout: () => {}, onOpenSourceBoard: () => {} };
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await run({ container, closeRequests,
        render: async (open, withFooter = true) => { await act(async () => root.render(<I18nProvider><MobileSessionsSheet open={open} onOpenChange={(value) => closeRequests.push(value)} {...(withFooter ? { footer } : {})} /></I18nProvider>)); },
        button: (name) => {
          const found = [...document.querySelectorAll<HTMLButtonElement>('button')]
            .find((node) => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === name);
          if (!found) throw new Error(`Missing button ${name}`);
          return found;
        },
      });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  } finally {
    try { await dom.happyDOM.close(); }
    finally {
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    }
  }
}

test('opening the mobile sessions drawer hydrates explicit open-session membership', async () => {
  await withSheet(async (ui) => {
    const { openSessionsStore } = await import('@/stores/useOpenSessionsStore');
    const originalHydrate = openSessionsStore.getState().hydrate;
    const hydrateCalls: Array<Parameters<typeof originalHydrate>[0]> = [];
    openSessionsStore.setState({ hydration: 'unloaded', hydrate: async (session) => {
      hydrateCalls.push(session);
      return { kind: 'ready' };
    } });
    try {
      await ui.render(true);
      expect(hydrateCalls).toEqual([null]);
    } finally {
      openSessionsStore.setState({ hydrate: originalHydrate });
    }
  });
});

test('selecting a session row in the mobile drawer requests drawer close', async () => {
  await withSheet(async (ui) => {
    await ui.render(true);
    await act(async () => ui.button('Mobile work').click());
    expect(ui.closeRequests).toEqual([false]);
  });
});

test('mobile sidebar has one More menu for secondary actions and no Add project action', async () => {
  await withSheet(async (ui) => {
    await ui.render(true);
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('Add project');
    expect(document.querySelectorAll('[aria-label="More"]').length).toBe(1);
    expect(document.querySelectorAll('[aria-label="Settings"]').length).toBe(1);
    expect(document.querySelectorAll('[aria-label="Archive"]').length).toBe(0);
    await act(async () => ui.button('More').click());
    expect(document.body.textContent).toContain('Integrations catalog');
    expect(document.body.textContent).toContain('Scheduled tasks');
  });
});

test('mobile sidebar without an app footer keeps shared sidebar actions and still omits Add project', async () => {
  await withSheet(async (ui) => {
    await ui.render(true, false);
    const text = document.body.textContent ?? '';
    expect(text).not.toContain('Add project');
    expect(document.querySelectorAll('[aria-label="Settings"]').length).toBe(1);
    expect(document.querySelectorAll('[aria-label="Archive"]').length).toBe(1);
    expect(document.querySelectorAll('[aria-label="Scheduled tasks"]').length).toBe(1);
    expect(document.querySelectorAll('[aria-label="Integrations catalog"]').length).toBe(1);
    expect(document.querySelectorAll('[aria-label="More"]').length).toBe(0);
  });
});
