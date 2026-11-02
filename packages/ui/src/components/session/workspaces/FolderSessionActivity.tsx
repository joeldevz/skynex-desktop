import { useSessionTurnActivity } from '@/sync/global-session-status';
import { SessionActivityIndicator } from '../SessionActivityIndicator';

export function FolderSessionActivity({ sessionId }: { sessionId: string }) {
  const activity = useSessionTurnActivity(sessionId);
  return activity ? <SessionActivityIndicator state={activity} /> : null;
}
