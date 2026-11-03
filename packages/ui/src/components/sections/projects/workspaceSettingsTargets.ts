import React from 'react';
import type { WorkspaceCatalog } from '@/lib/workspaces/model';
import { getChatsRoot, getChatsRootFromDirectory, subscribeChatsRoot, warmChatsRootDirectory } from '@/lib/chatDirectories';
import { normalizePath } from '@/lib/pathNormalization';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';

export type WorkspaceSettingsTarget =
  | { kind: 'workspace'; workspaceId: string }
  | { kind: 'folder'; workspaceId: string; folderId: string }
  | { kind: 'chats' };

/** The catalog without managed chat folders; until the server names the chats root nothing is hidden. */
export const visibleWorkspaceCatalog = (catalog: WorkspaceCatalog, chatsRoot: string | null = getChatsRoot()): WorkspaceCatalog => chatsRoot === null ? catalog : ({
  ...catalog,
  workspaces: catalog.workspaces.flatMap((workspace) => {
    const folders = workspace.folders.filter((folder) => getChatsRootFromDirectory(folder.path) === null);
    return folders.length > 0 || workspace.folders.length === 0 ? [{ ...workspace, folders }] : [];
  }),
});

/**
 * The catalog as Settings lists it. The chats root of a runtime can resolve
 * after Settings opens, so the result follows it and hides chat folders then.
 */
export const useVisibleWorkspaceCatalog = (): WorkspaceCatalog => {
  const catalog = useWorkspacesStore((state) => state.catalog);
  const [chatsRoot, setChatsRoot] = React.useState(getChatsRoot);
  React.useEffect(() => {
    const unsubscribe = subscribeChatsRoot(() => setChatsRoot(getChatsRoot()));
    void warmChatsRootDirectory().catch(() => {});
    return unsubscribe;
  }, []);
  return React.useMemo(() => visibleWorkspaceCatalog(catalog, chatsRoot), [catalog, chatsRoot]);
};

/** The folder the last selected project points at, else the first workspace, else Chats. */
export const resolveInitialWorkspaceTarget = (
  catalog: WorkspaceCatalog,
  projectPath: string | null,
): WorkspaceSettingsTarget => {
  const visibleCatalog = visibleWorkspaceCatalog(catalog);
  if (projectPath) {
    const normalized = normalizePath(projectPath);
    const match = visibleCatalog.workspaces.flatMap((workspace) => workspace.folders.map((folder) => ({ workspace, folder })))
      .find(({ folder }) => normalizePath(folder.path) === normalized);
    if (match) return { kind: 'folder', workspaceId: match.workspace.id, folderId: match.folder.id };
  }
  const first = visibleCatalog.workspaces[0];
  return first ? { kind: 'workspace', workspaceId: first.id } : { kind: 'chats' };
};
