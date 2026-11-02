import { expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { I18nProvider } from '@/lib/i18n';
import type { Workspace, WorkspaceDefaults, WorkspacePatch } from '@/lib/workspaces/model';
import type { FolderSelection } from '@/lib/workspaces/session-scope';
import { WorkspaceOverview } from './WorkspaceOverview';

export interface WorkspaceOverviewContract {
  workspace: Workspace;
  models: readonly { label: string; value: NonNullable<WorkspaceDefaults['model']> }[];
  agents: readonly { label: string; value: string }[];
  onUpdate(patch: WorkspacePatch): Promise<void>;
  onCreateSession(selection: FolderSelection, defaults: WorkspaceDefaults): Promise<void>;
  onAddFolders(): Promise<void>;
  onUnlinkFolder?(folderId: string): Promise<void>;
}

const workspace: Workspace = {
  id: 'product', name: 'Product', description: 'User-authored overview',
  folders: [{ id: 'app', path: '/projects/app', role: 'Application' },
    { id: 'notes', path: '/reference/notes', role: 'Non-Git research' }],
  defaults: { model: { providerID: 'test', id: 'small' }, agent: 'build' },
};

async function withOverview(run: (ui: {
  render(props: WorkspaceOverviewContract): Promise<void>;
  button(name: string): HTMLButtonElement;
  field(name: string): HTMLElement;
  edit(name: string, value: string, node?: HTMLElement): Promise<void>;
  choose(name: string, label: string): Promise<void>;
  container: HTMLDivElement;
}) => Promise<void>) {
  const dom = new Window({ url: 'http://workspace.test' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom, document: dom.document,
    navigator: dom.navigator, HTMLElement: dom.HTMLElement, Event: dom.Event,
    IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const button = (name: string) => {
    const found = [...document.querySelectorAll<HTMLButtonElement>('button')]
      .find((node) => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === name);
    if (!found) throw new Error(`Missing button ${name}`);
    return found;
  };
  const field = (name: string): HTMLElement => {
    const found = [...document.querySelectorAll<HTMLElement>('input, textarea, select, [role="combobox"]')]
      .find((node) => node.getAttribute('aria-label') === name
        || [...document.querySelectorAll('label')].some((label) => label.textContent?.trim() === name
          && (label.htmlFor === node.id && node.id !== '' || label.contains(node))));
    if (!found) throw new Error(`Missing labelled field ${name}`);
    return found;
  };
  try {
    await run({ container, button, field,
      render: async (props) => { await act(async () => root.render(<I18nProvider><WorkspaceOverview {...props} /></I18nProvider>)); },
      edit: async (name, value, target) => {
        const node = target ?? field(name);
        const textArea = node.tagName === 'TEXTAREA';
        if (node.tagName !== 'INPUT' && !textArea) throw new Error(`Not a text field: ${name}`);
        const setter = Object.getOwnPropertyDescriptor(textArea
          ? dom.HTMLTextAreaElement.prototype : dom.HTMLInputElement.prototype, 'value')?.set;
        if (!setter) throw new Error('Missing native value setter');
        await act(async () => { setter.call(node, value); node.dispatchEvent(new Event('input', { bubbles: true })); node.dispatchEvent(new Event('change', { bubbles: true })); });
      },
      choose: async (name, label) => {
        const node = field(name);
        if (node.tagName === 'SELECT') {
          const option = [...node.querySelectorAll('option')].find((item) => item.textContent === label);
          if (!option) throw new Error(`Missing option ${label}`);
          await act(async () => { node.setAttribute('value', option.value); Object.assign(node, { value: option.value }); node.dispatchEvent(new Event('change', { bubbles: true })); });
        } else {
          await act(async () => node.click());
          const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent?.trim() === label);
          if (!option) throw new Error(`Missing option ${label}`);
          await act(async () => option.click());
        }
      },
    });
  } finally {
    await act(async () => root.unmount());
    await dom.happyDOM.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
}

// Each folder is a tile holding its path, its description field and its actions.
const folderTile = (container: HTMLElement, path: string): HTMLElement => {
  const tile = [...container.querySelectorAll<HTMLElement>('.oc-tile')].find((node) => node.textContent?.includes(path));
  if (!tile) throw new Error(`Missing folder ${path}`);
  return tile;
};
const within = <T extends Element>(root: HTMLElement, selector: string, label: string): T => {
  const found = [...root.querySelectorAll<T>(selector)].find((node) => node.getAttribute('aria-label') === label);
  if (!found) throw new Error(`Missing ${label}`);
  return found;
};

function fixture() {
  const updates: WorkspacePatch[] = [];
  const creates: Array<[FolderSelection, WorkspaceDefaults]> = [];
  const additions: string[] = [];
  const unlinks: string[] = [];
  const props: WorkspaceOverviewContract = {
    workspace,
    models: [{ label: 'Small', value: { providerID: 'test', id: 'small' } }, { label: 'Large', value: { providerID: 'test', id: 'large' } }],
    agents: [{ label: 'Build', value: 'build' }, { label: 'Plan', value: 'plan' }],
    onUpdate: async (patch) => { updates.push(patch); },
    onCreateSession: async (selection, defaults) => { creates.push([selection, defaults]); },
    onAddFolders: async () => { additions.push('picker'); },
    onUnlinkFolder: async (folderId) => { unlinks.push(folderId); },
  };
  return { props, updates, creates, additions, unlinks };
}

test('C1/C6 overview saves explicit documentation/default edits and unlinks without destructive controls', async () => {
  await withOverview(async (ui) => {
    const f = fixture();
    await ui.render(f.props);
    expect([...ui.container.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent?.trim())).not.toContain('Sessions');
    expect(f.updates).toEqual([]);
    await ui.edit('Workspace name', 'Product next');
    await ui.edit('Description', 'Explicitly revised');
    const notesDescription = within<HTMLInputElement>(folderTile(ui.container, '/reference/notes'), 'input', 'Folder description');
    await ui.edit('Folder description', 'Reference material', notesDescription);
    await ui.choose('Default model', 'Large');
    await ui.choose('Default agent', 'Plan');
    expect(f.updates).toEqual([]);
    await act(async () => ui.button('Save').click());
    expect(f.updates).toHaveLength(1);
    expect(f.updates[0]).toMatchObject({ name: 'Product next', description: 'Explicitly revised',
      folders: [workspace.folders[0], { ...workspace.folders[1], role: 'Reference material' }],
      defaults: { model: { providerID: 'test', id: 'large' }, agent: 'plan' } });
    await act(async () => ui.button('Add folders').click());
    expect(f.additions).toEqual(['picker']);
    await act(async () => within<HTMLButtonElement>(folderTile(ui.container, '/reference/notes'), 'button', 'Unlink').click());
    expect(f.unlinks).toEqual(['notes']);
    expect(f.updates).toHaveLength(1);
    expect(workspace.folders).toHaveLength(2);
    const actions = [...ui.container.querySelectorAll('button, [role="menuitem"]')]
      .map((node) => node.getAttribute('aria-label') ?? node.textContent);
    expect(/delete|create folder|create repository|initialize git/i.test(actions.join(' '))).toBe(false);
    expect(f.creates).toEqual([]);
  });
});

test('C2 sessions start in the whole workspace or in one folder, never with no folders', async () => {
  await withOverview(async (ui) => {
    const f = fixture();
    await ui.render(f.props);
    const header = ui.button('New session');
    await act(async () => header.click());
    expect(f.creates).toEqual([[{ kind: 'workspace' }, workspace.defaults]]);
    await act(async () => within<HTMLButtonElement>(folderTile(ui.container, '/reference/notes'), 'button', 'New session').click());
    expect(f.creates).toEqual([[{ kind: 'workspace' }, workspace.defaults], [{ kind: 'folder', folderId: 'notes' }, workspace.defaults]]);
    await ui.render({ ...f.props, workspace: { ...workspace, folders: [] } });
    expect(ui.button('New session').disabled).toBe(true);
    expect(f.creates).toHaveLength(2);
  });
});
