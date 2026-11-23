import { normalizePath } from '@/lib/pathNormalization';
import type { Workspace } from '@/lib/workspaces/model';

const contains = (folder: string, directory: string): boolean => (
  directory === folder || directory.startsWith(folder.endsWith('/') ? folder : `${folder}/`)
);

/**
 * The workspaces a folder belongs to: those with a folder that is it or
 * contains it. The same rule the agent tool applies to a session's directory,
 * so the panel offers the boards the agent would pick.
 */
export const workspacesForDirectory = (workspaces: readonly Workspace[], directory: string | null): Workspace[] => {
  const target = directory ? normalizePath(directory) : '';
  if (!target) return [];
  return workspaces.filter((workspace) => workspace.folders.some((folder) => {
    const path = normalizePath(folder.path);
    return path ? contains(path, target) : false;
  }));
};
