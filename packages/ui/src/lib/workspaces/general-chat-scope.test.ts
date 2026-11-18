import { describe, expect, test } from 'bun:test';
import { bindWorkspaceScope, buildWorkspaceContext, readWorkspaceScope, snapshotGeneralWorkspaceScope, snapshotWorkspaceScope } from './session-scope';
import type { Workspace } from './model';

const workspace = (): Workspace => ({
  id: 'w', name: 'Product', description: 'Workspace notes',
  folders: [
    { id: 'a', path: '/repos/app', role: 'Application code' },
    { id: 'b', path: '/repos/docs', role: 'Documentation' },
  ],
  defaults: { agent: 'build' },
});

describe('general workspace session scope', () => {
  test('keeps existing folder scopes at version 1 with their selected folder as primary', () => {
    const result = snapshotWorkspaceScope(workspace(), { kind: 'workspace' });

    expect(result).toEqual({
      kind: 'valid',
      value: {
        version: 1,
        workspaceId: 'w',
        workspaceName: 'Product',
        description: 'Workspace notes',
        primaryDirectory: '/repos/app',
        folders: workspace().folders,
      },
    });
  });

  test('captures an ordered general scope rooted at a neutral directory and round-trips metadata', () => {
    const input = workspace();
    const neutralDirectory = '/managed/chats/workspace-w';
    const result = snapshotGeneralWorkspaceScope(input, neutralDirectory);

    expect(result).toEqual({
      kind: 'valid',
      value: {
        version: 2,
        mode: 'general',
        workspaceId: 'w',
        workspaceName: 'Product',
        description: 'Workspace notes',
        primaryDirectory: neutralDirectory,
        folders: input.folders,
      },
    });
    if (result.kind !== 'valid') throw new Error('Expected a valid general scope');

    const metadata = bindWorkspaceScope({ title: 'kept' }, result.value);
    expect(metadata.title).toBe('kept');
    expect(readWorkspaceScope(metadata)).toEqual(result.value);
  });

  test('rejects a directory equal to any linked folder and rejects empty workspaces', () => {
    expect(snapshotGeneralWorkspaceScope(workspace(), '/repos/docs').kind).toBe('invalid');
    expect(snapshotGeneralWorkspaceScope({ ...workspace(), folders: [] }, '/managed/chats/workspace-w')).toEqual({
      kind: 'invalid',
      reason: 'empty-selection',
    });
  });

  test('builds a manifest with every linked path and role and explains neutral configuration and permissions', () => {
    const input = workspace();
    const result = snapshotGeneralWorkspaceScope(input, '/managed/chats/workspace-w');
    expect(result.kind).toBe('valid');
    if (result.kind !== 'valid') throw new Error('Expected a valid general scope');

    const { text } = buildWorkspaceContext(result.value, input);
    expect(text).toContain('/repos/app');
    expect(text).toContain('/repos/docs');
    expect(text).toContain('Application code');
    expect(text).toContain('Documentation');
    expect(text).toContain('no linked folder is primary');
    expect(text).toContain('Folder selection grants no permissions');
    expect(text).toContain('/managed/chats/workspace-w');
    expect(text).not.toContain('Primary directory and sole configuration context: /repos/app');
  });
});
