import { resolveEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { useUIStore } from '@/stores/useUIStore';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';
import type { Whiteboard } from './model';

/**
 * Opens a board as a tab of the side panel next to the chat on screen. Without
 * a chat folder on screen the panel of the board's workspace folder is used.
 */
export function openBoardBesideChat(board: Pick<Whiteboard, 'id' | 'title' | 'workspaceId'>, directory?: string | null): boolean {
  const workspace = useWorkspacesStore.getState().catalog.workspaces.find((entry) => entry.id === board.workspaceId);
  const target = directory || resolveEffectiveDirectory() || workspace?.folders[0]?.path;
  if (!target) return false;
  useUIStore.getState().openContextPanelTab(target, {
    mode: 'whiteboard',
    targetPath: board.id,
    dedupeKey: board.id,
    label: board.title,
  });
  return true;
}
