import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createWhiteboardAgentActions } from './agent-actions.js';
import { createWhiteboardImageStore, inspectImage } from './images.js';
import { registerWhiteboardsRoutes } from './routes.js';
import { createWhiteboardsRuntime } from './runtime.js';
import { createWhiteboardImageUploads } from './uploads.js';

const png = (width, height) => {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};
const gif = () => {
  const bytes = Buffer.alloc(20);
  bytes.write('GIF89a', 0, 'ascii');
  bytes.writeUInt16LE(30, 6);
  bytes.writeUInt16LE(10, 8);
  return bytes;
};
const jpeg = () => Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x40, 0x00, 0x80, 0x03, 0x00, 0x00]);
const webp = () => {
  const bytes = Buffer.alloc(30);
  bytes.write('RIFF', 0, 'ascii');
  bytes.write('WEBP', 8, 'ascii');
  bytes.write('VP8X', 12, 'ascii');
  bytes.writeUIntLE(99, 24, 3);
  bytes.writeUIntLE(49, 27, 3);
  return bytes;
};

let root;
let servers = [];
beforeEach(async () => {
  servers = [];
  // Under a dot folder, like the real data folder (~/.config/...).
  root = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'wb-images-')), '.data');
  await fs.mkdir(root);
});
afterEach(async () => {
  for (const server of servers) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  await fs.rm(path.dirname(root), { recursive: true, force: true });
});

const setup = (workspaceFolders = []) => {
  const records = new Map();
  const store = {
    listIds: async () => [...records.keys()],
    read: async (id) => records.get(id) ?? null,
    write: async (board) => records.set(board.id, structuredClone(board)),
    remove: async (id) => records.delete(id),
  };
  const images = createWhiteboardImageStore({ fsPromises: fs, directory: path.join(root, 'images') });
  const readWorkspaces = async () => [{ id: 'w', name: 'Workspace', folders: workspaceFolders }];
  const runtime = createWhiteboardsRuntime({ store, images, readWorkspaces });
  return { runtime, images, readWorkspaces };
};

describe('whiteboard images', () => {
  it('knows a picture by its bytes, with its pixel size, and refuses anything else', () => {
    expect(inspectImage(png(640, 480))).toMatchObject({ mime: 'image/png', width: 640, height: 480 });
    expect(inspectImage(gif())).toMatchObject({ mime: 'image/gif', width: 30, height: 10 });
    expect(inspectImage(jpeg())).toMatchObject({ mime: 'image/jpeg', width: 128, height: 64 });
    expect(inspectImage(webp())).toMatchObject({ mime: 'image/webp', width: 100, height: 50 });
    expect(inspectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(inspectImage(Buffer.from('not a picture at all, just text'))).toBeNull();
    expect(inspectImage(png(20_000, 20_000))).toBeNull();
  });

  it('a board shows only its own stored pictures, and deleting the board removes them', async () => {
    const { runtime, images } = setup();
    const a = (await runtime.create({ workspaceId: 'w', title: 'A' })).board;
    const b = (await runtime.create({ workspaceId: 'w', title: 'B' })).board;
    const saved = await runtime.saveImage(a.id, png(200, 100));
    const image = (imageId) => ({ op: 'add', element: { kind: 'image', x: 0, y: 0, w: 200, h: 100, imageId, text: 'Login' } });

    await expect(runtime.apply(b.id, { baseRevision: 1, ops: [image(saved.imageId)] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(runtime.apply(a.id, { baseRevision: 1, ops: [image('img_000000000000000000000000')] })).rejects.toMatchObject({ code: 'invalid' });
    const applied = await runtime.apply(a.id, { baseRevision: 1, ops: [image(saved.imageId)] });
    expect(applied.board.elements[0]).toMatchObject({ kind: 'image', imageId: saved.imageId, text: 'Login' });
    // An image keeps its picture: only position, size and caption change.
    await expect(runtime.apply(a.id, { baseRevision: 2, ops: [{ op: 'update', id: applied.board.elements[0].id, set: { color: 'red' } }] })).rejects.toMatchObject({ code: 'invalid' });

    expect(await images.has(a.id, saved.imageId)).toBe(true);
    await runtime.delete(a.id);
    expect(await images.has(a.id, saved.imageId)).toBe(false);
  });

  it('refuses SVG and oversized uploads', async () => {
    const { runtime } = setup();
    const board = (await runtime.create({ workspaceId: 'w', title: 'A' })).board;
    await expect(runtime.saveImage(board.id, Buffer.from('<svg/>'.padEnd(64, ' ')))).rejects.toMatchObject({ code: 'invalid' });
    await expect(runtime.saveImage(board.id, Buffer.concat([png(1, 1), Buffer.alloc(10 * 1024 * 1024)]))).rejects.toMatchObject({ code: 'invalid' });
  });

  it('bounds the disk pictures take, and prunes old uploads the board never used', async () => {
    let clock = 1_000_000;
    const store = createWhiteboardImageStore({ fsPromises: fs, directory: path.join(root, 'images'), limits: { boardImages: 2, boardBytes: 10_000, totalBytes: 10_000 }, now: () => clock });
    const kept = await store.save('wb_a', png(1, 1));
    const orphan = await store.save('wb_a', png(1, 1));
    await expect(store.save('wb_a', png(1, 1), new Set([kept.imageId]))).rejects.toMatchObject({ code: 'invalid' });
    // Eleven minutes later the unused upload is gone and there is room again; the one in use stays.
    clock += 11 * 60 * 1000;
    const orphanFile = (await store.find('wb_a', orphan.imageId)).filePath;
    await fs.utimes(orphanFile, new Date(clock - 11 * 60 * 1000), new Date(clock - 11 * 60 * 1000));
    await fs.utimes((await store.find('wb_a', kept.imageId)).filePath, new Date(clock - 11 * 60 * 1000), new Date(clock - 11 * 60 * 1000));
    await store.save('wb_a', png(1, 1), new Set([kept.imageId]));
    expect(await store.has('wb_a', orphan.imageId)).toBe(false);
    expect(await store.has('wb_a', kept.imageId)).toBe(true);
    // Every board together shares one ceiling.
    await expect(store.save('wb_b', Buffer.concat([png(1, 1), Buffer.alloc(9_950)]))).rejects.toMatchObject({ code: 'invalid' });
  });

  const serve = async (runtime, limits) => {
    const options = { fs: fsSync, fsPromises: fs, directory: path.join(root, 'uploads'), runtime };
    if (limits) options.limits = limits;
    const uploads = createWhiteboardImageUploads(options);
    const app = express();
    const allow = { resolveAuthContext: async (req) => (req.get('authorization') === 'Bearer ok' ? { type: 'session' } : null) };
    registerWhiteboardsRoutes(app, { runtime, uploads, tunnelAuthController: { classifyRequestScope: () => 'local', getTunnelSessionFromRequest: vi.fn() }, uiAuthController: allow });
    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    return { app, port: server.address().port };
  };
  const ticket = async (app, boardId) => (await request(app).post(`/api/openchamber/whiteboards/images/${boardId}/uploads`).set('Authorization', 'Bearer ok')).body.upload;

  it('uploads in three steps and serves the picture back only as its proven type', async () => {
    const { runtime } = setup();
    const board = (await runtime.create({ workspaceId: 'w', title: 'A' })).board;
    const { app } = await serve(runtime);

    expect((await request(app).post(`/api/openchamber/whiteboards/images/${board.id}/uploads`)).status).toBe(401);
    const upload = await ticket(app, board.id);
    expect(upload).toMatchObject({ method: 'PUT', uploadUrl: `/api/openchamber/whiteboards/uploads/${upload.uploadId}`, completeUrl: `/api/openchamber/whiteboards/uploads/${upload.uploadId}/complete` });
    expect((await request(app).put(upload.uploadUrl).set('Content-Type', 'image/png').send(png(4, 2))).status).toBe(401);
    expect((await request(app).put(upload.uploadUrl).set('Authorization', 'Bearer ok').set('Content-Type', 'application/octet-stream').send(png(4, 2))).status).toBe(200);
    // A ticket takes one picture, once.
    expect((await request(app).put(upload.uploadUrl).set('Authorization', 'Bearer ok').send(png(4, 2))).status).toBe(409);
    const completed = await request(app).post(upload.completeUrl).set('Authorization', 'Bearer ok');
    expect(completed.status).toBe(200);
    expect(completed.body.image).toMatchObject({ width: 4, height: 2, mime: 'image/png' });
    expect((await request(app).post(upload.completeUrl).set('Authorization', 'Bearer ok')).status).toBe(404);

    const served = await request(app).get(`/api/openchamber/whiteboards/images/${board.id}/${completed.body.image.imageId}`).set('Authorization', 'Bearer ok');
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect(served.body.equals(png(4, 2))).toBe(true);
    expect((await request(app).get(`/api/openchamber/whiteboards/images/${board.id}/${completed.body.image.imageId}`)).status).toBe(401);
    expect((await request(app).get(`/api/openchamber/whiteboards/images/${board.id}/..%2F..%2Fsecret`).set('Authorization', 'Bearer ok')).status).toBe(400);

    // SVG arrives but is never stored, and nothing is left staged.
    const svgUpload = await ticket(app, board.id);
    await request(app).put(svgUpload.uploadUrl).set('Authorization', 'Bearer ok').set('Content-Type', 'image/svg+xml').send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'.padEnd(64, ' ')));
    expect((await request(app).post(svgUpload.completeUrl).set('Authorization', 'Bearer ok')).status).toBe(400);
    expect(await fs.readdir(path.join(root, 'uploads'))).toEqual([]);
  });

  it('cuts an upload that stalls or runs too long, and frees its place for the next one', async () => {
    const { runtime } = setup();
    const board = (await runtime.create({ workspaceId: 'w', title: 'A' })).board;
    const { app, port } = await serve(runtime, { openTickets: 4, activeTransfers: 1, ticketTtlMs: 60_000, idleMs: 150, totalMs: 600 });
    const partial = (uploadUrl, keepSending) => new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'PUT', path: uploadUrl, headers: { authorization: 'Bearer ok', 'content-type': 'image/png', 'transfer-encoding': 'chunked' } }, (response) => resolve(response.statusCode));
      req.on('error', () => resolve('cut'));
      req.write(png(4, 2).subarray(0, 8));
      if (keepSending) {
        const timer = setInterval(() => req.write(Buffer.from([0])), 50);
        req.on('close', () => clearInterval(timer));
      }
    });

    // Stalled: nothing after the first bytes, cut after the idle deadline.
    const stalled = await ticket(app, board.id);
    const started = Date.now();
    const stalledResult = partial(stalled.uploadUrl, false);
    await new Promise((resolve) => setTimeout(resolve, 40));
    // While it holds the only place, another upload is told to come back.
    const waiting = await ticket(app, board.id);
    expect((await request(app).put(waiting.uploadUrl).set('Authorization', 'Bearer ok').send(png(4, 2))).status).toBe(429);
    // Cut: answered 408 when the connection still takes an answer, or closed.
    expect(['cut', 408]).toContain(await stalledResult);
    expect(Date.now() - started).toBeLessThan(600);
    // The place is free again.
    expect((await request(app).put(waiting.uploadUrl).set('Authorization', 'Bearer ok').send(png(4, 2))).status).toBe(200);
    expect((await request(app).post(waiting.completeUrl).set('Authorization', 'Bearer ok')).status).toBe(200);

    // Trickling: always sending a little, cut at the total deadline.
    const slow = await ticket(app, board.id);
    const slowStarted = Date.now();
    expect(['cut', 408]).toContain(await partial(slow.uploadUrl, true));
    expect(Date.now() - slowStarted).toBeGreaterThanOrEqual(550);
    expect((await request(app).post(slow.completeUrl).set('Authorization', 'Bearer ok')).status).toBe(404);
    expect(await fs.readdir(path.join(root, 'uploads'))).toEqual([]);
  });

  it('asking for many tickets cannot lock others out: the oldest idle one gives way', async () => {
    const { runtime } = setup();
    const board = (await runtime.create({ workspaceId: 'w', title: 'A' })).board;
    const { app } = await serve(runtime, { openTickets: 3, activeTransfers: 2, ticketTtlMs: 60_000, idleMs: 1000, totalMs: 5000 });
    const hoarded = [await ticket(app, board.id), await ticket(app, board.id), await ticket(app, board.id)];
    // One hoarded ticket even received its bytes and was left without completing.
    expect((await request(app).put(hoarded[1].uploadUrl).set('Authorization', 'Bearer ok').send(png(4, 2))).status).toBe(200);
    const mine = await ticket(app, board.id);
    expect(mine).toBeDefined();
    // The oldest idle ticket made room and no longer works; the newest one does.
    expect((await request(app).put(hoarded[0].uploadUrl).set('Authorization', 'Bearer ok').send(png(4, 2))).status).toBe(404);
    expect((await request(app).put(mine.uploadUrl).set('Authorization', 'Bearer ok').send(png(4, 2))).status).toBe(200);
    expect((await request(app).post(mine.completeUrl).set('Authorization', 'Bearer ok')).status).toBe(200);
    // Received but never completed: the next ask removes it, staging file included.
    await ticket(app, board.id);
    await ticket(app, board.id);
    expect((await request(app).post(hoarded[1].completeUrl).set('Authorization', 'Bearer ok')).status).toBe(404);
    expect((await fs.readdir(path.join(root, 'uploads'))).filter((name) => name.endsWith('.part'))).toEqual([]);
  });

  it('a picture being stored is not swept away when its ticket expires meanwhile', async () => {
    const { runtime } = setup();
    const board = (await runtime.create({ workspaceId: 'w', title: 'A' })).board;
    let clock = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    // Reading the staged picture waits on the gate, as a slow disk would.
    const slowFs = { ...fs, readFile: async (...args) => { await gate; return fs.readFile(...args); } };
    const uploads = createWhiteboardImageUploads({ fs: fsSync, fsPromises: slowFs, directory: path.join(root, 'uploads'), runtime, now: () => clock, limits: { openTickets: 4, activeTransfers: 2, ticketTtlMs: 1000, idleMs: 1000, totalMs: 5000 } });
    const upload = await uploads.create(board.id);
    const { Readable } = await import('node:stream');
    await uploads.receive(upload.uploadId, Readable.from([png(4, 2)]));
    const completing = uploads.complete(upload.uploadId);
    clock = 10_000;
    // Another ask sweeps expired tickets while the first one is being stored.
    await uploads.create(board.id);
    release();
    await expect(completing).resolves.toMatchObject({ width: 4, height: 2 });
  });

  it('refuses oversized bodies before reading them', async () => {
    const { runtime } = setup();
    const board = (await runtime.create({ workspaceId: 'w', title: 'A' })).board;
    const { app } = await serve(runtime, { openTickets: 2, activeTransfers: 1, ticketTtlMs: 60_000, idleMs: 1000, totalMs: 5000 });
    await ticket(app, board.id);
    const second = await ticket(app, board.id);
    const declared = await request(app).put(second.uploadUrl).set('Authorization', 'Bearer ok').set('Content-Length', String(11 * 1024 * 1024)).send('');
    expect(declared.status).toBe(413);
    expect((await request(app).post('/api/openchamber/whiteboards/images/wb_missing/uploads').set('Authorization', 'Bearer ok')).status).toBe(404);
  });

  it('the agent places a workspace picture next to the board, and nothing from outside the workspace', async () => {
    const workspace = path.join(root, 'repo');
    const outside = path.join(root, 'outside');
    await fs.mkdir(path.join(workspace, 'shots'), { recursive: true });
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(workspace, 'shots', 'login.png'), png(1000, 500));
    await fs.writeFile(path.join(outside, 'secret.png'), png(10, 10));
    await fs.symlink(path.join(outside, 'secret.png'), path.join(workspace, 'shots', 'link.png'));
    const { runtime, readWorkspaces } = setup([workspace]);
    const actions = createWhiteboardAgentActions({ runtime, readWorkspaces, broadcast: vi.fn(), fsPromises: fs });
    const board = (await runtime.create({ workspaceId: 'w', title: 'Flow', elements: [{ id: 'a', kind: 'block', x: 0, y: 40, w: 200, h: 80, text: 'Login' }] })).board;

    const added = await actions.execute('whiteboard.addImage', { boardId: board.id, path: 'shots/login.png', caption: 'Login screen' }, { directory: workspace });
    const image = added.board.elements.find((element) => element.kind === 'image');
    expect(image).toMatchObject({ x: 280, y: 40, w: 480, h: 240, text: 'Login screen' });
    expect(added.changedElementIds).toEqual([image.id]);

    await expect(actions.execute('whiteboard.addImage', { boardId: board.id, path: path.join(outside, 'secret.png') }, { directory: workspace })).rejects.toMatchObject({ statusCode: 400 });
    await expect(actions.execute('whiteboard.addImage', { boardId: board.id, path: 'shots/link.png' }, { directory: workspace })).rejects.toMatchObject({ statusCode: 400 });
    await expect(actions.execute('whiteboard.addImage', { boardId: board.id, path: '../outside/secret.png' }, { directory: workspace })).rejects.toMatchObject({ statusCode: 400 });
    await expect(actions.execute('whiteboard.addImage', { boardId: board.id, path: 'shots/missing.png' }, { directory: workspace })).rejects.toMatchObject({ statusCode: 404 });
  });
});
