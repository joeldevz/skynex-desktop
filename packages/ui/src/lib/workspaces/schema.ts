import { z } from 'zod';
import { normalizePath } from '../pathNormalization';
import type { ParseResult, Workspace, WorkspaceCatalog, WorkspacePatch } from './model';

export const absoluteDirectorySchema = z.string().transform((value) => normalizePath(value) ?? '')
  .refine((value) => value === '/' || /^(?:\/(?!\/)|\/\/[^/]+\/[^/]+|[A-Z]:\/)/u.test(value), 'Expected an absolute directory');
const identity = z.string().min(1);
const workspaceFolderSchema = z.object({ id: identity, path: absoluteDirectorySchema, role: z.string() });
export const workspaceFoldersSchema = z.array(workspaceFolderSchema).refine(
  (folders) => new Set(folders.map((folder) => folder.id)).size === folders.length, 'Duplicate folder ID',
);
const workspaceDefaultsSchema = z.object({
  agent: identity.optional(),
  model: z.object({ providerID: identity, id: identity, variant: z.string().nullable().optional() }).optional(),
});
const workspaceSchema = z.object({
  id: identity, name: identity, description: z.string(), folders: workspaceFoldersSchema, defaults: workspaceDefaultsSchema,
});
export const workspaceCatalogSchema = z.object({ version: z.literal(1), workspaces: z.array(workspaceSchema) })
  .refine((catalog) => new Set(catalog.workspaces.map((workspace) => workspace.id)).size === catalog.workspaces.length, 'Duplicate workspace ID');

export function parseWorkspaceCatalog(json: string | null): ParseResult<WorkspaceCatalog> {
  if (json === null) return { kind: 'missing' };
  try {
    const result = workspaceCatalogSchema.safeParse(JSON.parse(json));
    return result.success ? { kind: 'valid', value: result.data } : { kind: 'invalid', reason: result.error.message };
  } catch {
    return { kind: 'invalid', reason: 'Malformed workspace catalog' };
  }
}

export function putWorkspace(catalog: WorkspaceCatalog, workspace: Workspace): WorkspaceCatalog {
  const parsed = workspaceSchema.parse(workspace);
  const exists = catalog.workspaces.some((entry) => entry.id === parsed.id);
  return { version: 1, workspaces: exists ? catalog.workspaces.map((entry) => entry.id === parsed.id ? parsed : entry) : [...catalog.workspaces, parsed] };
}

export function patchWorkspace(catalog: WorkspaceCatalog, id: string, patch: WorkspacePatch): WorkspaceCatalog {
  const workspace = catalog.workspaces.find((entry) => entry.id === id);
  if (!workspace) throw new Error('Unknown workspace');
  return putWorkspace(catalog, { ...workspace, ...patch, id });
}

export function unlinkWorkspaceFolder(catalog: WorkspaceCatalog, workspaceId: string, folderId: string): WorkspaceCatalog {
  const workspace = catalog.workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace) throw new Error('Unknown workspace');
  if (!workspace.folders.some((folder) => folder.id === folderId)) return catalog;
  return patchWorkspace(catalog, workspaceId, { folders: workspace.folders.filter((folder) => folder.id !== folderId) });
}

export function removeWorkspace(catalog: WorkspaceCatalog, id: string): WorkspaceCatalog {
  if (!catalog.workspaces.some((workspace) => workspace.id === id)) return catalog;
  return { version: 1, workspaces: catalog.workspaces.filter((workspace) => workspace.id !== id) };
}
