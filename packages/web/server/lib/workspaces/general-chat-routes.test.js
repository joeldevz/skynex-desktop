import express from 'express';
import request from 'supertest';
import { describe, expect, test, vi } from 'vitest';
import { registerWorkspaceGeneralChatRoutes } from './general-chat-routes.js';

const workspace = {
  id: 'workspace-alpha',
  name: 'Alpha',
  description: '',
  folders: [
    { id: 'folder-one', path: '/trusted/one', role: 'primary' },
    { id: 'folder-two', path: '/trusted/two', role: 'reference' },
  ],
  defaults: {},
};

function createApp({
  authorize = vi.fn(async () => true),
  readSettings = vi.fn(async () => ({ workspaceCatalog: { version: 1, workspaces: [workspace] } })),
  resolveDirectory = vi.fn(async () => '/managed/chats/workspace-alpha'),
} = {}) {
  const app = express();
  registerWorkspaceGeneralChatRoutes(app, { authorize, readSettings, resolveDirectory });
  return { app, authorize, readSettings, resolveDirectory };
}

describe('workspace general chat route', () => {
  test('authorizes before reading the workspace catalog or resolving a directory', async () => {
    const authorize = vi.fn(async () => false);
    const readSettings = vi.fn();
    const resolveDirectory = vi.fn();
    const { app } = createApp({ authorize, readSettings, resolveDirectory });

    const response = await request(app)
      .post('/api/openchamber/workspaces/general-chat')
      .send({ workspaceId: workspace.id });

    expect(response.status).toBe(401);
    expect(readSettings).not.toHaveBeenCalled();
    expect(resolveDirectory).not.toHaveBeenCalled();
  });

  test('rejects an oversized JSON body with the production route parser', async () => {
    const { app, authorize, readSettings } = createApp();
    const response = await request(app)
      .post('/api/openchamber/workspaces/general-chat')
      .send({ workspaceId: workspace.id, padding: 'x'.repeat(5 * 1024) });

    expect(response.status).toBe(413);
    expect(authorize).toHaveBeenCalledOnce();
    expect(readSettings).not.toHaveBeenCalled();
  });

  test('does not parse an oversized body before rejecting an unauthorized request', async () => {
    const authorize = vi.fn(async () => false);
    const { app, readSettings } = createApp({ authorize });
    const response = await request(app)
      .post('/api/openchamber/workspaces/general-chat')
      .send({ workspaceId: workspace.id, padding: 'x'.repeat(5 * 1024) });

    expect(response.status).toBe(401);
    expect(readSettings).not.toHaveBeenCalled();
  });

  test.each([
    ['missing workspaceId', {}],
    ['empty workspaceId', { workspaceId: '' }],
    ['non-string workspaceId', { workspaceId: 7 }],
    ['client-supplied directory', { workspaceId: workspace.id, directory: '/client/path' }],
    ['unexpected field', { workspaceId: workspace.id, arbitrary: 'value' }],
  ])('rejects %s without reading settings or resolving a directory', async (_label, body) => {
    const { app, readSettings, resolveDirectory } = createApp();

    const response = await request(app)
      .post('/api/openchamber/workspaces/general-chat')
      .send(body);

    expect(response.status).toBe(400);
    expect(readSettings).not.toHaveBeenCalled();
    expect(resolveDirectory).not.toHaveBeenCalled();
  });

  test('returns 404 for an unknown workspace without resolving a directory', async () => {
    const { app, resolveDirectory } = createApp();

    const response = await request(app)
      .post('/api/openchamber/workspaces/general-chat')
      .send({ workspaceId: 'unknown-workspace' });

    expect(response.status).toBe(404);
    expect(resolveDirectory).not.toHaveBeenCalled();
  });

  test('returns 409 for a workspace without linked folders and does not resolve a directory', async () => {
    const emptyWorkspace = { ...workspace, id: 'workspace-empty', folders: [] };
    const { app, resolveDirectory } = createApp({
      readSettings: vi.fn(async () => ({
        workspaceCatalog: { version: 1, workspaces: [emptyWorkspace] },
      })),
    });

    const response = await request(app)
      .post('/api/openchamber/workspaces/general-chat')
      .send({ workspaceId: emptyWorkspace.id });

    expect(response.status).toBe(409);
    expect(resolveDirectory).not.toHaveBeenCalled();
  });

  test('resolves with the trusted workspace ID and folder paths, then returns the directory', async () => {
    const resolveDirectory = vi.fn(async () => '/managed/chats/workspace-alpha');
    const { app } = createApp({ resolveDirectory });

    const response = await request(app)
      .post('/api/openchamber/workspaces/general-chat')
      .send({ workspaceId: workspace.id });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ directory: '/managed/chats/workspace-alpha' });
    expect(resolveDirectory).toHaveBeenCalledWith(workspace.id, ['/trusted/one', '/trusted/two']);
  });

  test('fails closed when directory resolution fails and does not expose the resolver error', async () => {
    const resolveDirectory = vi.fn(async () => {
      throw new Error('private filesystem detail');
    });
    const { app } = createApp({ resolveDirectory });

    const response = await request(app)
      .post('/api/openchamber/workspaces/general-chat')
      .send({ workspaceId: workspace.id });

    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('private filesystem detail');
  });
});
