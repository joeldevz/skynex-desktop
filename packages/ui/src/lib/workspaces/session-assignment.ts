import { z } from 'zod';
import type { Metadata } from '../opencode/model';

export const workspaceAssignmentSchema = z.object({
  version: z.literal(1), workspaceId: z.string().min(1), workspaceName: z.string().min(1),
});
export type WorkspaceAssignment = Readonly<z.infer<typeof workspaceAssignmentSchema>>;

export function readWorkspaceAssignment(metadata?: Metadata): WorkspaceAssignment | null {
  const parsed = z.object({ openchamber: z.object({ workspaceAssignment: workspaceAssignmentSchema }) }).safeParse(metadata);
  return parsed.success ? parsed.data.openchamber.workspaceAssignment : null;
}
