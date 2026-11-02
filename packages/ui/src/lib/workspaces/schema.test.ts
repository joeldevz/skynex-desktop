import { describe, expect, test } from 'bun:test';
import { parseWorkspaceCatalog, patchWorkspace, putWorkspace, unlinkWorkspaceFolder } from './schema';
import type { Workspace, WorkspaceCatalog } from './model';

const workspace = (): Workspace => ({
  id: 'w1', name: 'Product', description: 'User-authored overview',
  folders: [{ id: 'a', path: '/projects/app', role: 'Application' }, { id: 'b', path: '/notes', role: 'Non-Git notes' }],
  defaults: { agent: 'build', model: { providerID: 'p', id: 'm', variant: null } },
});
const catalog = (): WorkspaceCatalog => ({ version: 1, workspaces: [workspace(), { ...workspace(), id: 'w2', name: 'Other' }] });

describe('C1 workspace catalog', () => {
  test('round-trips ordered folders, documentation and model/agent defaults across two workspaces', () => {
    const input = catalog();
    expect(parseWorkspaceCatalog(JSON.stringify(input))).toEqual({ kind: 'valid', value: input });
    expect(parseWorkspaceCatalog(null)).toEqual({ kind: 'missing' });
    expect(parseWorkspaceCatalog('{"version":1,"workspaces":[]}')).toEqual({ kind: 'valid', value: { version: 1, workspaces: [] } });
  });

  test.each([
    ['malformed JSON', '{'],
    ['unsupported version', JSON.stringify({ ...catalog(), version: 2 })],
    ['duplicate workspace ID', JSON.stringify({ version: 1, workspaces: [workspace(), workspace()] })],
    ['duplicate folder ID', JSON.stringify({ version: 1, workspaces: [{ ...workspace(), folders: [workspace().folders[0], workspace().folders[0]] }] })],
    ['relative path', JSON.stringify({ version: 1, workspaces: [{ ...workspace(), folders: [{ id: 'a', path: 'relative', role: '' }] }] })],
  ])('rejects the whole document for %s', (_label, json) => {
    expect(parseWorkspaceCatalog(json)).toMatchObject({ kind: 'invalid', reason: expect.any(String) });
  });

  test('normalizes folder paths while preserving a Windows drive root', () => {
    const input = { version: 1, workspaces: [{ ...workspace(), folders: [{ id: 'a', path: 'C:\\', role: 'Drive' }, { id: 'b', path: '/notes/', role: 'Notes' }] }] };
    const parsed = parseWorkspaceCatalog(JSON.stringify(input));
    expect(parsed.kind).toBe('valid');
    if (parsed.kind !== 'valid') throw new Error('Expected valid catalog');
    expect(parsed.value.workspaces[0].folders.map(folder => folder.path)).toEqual(['C:/', '/notes']);
  });

  test('puts, patches and unlinks only the named workspace without mutating the source', () => {
    const original = catalog();
    const before = JSON.stringify(original);
    const updated = patchWorkspace(original, 'w1', { name: 'Renamed', description: 'Explicit edit', defaults: { agent: 'plan' } });
    expect(updated.workspaces).toEqual([{ ...workspace(), name: 'Renamed', description: 'Explicit edit', defaults: { agent: 'plan' } }, original.workspaces[1]]);
    const unlinked = unlinkWorkspaceFolder(updated, 'w1', 'b');
    expect(unlinked.workspaces[0].folders).toEqual([workspace().folders[0]]);
    expect(unlinked.workspaces[1]).toEqual(original.workspaces[1]);
    expect(unlinkWorkspaceFolder(unlinked, 'w1', 'b')).toBe(unlinked);
    const replacement = { ...workspace(), name: 'Replacement' };
    expect(putWorkspace(original, replacement).workspaces).toEqual([replacement, original.workspaces[1]]);
    const third = { ...workspace(), id: 'w3' };
    expect(putWorkspace(original, third).workspaces).toEqual([...original.workspaces, third]);
    expect(JSON.stringify(original)).toBe(before);
  });

  test('invalid edits throw without changing the catalog; an empty workspace stays editable', () => {
    const original = catalog();
    const before = JSON.stringify(original);
    expect(() => patchWorkspace(original, 'missing', { name: 'Lost' })).toThrow(Error);
    expect(() => unlinkWorkspaceFolder(original, 'missing', 'a')).toThrow(Error);
    expect(() => patchWorkspace(original, 'w1', { folders: [{ id: 'a', path: 'relative', role: '' }] })).toThrow(Error);
    expect(() => putWorkspace(original, { ...workspace(), folders: [{ id: 'a', path: 'relative', role: '' }] })).toThrow(Error);
    expect(patchWorkspace(original, 'w1', { folders: [] }).workspaces[0].folders).toEqual([]);
    expect(JSON.stringify(original)).toBe(before);
  });
});
