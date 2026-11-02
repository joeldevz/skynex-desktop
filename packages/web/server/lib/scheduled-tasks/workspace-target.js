import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { OpenChamberControlError } from '../openchamber-control/error.js';

const targetSchema = z.object({
  kind: z.literal('workspace'),
  workspaceId: z.string().refine((value) => value.trim().length > 0),
  folderId: z.string().refine((value) => value.trim().length > 0).optional(),
}).strict();

const catalogSchema = z.object({
  version: z.literal(1),
  workspaces: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string().optional(),
    folders: z.array(z.unknown()),
  }).passthrough()),
}).passthrough();
const workspaceFolderSchema = z.object({
  id: z.string(),
  path: z.string(),
  role: z.string().optional().catch(''),
}).passthrough();

export const resolveScheduledWorkspaceTarget = async (target, settings) => {
  const parsedTarget = targetSchema.safeParse(target);
  if (!parsedTarget.success) {
    throw new OpenChamberControlError('Scheduled task target is invalid', 400);
  }
  const catalogResult = catalogSchema.safeParse(settings?.workspaceCatalog);
  if (!catalogResult.success) {
    throw new OpenChamberControlError('Workspace catalog is unavailable; choose a valid target', 409);
  }
  const targetValue = parsedTarget.data;
  const catalog = catalogResult.data;
  const workspace = catalog.workspaces.find((entry) => entry.id === targetValue.workspaceId);
  if (!workspace || !Array.isArray(workspace.folders) || workspace.folders.length === 0) {
    throw new OpenChamberControlError('Workspace was deleted or has no linked folders; retarget this task', 409);
  }
  const selected = targetValue.folderId === undefined
    ? workspace.folders
    : workspace.folders.filter((folder) => folder.id === targetValue.folderId);
  if (selected.length === 0 || (targetValue.folderId !== undefined && selected.length !== 1)) {
    throw new OpenChamberControlError('Selected workspace folder is no longer linked; retarget this task', 409);
  }
  const folders = [];
  for (const candidate of selected) {
    const parsedFolder = workspaceFolderSchema.safeParse(candidate);
    if (!parsedFolder.success || !path.isAbsolute(parsedFolder.data.path)) {
      throw new OpenChamberControlError('Workspace target is malformed; retarget this task', 409);
    }
    const folder = parsedFolder.data;
    try {
      if (!(await fs.stat(folder.path)).isDirectory()) throw new Error('not a directory');
    } catch {
      throw new OpenChamberControlError(`Workspace folder is unavailable: ${folder.path}`, 409);
    }
    folders.push({ id: folder.id, path: path.resolve(folder.path), role: folder.role ?? '' });
  }
  return {
    version: 1,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
    description: workspace.description,
    primaryDirectory: folders[0].path,
    folders,
  };
};
