import { z } from 'zod';
import type { MembershipChange, OpenSessionReference, OpenSessionsAdapters } from '../../stores/useOpenSessionsStore';
import { workspaceSessionScopeSchema, type WorkspaceSessionScope } from './session-scope';
import { workspaceAssignmentSchema, type WorkspaceAssignment } from './session-assignment';

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

/** The server's reference: it names the folder `directory`; the store says `primaryDirectory`. */
type ServerReference = {
  sessionId: string;
  directory: string;
  title?: string;
  scope?: WorkspaceSessionScope | null;
  workspaceAssignment?: WorkspaceAssignment;
};
export type MembershipRequest = { operation: 'read' }
  | { operation: 'migrate'; references: ServerReference[] }
  | { operation: 'open'; reference: ServerReference }
  | { operation: 'reorder'; order: readonly string[] }
  | { operation: 'close'; sessionId: string };

const serverReferenceSchema = z.object({
  sessionId: z.string(),
  directory: z.string(),
  title: z.string().optional(),
  scope: workspaceSessionScopeSchema.nullable().optional(),
  workspaceAssignment: workspaceAssignmentSchema.optional(),
});
const serverResponseSchema = z.object({ sessions: z.array(serverReferenceSchema).nullable() });

const toServer = (reference: OpenSessionReference): ServerReference => {
  const server: ServerReference = {
    sessionId: reference.sessionId, directory: reference.primaryDirectory, title: reference.title, scope: reference.scope,
  };
  if (reference.workspaceAssignment) server.workspaceAssignment = reference.workspaceAssignment;
  return server;
};

const fromServer = (server: z.infer<typeof serverReferenceSchema>): OpenSessionReference => {
  const reference = {
    sessionId: server.sessionId, title: server.title ?? server.sessionId, primaryDirectory: server.directory, scope: server.scope ?? null,
  };
  return server.workspaceAssignment ? { ...reference, workspaceAssignment: server.workspaceAssignment } : reference;
};

// The store parses the snapshot it receives, so the JSON here only has to carry the fields.
const toSnapshot = (sessions: readonly z.infer<typeof serverReferenceSchema>[] | null): string | null => (
  sessions === null ? null : JSON.stringify({ version: 1, migrated: true, sessions: sessions.map(fromServer) })
);

const toRequest = (change: MembershipChange): MembershipRequest => {
  switch (change.kind) {
    case 'seed': return { operation: 'migrate', references: change.sessions.map(toServer) };
    case 'open': return { operation: 'open', reference: toServer(change.reference) };
    case 'reorder': return { operation: 'reorder', order: change.order };
    case 'close': return { operation: 'close', sessionId: change.sessionId };
  }
};

/**
 * Open-session membership kept by the OpenChamber server and shared by every
 * client of that server. The first read on each client unions the list it kept
 * locally into the server's; afterwards the server list is the only authority.
 */
export const createSharedOpenSessionsAdapters = ({ post, storage, readLocal }: {
  post: (request: MembershipRequest) => Promise<Response>;
  storage: () => Storage;
  /** The list this client kept before sharing; empty when missing or unreadable. */
  readLocal: (runtimeKey: string) => readonly OpenSessionReference[];
}): Pick<OpenSessionsAdapters, 'read' | 'write'> => {
  const send = async (request: MembershipRequest) => {
    const response = await post(request);
    if (!response.ok) throw new Error(`Open-session membership request failed (${response.status})`);
    return serverResponseSchema.parse(await response.json()).sessions;
  };
  const migrationKey = (runtimeKey: string) => `openchamber.openSessions.sharedMigration.v1:${runtimeKey}`;
  return {
    read: async (runtimeKey) => {
      let sessions = await send({ operation: 'read' });
      if (storage().getItem(migrationKey(runtimeKey)) === null) {
        const local = readLocal(runtimeKey);
        if (local.length > 0) sessions = await send({ operation: 'migrate', references: local.map(toServer) });
        storage().setItem(migrationKey(runtimeKey), '1');
      }
      return toSnapshot(sessions);
    },
    write: async (_runtimeKey, _json, change) => toSnapshot(await send(toRequest(change))) ?? undefined,
  };
};
