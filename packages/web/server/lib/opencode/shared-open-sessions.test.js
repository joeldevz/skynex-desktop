import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createSharedOpenSessionsRuntime, registerSharedOpenSessionsRoutes } from './shared-open-sessions.js';

const makeMembership = async (io) => createSharedOpenSessionsRuntime(io);

describe('shared open-session membership', () => {
  it('authenticates the shared membership route before reading membership', async () => {
    let snapshot = [{ sessionId: 'kept', directory: '/kept' }];
    const readSnapshot = vi.fn(async () => snapshot);
    const writeSnapshot = vi.fn(async (next) => { snapshot = next; });
    const membership = await makeMembership({ readSnapshot, writeSnapshot });
    const app = express();
    const uiAuthController = {
      resolveAuthContext: vi.fn(async (req) => (
        req.get('authorization') === 'Bearer valid-session' ? { type: 'session' } : null
      )),
    };
    const tunnelAuthController = {
      classifyRequestScope: vi.fn(() => 'local'),
      getTunnelSessionFromRequest: vi.fn(),
    };

    registerSharedOpenSessionsRoutes(app, {
      membership,
      tunnelAuthController,
      uiAuthController,
    });

    const unauthorized = await request(app)
      .post('/api/openchamber/open-sessions')
      .send({ operation: 'read' });
    expect([401, 403]).toContain(unauthorized.status);
    expect(snapshot).toEqual([{ sessionId: 'kept', directory: '/kept' }]);
    expect(readSnapshot).not.toHaveBeenCalled();
    expect(writeSnapshot).not.toHaveBeenCalled();
    expect(uiAuthController.resolveAuthContext).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Object),
      { allowUrlToken: false },
    );

    const authorized = await request(app)
      .post('/api/openchamber/open-sessions')
      .set('Authorization', 'Bearer valid-session')
      .send({ operation: 'read' });
    expect(authorized.status).toBe(200);
    expect(readSnapshot).toHaveBeenCalledOnce();
    expect(writeSnapshot).not.toHaveBeenCalled();
    expect(uiAuthController.resolveAuthContext).toHaveBeenCalledTimes(2);
  });

  it('keeps membership scoped to each active server instance without accepting a client server key', async () => {
    let firstSnapshot = [];
    let secondSnapshot = [];
    const first = await makeMembership({
      readSnapshot: async () => firstSnapshot,
      writeSnapshot: async (next) => { firstSnapshot = next; },
    });
    const second = await makeMembership({
      readSnapshot: async () => secondSnapshot,
      writeSnapshot: async (next) => { secondSnapshot = next; },
    });
    if (!first || !second) return;

    await first.open({ sessionId: 'first-server', directory: '/first' });

    expect(firstSnapshot.map(({ sessionId }) => sessionId)).toEqual(['first-server']);
    expect(secondSnapshot).toEqual([]);
    await expect(first.open({ sessionId: 'foreign', directory: '/foreign', serverId: 'second-server' })).rejects.toThrow();
  });

  it('unions validated migration references with the latest snapshot by session ID and preserves order', async () => {
    let snapshot = [
      { sessionId: 'server-only', directory: '/srv/a' },
      { sessionId: 'duplicate', directory: '/srv/shared' },
    ];
    const membership = await makeMembership({
      readSnapshot: async () => snapshot,
      writeSnapshot: async (next) => { snapshot = next; },
    });
    if (!membership) return;

    const migrationRefs = [
      { sessionId: 'local-only', directory: '/home/a' },
      { sessionId: 'duplicate', directory: '/wrong/duplicate' },
      { sessionId: 'local-only', directory: '/ignored/duplicate' },
    ];
    const result = await membership.migrate(migrationRefs);

    expect(result).toEqual([
      { sessionId: 'server-only', directory: '/srv/a' },
      { sessionId: 'duplicate', directory: '/srv/shared' },
      { sessionId: 'local-only', directory: '/home/a' },
    ]);
    expect(snapshot).toEqual(result);

    const beforeInvalidMigration = structuredClone(snapshot);
    const invalidResult = await membership.migrate([
      { sessionId: 'local-valid', directory: '/home/valid' },
      { sessionId: 'invalid-directory', directory: 42 },
    ]);
    expect(invalidResult).toEqual([
      ...beforeInvalidMigration,
      { sessionId: 'local-valid', directory: '/home/valid' },
    ]);
    expect(snapshot).toEqual(invalidResult);
  });

  it('preserves overlapping reorder, close, and migration mutations in invocation order', async () => {
    let snapshot = [
      { sessionId: 'a', directory: '/a' },
      { sessionId: 'b', directory: '/b' },
    ];
    let releaseFirstRead;
    let signalFirstRead;
    const firstReadStarted = new Promise((resolve) => { signalFirstRead = resolve; });
    const firstReadGate = new Promise((resolve) => { releaseFirstRead = resolve; });
    let reads = 0;
    const membership = await makeMembership({
      readSnapshot: async () => {
        reads += 1;
        if (reads === 1) {
          signalFirstRead();
          await firstReadGate;
        }
        return structuredClone(snapshot);
      },
      writeSnapshot: async (next) => { snapshot = structuredClone(next); },
    });
    if (!membership) return;

    const reorder = membership.reorder(['b', 'a']);
    await firstReadStarted;
    const close = membership.close('a');
    const migration = membership.migrate([{ sessionId: 'c', directory: '/c' }]);
    releaseFirstRead();
    await Promise.all([reorder, close, migration]);

    expect(snapshot).toEqual([
      { sessionId: 'b', directory: '/b' },
      { sessionId: 'c', directory: '/c' },
    ]);
  });

  it('distinguishes missing state from acknowledged empty membership', async () => {
    let snapshot;
    const membership = await makeMembership({
      readSnapshot: async () => snapshot,
      writeSnapshot: async (next) => { snapshot = next; },
    });
    if (!membership) return;

    expect(await membership.read()).toBeNull();
    await membership.migrate([]);
    expect(await membership.read()).toEqual([]);
    expect(await membership.migrate([{ sessionId: 'local', directory: '/local' }])).toEqual([
      { sessionId: 'local', directory: '/local' },
    ]);
  });

  it('reports malformed state and read or write failures without returning empty success or deleting prior state', async () => {
    const malformed = await makeMembership({
      readSnapshot: async () => ({ sessionId: 'bad', directory: 42 }),
      writeSnapshot: async () => {},
    });
    if (!malformed) return;
    await expect(malformed.read()).rejects.toThrow();

    const readFailure = await makeMembership({
      readSnapshot: async () => { throw new Error('read denied'); },
      writeSnapshot: async () => {},
    });
    await expect(readFailure.read()).rejects.toThrow('read denied');

    const prior = [{ sessionId: 'kept', directory: '/kept' }];
    const writeFailure = await makeMembership({
      readSnapshot: async () => prior,
      writeSnapshot: async () => { throw new Error('write denied'); },
    });
    await expect(writeFailure.open({ sessionId: 'new', directory: '/new' })).rejects.toThrow('write denied');
    expect(prior).toEqual([{ sessionId: 'kept', directory: '/kept' }]);
    await expect(readFailure.migrate([])).rejects.toThrow('read denied');
  });

  it('stores reference metadata only and rejects payloads with access or activity fields', async () => {
    let snapshot = [];
    const membership = await makeMembership({
      readSnapshot: async () => snapshot,
      writeSnapshot: async (next) => { snapshot = next; },
    });
    if (!membership) return;

    await membership.open({ sessionId: 'safe', directory: '/safe', title: 'Session' });
    expect(snapshot).toEqual([{ sessionId: 'safe', directory: '/safe', title: 'Session' }]);
    await expect(membership.open({
      sessionId: 'unsafe', directory: '/unsafe', transcript: 'private', liveActivity: { busy: true }, accessGrant: true,
    })).rejects.toThrow();
    expect(snapshot).toEqual([{ sessionId: 'safe', directory: '/safe', title: 'Session' }]);
  });
});
