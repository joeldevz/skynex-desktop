import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createWhiteboardsRuntime } from './runtime.js';
import { createWhiteboardAgentActions } from './agent-actions.js';

const create = (workspaces) => {
  const values = new Map();
  const runtime = createWhiteboardsRuntime({ store: { listIds: async () => [...values.keys()], read: async (id) => values.get(id) ?? null, write: async (board) => values.set(board.id, board), remove: async (id) => values.delete(id) }, readWorkspaces: async () => workspaces });
  const broadcast = vi.fn();
  return { actions: createWhiteboardAgentActions({ runtime, readWorkspaces: async () => workspaces, broadcast }), broadcast };
};

describe('whiteboard agent actions', () => {
  it('resolves a unique containing workspace, lists all on ambiguity, and rejects ambiguous create', async () => {
    const workspaces = [{ id: 'a', name: 'Alpha', folders: ['/repo'] }, { id: 'b', name: 'Beta', folders: ['/other'] }];
    const { actions } = create(workspaces);
    const created = await actions.execute('whiteboard.create', { action: 'whiteboard.create', title: 'Board' }, { directory: '/repo/sub' });
    expect(created.board.workspaceId).toBe('a');
    expect((await actions.execute('whiteboard.list', {}, { directory: '/elsewhere' })).boards).toMatchObject([{ workspaceName: 'Alpha', title: 'Board' }]);
    await expect(actions.execute('whiteboard.create', { title: 'No' }, { directory: '/elsewhere' })).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('a (Alpha)') });
    expect(path.resolve('/repo')).toBe('/repo');
  });

  it('opens a valid board and broadcasts the exact session event', async () => {
    const { actions, broadcast } = create([{ id: 'w', name: 'Workspace', folders: ['/repo'] }]);
    const result = await actions.execute('whiteboard.create', { title: 'Board' }, { directory: '/repo' });
    expect(await actions.execute('whiteboard.open', { boardId: result.board.id }, { sessionId: 's1' })).toEqual({ opened: true });
    expect(broadcast).toHaveBeenCalledWith({ type: 'openchamber:whiteboard-open', properties: { boardId: result.board.id, workspaceId: 'w', sessionID: 's1' } });
  });

  it('tells the agent which arrow labels it left without room, until it spaces the boxes', async () => {
    const { actions } = create([{ id: 'w', name: 'Workspace', folders: ['/repo'] }]);
    const elements = [
      { id: 'user', kind: 'block', x: 0, y: 0, w: 200, h: 90, text: 'Usuario' },
      { id: 'idp', kind: 'block', x: 252, y: 0, w: 200, h: 90, text: 'Proveedor' },
      { id: 'go', kind: 'arrow', from: 'user', to: 'idp', text: 'Redirección' },
    ];
    const created = await actions.execute('whiteboard.create', { title: 'SSO', elements }, { directory: '/repo' });
    expect(created.layoutWarnings).toEqual([expect.stringContaining('Arrow go ("Redirección") from user to idp')]);
    const spaced = await actions.execute('whiteboard.apply', { boardId: created.board.id, revision: created.board.revision, ops: [{ op: 'update', id: 'idp', set: { x: 400 } }] }, { directory: '/repo' });
    expect(spaced).not.toHaveProperty('layoutWarnings');
  });

  it('requires an explicit workspace when the session directory matches several workspaces', async () => {
    const { actions } = create([{ id: 'a', name: 'Alpha', folders: ['/repo'] }, { id: 'b', name: 'Beta', folders: ['/repo/sub'] }]);
    await expect(actions.execute('whiteboard.create', { title: 'Board' }, { directory: '/repo/sub/src' })).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('b (Beta)') });
  });
});
