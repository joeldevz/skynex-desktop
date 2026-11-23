import type { Whiteboard } from './model';
import { useUIStore } from '@/stores/useUIStore';
import { openBoardBesideChat } from './panel';

type BoardRef = Pick<Whiteboard, 'id' | 'title' | 'workspaceId'>;
type Opener = (board: BoardRef) => void;

let opener: Opener | null = null;

/**
 * Where a board opens when something outside the board asks for it (a
 * message that came from it, the agent showing it). Desktop opens it beside
 * the chat; the phone app registers its fullscreen page instead, since a
 * phone has no panel beside the chat. Returns the unregister function.
 */
export function setWhiteboardOpener(next: Opener): () => void {
  opener = next;
  return () => {
    if (opener === next) opener = null;
  };
}

export function openWhiteboard(board: BoardRef): void {
  // Whiteboards are a beta: nothing opens a board while they are off in Settings.
  if (!useUIStore.getState().whiteboardsEnabled) return;
  if (opener) opener(board);
  else openBoardBesideChat(board);
}
