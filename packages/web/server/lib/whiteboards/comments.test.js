import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createWhiteboardAgentActions } from './agent-actions.js';
import { COMMENT_LIMITS } from './comments.js';
import { registerWhiteboardsRoutes } from './routes.js';
import { createWhiteboardsRuntime } from './runtime.js';

const setup = () => {
  const records = new Map();
  const workspaces = [{ id: 'w', name: 'Workspace', folders: ['/repo'] }];
  const runtime = createWhiteboardsRuntime({
    store: { listIds: async () => [...records.keys()], read: async (id) => structuredClone(records.get(id) ?? null), write: async (board) => records.set(board.id, structuredClone(board)), remove: async (id) => records.delete(id) },
    readWorkspaces: async () => workspaces,
  });
  const app = express();
  registerWhiteboardsRoutes(app, { runtime, tunnelAuthController: { classifyRequestScope: () => 'local', getTunnelSessionFromRequest: vi.fn() }, uiAuthController: { resolveAuthContext: async () => ({ type: 'session' }) } });
  const post = (body) => request(app).post('/api/openchamber/whiteboards').send(body);
  const actions = createWhiteboardAgentActions({ runtime, readWorkspaces: async () => workspaces, broadcast: vi.fn() });
  return { runtime, post, actions, records };
};

const card = { id: 'card', kind: 'block', x: 0, y: 0, w: 200, h: 80, text: 'Rojo' };

describe('whiteboard comments', () => {
  it('pins a comment to an element, threads replies from the user and the agent, resolves and deletes it', async () => {
    const { runtime, post, actions } = setup();
    const board = (await runtime.create({ workspaceId: 'w', title: 'Board', elements: [card] })).board;
    expect(board.comments).toEqual([]);

    const added = await post({ operation: 'comment', boardId: board.id, comment: { anchor: { elementId: 'card', x: 200, y: 0 }, text: '  ¿puedes hacerlo un flujo? ', sent: true } });
    expect(added.status).toBe(200);
    const { commentId } = added.body;
    expect(commentId).toMatch(/^cm_[a-z0-9]{10}$/);
    expect(added.body.board.revision).toBe(board.revision + 1);
    expect(added.body.board.comments[0]).toMatchObject({ id: commentId, anchor: { elementId: 'card' }, resolved: false, entries: [{ author: 'user', text: '¿puedes hacerlo un flujo?', sent: true }] });
    // A comment is not an element edit: the board's last change and undo stay as they were.
    expect(added.body.board.lastChange).toEqual(board.lastChange);
    expect(added.body.board.canUndo).toBe(board.canUndo);

    const answered = await actions.execute('whiteboard.comment.reply', { boardId: board.id, commentId, text: 'Hecho: ahora es un flujo.' }, { directory: '/repo' });
    expect(answered).toMatchObject({ replied: true, commentId });

    expect((await post({ operation: 'resolveComment', boardId: board.id, commentId, resolved: true })).body.board.comments[0].resolved).toBe(true);
    // Answering a resolved thread opens it again.
    const reopened = await post({ operation: 'reply', boardId: board.id, commentId, reply: { text: 'Una cosa más' } });
    expect(reopened.body.board.comments[0]).toMatchObject({ resolved: false });
    expect(reopened.body.board.comments[0].entries.map(({ author, text }) => [author, text])).toEqual([
      ['user', '¿puedes hacerlo un flujo?'],
      ['agent', 'Hecho: ahora es un flujo.'],
      ['user', 'Una cosa más'],
    ]);
    // Only the user's entries can be marked as sent to the agent.
    expect(reopened.body.board.comments[0].entries[1]).not.toHaveProperty('sent');

    expect((await post({ operation: 'deleteComment', boardId: board.id, commentId })).body.board.comments).toEqual([]);
    expect((await post({ operation: 'reply', boardId: board.id, commentId, reply: { text: 'x' } })).status).toBe(404);
  });

  it('a comment keeps its point when its element is deleted, and survives element edits and undo', async () => {
    const { runtime, post } = setup();
    const board = (await runtime.create({ workspaceId: 'w', title: 'Board', elements: [card] })).board;
    const added = (await post({ operation: 'comment', boardId: board.id, comment: { anchor: { elementId: 'card', x: 200, y: 0 }, text: 'nota' } })).body;
    const deleted = await runtime.apply(board.id, { baseRevision: added.board.revision, ops: [{ op: 'delete', id: 'card' }] });
    expect(deleted.board.comments[0].anchor).toEqual({ elementId: 'card', x: 200, y: 0 });
    const undone = await runtime.undo(board.id);
    expect(undone.board.comments).toHaveLength(1);
    expect(undone.board.elements.map(({ id }) => id)).toEqual(['card']);
  });

  it('a comment can mark an area of the board, which needs both sides and no element', async () => {
    const { runtime, post } = setup();
    const board = (await runtime.create({ workspaceId: 'w', title: 'Board', elements: [card] })).board;
    const area = await post({ operation: 'comment', boardId: board.id, comment: { anchor: { x: 300, y: 40, w: 400, h: 200 }, text: '@Skynex dibuja aquí el flujo de login', sent: true } });
    expect(area.status).toBe(200);
    expect(area.body.board.comments[0].anchor).toEqual({ x: 300, y: 40, w: 400, h: 200 });
    expect((await post({ operation: 'comment', boardId: board.id, comment: { anchor: { x: 0, y: 0, w: 100 }, text: 'x' } })).status).toBe(400);
    expect((await post({ operation: 'comment', boardId: board.id, comment: { anchor: { elementId: 'card', x: 0, y: 0, w: 100, h: 100 }, text: 'x' } })).status).toBe(400);
    expect((await post({ operation: 'comment', boardId: board.id, comment: { anchor: { x: 0, y: 0, w: 2, h: 2 }, text: 'x' } })).status).toBe(400);
  });

  it('the agent cannot answer an area comment until what it made reaches the area', async () => {
    const { runtime, post, actions } = setup();
    const board = (await runtime.create({ workspaceId: 'w', title: 'Board', elements: [card] })).board;
    const asked = (await post({ operation: 'comment', boardId: board.id, comment: { anchor: { x: 600, y: 0, w: 300, h: 200 }, text: '@Skynex crea aquí un login', sent: true } })).body;
    // The agent draws far from the area: its answer is refused, saying where to put things.
    const drawn = await runtime.apply(board.id, { baseRevision: asked.board.revision, ops: [{ op: 'add', element: { id: 'login', kind: 'block', x: 2000, y: 900, w: 200, h: 80, text: 'Login' } }] }, { actor: 'agent' });
    await expect(actions.execute('whiteboard.comment.reply', { boardId: board.id, commentId: asked.commentId, text: 'Hecho' }, {})).rejects.toMatchObject({ statusCode: 400, message: expect.stringContaining('marks the area x 600, y 0') });
    // A box the user draws in the area meanwhile is not the agent's answer.
    await runtime.apply(board.id, { baseRevision: (await runtime.read(board.id)).revision, ops: [{ op: 'add', element: { id: 'mine', kind: 'note', x: 650, y: 50, w: 100, h: 100, text: 'mía' } }] }, { actor: 'user' });
    await expect(actions.execute('whiteboard.comment.reply', { boardId: board.id, commentId: asked.commentId, text: 'Hecho' }, {})).rejects.toMatchObject({ statusCode: 400 });
    // Entries added afterwards do not excuse it, whether or not they claim to have been sent.
    await post({ operation: 'reply', boardId: board.id, commentId: asked.commentId, reply: { text: 'una nota', sent: false } });
    await post({ operation: 'reply', boardId: board.id, commentId: asked.commentId, reply: { text: 'otra nota', sent: true } });
    await expect(actions.execute('whiteboard.comment.reply', { boardId: board.id, commentId: asked.commentId, text: 'Hecho' }, {})).rejects.toMatchObject({ statusCode: 400 });
    // Moved into the area, the answer goes through.
    await runtime.apply(board.id, { baseRevision: (await runtime.read(board.id)).revision, ops: [{ op: 'update', id: 'login', set: { x: 620, y: 20 } }] }, { actor: 'agent' });
    await expect(actions.execute('whiteboard.comment.reply', { boardId: board.id, commentId: asked.commentId, text: 'Hecho' }, {})).resolves.toMatchObject({ replied: true });
  });

  it('refuses empty text, unknown elements, malformed ids and more comments than a board keeps', async () => {
    const { runtime, post, records } = setup();
    const board = (await runtime.create({ workspaceId: 'w', title: 'Board', elements: [card] })).board;
    expect((await post({ operation: 'comment', boardId: board.id, comment: { anchor: { x: 0, y: 0 }, text: '   ' } })).status).toBe(400);
    expect((await post({ operation: 'comment', boardId: board.id, comment: { anchor: { elementId: 'nope', x: 0, y: 0 }, text: 'x' } })).status).toBe(400);
    expect((await post({ operation: 'comment', boardId: board.id, comment: { anchor: { x: 0, y: 0 }, text: 'x', author: 'agent' } })).status).toBe(400);
    expect((await post({ operation: 'reply', boardId: board.id, commentId: '../etc', reply: { text: 'x' } })).status).toBe(400);
    expect((await post({ operation: 'comment', boardId: board.id, comment: { anchor: { x: 0, y: 0 }, text: 'x'.repeat(COMMENT_LIMITS.text + 1) } })).status).toBe(400);

    // A board already holding the most comments it keeps refuses one more.
    const full = records.get(board.id);
    full.comments = Array.from({ length: COMMENT_LIMITS.comments }, (_, index) => ({
      id: `cm_${String(index).padStart(10, '0')}`, anchor: { x: 0, y: 0 }, resolved: false, createdAt: 1, updatedAt: 1,
      entries: [{ id: `ce_${String(index).padStart(10, '0')}`, author: 'user', text: 'x', at: 1 }],
    }));
    records.set(board.id, full);
    expect((await post({ operation: 'comment', boardId: board.id, comment: { anchor: { x: 0, y: 0 }, text: 'x' } })).status).toBe(400);
  });

  it('a board holds a bounded amount of comment text in total, and its comments change at a bounded pace', async () => {
    const { runtime, records } = setup();
    const board = (await runtime.create({ workspaceId: 'w', title: 'Board' })).board;
    // A board whose comments already hold nearly all the text it keeps refuses more.
    const full = records.get(board.id);
    full.comments = [{
      id: 'cm_0000000001', anchor: { x: 0, y: 0 }, resolved: false, createdAt: 1, updatedAt: 1,
      entries: Array.from({ length: Math.ceil(COMMENT_LIMITS.totalText / COMMENT_LIMITS.text) }, (_, index) => ({ id: `ce_${String(index).padStart(10, '0')}`, author: 'user', text: 'x'.repeat(COMMENT_LIMITS.text), at: 1 })).slice(0, COMMENT_LIMITS.totalText / COMMENT_LIMITS.text),
    }];
    records.set(board.id, full);
    await expect(runtime.comment(board.id, { anchor: { x: 0, y: 0 }, text: 'una más' })).rejects.toMatchObject({ code: 'invalid' });
    await expect(runtime.reply(board.id, 'cm_0000000001', { text: 'una más' })).rejects.toMatchObject({ code: 'invalid' });

    const other = (await runtime.create({ workspaceId: 'w', title: 'Other' })).board;
    for (let index = 0; index < COMMENT_LIMITS.changesPerMinute; index += 1) {
      await runtime.comment(other.id, { anchor: { x: index, y: 0 }, text: `nota ${index}` }, { now: 1_000 + index });
    }
    await expect(runtime.comment(other.id, { anchor: { x: 0, y: 0 }, text: 'demasiado rápido' }, { now: 2_000 })).rejects.toMatchObject({ status: 429, code: 'rate-limited' });
    // A minute later the board takes comments again.
    await expect(runtime.comment(other.id, { anchor: { x: 0, y: 0 }, text: 'ya' }, { now: 70_000 })).resolves.toMatchObject({ commentId: expect.stringMatching(/^cm_/) });
    // Refused changes and boards that do not exist count for nothing.
    const fresh = (await runtime.create({ workspaceId: 'w', title: 'Fresh' })).board;
    for (let index = 0; index < COMMENT_LIMITS.changesPerMinute + 5; index += 1) {
      await expect(runtime.comment(`wb_missing${index}`, { anchor: { x: 0, y: 0 }, text: 'x' }, { now: 80_000 + index })).rejects.toMatchObject({ status: 404 });
      await expect(runtime.comment(fresh.id, { anchor: { x: 0, y: 0 }, text: '   ' }, { now: 80_000 + index })).rejects.toMatchObject({ code: 'invalid' });
    }
    await expect(runtime.comment(fresh.id, { anchor: { x: 0, y: 0 }, text: 'cuenta' }, { now: 80_100 })).resolves.toMatchObject({ commentId: expect.stringMatching(/^cm_/) });
    // A deleted board leaves no pace behind: a board made later under load still takes its comments.
    await runtime.delete(other.id);
    const third = (await runtime.create({ workspaceId: 'w', title: 'Third' })).board;
    await expect(runtime.comment(third.id, { anchor: { x: 0, y: 0 }, text: 'hola' }, { now: 70_001 })).resolves.toMatchObject({ commentId: expect.stringMatching(/^cm_/) });
  });

  it('the agent can only answer an existing thread, with text', async () => {
    const { runtime, actions } = setup();
    const board = (await runtime.create({ workspaceId: 'w', title: 'Board' })).board;
    await expect(actions.execute('whiteboard.comment.reply', { boardId: board.id, commentId: 'cm_0000000000', text: 'hola' }, {})).rejects.toMatchObject({ statusCode: 404 });
    await expect(actions.execute('whiteboard.comment.reply', { boardId: board.id, commentId: 'cm_0000000000', text: '' }, {})).rejects.toMatchObject({ statusCode: 400 });
  });
});
