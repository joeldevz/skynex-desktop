import { z } from 'zod';
import type { Metadata, Session } from '../opencode/model';
import { normalizePath } from '../pathNormalization';
import type { Workspace } from './model';
import { readWorkspaceScope } from './session-scope';

export const workspaceAssignmentSchema = z.object({
  version: z.literal(1), workspaceId: z.string().min(1), workspaceName: z.string().min(1),
});
export type WorkspaceAssignment = Readonly<z.infer<typeof workspaceAssignmentSchema>>;

export function readWorkspaceAssignment(metadata?: Metadata): WorkspaceAssignment | null {
  const parsed = z.object({ openchamber: z.object({ workspaceAssignment: workspaceAssignmentSchema }) }).safeParse(metadata);
  return parsed.success ? parsed.data.openchamber.workspaceAssignment : null;
}

export function bindWorkspaceAssignment(metadata: Metadata, session: Pick<Session, 'directory' | 'parentID'>, workspace: Workspace): Metadata {
  if (session.parentID) throw new Error('Only root sessions can be assigned');
  const scope = readWorkspaceScope(metadata);
  if (scope) {
    if (scope.workspaceId !== workspace.id) throw new Error('Session belongs to another workspace');
    return metadata;
  }
  const envelope = metadata.openchamber;
  const existingResult = z.record(z.string(), z.unknown()).safeParse(envelope);
  const existing = existingResult.success ? existingResult.data : {};
  if (existing.workspaceScope !== undefined) throw new Error('Invalid captured workspace scope');
  const assignment = readWorkspaceAssignment(metadata);
  if (assignment) {
    if (assignment.workspaceId !== workspace.id) throw new Error('Session is assigned to another workspace');
    return metadata;
  }
  if (existing.workspaceAssignment !== undefined) throw new Error('Invalid workspace assignment');
  const directory = normalizePath(session.directory);
  if (!directory || !workspace.folders.some((folder) => normalizePath(folder.path) === directory)) {
    throw new Error('Session directory is outside the saved workspace folders');
  }
  const parsed = workspaceAssignmentSchema.parse({ version: 1, workspaceId: workspace.id, workspaceName: workspace.name });
  return { ...metadata, openchamber: { ...existing, workspaceAssignment: parsed } };
}
