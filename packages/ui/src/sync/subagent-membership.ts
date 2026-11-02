import type { Session } from '@/lib/opencode/model';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { openSessionsStore } from '@/stores/useOpenSessionsStore';

/** Entries whose loaded session record has a parent, i.e. a subagent's chat. */
export function subagentMembers(sessionIds: readonly string[], lookup: (sessionId: string) => Session | undefined): string[] {
  return sessionIds.filter((sessionId) => Boolean(lookup(sessionId)?.parentID));
}

/**
 * Earlier builds added a subagent's chat to the open sessions list when it was
 * viewed. Once the global session list shows the parent, the entry leaves the
 * list; the subagent keeps running and its conversation stays. Returns the
 * unsubscribe.
 */
export function startSubagentMembershipCleanup(): () => void {
  let running = false;
  const forget = () => {
    const membership = openSessionsStore.getState();
    if (running || membership.hydration !== 'ready') return;
    const ids = subagentMembers(membership.sessions.map((entry) => entry.sessionId),
      (sessionId) => useGlobalSessionsStore.getState().entityById.get(sessionId));
    if (ids.length === 0) return;
    running = true;
    void membership.forgetSessions(ids).finally(() => { running = false; });
  };
  const stopMembership = openSessionsStore.subscribe((state, previous) => {
    if (state.sessions !== previous.sessions || state.hydration !== previous.hydration) forget();
  });
  const stopGlobal = useGlobalSessionsStore.subscribe((state, previous) => {
    if (state.entityById !== previous.entityById) forget();
  });
  forget();
  return () => { stopMembership(); stopGlobal(); };
}
