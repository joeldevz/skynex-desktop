import { describe, expect, test } from 'bun:test';
import { createOpenSessionsStore, parseOpenSessionsSnapshot } from './useOpenSessionsStore';
import type { OpenSessionReference, OpenSessionsAdapters } from './useOpenSessionsStore';

const reference = (sessionId: string, primaryDirectory = '/app'): OpenSessionReference => ({
  sessionId, title: `Saved ${sessionId}`, primaryDirectory,
  scope: { version: 1, workspaceId: 'w', workspaceName: 'Product', description: 'Overview', primaryDirectory,
    folders: [{ id: 'a', path: primaryDirectory, role: 'Code' }, { id: 'b', path: '/notes', role: 'Notes' }] },
});
const snapshot = (sessions: readonly OpenSessionReference[]) => JSON.stringify({ version: 1, migrated: true, sessions });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type FixtureCalls = { reads: string[]; writes: { runtime: string; json: string }[]; interrupts: { runtime: string; reference: OpenSessionReference }[] };

function fixture(initial: string | null = snapshot([])) {
  const disk = new Map<string, string>();
  if (initial !== null) disk.set('host-a', initial);
  const calls: FixtureCalls = { reads: [], writes: [], interrupts: [] };
  let runtime: string | null = 'host-a';
  let activity: 'idle' | 'active' | 'unknown' = 'idle';
  let read = async (key: string): Promise<string | null> => disk.get(key) ?? null;
  let write = async (key: string, json: string): Promise<void> => { disk.set(key, json); };
  let interrupt = async (): Promise<boolean> => true;
  const adapters: OpenSessionsAdapters = {
    runtimeKey: () => runtime,
    read: key => { calls.reads.push(key); return read(key); },
    write: (key, json) => { calls.writes.push({ runtime: key, json }); return write(key, json); },
    activity: () => activity,
    interrupt: (key, value) => { calls.interrupts.push({ runtime: key, reference: value }); return interrupt(); },
  };
  const store = createOpenSessionsStore(adapters);
  return { store, disk, calls, adapters,
    runtime: (value: string | null) => { runtime = value; },
    activity: (value: typeof activity) => { activity = value; },
    read: (value: typeof read) => { read = value; },
    write: (value: typeof write) => { write = value; },
    interrupt: (value: typeof interrupt) => { interrupt = value; },
  };
}

describe('C3-C9/C12 explicit open membership', () => {
  test('C4 migrates only the first captured viewed reference once despite concurrent restore', async () => {
    const f = fixture(null);
    const load = deferred<string | null>();
    f.read(() => load.promise);
    const first = f.store.getState().hydrate(reference('viewed'));
    const second = f.store.getState().hydrate(reference('default-navigation'));
    load.resolve(null);
    expect(await first).toEqual({ kind: 'ready' });
    expect(await second).toEqual({ kind: 'ready' });
    expect(f.store.getState().sessions).toEqual([reference('viewed')]);
    expect(f.calls.writes).toHaveLength(1);
    expect(JSON.parse(f.calls.writes[0].json)).toEqual({ version: 1, migrated: true, sessions: [reference('viewed')] });
    const restarted = createOpenSessionsStore({ ...f.adapters, read: async key => f.disk.get(key) ?? null });
    expect(await restarted.getState().hydrate(reference('other'))).toEqual({ kind: 'ready' });
    expect(restarted.getState().sessions).toEqual([reference('viewed')]);
    expect(f.calls.writes).toHaveLength(1);
  });

  test.each<{ label: string; sessions: OpenSessionReference[] }>([
    { label: 'empty', sessions: [] }, { label: 'unresolved saved row', sessions: [reference('unresolved')] },
  ])('C4 restores $label exactly without migrating the viewed session', async ({ sessions }) => {
    const f = fixture(snapshot(sessions));
    expect(await f.store.getState().hydrate(reference('viewed'))).toEqual({ kind: 'ready' });
    expect(f.store.getState().sessions).toEqual(sessions);
    expect(f.calls.writes).toEqual([]);
  });

  test('C4 missing storage with no viewed session persists an empty migration marker', async () => {
    const f = fixture(null);
    expect(await f.store.getState().hydrate(null)).toEqual({ kind: 'ready' });
    expect(JSON.parse(f.disk.get('host-a') ?? 'null')).toEqual({ version: 1, migrated: true, sessions: [] });
  });

  test.each(['read-failed', 'invalid-snapshot'] as const)('C5 %s preserves prior rows, never migrates, and retains pending intents for retry', async reason => {
    const f = fixture(snapshot([reference('prior')]));
    await f.store.getState().hydrate(null);
    const read = deferred<string | null>();
    f.read(() => read.promise);
    const hydration = f.store.getState().hydrate(reference('must-not-migrate'));
    const opening = f.store.getState().openSession(reference('pending'));
    const closing = f.store.getState().closeSession('prior', 'unconfirmed');
    expect(f.store.getState().sessions).toEqual([reference('prior')]);
    if (reason === 'read-failed') read.reject(new Error('storage unavailable'));
    else read.resolve('{');
    expect(await hydration).toEqual({ kind: 'retained', reason });
    expect(await opening).toEqual({ kind: 'retained', reason: 'load-failed' });
    expect(await closing).toEqual({ kind: 'retained', reason: 'load-failed' });
    expect(f.store.getState().sessions).toEqual([reference('prior')]);
    expect(f.calls.writes).toEqual([]);
    f.read(async () => snapshot([reference('prior')]));
    expect(await f.store.getState().hydrate(null)).toEqual({ kind: 'ready' });
    expect(f.store.getState().sessions).toEqual([reference('pending')]);
    expect(JSON.parse(f.disk.get('host-a') ?? 'null').sessions).toEqual([reference('pending')]);
  });

  test('C3/C12 retains 12 explicit rows across directories, completion and refresh with no history input', async () => {
    const f = fixture();
    await f.store.getState().hydrate(null);
    const rows = Array.from({ length: 12 }, (_, i) => reference(`s${i}`, `/directory-${i % 3}`));
    for (const row of rows) expect(await f.store.getState().openSession(row)).toEqual({ kind: 'saved' });
    const renamed = { ...rows[3], title: 'Updated saved label' };
    await f.store.getState().openSession(renamed);
    const expected = rows.map(row => row.sessionId === renamed.sessionId ? renamed : row);
    f.activity('active');
    f.activity('idle');
    const writes = f.calls.writes.length;
    await f.store.getState().hydrate(reference('history-only'));
    expect(f.store.getState().sessions).toEqual(expected);
    expect(f.calls.writes).toHaveLength(writes);
    const restarted = createOpenSessionsStore(f.adapters);
    await restarted.getState().hydrate(null);
    expect(restarted.getState().sessions).toEqual(expected);
  });

  test('C5 queues opens and absent close tombstones over a delayed baseline in invocation order', async () => {
    const f = fixture();
    const load = deferred<string | null>();
    f.read(() => load.promise);
    const hydration = f.store.getState().hydrate(null);
    const opening = f.store.getState().openSession(reference('new'));
    const closing = f.store.getState().closeSession('old', 'unconfirmed');
    expect(f.calls.writes).toEqual([]);
    load.resolve(snapshot([reference('old'), reference('keep')]));
    expect(await hydration).toEqual({ kind: 'ready' });
    expect(await opening).toEqual({ kind: 'saved' });
    expect(await closing).toEqual({ kind: 'closed' });
    expect(f.store.getState().sessions).toEqual([reference('keep'), reference('new')]);
    expect(JSON.parse(f.disk.get('host-a') ?? 'null').sessions).toEqual([reference('keep'), reference('new')]);
  });

  test('C5 serializes a pending open before close so a late write cannot resurrect it', async () => {
    const f = fixture();
    await f.store.getState().hydrate(null);
    const gate = deferred<void>();
    const started = deferred<void>();
    f.write(async (key, json) => { started.resolve(); await gate.promise; f.disk.set(key, json); });
    const opening = f.store.getState().openSession(reference('s'));
    const closing = f.store.getState().closeSession('s', 'unconfirmed');
    await started.promise;
    expect(f.calls.writes).toHaveLength(1);
    expect(f.store.getState().sessions).toEqual([]);
    gate.resolve();
    expect(await opening).toEqual({ kind: 'saved' });
    expect(await closing).toEqual({ kind: 'closed' });
    expect(f.calls.writes).toHaveLength(2);
    expect(JSON.parse(f.disk.get('host-a') ?? 'null').sessions).toEqual([]);
    expect(f.store.getState().sessions).toEqual([]);
  });

  test('C5 same-runtime late hydrate cannot resurrect an acknowledged close or erase an open', async () => {
    const f = fixture(snapshot([reference('old')]));
    await f.store.getState().hydrate(null);
    const stale = deferred<string | null>();
    f.read(() => stale.promise);
    const hydration = f.store.getState().hydrate(null);
    const closing = f.store.getState().closeSession('old', 'unconfirmed');
    const opening = f.store.getState().openSession(reference('new'));
    stale.resolve(snapshot([reference('old')]));
    await Promise.all([hydration, closing, opening]);
    expect(f.store.getState().sessions).toEqual([reference('new')]);
    expect(JSON.parse(f.disk.get('host-a') ?? 'null').sessions).toEqual([reference('new')]);
  });

  test('C5 fences stale hydration and clears the previous runtime synchronously', async () => {
    const f = fixture(snapshot([reference('same-id')]));
    await f.store.getState().hydrate(null);
    const stale = deferred<string | null>();
    f.read(key => key === 'host-a' ? stale.promise : Promise.resolve(snapshot([reference('same-id', '/other-host')])));
    const old = f.store.getState().hydrate(null);
    f.runtime('host-b');
    const current = f.store.getState().hydrate(null);
    expect(f.store.getState().sessions).toEqual([]);
    expect(await current).toEqual({ kind: 'ready' });
    stale.resolve(snapshot([reference('stale')]));
    expect(await old).toEqual({ kind: 'retained', reason: 'runtime-changed' });
    expect(f.store.getState().runtimeKey).toBe('host-b');
    expect(f.store.getState().sessions).toEqual([reference('same-id', '/other-host')]);
  });

  test('C9 an already-started write finishes only against its captured runtime', async () => {
    const f = fixture();
    await f.store.getState().hydrate(null);
    const gate = deferred<void>();
    const started = deferred<void>();
    f.write(async (key, json) => { started.resolve(); await gate.promise; f.disk.set(key, json); });
    const opening = f.store.getState().openSession(reference('a'));
    await started.promise;
    f.runtime('host-b');
    f.disk.set('host-b', snapshot([reference('b')]));
    await f.store.getState().hydrate(null);
    gate.resolve();
    expect(await opening).toEqual({ kind: 'retained', reason: 'runtime-changed' });
    expect(f.calls.writes.map(call => call.runtime)).toEqual(['host-a']);
    expect(JSON.parse(f.disk.get('host-a') ?? 'null').sessions).toEqual([reference('a')]);
    expect(f.store.getState().sessions).toEqual([reference('b')]);
  });

  test('C5 unavailable identity performs no reads, writes or interrupts', async () => {
    const f = fixture();
    f.runtime(null);
    expect(await f.store.getState().hydrate(reference('s'))).toEqual({ kind: 'retained', reason: 'runtime-unavailable' });
    expect(await f.store.getState().openSession(reference('s'))).toEqual({ kind: 'retained', reason: 'runtime-unavailable' });
    expect(await f.store.getState().closeSession('s', 'stop-confirmed')).toEqual({ kind: 'retained', reason: 'runtime-unavailable' });
    expect(f.calls).toEqual({ reads: [], writes: [], interrupts: [] });
  });

  test('C7 idle close persists before publication and reopen preserves the same ID and binding', async () => {
    const row = reference('s');
    const f = fixture(snapshot([row]));
    await f.store.getState().hydrate(null);
    const gate = deferred<void>();
    const started = deferred<void>();
    f.write(async (key, json) => { started.resolve(); await gate.promise; f.disk.set(key, json); });
    const closing = f.store.getState().closeSession('s', 'unconfirmed');
    await started.promise;
    expect(f.store.getState().sessions).toEqual([row]);
    expect(JSON.parse(f.calls.writes[0].json).sessions).toEqual([]);
    gate.resolve();
    expect(await closing).toEqual({ kind: 'closed' });
    expect(f.store.getState().sessions).toEqual([]);
    expect(f.calls.interrupts).toEqual([]);
    expect(await f.store.getState().openSession(row)).toEqual({ kind: 'saved' });
    expect(f.store.getState().sessions).toEqual([row]);
    expect(row).toEqual(reference('s'));
    const writes = f.calls.writes.length;
    expect(await f.store.getState().closeSession('absent', 'unconfirmed')).toEqual({ kind: 'closed' });
    expect(f.calls.writes).toHaveLength(writes);
  });

  test('C8 active close requests confirmation; cancellation makes no second call and leaves it working', async () => {
    const f = fixture(snapshot([reference('s')]));
    await f.store.getState().hydrate(null);
    f.activity('active');
    expect(await f.store.getState().closeSession('s', 'unconfirmed')).toEqual({ kind: 'confirmation-required' });
    await Promise.resolve();
    expect(f.calls.interrupts).toEqual([]);
    expect(f.calls.writes).toEqual([]);
    expect(f.store.getState().sessions).toEqual([reference('s')]);
  });

  test('C8 confirmed stop uses captured runtime and session directory before removing membership', async () => {
    const row = reference('s', '/other-directory');
    const f = fixture(snapshot([row]));
    await f.store.getState().hydrate(null);
    f.activity('active');
    f.interrupt(async () => { f.activity('idle'); return true; });
    expect(await f.store.getState().closeSession('s', 'stop-confirmed')).toEqual({ kind: 'closed' });
    expect(f.calls.interrupts).toEqual([{ runtime: 'host-a', reference: row }]);
    expect(f.store.getState().sessions).toEqual([]);
  });

  test('C8 acknowledged stop permits close while cached activity still reports active', async () => {
    const row = reference('s');
    const f = fixture(snapshot([row]));
    await f.store.getState().hydrate(null);
    f.activity('active');
    f.interrupt(async () => true);
    expect(await f.store.getState().closeSession('s', 'stop-confirmed')).toEqual({ kind: 'closed' });
    expect(f.calls.interrupts).toEqual([{ runtime: 'host-a', reference: row }]);
    expect(f.store.getState().sessions).toEqual([]);
    expect(JSON.parse(f.disk.get('host-a') ?? 'null').sessions).toEqual([]);
  });

  test.each(['false', 'throw', 'unknown'] as const)('C8 %s cannot close an unsafe session', async mode => {
    const f = fixture(snapshot([reference('s')]));
    await f.store.getState().hydrate(null);
    f.activity(mode === 'unknown' ? 'unknown' : 'active');
    f.interrupt(async () => { if (mode === 'throw') throw new Error('stop rejected'); return false; });
    const result = await f.store.getState().closeSession('s', 'stop-confirmed');
    expect(result.kind).toBe('retained');
    expect(f.store.getState().sessions).toEqual([reference('s')]);
    expect(f.calls.writes).toEqual([]);
  });

  test('C8 false interruption closes only with authoritative idle proof', async () => {
    const f = fixture(snapshot([reference('s')]));
    await f.store.getState().hydrate(null);
    f.activity('active');
    f.interrupt(async () => { f.activity('idle'); return false; });
    expect(await f.store.getState().closeSession('s', 'stop-confirmed')).toEqual({ kind: 'closed' });
    expect(f.store.getState().sessions).toEqual([]);
  });

  test.each(['open', 'idle-close', 'stopped-close', 'migration'] as const)('C9 %s save failure preserves acknowledged membership and supports explicit retry', async operation => {
    const f = fixture(operation === 'migration' ? null : snapshot([reference('prior')]));
    if (operation !== 'migration') await f.store.getState().hydrate(null);
    f.write(async () => { throw new Error('quota'); });
    if (operation === 'stopped-close') { f.activity('active'); f.interrupt(async () => { f.activity('idle'); return true; }); }
    const perform = () => operation === 'migration' ? f.store.getState().hydrate(reference('seed'))
      : operation === 'open' ? f.store.getState().openSession(reference('new'))
      : f.store.getState().closeSession('prior', operation === 'stopped-close' ? 'stop-confirmed' : 'unconfirmed');
    expect(await perform()).toEqual({ kind: 'retained', reason: 'persistence-failed' });
    expect(f.store.getState().sessions).toEqual(operation === 'migration' ? [] : [reference('prior')]);
    expect(f.disk.get('host-a') ?? null).toBe(operation === 'migration' ? null : snapshot([reference('prior')]));
    f.write(async (key, json) => { f.disk.set(key, json); });
    expect(await perform()).toEqual({ kind: operation === 'migration' ? 'ready' : operation === 'open' ? 'saved' : 'closed' });
    expect(f.store.getState().sessions).toEqual(operation === 'migration' ? [reference('seed')] : operation === 'open' ? [reference('prior'), reference('new')] : []);
  });
});

describe('C4/C5 snapshot authority', () => {
  test('distinguishes missing from empty and normalizes valid paths', () => {
    expect(parseOpenSessionsSnapshot(null)).toEqual({ kind: 'missing' });
    expect(parseOpenSessionsSnapshot(snapshot([]))).toEqual({ kind: 'valid', value: { version: 1, migrated: true, sessions: [] } });
    const row = reference('s', '/app/');
    const expected = reference('s');
    expect(parseOpenSessionsSnapshot(snapshot([row]))).toEqual({ kind: 'valid', value: { version: 1, migrated: true, sessions: [expected] } });
  });

  test.each([
    ['malformed', '{'],
    ['version', JSON.stringify({ version: 2, migrated: true, sessions: [] })],
    ['migration marker', JSON.stringify({ version: 1, sessions: [] })],
    ['duplicate IDs', snapshot([reference('s'), reference('s')])],
    ['relative directory', snapshot([{ ...reference('s'), primaryDirectory: 'relative' }])],
    ['mismatched primary', snapshot([{ ...reference('s'), primaryDirectory: '/different' }])],
  ])('rejects %s instead of granting empty authority', (_label, json) => {
    expect(parseOpenSessionsSnapshot(json)).toMatchObject({ kind: 'invalid', reason: expect.any(String) });
  });
});

describe('closing a session no live source covers', () => {
  const closeWith = async (resolved: () => Promise<'active' | 'idle' | 'unknown'>) => {
    const f = fixture(snapshot([reference('cold'), reference('kept')]));
    f.activity('unknown');
    const store = createOpenSessionsStore({ ...f.adapters, resolveActivity: resolved });
    await store.getState().hydrate(null);
    return { store, result: await store.getState().closeSession('cold', 'unconfirmed') };
  };

  test('closes once the server reports it idle', async () => {
    const { store, result } = await closeWith(async () => 'idle');
    expect(result).toEqual({ kind: 'closed' });
    expect(store.getState().sessions.map((entry) => entry.sessionId)).toEqual(['kept']);
  });

  test('asks for confirmation when the server reports it running', async () => {
    const { store, result } = await closeWith(async () => 'active');
    expect(result).toEqual({ kind: 'confirmation-required' });
    expect(store.getState().sessions.map((entry) => entry.sessionId)).toEqual(['cold', 'kept']);
  });

  test('keeps the session open when the server cannot be asked', async () => {
    const { store, result } = await closeWith(async () => { throw new Error('offline'); });
    expect(result).toEqual({ kind: 'retained', reason: 'activity-unknown' });
    expect(store.getState().sessions.map((entry) => entry.sessionId)).toEqual(['cold', 'kept']);
  });
});

describe('forgetting entries that do not belong in the list', () => {
  test('removes them without stopping a running session', async () => {
    const f = fixture(snapshot([reference('child'), reference('kept')]));
    f.activity('active');
    await f.store.getState().hydrate(null);
    expect(await f.store.getState().forgetSessions(['child'])).toEqual({ kind: 'saved' });
    expect(f.store.getState().sessions.map((entry) => entry.sessionId)).toEqual(['kept']);
    expect(f.calls.interrupts).toEqual([]);
  });

  test('keeps them when the change cannot be saved', async () => {
    const f = fixture(snapshot([reference('child')]));
    await f.store.getState().hydrate(null);
    f.write(async () => { throw new Error('offline'); });
    expect(await f.store.getState().forgetSessions(['child'])).toEqual({ kind: 'retained', reason: 'persistence-failed' });
    expect(f.store.getState().sessions.map((entry) => entry.sessionId)).toEqual(['child']);
  });
});
