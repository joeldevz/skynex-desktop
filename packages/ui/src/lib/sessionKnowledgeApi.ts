import { runtimeFetch } from './runtime-fetch';

/** Refresh checkout and tool guidance before sending, without blocking on failure. */
export const syncSessionKnowledge = async (
  directory: string | null | undefined,
  sessionId: string | null | undefined,
): Promise<void> => {
  if (!directory || !sessionId) return;
  try {
    await runtimeFetch('/api/session-knowledge/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory, sessionId }),
      directory,
    });
  } catch {
    // Context refresh failure must not discard the message.
  }
};
