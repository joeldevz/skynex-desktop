import { describe, expect, it, vi } from 'vitest';
import { createWhiteboardsRuntime } from './runtime.js';

const workspace = [{ id: 'w', name: 'Workspace', folders: ['/work'] }];
const setup = () => {
  const records = new Map();
  const store = { listIds: async () => [...records.keys()], read: async (id) => { const value = records.get(id); if (value instanceof Error) throw value; return value ?? null; }, write: async (board) => records.set(board.id, structuredClone(board)), remove: async (id) => records.delete(id) };
  const onChange = vi.fn();
  return { runtime: createWhiteboardsRuntime({ store, readWorkspaces: async () => workspace, onChange }), records, onChange };
};

describe('whiteboards runtime', () => {
  it('creates, reads and lists newest first, and broadcasts persisted changes', async () => {
    const { runtime, onChange } = setup();
    const older = await runtime.create({ workspaceId: 'w', title: 'Older' }, { now: 1 });
    const newer = await runtime.create({ workspaceId: 'w', title: 'Newer' }, { now: 2 });
    expect((await runtime.list('w')).map(({ title }) => title)).toEqual(['Newer', 'Older']);
    expect(await runtime.read(older.board.id)).toMatchObject({ canUndo: false });
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith({ boardId: newer.board.id, workspaceId: 'w', revision: 1, actor: 'user', deleted: false });
    expect(newer.board.history).toBeUndefined();
  });

  it('skips malformed board files in lists and allows healthy boards', async () => {
    const { runtime, records } = setup();
    await runtime.create({ workspaceId: 'w', title: 'Good' });
    records.set('bad', new Error('Malformed'));
    expect((await runtime.list()).map(({ title }) => title)).toEqual(['Good']);
    await expect(runtime.read('bad')).rejects.toThrow();
  });

  it('stores apply, undo, rename and delete in queue order with event actors', async () => {
    const { runtime, records, onChange } = setup();
    const created = await runtime.create({ workspaceId: 'w', title: 'Board' });
    const added = await runtime.apply(created.board.id, { baseRevision: 1, ops: [{ op: 'add', element: { id: 'e', kind: 'block', x: 0, y: 0, w: 100, h: 40, text: 'Block' } }] }, { actor: 'agent' });
    expect(added.board.canUndo).toBe(true);
    expect(records.get(created.board.id).history).toHaveLength(1);
    const undone = await runtime.undo(created.board.id, { actor: 'user' });
    expect(undone.board.elements).toEqual([]);
    expect(undone.board.revision).toBe(3);
    await runtime.rename(created.board.id, 'Renamed');
    await runtime.delete(created.board.id);
    expect(onChange.mock.calls.map(([event]) => [event.actor, event.deleted])).toEqual([['user', false], ['agent', false], ['user', false], ['user', false], ['user', true]]);
    expect(await runtime.list()).toEqual([]);
  });
});
