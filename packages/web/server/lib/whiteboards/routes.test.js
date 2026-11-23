import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { registerWhiteboardsRoutes } from './routes.js';

describe('whiteboard route', () => {
  it('requires authorization and dispatches validated requests', async () => {
    const app = express();
    const runtime = { list: vi.fn(async () => []) };
    const auth = { resolveAuthContext: async (req) => req.get('authorization') === 'Bearer valid-session' ? { type: 'session' } : null };
    const tunnelAuthController = { classifyRequestScope: () => 'local', getTunnelSessionFromRequest: vi.fn() };
    registerWhiteboardsRoutes(app, { runtime, tunnelAuthController, uiAuthController: auth });
    expect((await request(app).post('/api/openchamber/whiteboards').send({ operation: 'list' })).status).toBe(401);
    runtime.list.mockResolvedValueOnce([{ id: 'wb_x' }]);
    const authorizedApp = express();
    registerWhiteboardsRoutes(authorizedApp, { runtime, tunnelAuthController, uiAuthController: auth });
    const response = await request(authorizedApp).post('/api/openchamber/whiteboards').set('Authorization', 'Bearer valid-session').send({ operation: 'list' });
    expect(response.status).toBe(200);
    expect(response.body.boards).toHaveLength(1);
    expect((await request(authorizedApp).post('/api/openchamber/whiteboards').set('Authorization', 'Bearer valid-session').send({ operation: 'list', invalid: true })).status).toBe(400);
  });
});

describe('whiteboard route with the runtime', () => {
  it('creates a board with client ids and applies a change against its revision', async () => {
    const { createWhiteboardsRuntime } = await import('./runtime.js');
    const records = new Map();
    const runtime = createWhiteboardsRuntime({
      store: { listIds: async () => [...records.keys()], read: async (id) => records.get(id) ?? null, write: async (board) => records.set(board.id, structuredClone(board)), remove: async (id) => records.delete(id) },
      readWorkspaces: async () => [{ id: 'w', name: 'Workspace', folders: ['/repo'] }],
    });
    const app = express();
    const auth = { resolveAuthContext: async () => ({ type: 'session' }) };
    registerWhiteboardsRoutes(app, { runtime, tunnelAuthController: { classifyRequestScope: () => 'local', getTunnelSessionFromRequest: vi.fn() }, uiAuthController: auth });
    const created = await request(app).post('/api/openchamber/whiteboards').send({
      operation: 'create', workspaceId: 'w', title: 'Board',
      elements: [{ id: 'a', kind: 'block', x: 0, y: 0, w: 100, h: 40, text: 'A', form: 'pill' }, { id: 'b', kind: 'note', x: 200, y: 0, w: 100, h: 80, text: 'B' }, { kind: 'arrow', from: 'a', to: 'b', text: '' }],
    });
    expect(created.status).toBe(200);
    expect(created.body.board.elements.map(({ id }) => id).slice(0, 2)).toEqual(['a', 'b']);
    const applied = await request(app).post('/api/openchamber/whiteboards').send({
      operation: 'apply', boardId: created.body.board.id, baseRevision: created.body.board.revision,
      ops: [{ op: 'update', id: 'a', set: { x: 20 } }, { op: 'add', element: { id: 'el_client0001', kind: 'text', x: 0, y: -60, w: 200, h: 40, text: 'Title', size: 'title' } }],
    });
    expect(applied.status).toBe(200);
    expect(applied.body.board.elements.find(({ id }) => id === 'a').x).toBe(20);
    expect(applied.body.board.elements.some(({ id }) => id === 'el_client0001')).toBe(true);
    const stale = await request(app).post('/api/openchamber/whiteboards').send({
      operation: 'apply', boardId: created.body.board.id, baseRevision: created.body.board.revision, ops: [{ op: 'delete', id: 'a' }],
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('conflict');
    expect(stale.body.board.revision).toBe(applied.body.board.revision);
  });
});

describe('whiteboards turned off in Settings', () => {
  it('answers nothing of whiteboards while the beta is off, and the agent gets nothing either', async () => {
    const { createWhiteboardAgentActions } = await import('./agent-actions.js');
    const runtime = { list: vi.fn(async () => [{ id: 'wb_x' }]) };
    let enabled = false;
    const app = express();
    registerWhiteboardsRoutes(app, { runtime, tunnelAuthController: { classifyRequestScope: () => 'local', getTunnelSessionFromRequest: vi.fn() }, uiAuthController: { resolveAuthContext: async () => ({ type: 'session' }) }, isEnabled: async () => enabled });
    const off = await request(app).post('/api/openchamber/whiteboards').send({ operation: 'list' });
    expect(off.status).toBe(404);
    expect(off.body.code).toBe('disabled');
    expect((await request(app).get('/api/openchamber/whiteboards/images/wb_x/img_000000000000000000000000')).status).toBe(404);
    expect(runtime.list).not.toHaveBeenCalled();
    const actions = createWhiteboardAgentActions({ runtime, readWorkspaces: async () => [], broadcast: vi.fn(), isEnabled: async () => enabled });
    await expect(actions.execute('whiteboard.list', {}, {})).rejects.toMatchObject({ statusCode: 404 });
    enabled = true;
    expect((await request(app).post('/api/openchamber/whiteboards').send({ operation: 'list' })).status).toBe(200);
  });
});
