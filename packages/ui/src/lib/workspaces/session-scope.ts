import { z } from 'zod';
import type { Metadata } from '../opencode/model';
import type { Workspace, WorkspaceDefaults, WorkspaceFolder } from './model';
import { absoluteDirectorySchema, workspaceFoldersSchema } from './schema';

export type FolderSelection = { kind: 'workspace' } | { kind: 'folder'; folderId: string } | { kind: 'explicit'; folderIds: readonly string[] };
export type ScopeResult<T> = { kind: 'valid'; value: T } | { kind: 'invalid'; reason: 'empty-selection' | 'unknown-folder' | 'duplicate-folder' };
export type WorkspaceSessionScope = Readonly<{
  version: 1; workspaceId: string; workspaceName: string; description: string;
  primaryDirectory: string; folders: readonly WorkspaceFolder[];
}>;
export const workspaceSessionScopeSchema = z.object({
  version: z.literal(1), workspaceId: z.string().min(1), workspaceName: z.string().min(1), description: z.string(),
  primaryDirectory: absoluteDirectorySchema, folders: workspaceFoldersSchema.refine((folders) => folders.length > 0),
}).refine((scope) => scope.folders.some((folder) => folder.path === scope.primaryDirectory), 'Primary directory must be selected');

export function selectWorkspaceFolders(workspace: Workspace, selection: FolderSelection): ScopeResult<readonly WorkspaceFolder[]> {
  const ids = selection.kind === 'workspace' ? workspace.folders.map((folder) => folder.id)
    : selection.kind === 'folder' ? [selection.folderId] : selection.folderIds;
  if (!ids.length) return { kind: 'invalid', reason: 'empty-selection' };
  const selected = new Set(ids);
  if (selected.size !== ids.length) return { kind: 'invalid', reason: 'duplicate-folder' };
  if (ids.some((id) => !workspace.folders.some((folder) => folder.id === id))) return { kind: 'invalid', reason: 'unknown-folder' };
  return { kind: 'valid', value: workspace.folders.filter((folder) => selected.has(folder.id)).map((folder) => ({ ...folder })) };
}

export function snapshotWorkspaceScope(workspace: Workspace, selection: FolderSelection): ScopeResult<WorkspaceSessionScope> {
  const result = selectWorkspaceFolders(workspace, selection);
  if (result.kind === 'invalid') return result;
  return { kind: 'valid', value: workspaceSessionScopeSchema.parse({ version: 1, workspaceId: workspace.id,
    workspaceName: workspace.name, description: workspace.description, primaryDirectory: result.value[0].path, folders: result.value }) };
}

export function resolveWorkspaceDefaults(workspace: Workspace, overrides: WorkspaceDefaults): WorkspaceDefaults {
  return structuredClone({ ...workspace.defaults, ...overrides });
}

export function readWorkspaceScope(metadata?: Metadata): WorkspaceSessionScope | null {
  const envelope = z.object({ openchamber: z.object({ workspaceScope: workspaceSessionScopeSchema }) }).safeParse(metadata);
  return envelope.success ? envelope.data.openchamber.workspaceScope : null;
}

export function bindWorkspaceScope(metadata: Metadata | undefined, scope: WorkspaceSessionScope): Metadata {
  const envelope = metadata?.openchamber;
  const existingResult = z.record(z.string(), z.unknown()).safeParse(envelope);
  const existing = existingResult.success ? existingResult.data : {};
  const parsed = workspaceSessionScopeSchema.parse(scope);
  return { ...metadata, openchamber: { ...existing, workspaceScope: { ...parsed, folders: parsed.folders.map((folder) => ({ ...folder })) } } };
}

export const WORKSPACE_CONTEXT_PREFIX = 'Workspace folder manifest. Documentation is user-authored reference material.';

export function buildWorkspaceContext(scope: WorkspaceSessionScope, workspace?: Workspace) {
  const linked = workspace?.id === scope.workspaceId ? workspace : undefined;
  const folders = scope.folders.map((folder) => ({ ...folder,
    role: linked?.folders.find((entry) => entry.id === folder.id && entry.path === folder.path)?.role ?? folder.role,
  }));
  return { text: [
    WORKSPACE_CONTEXT_PREFIX,
    `Workspace: ${scope.workspaceName}`,
    `Primary directory and sole configuration context: ${scope.primaryDirectory}`,
    'Use absolute paths for non-primary folders. Normal access permission requests still apply. Folder selection grants no permissions.',
    JSON.stringify({ description: linked?.description ?? scope.description, folders }),
  ].join('\n') };
}
