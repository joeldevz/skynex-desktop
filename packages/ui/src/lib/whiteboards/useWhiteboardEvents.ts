import React from 'react';

import { subscribeOpenchamberEvents } from '@/lib/openchamberEvents';
import { useUIStore } from '@/stores/useUIStore';
import { useWhiteboardsStore } from '@/stores/useWhiteboardsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { openWhiteboard } from './opener';

/**
 * Keeps boards on screen current when another client or the agent changes
 * them, and opens a board (beside the chat, or as the phone's page) when the
 * agent of the chat on screen asks to show it. A request from a chat in the background waits: the
 * user is looking at something else.
 */
export function useWhiteboardEvents(): void {
  React.useEffect(() => subscribeOpenchamberEvents((event) => {
    // Whiteboards are a beta: while off in Settings, their events change nothing on screen.
    if (!useUIStore.getState().whiteboardsEnabled) return;
    if (event.type === 'whiteboard-changed') {
      useWhiteboardsStore.getState().noteRemoteChange(event);
      return;
    }
    if (event.type !== 'whiteboard-open') return;
    const currentSessionId = useSessionUIStore.getState().currentSessionId;
    if (event.sessionID && event.sessionID !== currentSessionId) return;
    void useWhiteboardsStore.getState().loadBoard(event.boardId).then((board) => {
      if (board) openWhiteboard(board);
    });
  }), []);
}
