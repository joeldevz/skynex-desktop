import { describe, expect, test } from 'bun:test';
import type { OpenSessionReference } from '../../stores/useOpenSessionsStore';
import { createSharedOpenSessionsAdapters, type MembershipRequest } from './shared-open-sessions';

const reference = (sessionId: string, primaryDirectory = `/work/${sessionId}`): OpenSessionReference => ({
  sessionId, title: sessionId, primaryDirectory, scope: null,
});

const fakeServer = (initial: { sessionId: string; directory: string; title?: string }[] | null) => {
  let sessions = initial;
  const calls: MembershipRequest[] = [];
  const post = async (body: MembershipRequest) => {
    calls.push(body);
    if (body.operation === 'migrate') {
      const current = sessions ?? [];
      sessions = [...current, ...body.references.filter((ref) => !current.some((entry) => entry.sessionId === ref.sessionId))];
    }
    return new Response(JSON.stringify({ sessions }), { status: 200 });
  };
  return { post, calls, get sessions() { return sessions; } };
};

const memoryStorage = () => {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};

describe('shared open-session adapters', () => {
  test('unions the local list into the server list once per client', async () => {
    const server = fakeServer([{ sessionId: 'server', directory: '/srv', title: 'server' }]);
    const memory = memoryStorage();
    const storage = () => memory;
    const adapters = createSharedOpenSessionsAdapters({ post: server.post, storage, readLocal: () => [reference('local'), reference('server', '/stale')] });

    const first = JSON.parse((await adapters.read('rt')) ?? 'null');
    expect(first.sessions.map((entry: OpenSessionReference) => [entry.sessionId, entry.primaryDirectory])).toEqual([
      ['server', '/srv'], ['local', '/work/local'],
    ]);

    await adapters.read('rt');
    expect(server.calls.map((call) => call.operation)).toEqual(['read', 'migrate', 'read']);
  });

  test('reports a missing server list as missing, not empty', async () => {
    const adapters = createSharedOpenSessionsAdapters({ post: fakeServer(null).post, storage: memoryStorage, readLocal: () => [] });
    expect(await adapters.read('rt')).toBeNull();
  });

  test('rejects when the server request fails instead of returning an empty list', async () => {
    const adapters = createSharedOpenSessionsAdapters({
      post: async () => new Response('{}', { status: 500 }), storage: memoryStorage, readLocal: () => [],
    });
    await expect(adapters.read('rt')).rejects.toThrow('500');
    await expect(adapters.write('rt', '', { kind: 'close', sessionId: 'a' })).rejects.toThrow('500');
  });
});
