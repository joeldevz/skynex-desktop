import React, { act } from 'react';
import { Window } from 'happy-dom';
import { expect, test } from 'bun:test';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from '@/lib/i18n';
import type { ProjectEntry } from '@/lib/api/types';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';
import { useCommandSettingsScope } from './commandSettingsScope';
import { CommandsScopeSelector } from './CommandsScopeSelector';

test('picks the workspace first, then its shared commands or one of its folders', async () => {
  const win = new Window({ url: 'http://localhost' });
  const values = { window: win, document: win.document, navigator: win.navigator, localStorage: win.localStorage, requestAnimationFrame: win.requestAnimationFrame.bind(win), cancelAnimationFrame: win.cancelAnimationFrame.bind(win), ResizeObserver: win.ResizeObserver, MutationObserver: win.MutationObserver, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, value });
  const initialProjects = useProjectsStore.getState();
  const initialUI = useUIStore.getState();
  const initialWorkspaces = useWorkspacesStore.getState();
  const initialScope = useCommandSettingsScope.getState();
  const one = { id: 'workspace-1', name: 'Workspace One', description: '', defaults: {}, folders: [{ id: 'folder-a', path: '/projects/shared', role: '' }] } as const;
  const two = { id: 'workspace-2', name: 'Workspace Two', description: '', defaults: {}, folders: [{ id: 'folder-b', path: '/projects/shared', role: '' }] } as const;
  const added: string[] = [];
  useProjectsStore.setState({
    projects: [],
    activeProjectId: null,
    addProject: async (path, options) => {
      added.push(`${path}:${String(options?.activate)}`);
      const entry: ProjectEntry = { id: 'shared', path };
      useProjectsStore.setState({ projects: [entry] });
      return entry;
    },
  });
  useUIStore.setState({ isMobile: true, settingsProjectPath: null });
  useWorkspacesStore.setState({ catalog: { version: 1, workspaces: [one, two] }, status: 'ready' });
  useCommandSettingsScope.setState({ workspaceId: null, browsedWorkspaceId: null, commandName: null });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const trigger = (label: string) => container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`);
  const choose = async (label: string, option: string) => {
    await act(async () => trigger(label)?.click());
    const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button'));
    await act(async () => rows.find((row) => row.textContent?.trim() === option)?.click());
  };
  try {
    await act(async () => root.render(<I18nProvider><CommandsScopeSelector /></I18nProvider>));
    expect(trigger('Choose workspace')?.textContent).toContain('Workspace One');

    await choose('Choose workspace', 'Workspace Two');
    expect(useCommandSettingsScope.getState().workspaceId).toBe('workspace-2');
    expect(trigger('Choose folder')?.textContent).toContain('Shared commands');
    expect(useUIStore.getState().settingsProjectPath).toBeNull();

    await choose('Choose folder', 'shared');
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    expect(added).toEqual(['/projects/shared:false']);
    expect(useCommandSettingsScope.getState().workspaceId).toBeNull();
    expect(useUIStore.getState().settingsProjectPath).toBe('/projects/shared');
    expect(useProjectsStore.getState().activeProjectId).toBeNull();
    // The folder also belongs to Workspace One; the first selector keeps the workspace it was picked from.
    expect(trigger('Choose workspace')?.textContent).toContain('Workspace Two');
    expect(trigger('Choose folder')?.textContent).toContain('shared');
  } finally {
    await act(async () => root.unmount());
    useProjectsStore.setState(initialProjects);
    useUIStore.setState(initialUI);
    useWorkspacesStore.setState(initialWorkspaces);
    useCommandSettingsScope.setState(initialScope);
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
    await win.happyDOM.close();
  }
});
