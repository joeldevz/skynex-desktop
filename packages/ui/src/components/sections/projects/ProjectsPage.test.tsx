import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import type { Root } from 'react-dom/client';
import { registerRuntimeAPIs } from '@/contexts/runtimeAPIRegistry';
import type { RuntimeAPIs, SettingsPayload } from '@/lib/api/types';
import type { ProjectEntry } from '@/lib/api/types';
import type { WorkspaceCatalog } from '@/lib/workspaces/model';
import type { WorkspaceSettingsTarget } from './workspaceSettingsTargets';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';
import { useUIStore } from '@/stores/useUIStore';
import { switchRuntimeEndpoint } from '@/lib/runtime-switch';
import { invalidateSettingsCache } from '@/lib/persistence';

describe('workspace Projects settings', () => {
  let dom: Window;
  let root: Root | undefined;
  let restoreStores = () => {};
  let saveFails = false;
  const globals = new Map<string, PropertyDescriptor | undefined>();
  let testRuntime = 0;
  const setInputValue = (input: HTMLInputElement | null, value: string) => {
    if (!input) return;
    Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value')?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };

  beforeEach(() => {
    dom = new Window({ url: 'http://localhost/' });
    const values = {
      window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement,
      Element: dom.Element, Node: dom.Node, HTMLInputElement: dom.HTMLInputElement,
      DocumentFragment: dom.DocumentFragment, MutationObserver: dom.MutationObserver,
      ResizeObserver: dom.ResizeObserver, MouseEvent: dom.MouseEvent, PointerEvent: dom.PointerEvent,
      Event: dom.Event, CustomEvent: dom.CustomEvent, getComputedStyle: dom.getComputedStyle.bind(dom),
      requestAnimationFrame: dom.requestAnimationFrame.bind(dom), cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
      localStorage: dom.localStorage, sessionStorage: dom.sessionStorage,
      fetch: async () => new Response('{}', { status: 404 }), IS_REACT_ACT_ENVIRONMENT: true,
    };
    for (const [key, value] of Object.entries(values)) {
      globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: `settings-projects-${++testRuntime}` });
    invalidateSettingsCache();
    saveFails = false;
    registerRuntimeAPIs({ runtime: { platform: 'web', isDesktop: false, isVSCode: false }, settings: {
      load: async () => ({ settings: {}, source: 'web' }),
      save: async (changes: Partial<SettingsPayload>) => {
        if (saveFails) throw new Error('save failed');
        return changes;
      },
    } } as RuntimeAPIs);
  });

  afterEach(async () => {
    if (root) await act(async () => { root?.unmount(); });
    root = undefined;
    restoreStores();
    await dom.happyDOM.close();
    for (const [key, value] of globals) {
      if (value) Object.defineProperty(globalThis, key, value);
      else Reflect.deleteProperty(globalThis, key);
    }
    globals.clear();
    registerRuntimeAPIs(null);
    invalidateSettingsCache();
  });

  const render = async (target: WorkspaceSettingsTarget | null, setup?: { catalog?: WorkspaceCatalog; projects?: ProjectEntry[]; legacyId?: string | null }) => {
    const [{ createRoot }, { ThemeSystemProvider }, { I18nProvider }, { useProjectsStore }, { useUIStore }, { useWorkspacesStore }, { ProjectsPage }, { ProjectsSidebar }] = await Promise.all([
      import('react-dom/client'), import('@/contexts/ThemeSystemContext'), import('@/lib/i18n'), import('@/stores/useProjectsStore'), import('@/stores/useUIStore'), import('@/stores/useWorkspacesStore'), import('./ProjectsPage'), import('./ProjectsSidebar'),
    ]);
    const initialProjects = useProjectsStore.getState();
    const initialUi = useUIStore.getState();
    const initialWorkspace = useWorkspacesStore.getState();
    const { useDirectoryStore } = await import('@/stores/useDirectoryStore');
    const { opencodeClient } = await import('@/lib/opencode/client');
    const initialDirectory = useDirectoryStore.getState();
    const initialSdkDirectory = opencodeClient.getDirectory();
    restoreStores = () => {
      useProjectsStore.setState(initialProjects);
      useUIStore.setState(initialUi);
      useWorkspacesStore.setState(initialWorkspace);
      useDirectoryStore.setState(initialDirectory, true);
      opencodeClient.setDirectory(initialSdkDirectory);
    };
    const projects = setup?.projects ?? [];
    useProjectsStore.setState({ projects, activeProjectId: projects[0]?.id ?? null });
    const catalog = setup?.catalog ?? { version: 1, workspaces: [{ id: 'workspace-a', name: 'Workspace A', description: '', defaults: {}, folders: [{ id: 'folder-a', path: '/repo/one', role: '' }] }] };
    useWorkspacesStore.getState().adopt(catalog);
    useUIStore.setState({ settingsWorkspaceTarget: target, settingsProjectsSelectedId: setup?.legacyId ?? null });
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => { root?.render(<ThemeSystemProvider><I18nProvider><ProjectsSidebar /><ProjectsPage /></I18nProvider></ThemeSystemProvider>); });
  };

  test('lists unregistered folders and listing never registers them', async () => {
    await render({ kind: 'workspace', workspaceId: 'workspace-a' });
    expect(document.body.textContent).toContain('one');
    expect(useProjectsStore.getState().projects).toHaveLength(0);
  });

  test('selecting an unregistered folder registers once, then mounts project tabs', async () => {
    await render({ kind: 'workspace', workspaceId: 'workspace-a' });
    const activeProject = { id: 'active', path: '/repo/active', label: 'Active' };
    const { useDirectoryStore } = await import('@/stores/useDirectoryStore');
    const { opencodeClient } = await import('@/lib/opencode/client');
    useProjectsStore.setState({ projects: [activeProject], activeProjectId: activeProject.id });
    useDirectoryStore.setState({ currentDirectory: '/repo/active' });
    opencodeClient.setDirectory('/repo/active');
    const folderButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'one');
    expect(folderButton).not.toBeNull();
    await act(async () => { folderButton?.click(); await Promise.resolve(); });
    expect(useProjectsStore.getState().projects.filter((project) => project.path === '/repo/one')).toHaveLength(1);
    expect(useProjectsStore.getState().activeProjectId).toBe(activeProject.id);
    expect(useDirectoryStore.getState().currentDirectory).toBe('/repo/active');
    expect(opencodeClient.getDirectory()).toBe('/repo/active');
    expect(document.body.textContent).toContain('General');
  });

  test('unlink uses workspace and folder IDs without removing the project entry', async () => {
    await render({ kind: 'folder', workspaceId: 'workspace-a', folderId: 'folder-a' });
    await act(async () => { await Promise.resolve(); });
    const unlink = document.querySelector<HTMLButtonElement>('[data-settings-item="projects.unlink"]');
    expect(unlink).not.toBeNull();
    await act(async () => { unlink?.click(); await Promise.resolve(); });
    expect(useWorkspacesStore.getState().catalog.workspaces[0]?.folders).toHaveLength(0);
    const { useProjectsStore } = await import('@/stores/useProjectsStore');
    expect(useProjectsStore.getState().projects).toHaveLength(1);
  });

  test('retained unlink results stay visible as errors', async () => {
    saveFails = true;
    await render({ kind: 'folder', workspaceId: 'workspace-a', folderId: 'folder-a' });
    await act(async () => { await Promise.resolve(); });
    const unlink = document.querySelector<HTMLButtonElement>('[data-settings-item="projects.unlink"]');
    await act(async () => { unlink?.click(); await Promise.resolve(); });
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not save changes');
  });

  test('workspace selection saves through the catalog and reflects acknowledged values', async () => {
    await render({ kind: 'chats' });
    const workspaceButton = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Workspace A');
    await act(async () => { workspaceButton?.click(); });
    expect(document.body.textContent).toContain('Workspace A');
    const nameInput = document.querySelector<HTMLInputElement>('input[aria-label="Workspace name"]');
    expect(nameInput).not.toBeNull();
    await act(async () => {
      setInputValue(nameInput, 'Renamed workspace');
    });
    const save = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save');
    await act(async () => { save?.click(); await Promise.resolve(); });
    const { useWorkspacesStore } = await import('@/stores/useWorkspacesStore');
    expect(useWorkspacesStore.getState().catalog.workspaces[0]?.name).toBe('Renamed workspace');
  });

  test('failed workspace update leaves catalog values intact and reports an error', async () => {
    saveFails = true;
    await render({ kind: 'workspace', workspaceId: 'workspace-a' });
    const nameInput = document.querySelector<HTMLInputElement>('input[aria-label="Workspace name"]');
    await act(async () => {
      setInputValue(nameInput, 'Unacknowledged');
    });
    const save = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save');
    await act(async () => { save?.click(); await Promise.resolve(); });
    const { useWorkspacesStore } = await import('@/stores/useWorkspacesStore');
    expect(useWorkspacesStore.getState().catalog.workspaces[0]?.name).toBe('Workspace A');
    expect(useWorkspacesStore.getState().hasBaseline).toBe(true);
    expect(document.querySelector('input[aria-label="Workspace name"]')).not.toBeNull();
    expect([...document.querySelectorAll('button')].some((button) => button.textContent?.trim() === 'Chat')).toBe(true);
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not save changes');
  });

  test('sidebar plus creates a workspace and selects it', async () => {
    await render({ kind: 'chats' });
    const addButton = Array.from(document.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === 'New workspace');
    expect(addButton).not.toBeNull();
    await act(async () => { addButton?.click(); await Promise.resolve(); });
    const nameInput = document.querySelector<HTMLInputElement>('input[aria-label="Workspace name"]');
    expect(nameInput).not.toBeNull();
    await act(async () => {
      setInputValue(nameInput, 'Fresh');
    });
    const save = Array.from(document.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Save');
    await act(async () => { save?.click(); await Promise.resolve(); });
    expect(useWorkspacesStore.getState().catalog.workspaces.map((item) => item.name)).toContain('Fresh');
    const { useUIStore } = await import('@/stores/useUIStore');
    const created = useWorkspacesStore.getState().catalog.workspaces.find((item) => item.name === 'Fresh');
    expect(useUIStore.getState().settingsWorkspaceTarget).toEqual({ kind: 'workspace', workspaceId: created?.id });
  });

  test('Chats shows the existing global default agent and model controls', async () => {
    await render({ kind: 'chats' });
    expect(document.body.textContent).toContain('Conversations without a workspace are saved here.');
    expect(document.querySelector('[data-settings-item="sessions.default-agent"]')).not.toBeNull();
    expect(document.querySelector('[data-settings-item="sessions.default-model"]')).not.toBeNull();
  });

  test('hides managed chat roots and descendants while keeping lookalike siblings', async () => {
    const { opencodeClient } = await import('@/lib/opencode/client');
    const roots = spyOn(opencodeClient, 'getFilesystemHomeInfo').mockResolvedValue({ home: '/home/user', chatsRoot: '/srv/chats' });
    const { ensureChatsRootDirectory } = await import('@/lib/chatDirectories');
    await ensureChatsRootDirectory();
    try {
      await render({ kind: 'chats' });
      useWorkspacesStore.getState().adopt({ version: 1, workspaces: [
        { id: 'managed', name: 'Managed', description: '', defaults: {}, folders: [
          { id: 'root', path: '/srv/chats', role: '' },
          { id: 'day', path: '/srv/chats/2026-11-03', role: '' },
          { id: 'session', path: '/srv/chats/2026-11-03/session-one', role: '' },
        ] },
        { id: 'lookalike', name: 'Lookalike', description: '', defaults: {}, folders: [{ id: 'sibling', path: '/srv/chats-old', role: '' }] },
      ] });
      await act(async () => { await Promise.resolve(); });
      expect(document.body.textContent).not.toContain('Managed');
      expect(document.body.textContent).toContain('Lookalike');
      expect(document.body.textContent).toContain('chats-old');
    } finally {
      roots.mockRestore();
    }
  });

  test('initial selection skips managed chat folders, including the persisted project target', async () => {
    const { opencodeClient } = await import('@/lib/opencode/client');
    const roots = spyOn(opencodeClient, 'getFilesystemHomeInfo').mockResolvedValue({ home: '/home/user', chatsRoot: '/srv/chats' });
    const { ensureChatsRootDirectory } = await import('@/lib/chatDirectories');
    await ensureChatsRootDirectory();
    try {
      await render(null, {
        catalog: { version: 1, workspaces: [
          { id: 'managed', name: 'Managed chats', description: '', defaults: {}, folders: [{ id: 'managed-root', path: '/srv/chats', role: '' }] },
          { id: 'visible', name: 'Visible workspace', description: '', defaults: {}, folders: [{ id: 'visible-folder', path: '/repo/visible', role: '' }] },
        ] },
        projects: [{ id: 'chat-project', path: '/srv/chats/day/session-a', label: 'Chat project' }],
        legacyId: 'chat-project',
      });
      await act(async () => { await Promise.resolve(); });
      expect(useUIStore.getState().settingsWorkspaceTarget).toEqual({ kind: 'workspace', workspaceId: 'visible' });
      expect(document.body.textContent).toContain('Visible workspace');
      expect(document.body.textContent).not.toContain('Managed chats');
    } finally {
      roots.mockRestore();
    }
  });

  test('a chats root that resolves after Settings opens moves the selection off the hidden chat workspace', async () => {
    const { opencodeClient } = await import('@/lib/opencode/client');
    const { getRuntimeKey, switchRuntimeEndpoint } = await import('@/lib/runtime-switch');
    const previousRuntime = getRuntimeKey();
    // A fresh runtime has no chats root cached yet.
    switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: 'late-chats-root' });
    let resolveRoot: (value: { home: string; chatsRoot: string }) => void = () => {};
    const roots = spyOn(opencodeClient, 'getFilesystemHomeInfo');
    roots.mockReturnValue(new Promise((resolve) => { resolveRoot = resolve; }));
    try {
      await render(null, {
        catalog: { version: 1, workspaces: [
          { id: 'managed', name: 'Managed chats', description: '', defaults: {}, folders: [{ id: 'managed-root', path: '/srv/chats', role: '' }] },
          { id: 'visible', name: 'Visible workspace', description: '', defaults: {}, folders: [{ id: 'visible-folder', path: '/repo/visible', role: '' }] },
        ] },
      });
      expect(useUIStore.getState().settingsWorkspaceTarget).toEqual({ kind: 'workspace', workspaceId: 'managed' });
      await act(async () => { resolveRoot({ home: '/home/user', chatsRoot: '/srv/chats' }); await Promise.resolve(); await Promise.resolve(); });
      expect(useUIStore.getState().settingsWorkspaceTarget).toEqual({ kind: 'workspace', workspaceId: 'visible' });
      expect(document.body.textContent).not.toContain('Managed chats');
    } finally {
      roots.mockRestore();
      switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: previousRuntime });
    }
  });
});
