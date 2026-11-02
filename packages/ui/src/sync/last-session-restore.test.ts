import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Session } from '@/lib/opencode/model';
import { getRuntimeKey, switchRuntimeEndpoint } from '@/lib/runtime-switch';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { openSessionsStore, type OpenSessionReference } from '@/stores/useOpenSessionsStore';
import { clearLastActiveSession, persistLastActiveSession, readLastActiveSession } from './last-session-cache';
import { beginLastSessionRestore, restoreLastActiveSession } from './last-session-restore';
import { useSessionUIStore } from './session-ui-store';

const session = (id: string): Session => ({
  id, projectID: 'project', directory: '/repo', title: id, time: { created: 1, updated: 1 },
  cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
});
const reference = (id: string): OpenSessionReference => ({ sessionId: id, title: id, primaryDirectory: '/repo', scope: null });
class RestoreStorage implements Storage {
  readonly values = new Map<string, string>();
  readonly writes: Array<{ key: string; value: string }> = [];
  readFailure = false;
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) {
    if (this.readFailure && key.startsWith('openchamber.openSessions.')) throw new Error('durable read denied');
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) { this.writes.push({ key, value }); this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalFetch = globalThis.fetch;
const originalSetCurrentSession = useSessionUIStore.getState().setCurrentSession;
let selected: Array<{ id: string | null; directory: string | null | undefined }> = [];
let storage: RestoreStorage;
let runtime = 0;
const membershipKey = () => `openchamber.openSessions.v1:${getRuntimeKey()}`;
const saveMembership = (ids: string[]) => storage.values.set(membershipKey(), JSON.stringify({ version: 1, migrated: true, sessions: ids.map(reference) }));
const membershipWrites = () => storage.writes.filter(({ key }) => key === membershipKey());
// The OpenChamber server's membership route, keeping its list in the same storage
// document so the durable-storage assertions below apply to the shared list.
type ServerRef = { sessionId: string; directory: string; title?: string; scope?: null };
const membershipServer = (body: { operation: string; references?: ServerRef[]; reference?: ServerRef; sessionId?: string }): Response => {
  let stored: { sessions: OpenSessionReference[] } | null;
  try {
    const json = storage.getItem(membershipKey());
    stored = json === null ? null : JSON.parse(json);
  } catch {
    return new Response('{}', { status: 500 });
  }
  const toServer = (entry: OpenSessionReference): ServerRef => ({ sessionId: entry.sessionId, directory: entry.primaryDirectory, title: entry.title, scope: null });
  const current = (stored?.sessions ?? []).map(toServer);
  let next = current;
  if (body.operation === 'migrate') next = [...current, ...(body.references ?? []).filter((ref) => !current.some((entry) => entry.sessionId === ref.sessionId))];
  else if (body.operation === 'open' && body.reference) next = [...current.filter((entry) => entry.sessionId !== body.reference?.sessionId), body.reference];
  else if (body.operation === 'close') next = current.filter((entry) => entry.sessionId !== body.sessionId);
  if (body.operation !== 'read' && (stored === null || JSON.stringify(next) !== JSON.stringify(current))) {
    storage.setItem(membershipKey(), JSON.stringify({ version: 1, migrated: true,
      sessions: next.map((entry) => ({ sessionId: entry.sessionId, title: entry.title ?? entry.sessionId, primaryDirectory: entry.directory, scope: null })) }));
  }
  return Response.json({ sessions: body.operation === 'read' && stored === null ? null : next });
};

beforeEach(() => {
  storage = new RestoreStorage();
  const events = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: storage,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  // SAFETY: the stub implements fetch's call signature, the only part runtimeFetch uses.
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!url.includes('/api/openchamber/open-sessions')) return new Response(null, { status: 503 });
    const body = JSON.parse(input instanceof Request ? await input.text() : String(init?.body));
    return membershipServer(body);
  }) as typeof fetch;
  switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: `restore-contract-${++runtime}` });
  selected = [];
  useSessionUIStore.setState({ currentSessionId: null, currentSessionDirectory: null,
    setCurrentSession: (id, directory) => {
      selected.push({ id, directory });
      useSessionUIStore.setState({ currentSessionId: id, currentSessionDirectory: id ? directory ?? null : null });
    },
  });
  useGlobalSessionsStore.setState({ hasLoaded: true, status: 'ready',
    activeSessions: [session('ses_open'), session('ses_other')], archivedSessions: [],
    entityById: new Map(['ses_open', 'ses_other'].map((id) => [id, session(id)])),
  });
  openSessionsStore.setState({ runtimeKey: null, sessions: [], hydration: 'unloaded' });
  clearLastActiveSession(getRuntimeKey());
});

afterEach(() => {
  useSessionUIStore.setState({ setCurrentSession: originalSetCurrentSession, currentSessionId: null, currentSessionDirectory: null });
  clearLastActiveSession(getRuntimeKey());
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('restoreLastActiveSession durable membership', () => {
  test('C4 migrates exactly the session left viewed when membership is missing', async () => {
    persistLastActiveSession(getRuntimeKey(), { sessionId: 'ses_open', directory: '/repo' });
    expect(await restoreLastActiveSession({ refresh: false })).toBe('restored');
    expect(selected).toEqual([{ id: 'ses_open', directory: '/repo' }]);
    expect(JSON.parse(storage.getItem(membershipKey()) ?? 'null')).toEqual({ version: 1, migrated: true, sessions: [reference('ses_open')] });
    expect(membershipWrites()).toHaveLength(1);
  });

  test('leaves the launch alone without a pointer', async () => {
    expect(await restoreLastActiveSession({ refresh: false })).toBe('none');
    expect(selected).toEqual([]);
  });

  test('does not replace a session a link already opened', async () => {
    persistLastActiveSession(getRuntimeKey(), { sessionId: 'ses_open', directory: '/repo' });
    useSessionUIStore.setState({ currentSessionId: 'ses_other', currentSessionDirectory: '/repo' });
    expect(await restoreLastActiveSession({ refresh: false })).toBe('none');
    expect(selected).toEqual([]);
  });

  test('C4/C12 retains an unresolved saved session when the global list omits it', async () => {
    persistLastActiveSession(getRuntimeKey(), { sessionId: 'ses_unresolved', directory: '/repo' });
    saveMembership(['ses_unresolved']);
    expect(await restoreLastActiveSession({ refresh: false })).toBe('restored');
    expect(selected).toEqual([{ id: 'ses_unresolved', directory: '/repo' }]);
    expect(readLastActiveSession(getRuntimeKey())?.sessionId).toBe('ses_unresolved');
    expect(openSessionsStore.getState().sessions).toEqual([reference('ses_unresolved')]);
    expect(membershipWrites()).toEqual([]);
  });

  test('C5 keeps the pointer and performs zero writes after a failed durable read, then permits restore retry', async () => {
    persistLastActiveSession(getRuntimeKey(), { sessionId: 'ses_open', directory: '/repo' });
    saveMembership(['ses_open']);
    storage.readFailure = true;
    expect(await restoreLastActiveSession({ refresh: false })).toBe('failed');
    expect(selected).toEqual([]);
    expect(readLastActiveSession(getRuntimeKey())?.sessionId).toBe('ses_open');
    expect(membershipWrites()).toEqual([]);
    storage.readFailure = false;
    expect(await restoreLastActiveSession({ refresh: false })).toBe('restored');
    expect(selected).toEqual([{ id: 'ses_open', directory: '/repo' }]);
  });

  test('C5 a failed durable refresh preserves the earlier acknowledged membership', async () => {
    persistLastActiveSession(getRuntimeKey(), { sessionId: 'ses_open', directory: '/repo' });
    saveMembership(['ses_open']);
    await openSessionsStore.getState().hydrate(null);
    storage.readFailure = true;
    expect(await restoreLastActiveSession({ refresh: true })).toBe('failed');
    expect(readLastActiveSession(getRuntimeKey())?.sessionId).toBe('ses_open');
    expect(openSessionsStore.getState().sessions).toEqual([reference('ses_open')]);
    expect(membershipWrites()).toEqual([]);
  });

  test('C4 a valid empty snapshot never reopens the saved pointer', async () => {
    persistLastActiveSession(getRuntimeKey(), { sessionId: 'ses_open', directory: '/repo' });
    saveMembership([]);
    expect(await restoreLastActiveSession({ refresh: false })).toBe('none');
    expect(selected).toEqual([]);
    expect(openSessionsStore.getState().sessions).toEqual([]);
    expect(membershipWrites()).toEqual([]);
  });

  test('C5 malformed membership never migrates or overwrites the stored document', async () => {
    persistLastActiveSession(getRuntimeKey(), { sessionId: 'ses_open', directory: '/repo' });
    storage.values.set(membershipKey(), '{broken');
    expect(await restoreLastActiveSession({ refresh: false })).toBe('failed');
    expect(selected).toEqual([]);
    expect(storage.getItem(membershipKey())).toBe('{broken');
    expect(membershipWrites()).toEqual([]);
  });
});

describe('beginLastSessionRestore', () => {
  test('C4 hydrates durable membership before selecting, without waiting for global history', async () => {
    persistLastActiveSession(getRuntimeKey(), { sessionId: 'ses_open', directory: '/repo' });
    saveMembership(['ses_open']);
    useGlobalSessionsStore.setState({ hasLoaded: false, status: 'idle', activeSessions: [] });
    const attempt = beginLastSessionRestore({ selectNow: true });
    expect(selected).toEqual([]);
    await attempt();
    expect(selected).toEqual([{ id: 'ses_open', directory: '/repo' }]);
    expect(readLastActiveSession(getRuntimeKey())?.sessionId).toBe('ses_open');
  });

  test('takes the directory from the persisted session index when the pointer has none', async () => {
    persistLastActiveSession(getRuntimeKey(), { sessionId: 'ses_open', directory: null });
    await beginLastSessionRestore({ selectNow: true })();
    expect(selected).toEqual([{ id: 'ses_open', directory: '/repo' }]);
  });

  test('C4 uses the saved member routing when the pointer and global index have no directory', async () => {
    persistLastActiveSession(getRuntimeKey(), { sessionId: 'ses_open', directory: null });
    saveMembership(['ses_open']);
    useGlobalSessionsStore.setState({ entityById: new Map(), activeSessions: [], hasLoaded: false, status: 'idle' });
    expect(await beginLastSessionRestore({ selectNow: true })()).toBe('restored');
    expect(selected).toEqual([{ id: 'ses_open', directory: '/repo' }]);
    expect(membershipWrites()).toEqual([]);
  });

  test('leaves the launch to a route that names a session', async () => {
    persistLastActiveSession(getRuntimeKey(), { sessionId: 'ses_open', directory: '/repo' });
    expect(await beginLastSessionRestore({ selectNow: false })()).toBe('none');
    expect(selected).toEqual([]);
  });

  test('C4/C12 retains an unresolved row and pointer across global list failure and omission', async () => {
    persistLastActiveSession(getRuntimeKey(), { sessionId: 'ses_unresolved', directory: '/repo' });
    saveMembership(['ses_unresolved']);
    useGlobalSessionsStore.setState({ hasLoaded: false, status: 'error', activeSessions: [], entityById: new Map() });
    await beginLastSessionRestore({ selectNow: true })();
    expect(useSessionUIStore.getState().currentSessionId).toBe('ses_unresolved');
    useGlobalSessionsStore.setState({ hasLoaded: true, status: 'ready', activeSessions: [session('ses_other')] });
    expect(await restoreLastActiveSession({ refresh: true })).toBe('none');
    expect(useSessionUIStore.getState().currentSessionId).toBe('ses_unresolved');
    expect(readLastActiveSession(getRuntimeKey())?.sessionId).toBe('ses_unresolved');
    expect(openSessionsStore.getState().sessions).toEqual([reference('ses_unresolved')]);
  });

  test('keeps what the user opened while durable hydration was pending', async () => {
    persistLastActiveSession(getRuntimeKey(), { sessionId: 'ses_open', directory: '/repo' });
    saveMembership(['ses_open']);
    const attempt = beginLastSessionRestore({ selectNow: true });
    useSessionUIStore.getState().setCurrentSession('ses_other', '/repo');
    persistLastActiveSession(getRuntimeKey(), { sessionId: 'ses_other', directory: '/repo' });
    expect(await attempt()).toBe('none');
    expect(useSessionUIStore.getState().currentSessionId).toBe('ses_other');
    expect(readLastActiveSession(getRuntimeKey())?.sessionId).toBe('ses_other');
  });
});
