import { getRuntimeKey } from '@/lib/runtime-switch';
import { openSessionsStore, openSessionReference, type OpenSessionReference, type HydrationResult } from '@/stores/useOpenSessionsStore';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { opencodeClient } from '@/lib/opencode/client';
import { useSessionUIStore } from './session-ui-store';
import { readLastActiveSession } from './last-session-cache';

export type LastSessionRestoreResult = 'restored' | 'none' | 'failed';

export function hydrateOpenSessionsForRestore(): Promise<HydrationResult> {
  const key = getRuntimeKey();
  const ui = useSessionUIStore.getState();
  const persisted = readLastActiveSession(key);
  const id = ui.currentSessionId ?? persisted?.sessionId;
  const record = id ? useGlobalSessionsStore.getState().entityById.get(id) : undefined;
  const directory = ui.currentSessionId ? ui.currentSessionDirectory : persisted?.directory;
  const reference: OpenSessionReference | null = record ? openSessionReference(record)
    : id && directory ? { sessionId: id, title: id, primaryDirectory: directory, scope: null } : null;
  if (id && !reference) {
    return openSessionsStore.getState().hydrate({ kind: 'lookup', load: async () => openSessionReference(await opencodeClient.getSession(id)) });
  }
  return openSessionsStore.getState().hydrate(reference);
}

export const restoreLastActiveSession = async (_options: { readonly refresh: boolean }): Promise<LastSessionRestoreResult> => {
  const key = getRuntimeKey();
  const captured = readLastActiveSession(key);
  const hydration = await hydrateOpenSessionsForRestore();
  if (key !== getRuntimeKey()) return 'none';
  if (hydration.kind !== 'ready') return 'failed';
  const ui = useSessionUIStore.getState();
  if (ui.currentSessionId || readLastActiveSession(key)?.sessionId !== captured?.sessionId) return 'none';
  const reference = openSessionsStore.getState().sessions.find((session) => session.sessionId === captured?.sessionId);
  if (!reference) return 'none';
  ui.setCurrentSession(reference.sessionId, reference.primaryDirectory, undefined, 'restore');
  return 'restored';
};

export const beginLastSessionRestore = (options: { readonly selectNow: boolean }): (() => Promise<LastSessionRestoreResult>) => {
  const key = getRuntimeKey();
  const captured = readLastActiveSession(key);
  const hydration = hydrateOpenSessionsForRestore();
  const attempt = async (): Promise<LastSessionRestoreResult> => {
    const result = await hydration;
    if (key !== getRuntimeKey()) return 'none';
    if (result.kind !== 'ready') return 'failed';
    const ui = useSessionUIStore.getState();
    if (!options.selectNow || ui.currentSessionId || readLastActiveSession(key)?.sessionId !== captured?.sessionId) return 'none';
    const reference = openSessionsStore.getState().sessions.find((session) => session.sessionId === captured?.sessionId);
    if (!reference) return 'none';
    ui.setCurrentSession(reference.sessionId, reference.primaryDirectory, undefined, 'restore');
    return 'restored';
  };
  const pending = options.selectNow ? attempt() : null;
  return () => pending ?? attempt();
};
