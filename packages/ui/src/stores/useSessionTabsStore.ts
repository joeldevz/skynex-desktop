import { create } from 'zustand';
import { openSessionsStore } from './useOpenSessionsStore';

interface SessionTabsStore {
  tabIds: string[];
  previewTabId: string | null;
  pinOnOpenIds: string[];
  ensureTab(sessionId: string, slotIds?: readonly string[]): void;
  pinTab(sessionId: string): void;
  closeTab(sessionId: string): void;
  closeOtherTabs(sessionId: string): void;
  reorderTabs(activeId: string, overId: string): void;
  removeTabs(sessionIds: readonly string[]): void;
}

export const useSessionTabsStore = create<SessionTabsStore>()(() => ({
  tabIds: openSessionsStore.getState().sessions.map((session) => session.sessionId),
  previewTabId: null,
  pinOnOpenIds: [],
  ensureTab: () => {},
  pinTab: () => {},
  closeTab: (sessionId) => {
    void import('../lib/sessionTabs').then(({ closeSessionTabAndActivateNeighbour }) => closeSessionTabAndActivateNeighbour(sessionId));
  },
  closeOtherTabs: (sessionId) => {
    const others = openSessionsStore.getState().sessions.filter((session) => session.sessionId !== sessionId);
    void import('../lib/sessionTabs').then(async ({ closeSessionTabAndActivateNeighbour }) => {
      for (const session of others) await closeSessionTabAndActivateNeighbour(session.sessionId);
    });
  },
  reorderTabs: (activeId, overId) => { void openSessionsStore.getState().reorderSession(activeId, overId); },
  removeTabs: () => {},
}));

openSessionsStore.subscribe((state, previous) => {
  if (state.sessions === previous.sessions) return;
  const ids = state.sessions.map((session) => session.sessionId);
  const current = useSessionTabsStore.getState().tabIds;
  if (ids.length === current.length && ids.every((id, index) => id === current[index])) return;
  useSessionTabsStore.setState({ tabIds: ids });
});
