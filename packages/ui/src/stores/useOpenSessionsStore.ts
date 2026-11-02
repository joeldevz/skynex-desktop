import { z } from 'zod';
import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { ParseResult } from '../lib/workspaces/model';
import { absoluteDirectorySchema } from '../lib/workspaces/schema';
import { readWorkspaceScope, workspaceSessionScopeSchema, type WorkspaceSessionScope } from '../lib/workspaces/session-scope';
import { readWorkspaceAssignment, workspaceAssignmentSchema, type WorkspaceAssignment } from '../lib/workspaces/session-assignment';
import type { Session } from '../lib/opencode/model';
import { getRuntimeKey, isTransientRuntimeKey } from '../lib/runtime-switch';
import { getDurableStorage } from './utils/safeStorage';
import { isVSCodeRuntime } from '../lib/desktop';
import { createSharedOpenSessionsAdapters } from '../lib/workspaces/shared-open-sessions';

export type OpenSessionReference = Readonly<{
  sessionId: string; title: string; primaryDirectory: string; scope: WorkspaceSessionScope | null;
  workspaceAssignment?: WorkspaceAssignment;
}>;
export type OpenSessionsSnapshot = Readonly<{ version: 1; migrated: true; sessions: readonly OpenSessionReference[] }>;
type ViewedSessionSeed = OpenSessionReference | null | { kind: 'lookup'; load: () => Promise<OpenSessionReference | null> };
type Retained<R extends string> = { kind: 'retained'; reason: R };
type RuntimeFailure = 'runtime-changed' | 'runtime-unavailable';
export type MembershipResult = { kind: 'saved' } | Retained<'load-failed' | 'persistence-failed' | RuntimeFailure>;
export type HydrationResult = { kind: 'ready' } | Retained<'read-failed' | 'invalid-snapshot' | 'persistence-failed' | RuntimeFailure>;
export type SessionCloseResult = { kind: 'closed' } | { kind: 'confirmation-required' }
  | Retained<'load-failed' | 'activity-unknown' | 'stop-failed' | 'persistence-failed' | RuntimeFailure>;
export type OpenSessionsState = {
  runtimeKey: string | null;
  sessions: readonly OpenSessionReference[];
  hydration: 'unloaded' | 'loading' | 'ready' | 'failed';
  hydrate(viewedSession: ViewedSessionSeed): Promise<HydrationResult>;
  openSession(reference: OpenSessionReference): Promise<MembershipResult>;
  reorderSession(sessionId: string, overId: string): Promise<MembershipResult>;
  closeSession(sessionId: string, confirmation: 'unconfirmed' | 'stop-confirmed'): Promise<SessionCloseResult>;
  /** Removes entries from the list only: never stops their sessions. For entries that do not belong in it. */
  forgetSessions(sessionIds: readonly string[]): Promise<MembershipResult>;
};
export type MembershipChange = { kind: 'seed'; sessions: readonly OpenSessionReference[] }
  | { kind: 'open'; reference: OpenSessionReference }
  | { kind: 'reorder'; order: readonly string[] }
  | { kind: 'close'; sessionId: string };
export type OpenSessionsAdapters = {
  runtimeKey(): string | null;
  read(runtimeKey: string): Promise<string | null>;
  /** Persists one change. A returned snapshot is the authoritative list after it, other clients' changes included. */
  write(runtimeKey: string, json: string, change: MembershipChange): Promise<string | void>;
  activity(runtimeKey: string, reference: OpenSessionReference): 'active' | 'idle' | 'unknown';
  /** Asks the server when no live source covers the session, e.g. a chat not opened since launch. */
  resolveActivity?(runtimeKey: string, reference: OpenSessionReference): Promise<'active' | 'idle' | 'unknown'>;
  interrupt(runtimeKey: string, reference: OpenSessionReference): Promise<boolean>;
};
const referenceSchema = z.object({ sessionId: z.string().min(1), title: z.string(), primaryDirectory: absoluteDirectorySchema,
  scope: workspaceSessionScopeSchema.nullable(),
  workspaceAssignment: workspaceAssignmentSchema.optional(),
}).refine((reference) => reference.scope === null || reference.primaryDirectory === reference.scope.primaryDirectory, 'Scope directory mismatch');
const snapshotSchema = z.object({ version: z.literal(1), migrated: z.literal(true), sessions: z.array(referenceSchema) })
  .refine((snapshot) => new Set(snapshot.sessions.map((reference) => reference.sessionId)).size === snapshot.sessions.length, 'Duplicate session ID');

export function parseOpenSessionsSnapshot(json: string | null): ParseResult<OpenSessionsSnapshot> {
  if (json === null) return { kind: 'missing' };
  try {
    const result = snapshotSchema.safeParse(JSON.parse(json));
    return result.success ? { kind: 'valid', value: result.data } : { kind: 'invalid', reason: result.error.message };
  } catch {
    return { kind: 'invalid', reason: 'Malformed open sessions snapshot' };
  }
}
type Intent = { kind: 'open'; reference: OpenSessionReference } | { kind: 'reorder'; sessionId: string; overId: string }
  | { kind: 'close'; sessionId: string; confirmation: 'unconfirmed' | 'stop-confirmed' }
  | { kind: 'forget'; sessionId: string };
type Namespace = {
  sessions: readonly OpenSessionReference[]; ready: boolean; tail: Promise<void>;
  loading: Promise<HydrationResult> | null; retry: Intent[];
};
const serialize = (sessions: readonly OpenSessionReference[]): string => JSON.stringify({ version: 1, migrated: true, sessions });
const authoritative = (json: string | void): readonly OpenSessionReference[] | null => {
  if (!json) return null;
  const parsed = parseOpenSessionsSnapshot(json);
  if (parsed.kind !== 'valid') throw new Error('Invalid authoritative open sessions snapshot');
  return parsed.value.sessions;
};

export function createOpenSessionsStore(adapters: OpenSessionsAdapters): StoreApi<OpenSessionsState> {
  const namespaces = new Map<string, Namespace>();
  const namespace = (key: string): Namespace => {
    let entry = namespaces.get(key);
    if (!entry) {
      entry = { sessions: [], ready: false, tail: Promise.resolve(), loading: null, retry: [] };
      namespaces.set(key, entry);
    }
    return entry;
  };
  const enqueue = <T>(owner: Namespace, action: () => Promise<T>): Promise<T> => {
    const next = owner.tail.then(action);
    owner.tail = next.then(() => undefined, () => undefined);
    return next;
  };
  const store = createStore<OpenSessionsState>()((set, get) => {
    const current = (key: string): boolean => adapters.runtimeKey() === key && get().runtimeKey === key;
    const publish = (key: string, owner: Namespace) => {
      if (current(key)) set({ sessions: owner.sessions });
    };
    const apply = async (key: string, owner: Namespace, intent: Intent): Promise<MembershipResult | SessionCloseResult> => {
      if (!current(key)) return { kind: 'retained', reason: 'runtime-changed' };
      let next: readonly OpenSessionReference[];
      if (intent.kind === 'open') {
        const index = owner.sessions.findIndex((entry) => entry.sessionId === intent.reference.sessionId);
        next = index < 0 ? [...owner.sessions, intent.reference]
          : owner.sessions.map((entry, i) => i === index ? intent.reference : entry);
      } else if (intent.kind === 'reorder') {
        const from = owner.sessions.findIndex((entry) => entry.sessionId === intent.sessionId);
        const to = owner.sessions.findIndex((entry) => entry.sessionId === intent.overId);
        if (from < 0 || to < 0 || from === to) return { kind: 'saved' };
        const moved = [...owner.sessions];
        moved.splice(to, 0, ...moved.splice(from, 1));
        next = moved;
      } else if (intent.kind === 'forget') {
        next = owner.sessions.filter((entry) => entry.sessionId !== intent.sessionId);
      } else {
        const reference = owner.sessions.find((entry) => entry.sessionId === intent.sessionId);
        if (!reference) return { kind: 'closed' };
        const live = adapters.activity(key, reference);
        let activity = live;
        if (live === 'unknown' && adapters.resolveActivity) {
          try { activity = await adapters.resolveActivity(key, reference); } catch { activity = 'unknown'; }
          if (!current(key)) return { kind: 'retained', reason: 'runtime-changed' };
          // A live event that arrived during the read outranks the snapshot.
          if (adapters.activity(key, reference) === 'active') activity = 'active';
        }
        if (activity === 'unknown') return { kind: 'retained', reason: 'activity-unknown' };
        if (activity === 'active') {
          if (intent.confirmation === 'unconfirmed') return { kind: 'confirmation-required' };
          try {
            const acknowledged = await adapters.interrupt(key, reference);
            if (!current(key)) return { kind: 'retained', reason: 'runtime-changed' };
            if (!acknowledged && adapters.activity(key, reference) !== 'idle') return { kind: 'retained', reason: 'stop-failed' };
          } catch {
            return { kind: 'retained', reason: 'stop-failed' };
          }
        } else if (live === 'idle' && adapters.activity(key, reference) !== 'idle') {
          return { kind: 'retained', reason: 'activity-unknown' };
        }
        next = owner.sessions.filter((entry) => entry.sessionId !== intent.sessionId);
      }
      if (serialize(next) !== serialize(owner.sessions)) {
        const change: MembershipChange = intent.kind === 'open' ? { kind: 'open', reference: intent.reference }
          : intent.kind === 'reorder' ? { kind: 'reorder', order: next.map((entry) => entry.sessionId) }
          : { kind: 'close', sessionId: intent.sessionId };
        try {
          owner.sessions = authoritative(await adapters.write(key, serialize(next), change)) ?? next;
        } catch {
          return { kind: 'retained', reason: 'persistence-failed' };
        }
      }
      if (!current(key)) return { kind: 'retained', reason: 'runtime-changed' };
      publish(key, owner);
      return intent.kind === 'close' ? { kind: 'closed' } : { kind: 'saved' };
    };
    const prepare = (key: string) => {
      if (get().runtimeKey !== key || get().hydration === 'unloaded') void get().hydrate(null);
      return namespace(key);
    };
    return {
      runtimeKey: null, sessions: [], hydration: 'unloaded',
      hydrate: (viewedSession) => {
        const key = adapters.runtimeKey();
        if (!key) {
          set({ runtimeKey: null, sessions: [], hydration: 'unloaded' });
          return Promise.resolve({ kind: 'retained', reason: 'runtime-unavailable' });
        }
        const changed = get().runtimeKey !== key;
        if (changed) set({ runtimeKey: key, sessions: [], hydration: 'loading' });
        const owner = namespace(key);
        if (owner.loading) return owner.loading;
        set({ hydration: 'loading' });
        const capturedSeed = viewedSession && 'kind' in viewedSession ? viewedSession
          : { kind: 'reference' as const, reference: viewedSession ? referenceSchema.parse(viewedSession) : null };
        const loading = enqueue(owner, async (): Promise<HydrationResult> => {
          let parsed: ParseResult<OpenSessionsSnapshot>;
          try { parsed = parseOpenSessionsSnapshot(await adapters.read(key)); }
          catch {
            owner.ready = false;
            if (current(key)) set({ hydration: 'failed' });
            return { kind: 'retained', reason: current(key) ? 'read-failed' : 'runtime-changed' };
          }
          if (!current(key)) return { kind: 'retained', reason: 'runtime-changed' };
          if (parsed.kind === 'invalid') {
            owner.ready = false;
            set({ hydration: 'failed' });
            return { kind: 'retained', reason: 'invalid-snapshot' };
          }
          let baseline: readonly OpenSessionReference[];
          if (parsed.kind === 'missing') {
            try {
              const seed = capturedSeed.kind === 'lookup' ? await capturedSeed.load() : capturedSeed.reference;
              baseline = seed ? [referenceSchema.parse(seed)] : [];
            } catch {
              owner.ready = false;
              if (current(key)) set({ hydration: 'failed' });
              return { kind: 'retained', reason: current(key) ? 'read-failed' : 'runtime-changed' };
            }
          } else baseline = parsed.value.sessions;
          if (!current(key)) return { kind: 'retained', reason: 'runtime-changed' };
          if (parsed.kind === 'missing') {
            try { baseline = authoritative(await adapters.write(key, serialize(baseline), { kind: 'seed', sessions: baseline })) ?? baseline; }
            catch {
              owner.ready = false;
              if (current(key)) set({ hydration: 'failed' });
              return { kind: 'retained', reason: 'persistence-failed' };
            }
          }
          if (!current(key)) return { kind: 'retained', reason: 'runtime-changed' };
          owner.sessions = baseline;
          owner.ready = true;
          const retry = owner.retry;
          owner.retry = [];
          for (const intent of retry) {
            const result = await apply(key, owner, intent);
            if (result.kind === 'retained') {
              owner.retry.push(intent);
              if (result.reason === 'persistence-failed') {
                publish(key, owner);
                set({ hydration: 'failed' });
                return { kind: 'retained', reason: 'persistence-failed' };
              }
            }
          }
          publish(key, owner);
          if (current(key)) set({ hydration: 'ready' });
          return current(key) ? { kind: 'ready' } : { kind: 'retained', reason: 'runtime-changed' };
        });
        owner.loading = loading;
        void loading.finally(() => { if (owner.loading === loading) owner.loading = null; });
        return loading;
      },
      openSession: (reference) => {
        const key = adapters.runtimeKey();
        if (!key) return Promise.resolve({ kind: 'retained', reason: 'runtime-unavailable' });
        const owner = prepare(key);
        const intent: Intent = { kind: 'open', reference: referenceSchema.parse(reference) };
        return enqueue(owner, async (): Promise<MembershipResult> => {
          if (!current(key)) return { kind: 'retained', reason: 'runtime-changed' };
          if (!owner.ready) {
            owner.retry.push(intent);
            return { kind: 'retained', reason: 'load-failed' };
          }
          const result = await apply(key, owner, intent);
          if (result.kind === 'saved') return result;
          if (result.kind === 'retained' && (result.reason === 'persistence-failed' || result.reason === 'runtime-changed')) return { kind: 'retained', reason: result.reason };
          return { kind: 'retained', reason: 'load-failed' };
        });
      },
      reorderSession: (sessionId, overId) => {
        const key = adapters.runtimeKey();
        if (!key) return Promise.resolve({ kind: 'retained', reason: 'runtime-unavailable' });
        const owner = prepare(key);
        return enqueue(owner, async (): Promise<MembershipResult> => {
          if (!owner.ready) return { kind: 'retained', reason: 'load-failed' };
          const result = await apply(key, owner, { kind: 'reorder', sessionId, overId });
          if (result.kind === 'saved') return result;
          if (result.kind === 'retained' && (result.reason === 'persistence-failed' || result.reason === 'runtime-changed')) return { kind: 'retained', reason: result.reason };
          return { kind: 'retained', reason: 'load-failed' };
        });
      },
      forgetSessions: async (sessionIds) => {
        const key = adapters.runtimeKey();
        if (!key) return { kind: 'retained', reason: 'runtime-unavailable' };
        const owner = prepare(key);
        for (const sessionId of sessionIds) {
          const result = await enqueue(owner, async (): Promise<MembershipResult> => {
            if (!owner.ready) return { kind: 'retained', reason: 'load-failed' };
            const applied = await apply(key, owner, { kind: 'forget', sessionId });
            if (applied.kind === 'retained' && (applied.reason === 'persistence-failed' || applied.reason === 'runtime-changed')) return { kind: 'retained', reason: applied.reason };
            return { kind: 'saved' };
          });
          if (result.kind === 'retained') return result;
        }
        return { kind: 'saved' };
      },
      closeSession: (sessionId, confirmation) => {
        const key = adapters.runtimeKey();
        if (!key) return Promise.resolve({ kind: 'retained', reason: 'runtime-unavailable' });
        const owner = prepare(key);
        const intent: Intent = { kind: 'close', sessionId, confirmation };
        return enqueue(owner, async (): Promise<SessionCloseResult> => {
          if (!current(key)) return { kind: 'retained', reason: 'runtime-changed' };
          if (!owner.ready) {
            owner.retry.push(intent);
            return { kind: 'retained', reason: 'load-failed' };
          }
          const result = await apply(key, owner, intent);
          return result.kind === 'saved' ? { kind: 'closed' } : result;
        });
      },
    };
  });
  return store;
}

export function openSessionReference(session: Session): OpenSessionReference {
  const scope = readWorkspaceScope(session.metadata);
  const workspaceAssignment = readWorkspaceAssignment(session.metadata);
  const reference = { sessionId: session.id, title: session.title || session.id, primaryDirectory: scope?.primaryDirectory ?? session.directory, scope };
  return referenceSchema.parse(workspaceAssignment ? { ...reference, workspaceAssignment } : reference);
}

const localKey = (key: string) => `openchamber.openSessions.v1:${key}`;
const localAdapters: Pick<OpenSessionsAdapters, 'read' | 'write'> = {
  read: async (key) => getDurableStorage().getItem(localKey(key)),
  write: async (key, json) => getDurableStorage().setItem(localKey(key), json),
};
const sharedAdapters = createSharedOpenSessionsAdapters({
  post: async (body) => {
    const { runtimeFetch } = await import('../lib/runtime-fetch');
    return runtimeFetch('/api/openchamber/open-sessions', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  },
  storage: getDurableStorage,
  readLocal: (key) => {
    const parsed = parseOpenSessionsSnapshot(getDurableStorage().getItem(localKey(key)));
    return parsed.kind === 'valid' ? parsed.value.sessions : [];
  },
});
// VS Code has no OpenChamber server to share through, so it keeps the list in the webview's storage.
const membershipAdapters = (): Pick<OpenSessionsAdapters, 'read' | 'write'> => (isVSCodeRuntime() ? localAdapters : sharedAdapters);

export const openSessionsStore = createOpenSessionsStore({
  runtimeKey: () => { const key = getRuntimeKey(); return isTransientRuntimeKey(key) ? null : key; },
  read: (key) => membershipAdapters().read(key),
  write: (key, json, change) => membershipAdapters().write(key, json, change),
  activity: (key, reference) => key === getRuntimeKey() ? liveActivity(reference.sessionId) : 'unknown',
  // OpenCode's active-session list is global and starts no location: absence from a
  // successful read means idle. A failed read stays unknown.
  resolveActivity: async (key, reference) => {
    if (key !== getRuntimeKey()) return 'unknown';
    const { opencodeClient } = await import('../lib/opencode/client');
    const statuses = await opencodeClient.getActiveSessionStatuses(reference.primaryDirectory);
    if (statuses === null || key !== getRuntimeKey()) return 'unknown';
    return reference.sessionId in statuses ? 'active' : 'idle';
  },
  interrupt: async (key, reference) => {
    if (key !== getRuntimeKey()) return false;
    const { opencodeClient } = await import('../lib/opencode/client');
    if (key !== getRuntimeKey()) return false;
    return opencodeClient.abortSession(reference.sessionId, reference.primaryDirectory);
  },
});
// Another client of the same server may have changed the list while this one was hidden.
if ('document' in globalThis) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && openSessionsStore.getState().hydration === 'ready') {
      void openSessionsStore.getState().hydrate(null);
    }
  });
}
let liveActivity: (sessionId: string) => 'active' | 'idle' | 'unknown' = () => 'unknown';
export function bindOpenSessionActivity(reader: typeof liveActivity): void { liveActivity = reader; }
export function useOpenSessionsStore<T>(selector: (state: OpenSessionsState) => T): T { return useStore(openSessionsStore, selector); }
