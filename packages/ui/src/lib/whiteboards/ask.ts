import { captureDefaultSendSelection } from '@/lib/defaultSendSelection';
import { useInputStore } from '@/sync/input-store';
import { abortCurrentOperation } from '@/sync/session-actions';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { createContextPart, whiteboardCommentInstruction } from '@/lib/messages/contextParts';
import { commentArea } from './comments';
import { describeSelectionForAgent, type Whiteboard } from './model';

/**
 * Where a request made from a board went: straight to the chat on screen, or
 * into a new chat of the board's workspace for the user to send, when no chat
 * was open.
 */
export type WhiteboardAskOutcome =
  | { kind: 'sent'; sessionId: string }
  | { kind: 'drafted' }
  | { kind: 'failed' };

/**
 * Sends a request about a board to the chat the user is in, with the board and
 * the selected elements as context the agent reads, so it can change exactly
 * those elements with its whiteboard tool.
 */
export async function askAgentAboutBoard(board: Whiteboard, text: string, selectedIds: readonly string[], commentId?: string): Promise<WhiteboardAskOutcome> {
  // The agent reads the board and the selection; the message shows the board
  // it came from, with a button back to it (UserContextPart).
  const byId = new Map(board.elements.map((element) => [element.id, element]));
  const selected = selectedIds.flatMap((id) => {
    const element = byId.get(id);
    return element ? [{ id, kind: element.kind, text: element.text.trim().replace(/\s+/g, ' ').slice(0, 160) }] : [];
  });
  const part = createContextPart(
    commentId
      ? { kind: 'whiteboard', boardId: board.id, workspaceId: board.workspaceId, title: board.title, selected, commentId }
      : { kind: 'whiteboard', boardId: board.id, workspaceId: board.workspaceId, title: board.title, selected },
    commentId ? `${describeSelectionForAgent(board, selectedIds)}\n${whiteboardCommentInstruction(commentId, commentAreaOf(board, commentId))}` : describeSelectionForAgent(board, selectedIds),
  );
  const context = { text: part.text, metadata: part.metadata, synthetic: true };
  const sessionState = useSessionUIStore.getState();
  const sessionId = sessionState.currentSessionId;
  if (!sessionId) {
    try {
      sessionState.openWorkspaceDraft(board.workspaceId, { kind: 'workspace' });
    } catch {
      return { kind: 'failed' };
    }
    const input = useInputStore.getState();
    input.setPendingSyntheticParts([context]);
    input.setPendingInputText(text, 'replace');
    return { kind: 'drafted' };
  }
  const selection = captureDefaultSendSelection();
  if (!selection) return { kind: 'failed' };
  try {
    await sessionState.sendMessage(
      text,
      selection.providerID,
      selection.modelID,
      selection.agentName,
      undefined,
      undefined,
      [context],
      selection.variant,
      undefined,
      { sessionId, userInitiated: true },
    );
    return { kind: 'sent', sessionId };
  } catch {
    return { kind: 'failed' };
  }
}

const commentAreaOf = (board: Whiteboard, commentId: string) => {
  const comment = board.comments.find((item) => item.id === commentId);
  return comment ? commentArea(comment) ?? undefined : undefined;
};

/** Stops the turn a request from a board started. */
export async function stopAgentOnBoard(sessionId: string): Promise<void> {
  await abortCurrentOperation(sessionId);
}
