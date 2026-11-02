import express from 'express';
import { z } from 'zod';

import { isRequestAuthorized } from './core-routes.js';

const SHARED_OPEN_SESSIONS_ROUTE = '/api/openchamber/open-sessions';

// A reference names a session and where to open it. Strict: transcripts, live
// activity, access grants or a client-chosen server never get stored.
const referenceSchema = z.strictObject({
  sessionId: z.string().min(1),
  directory: z.string().min(1),
  title: z.string().optional(),
  scope: z.looseObject({}).nullable().optional(),
  workspaceAssignment: z.looseObject({}).optional(),
});

const snapshotSchema = z.array(referenceSchema).refine(
  (sessions) => new Set(sessions.map(({ sessionId }) => sessionId)).size === sessions.length,
  'Duplicate session ID',
);

const requestSchema = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('read') }),
  z.object({ operation: z.literal('open'), reference: z.unknown() }),
  z.object({ operation: z.literal('reorder'), order: z.array(z.string()) }),
  z.object({ operation: z.literal('close'), sessionId: z.string().min(1) }),
  z.object({ operation: z.literal('migrate'), references: z.array(z.unknown()) }),
]);

/** A request the client can fix: answered with 400, never with a server fault. */
class InvalidMembershipRequest extends Error {}

const parseReference = (value) => {
  const result = referenceSchema.safeParse(value);
  if (!result.success) throw new InvalidMembershipRequest('Invalid open-session reference');
  return result.data;
};

// Missing state is null. Stored data that fails validation rejects: it is never empty.
const parseSnapshot = (value) => {
  if (value == null) return null;
  const result = snapshotSchema.safeParse(value);
  if (!result.success) throw new Error('Malformed open-session membership');
  return result.data;
};

/**
 * Server-instance membership of explicitly open sessions. Every operation runs
 * in one queue against the latest stored snapshot, so concurrent clients never
 * overwrite each other's changes. A read or parse failure rejects; it never
 * reads as an empty list.
 */
export const createSharedOpenSessionsRuntime = ({ readSnapshot, writeSnapshot }) => {
  let tail = Promise.resolve();
  const enqueue = (action) => {
    const next = tail.then(action);
    tail = next.then(() => undefined, () => undefined);
    return next;
  };

  const mutate = (change) => enqueue(async () => {
    const stored = parseSnapshot(await readSnapshot());
    const current = stored ?? [];
    const next = change(current);
    if (stored === null || JSON.stringify(next) !== JSON.stringify(current)) {
      await writeSnapshot(next);
    }
    return next;
  });

  return {
    read: () => enqueue(async () => parseSnapshot(await readSnapshot())),
    open: async (value) => {
      const reference = parseReference(value);
      return mutate((current) => {
        const index = current.findIndex(({ sessionId }) => sessionId === reference.sessionId);
        return index < 0
          ? [...current, reference]
          : current.map((entry, i) => (i === index ? reference : entry));
      });
    },
    reorder: async (order) => mutate((current) => {
      const byId = new Map(current.map((entry) => [entry.sessionId, entry]));
      const listed = [...new Set(order)].filter((id) => byId.has(id)).map((id) => byId.get(id));
      const listedIds = new Set(listed.map(({ sessionId }) => sessionId));
      return [...listed, ...current.filter(({ sessionId }) => !listedIds.has(sessionId))];
    }),
    close: async (sessionId) => mutate((current) => current.filter((entry) => entry.sessionId !== sessionId)),
    migrate: async (values) => {
      const references = values
        .map((value) => referenceSchema.safeParse(value))
        .filter((result) => result.success)
        .map((result) => result.data);
      return mutate((current) => {
        const known = new Set(current.map(({ sessionId }) => sessionId));
        const added = [];
        for (const reference of references) {
          if (known.has(reference.sessionId)) continue;
          known.add(reference.sessionId);
          added.push(reference);
        }
        return [...current, ...added];
      });
    },
  };
};

const runOperation = (membership, body) => {
  const result = requestSchema.safeParse(body);
  if (!result.success) return Promise.reject(new InvalidMembershipRequest('Invalid open-session request'));
  const request = result.data;
  switch (request.operation) {
    case 'read': return membership.read();
    case 'open': return membership.open(request.reference);
    case 'reorder': return membership.reorder(request.order);
    case 'close': return membership.close(request.sessionId);
    case 'migrate': return membership.migrate(request.references);
  }
};

export const registerSharedOpenSessionsRoutes = (app, { membership, tunnelAuthController, uiAuthController }) => {
  app.post(SHARED_OPEN_SESSIONS_ROUTE, express.json({ limit: '1mb' }), async (req, res) => {
    const authorized = await isRequestAuthorized(req, res, { tunnelAuthController, uiAuthController });
    if (!authorized) return res.status(401).json({ error: 'Unauthorized' });
    try {
      return res.json({ sessions: await runOperation(membership, req.body) });
    } catch (error) {
      if (error instanceof InvalidMembershipRequest) return res.status(400).json({ error: error.message });
      return res.status(500).json({ error: 'Open-session membership unavailable' });
    }
  });
};

const fileSchema = z.object({ version: z.literal(1), sessions: z.array(z.unknown()) });

/** File-backed snapshot IO: a missing file reads as null; anything malformed rejects. */
export const createSharedOpenSessionsFileStore = ({ fsPromises, filePath, writeFileAtomic }) => ({
  readSnapshot: async () => {
    let text;
    try {
      text = await fsPromises.readFile(filePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    return fileSchema.parse(JSON.parse(text)).sessions;
  },
  writeSnapshot: async (sessions) => writeFileAtomic(filePath, `${JSON.stringify({ version: 1, sessions }, null, 2)}\n`),
});
