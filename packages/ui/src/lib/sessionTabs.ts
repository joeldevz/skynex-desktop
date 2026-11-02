import { useSessionUIStore } from '@/sync/session-ui-store';
import { openSessionsStore, type SessionCloseResult } from '@/stores/useOpenSessionsStore';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';
import { useSessionCloseDialogStore } from '@/stores/useSessionCloseDialogStore';

export const activateSessionTabByIndex = (index: number): boolean => {
  const session = openSessionsStore.getState().sessions[index];
  if (!session) return false;
  useWorkspacesStore.getState().selectWorkspace(null);
  useSessionUIStore.getState().setCurrentSession(session.sessionId, session.primaryDirectory, undefined, 'restore');
  return true;
};

export const activateAdjacentSessionTab = (delta: -1 | 1): boolean => {
  const sessions = openSessionsStore.getState().sessions;
  const { currentSessionId, setCurrentSession } = useSessionUIStore.getState();
  if (!currentSessionId || sessions.length < 2) return false;
  const index = sessions.findIndex((session) => session.sessionId === currentSessionId);
  if (index === -1) return false;
  const next = sessions[(index + delta + sessions.length) % sessions.length];
  useWorkspacesStore.getState().selectWorkspace(null);
  setCurrentSession(next.sessionId, next.primaryDirectory, undefined, 'restore');
  return true;
};

export const closeSessionTabAndActivateNeighbour = async (sessionId: string, confirmation: 'unconfirmed' | 'stop-confirmed' = 'unconfirmed', presentDialog = true): Promise<SessionCloseResult> => {
  const rows = openSessionsStore.getState().sessions;
  const index = rows.findIndex((row) => row.sessionId === sessionId);
  const runtimeKey = openSessionsStore.getState().runtimeKey;
  const result = await openSessionsStore.getState().closeSession(sessionId, confirmation);
  if (presentDialog && openSessionsStore.getState().runtimeKey === runtimeKey) {
    const reference = rows[index];
    if (result.kind === 'confirmation-required' && reference) useSessionCloseDialogStore.getState().present({ reference, runtimeKey });
    if (result.kind === 'retained') useSessionCloseDialogStore.getState().fail(result.reason === 'stop-failed' ? 'stop-failed' : confirmation === 'stop-confirmed' && result.reason === 'persistence-failed' ? 'stopped-but-open' : 'close-failed');
  }
  if (result.kind !== 'closed' || openSessionsStore.getState().runtimeKey !== runtimeKey) return result;
  const ui = useSessionUIStore.getState();
  if (ui.currentSessionId === sessionId) {
    const remaining = openSessionsStore.getState().sessions;
    const neighbour = remaining[index] ?? remaining[index - 1];
    ui.setCurrentSession(neighbour?.sessionId ?? null, neighbour?.primaryDirectory, undefined, 'restore');
    if (!neighbour) {
      ui.closeNewSessionDraft();
      const workspaces = useWorkspacesStore.getState();
      const workspace = workspaces.catalog.workspaces.find((entry) => entry.id === rows[index]?.scope?.workspaceId) ?? workspaces.catalog.workspaces[0];
      if (workspace) workspaces.selectWorkspace(workspace.id);
    }
  }
  return result;
};

// Completion and folder cleanup retain explicit open membership.
export const leaveFinishedSessions = (_sessionIds: readonly string[], _options?: { projectId?: string | null }): void => {};
