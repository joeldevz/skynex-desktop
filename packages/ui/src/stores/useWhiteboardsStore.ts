import { create } from 'zustand';

import { getRuntimeKey, subscribeRuntimeEndpointChanged } from '@/lib/runtime-switch';
import {
  addWhiteboardComment,
  applyWhiteboardOps,
  createWhiteboard,
  deleteWhiteboardComment,
  replyToWhiteboardComment,
  resolveWhiteboardComment,
  deleteWhiteboard,
  listWhiteboards,
  readWhiteboard,
  renameWhiteboard,
  undoWhiteboard,
  WhiteboardRequestError,
  type WhiteboardChangeResult,
} from '@/lib/whiteboards/api';
import { elementFromInput, patchElement, type CommentAnchor, type ElementInput, type Whiteboard, type WhiteboardElement, type WhiteboardOp } from '@/lib/whiteboards/model';

type WhiteboardListStatus = 'idle' | 'loading' | 'ready' | 'failed';

/** What a change came to, as the board view needs it. */
export type WhiteboardChangeOutcome = WhiteboardChangeResult['kind'] | 'failed';

type WhiteboardsState = {
  /** Each board as shown: the server's board with this client's unconfirmed changes on top. */
  boards: Record<string, Whiteboard>;
  /** Ids of every board, newest first, once the list was read. */
  listIds: string[];
  listStatus: WhiteboardListStatus;
  /** Boards whose last read failed, so a view says so instead of waiting. */
  failedBoardIds: Record<string, true>;
  /** The board open on the Whiteboards page; null shows the gallery. */
  pageBoardId: string | null;
  /** The workspace the gallery shows; null shows every workspace. */
  pageWorkspaceId: string | null;

  loadList(): Promise<void>;
  loadBoard(boardId: string): Promise<Whiteboard | null>;
  createBoard(workspaceId: string, title: string, elements?: ElementInput[]): Promise<Whiteboard>;
  applyOps(boardId: string, ops: WhiteboardOp[], options?: { confirmReplace?: boolean }): Promise<WhiteboardChangeOutcome>;
  undo(boardId: string): Promise<WhiteboardChangeOutcome>;
  rename(boardId: string, title: string): Promise<boolean>;
  remove(boardId: string): Promise<boolean>;
  /** Adds a comment; resolves to its id, or null when the server refused it. */
  addComment(boardId: string, anchor: CommentAnchor, text: string, sent: boolean): Promise<string | null>;
  replyToComment(boardId: string, commentId: string, text: string, sent: boolean): Promise<boolean>;
  resolveComment(boardId: string, commentId: string, resolved: boolean): Promise<boolean>;
  deleteComment(boardId: string, commentId: string): Promise<boolean>;
  /** A comment thread something outside the board asked to show ("View thread" in the chat); the board opens it once. */
  focusedComment: { boardId: string; commentId: string } | null;
  focusComment(target: { boardId: string; commentId: string } | null): void;
  /** Another client or the agent changed a board. */
  noteRemoteChange(change: { boardId: string; revision: number; deleted: boolean }): void;
  setPageBoard(boardId: string | null): void;
  setPageWorkspace(workspaceId: string | null): void;
  reset(): void;
};

const initialState = {
  boards: {},
  listIds: [],
  listStatus: 'idle',
  failedBoardIds: {},
  pageBoardId: null,
  pageWorkspaceId: null,
  focusedComment: null,
} satisfies Partial<WhiteboardsState>;

/**
 * The same operations the server applies, so a drag or an edit shows at once.
 * Adds carry their id from the client, which the server keeps.
 */
export const applyOpsLocally = (board: Whiteboard, ops: readonly WhiteboardOp[]): Whiteboard => {
  let elements: WhiteboardElement[] = [...board.elements];
  for (const op of ops) {
    if (op.op === 'add') {
      if (op.element.id) elements.push(elementFromInput(op.element, op.element.id, board.revision + 1));
    } else if (op.op === 'update') {
      elements = elements.map((element) => (element.id === op.id ? patchElement(element, op.set) : element));
    } else {
      elements = elements.filter((element) => element.id !== op.id
        && !(element.kind === 'arrow' && (element.from === op.id || element.to === op.id)));
    }
  }
  return { ...board, elements };
};

// The server's last word on each board, and the changes sent after it that it
// has not answered yet. A change waits for the one before it, so each is sent
// against the revision the previous one produced and never conflicts with
// this client's own edits.
const confirmed = new Map<string, Whiteboard>();
const pending = new Map<string, WhiteboardOp[][]>();
const queues = new Map<string, Promise<unknown>>();
let listRequest = 0;
let generation = 0;

export const useWhiteboardsStore = create<WhiteboardsState>()((set, get) => {
  const show = (boardId: string) => {
    const base = confirmed.get(boardId);
    if (!base) return;
    const board = (pending.get(boardId) ?? []).reduce(applyOpsLocally, base);
    set((state) => {
      const { [boardId]: _failed, ...failedBoardIds } = state.failedBoardIds;
      return {
        boards: { ...state.boards, [boardId]: board },
        listIds: state.listIds.includes(boardId) ? state.listIds : [boardId, ...state.listIds],
        failedBoardIds,
      };
    });
  };
  const confirm = (board: Whiteboard) => {
    const known = confirmed.get(board.id);
    // An answer older than one already shown would undo a newer change.
    if (known && known.revision > board.revision) return;
    confirmed.set(board.id, board);
    show(board.id);
  };
  const forget = (boardId: string) => {
    confirmed.delete(boardId);
    pending.delete(boardId);
    set((state) => {
      const { [boardId]: _removed, ...boards } = state.boards;
      return {
        boards,
        listIds: state.listIds.filter((id) => id !== boardId),
        pageBoardId: state.pageBoardId === boardId ? null : state.pageBoardId,
      };
    });
  };
  const enqueue = <T>(boardId: string, run: () => Promise<T>): Promise<T> => {
    const next = (queues.get(boardId) ?? Promise.resolve()).then(run, run);
    queues.set(boardId, next.catch(() => undefined));
    return next;
  };

  // Comment changes wait their turn behind the board's element changes, and show once the server has them.
  const changeComment = (boardId: string, run: () => Promise<{ board: Whiteboard }>): Promise<boolean> => {
    const started = generation;
    return enqueue(boardId, async () => {
      const result = await run().catch(() => null);
      if (started !== generation || !result) return false;
      confirm(result.board);
      return true;
    });
  };

  return {
    ...initialState,

    loadList: async () => {
      const request = ++listRequest;
      const runtimeKey = getRuntimeKey();
      set((state) => ({ listStatus: state.listStatus === 'ready' ? 'ready' : 'loading' }));
      try {
        const boards = await listWhiteboards();
        if (request !== listRequest || getRuntimeKey() !== runtimeKey) return;
        for (const board of boards) confirm(board);
        set({ listIds: boards.map((board) => board.id), listStatus: 'ready' });
      } catch {
        if (request !== listRequest || getRuntimeKey() !== runtimeKey) return;
        // A failed read keeps the boards already shown; it never empties the list.
        set((state) => ({ listStatus: state.listStatus === 'ready' ? 'ready' : 'failed' }));
      }
    },

    loadBoard: async (boardId) => {
      const started = generation;
      try {
        const board = await readWhiteboard(boardId);
        if (started !== generation) return null;
        confirm(board);
        return get().boards[boardId] ?? null;
      } catch (error) {
        if (started !== generation) return null;
        if (error instanceof WhiteboardRequestError && error.status === 404) forget(boardId);
        set((state) => ({ failedBoardIds: { ...state.failedBoardIds, [boardId]: true } }));
        return null;
      }
    },

    createBoard: async (workspaceId, title, elements) => {
      const board = await createWhiteboard(workspaceId, title, elements);
      confirm(board);
      return board;
    },

    applyOps: (boardId, ops, options = {}) => {
      if (!confirmed.has(boardId) || ops.length === 0) return Promise.resolve('failed');
      const started = generation;
      const batch = [...ops];
      pending.set(boardId, [...(pending.get(boardId) ?? []), batch]);
      show(boardId);
      return enqueue(boardId, async (): Promise<WhiteboardChangeOutcome> => {
        const base = confirmed.get(boardId);
        const result = base
          ? await applyWhiteboardOps(boardId, base.revision, batch, options.confirmReplace === true).catch(() => null)
          : null;
        if (started !== generation) return 'failed';
        pending.set(boardId, (pending.get(boardId) ?? []).filter((entry) => entry !== batch));
        // A refused or failed change is dropped: the board shows what the server holds.
        if (result) confirm(result.board);
        else show(boardId);
        return result ? result.kind : 'failed';
      });
    },

    undo: (boardId) => {
      const started = generation;
      return enqueue(boardId, async (): Promise<WhiteboardChangeOutcome> => {
        const result = await undoWhiteboard(boardId).catch(() => null);
        if (started !== generation || !result) return 'failed';
        confirm(result.board);
        return result.kind;
      });
    },

    rename: async (boardId, title) => {
      const started = generation;
      try {
        const board = await renameWhiteboard(boardId, title);
        if (started === generation) confirm(board);
        return true;
      } catch {
        return false;
      }
    },

    remove: async (boardId) => {
      const started = generation;
      try {
        await deleteWhiteboard(boardId);
        if (started === generation) forget(boardId);
        return true;
      } catch {
        return false;
      }
    },

    addComment: (boardId, anchor, text, sent) => {
      const started = generation;
      return enqueue(boardId, async () => {
        const result = await addWhiteboardComment(boardId, anchor, text, sent).catch(() => null);
        if (started !== generation || !result) return null;
        confirm(result.board);
        return result.commentId;
      });
    },

    replyToComment: (boardId, commentId, text, sent) => changeComment(boardId, () => replyToWhiteboardComment(boardId, commentId, text, sent)),
    resolveComment: (boardId, commentId, resolved) => changeComment(boardId, () => resolveWhiteboardComment(boardId, commentId, resolved)),
    deleteComment: (boardId, commentId) => changeComment(boardId, () => deleteWhiteboardComment(boardId, commentId)),
    focusComment: (target) => set({ focusedComment: target }),

    noteRemoteChange: ({ boardId, revision, deleted }) => {
      if (deleted) {
        forget(boardId);
        return;
      }
      const known = confirmed.get(boardId);
      if (known && known.revision >= revision) return;
      if (known || get().listStatus === 'ready') void get().loadBoard(boardId);
    },

    setPageBoard: (boardId) => set({ pageBoardId: boardId }),
    setPageWorkspace: (workspaceId) => set({ pageWorkspaceId: workspaceId }),
    reset: () => {
      generation += 1;
      listRequest += 1;
      confirmed.clear();
      pending.clear();
      queues.clear();
      set({ ...initialState });
    },
  };
});

// Boards belong to the server they came from; another server has other boards.
subscribeRuntimeEndpointChanged(() => useWhiteboardsStore.getState().reset());
