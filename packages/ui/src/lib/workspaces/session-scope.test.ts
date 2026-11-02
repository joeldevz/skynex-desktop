import { describe, expect, test } from 'bun:test';
import { resolveWorkspaceDefaults, selectWorkspaceFolders, snapshotWorkspaceScope } from './session-scope';
import { patchWorkspace, unlinkWorkspaceFolder } from './schema';
import type { Workspace } from './model';
import type { FolderSelection } from './session-scope';

const workspace = (): Workspace => ({
  id: 'w', name: 'Product', description: 'Overview',
  folders: [{ id: 'a', path: '/app', role: 'Code' }, { id: 'b', path: '/notes', role: 'Notes' }],
  defaults: { agent: 'build', model: { providerID: 'p', id: 'm', variant: null } },
});

describe('C2/C6 workspace session scope', () => {
  test.each<{ label: string; selection: FolderSelection; ids: string[] }>([
    { label: 'workspace creation', selection: { kind: 'workspace' }, ids: ['a', 'b'] },
    { label: 'folder creation', selection: { kind: 'folder', folderId: 'b' }, ids: ['b'] },
    { label: 'edited selection in workspace order', selection: { kind: 'explicit', folderIds: ['b', 'a'] }, ids: ['a', 'b'] },
  ])('$label selects the documented folders and primary directory', ({ selection, ids }) => {
    const input = workspace();
    const folders = input.folders.filter(folder => ids.includes(folder.id));
    expect(selectWorkspaceFolders(input, selection)).toEqual({ kind: 'valid', value: folders });
    expect(snapshotWorkspaceScope(input, selection)).toEqual({ kind: 'valid', value: {
      version: 1, workspaceId: 'w', workspaceName: 'Product', description: 'Overview', primaryDirectory: folders[0].path, folders,
    } });
  });

  test.each<{ selection: FolderSelection; reason: string }>([
    { selection: { kind: 'explicit', folderIds: [] }, reason: 'empty-selection' },
    { selection: { kind: 'folder', folderId: 'missing' }, reason: 'unknown-folder' },
    { selection: { kind: 'explicit', folderIds: ['a', 'missing'] }, reason: 'unknown-folder' },
    { selection: { kind: 'explicit', folderIds: ['a', 'a'] }, reason: 'duplicate-folder' },
  ])('rejects $reason without silently dropping a selection', ({ selection, reason }) => {
    expect(selectWorkspaceFolders(workspace(), selection)).toEqual({ kind: 'invalid', reason });
    expect(snapshotWorkspaceScope(workspace(), selection)).toEqual({ kind: 'invalid', reason });
  });

  test('empty workspaces cannot snapshot a session', () => {
    expect(snapshotWorkspaceScope({ ...workspace(), folders: [] }, { kind: 'workspace' })).toEqual({ kind: 'invalid', reason: 'empty-selection' });
  });

  test('snapshots retain unlinked folders and documentation after explicit edits and source mutation', () => {
    const input = workspace();
    const snapshot = snapshotWorkspaceScope(input, { kind: 'workspace' });
    expect(snapshot.kind).toBe('valid');
    if (snapshot.kind !== 'valid') throw new Error('Expected scope');
    const retained = structuredClone(snapshot.value);
    const edited = patchWorkspace({ version: 1, workspaces: [input] }, 'w', { description: 'Edited', folders: [{ id: 'a', path: '/app', role: 'Edited code' }, input.folders[1]] });
    const unlinked = unlinkWorkspaceFolder(edited, 'w', 'b');
    expect(snapshotWorkspaceScope(unlinked.workspaces[0], { kind: 'workspace' })).toEqual({ kind: 'valid', value: { ...retained, description: 'Edited', folders: [{ id: 'a', path: '/app', role: 'Edited code' }] } });
    Object.assign(input.folders[1], { path: '/changed', role: 'Changed' });
    Object.assign(input, { name: 'Changed', description: 'Changed' });
    expect(snapshot.value).toEqual(retained);
  });

  test('resolves each explicit override ahead of defaults without inventing defaults', () => {
    const input = workspace();
    const model = { providerID: 'other', id: 'chosen' };
    expect(resolveWorkspaceDefaults(input, {})).toEqual(input.defaults);
    expect(resolveWorkspaceDefaults(input, { agent: 'plan' })).toEqual({ ...input.defaults, agent: 'plan' });
    expect(resolveWorkspaceDefaults(input, { model })).toEqual({ agent: 'build', model });
    expect(resolveWorkspaceDefaults(input, { agent: 'plan', model })).toEqual({ agent: 'plan', model });
    expect(resolveWorkspaceDefaults({ ...input, defaults: {} }, {})).toEqual({});
  });
});
