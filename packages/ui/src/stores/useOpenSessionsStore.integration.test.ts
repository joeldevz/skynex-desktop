import { describe, expect, test } from 'bun:test';
import type { SessionInfo } from '@opencode/client';
import { projectSession } from '../lib/opencode/projection';
import { openSessionReference, parseOpenSessionsSnapshot } from './useOpenSessionsStore';

describe('openSessionReference SDK conversion', () => {
  test('C3/C4 gives a titleless SDK session a stable label without changing its authoritative directory', () => {
    const wire: SessionInfo = {
      id: 'ses_titleless', projectID: 'project', location: { directory: '/authoritative/repo' },
      time: { created: 1, updated: 1 }, cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    };
    const session = projectSession(wire);
    const reference = openSessionReference(session);
    expect(reference).toEqual({
      sessionId: 'ses_titleless', title: 'ses_titleless', primaryDirectory: '/authoritative/repo', scope: null,
    });
    expect(openSessionReference(projectSession(wire))).toEqual(reference);
  });

  test('C5 still rejects a durable reference with a missing title', () => {
    expect(parseOpenSessionsSnapshot(JSON.stringify({ version: 1, migrated: true, sessions: [
      { sessionId: 'ses_titleless', primaryDirectory: '/authoritative/repo', scope: null },
    ] })).kind).toBe('invalid');
  });
});
