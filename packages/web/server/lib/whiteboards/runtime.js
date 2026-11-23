import path from 'node:path';
import { z } from 'zod';
import { addComment, COMMENT_LIMITS, commentsSchema, deleteComment, replyToComment, setCommentResolved } from './comments.js';
import { applyOps, createBoardId, createElementId, parseElementInput, publicWhiteboard, undoLast, validateBoard, WhiteboardError, whiteboardSchemas } from './model.js';

const historyEntrySchema = z.strictObject({
  revision: z.number().int().positive(),
  before: z.array(z.strictObject({ id: z.string(), before: whiteboardSchemas.elementSchema.nullable(), index: z.number().int().nonnegative(), expectedPresent: z.boolean() })),
});
const lastChangeSchema = z.strictObject({ revision: z.number().int().positive(), actor: z.enum(['user', 'agent']), elementIds: z.array(z.string()), at: z.number().finite() });
const storedBoardSchema = z.strictObject({ id: z.string().regex(/^wb_[A-Za-z0-9_-]{1,64}$/), workspaceId: z.string().min(1), title: z.string().min(1).max(120), revision: z.number().int().positive(), createdAt: z.number().finite(), updatedAt: z.number().finite(), elements: z.array(whiteboardSchemas.elementSchema), lastChange: lastChangeSchema.nullable(), history: z.array(historyEntrySchema).max(30), comments: commentsSchema.optional(), agentRevisions: z.array(z.number().int().positive()).max(200).optional() });
const createInputSchema = z.strictObject({ workspaceId: z.string().min(1), title: z.string().min(1).max(120), elements: z.array(z.unknown()).max(800).optional() });
const missing = (code) => code === 'ENOENT';

// The board revisions the agent made, newest last: which changed elements
// are its work, for the area comment check (comments.js). Element changes
// only; a person's later edit of the same element makes it theirs.
const AGENT_REVISIONS_KEPT = 200;
const byActor = (board, actor) => (actor === 'agent'
  ? { ...board, agentRevisions: [...(board.agentRevisions ?? []), board.revision].slice(-AGENT_REVISIONS_KEPT) }
  : board);

export const createWhiteboardsFileStore = ({ fsPromises, directory, writeFileAtomic }) => {
  const filePath = (boardId) => {
    if (!/^wb_[A-Za-z0-9_-]{1,64}$/.test(boardId)) throw new WhiteboardError('invalid', 'Invalid whiteboard id');
    return path.join(directory, `${boardId}.json`);
  };
  return {
    listIds: async () => {
      try {
        return (await fsPromises.readdir(directory, { withFileTypes: true }))
          .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
          .map(({ name }) => name.slice(0, -5));
      } catch (error) {
        if (missing(error?.code)) return [];
        throw error;
      }
    },
    read: async (boardId) => {
      try {
        const value = JSON.parse(await fsPromises.readFile(filePath(boardId), 'utf8'));
        const parsed = storedBoardSchema.parse(value);
        const board = validateBoard(parsed);
        if (board.history.some(({ revision }) => revision > board.revision)) throw new Error('Malformed whiteboard history');
        if (board.lastChange && board.lastChange.revision > board.revision) throw new Error('Malformed whiteboard last change');
        if (board.id !== boardId) throw new Error('Whiteboard file id mismatch');
        return board;
      } catch (error) {
        if (missing(error?.code)) return null;
        throw error;
      }
    },
    write: async (board) => {
      await fsPromises.mkdir(directory, { recursive: true });
      return writeFileAtomic(filePath(board.id), `${JSON.stringify(board, null, 2)}\n`);
    },
    remove: async (boardId) => {
      try {
        await fsPromises.unlink(filePath(boardId));
      } catch (error) {
        if (!missing(error?.code)) throw error;
      }
    },
  };
};

/** Image ids that added elements name, so each can be checked against the board's own pictures. */
const addedImageIds = (elements) => elements.filter((element) => element?.kind === 'image').map((element) => element.imageId);

export const createWhiteboardsRuntime = ({ store, images = null, readWorkspaces, onChange = () => {} }) => {
  let tail = Promise.resolve();
  const enqueue = (fn) => {
    const next = tail.then(fn);
    tail = next.then(() => undefined, () => undefined);
    return next;
  };
  const workspaces = async () => {
    const result = await readWorkspaces();
    return Array.isArray(result) ? result : [];
  };
  const requireWorkspace = async (workspaceId) => {
    const workspace = (await workspaces()).find((item) => item.id === workspaceId);
    if (!workspace) throw new WhiteboardError('not-found', 'Workspace not found', 404);
    return workspace;
  };
  const readBoard = async (boardId) => {
    const board = await store.read(boardId);
    if (!board) throw new WhiteboardError('not-found', 'Whiteboard not found', 404);
    return board;
  };
  // A board shows only pictures stored for it: an id from another board, or one never uploaded, is refused.
  const requireImages = async (boardId, imageIds) => {
    for (const imageId of imageIds) {
      if (!images || !(await images.has(boardId, imageId))) throw new WhiteboardError('invalid', `Image ${imageId} is not stored for this board`);
    }
  };
  const emit = (board, actor, deleted = false) => onChange({ boardId: board.id, workspaceId: board.workspaceId, revision: board.revision, actor, deleted });
  // Recent comment changes per board, for COMMENT_LIMITS.changesPerMinute. A
  // change is counted only once it is stored on a board that exists, so
  // refused requests and unknown board ids never add to it; boards with no
  // change in the last minute are dropped, so it holds only boards active in
  // the last minute.
  const commentChanges = new Map();
  const changeComments = (boardId, actor, change, now) => enqueue(async () => {
    const board = await readBoard(boardId);
    for (const [id, times] of commentChanges) {
      if (now - times[times.length - 1] >= 60_000) commentChanges.delete(id);
    }
    const recent = (commentChanges.get(boardId) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= COMMENT_LIMITS.changesPerMinute) throw new WhiteboardError('rate-limited', 'Too many comment changes on this board; wait a moment', 429);
    const result = change(board);
    await store.write(result.board); emit(result.board, actor);
    commentChanges.set(boardId, [...recent, now]);
    return { board: publicWhiteboard(result.board), commentId: result.commentId };
  });
  const loggedMalformed = new Set();
  const list = async (workspaceId) => enqueue(async () => {
    if (workspaceId) await requireWorkspace(workspaceId);
    const ids = await store.listIds();
    const boards = [];
    for (const boardId of ids) {
      try {
        const board = await store.read(boardId);
        if (board && (!workspaceId || board.workspaceId === workspaceId)) boards.push(publicWhiteboard(board));
      } catch {
        if (!loggedMalformed.has(boardId)) { loggedMalformed.add(boardId); console.warn(`[whiteboards] Skipping malformed board ${boardId}`); }
      }
    }
    return boards.sort((a, b) => b.updatedAt - a.updatedAt);
  });
  return {
    list,
    read: (boardId) => enqueue(async () => publicWhiteboard(await readBoard(boardId))),
    create: (input, { actor = 'user', now = Date.now() } = {}) => enqueue(async () => {
      const parsed = createInputSchema.safeParse(input);
      if (!parsed.success) throw new WhiteboardError('invalid', 'Invalid whiteboard creation request');
      const creation = parsed.data;
      await requireWorkspace(creation.workspaceId);
      const board = { id: createBoardId(), workspaceId: creation.workspaceId, title: creation.title, revision: 1, createdAt: now, updatedAt: now, elements: [], lastChange: null, history: [] };
      const elements = (creation.elements ?? []).map((raw) => ({ ...parseElementInput(raw), id: raw.id ?? createElementId(), rev: 1 }));
      // A new board has no pictures yet; they are uploaded to it and added afterwards.
      if (addedImageIds(elements).length > 0) throw new WhiteboardError('invalid', 'Add images after the board exists');
      if (new Set(elements.map(({ id: elementId }) => elementId)).size !== elements.length) throw new WhiteboardError('invalid', 'Element id already exists');
      board.elements = elements;
      if (elements.length) board.lastChange = { revision: 1, actor, elementIds: elements.map(({ id: elementId }) => elementId), at: now };
      validateBoard(board);
      const stored = byActor(board, actor);
      await store.write(stored); emit(stored, actor);
      return { board: publicWhiteboard(stored), changedElementIds: stored.lastChange?.elementIds ?? [] };
    }),
    apply: (boardId, input, { actor = 'user', now = Date.now() } = {}) => enqueue(async () => {
      const current = await readBoard(boardId);
      await requireImages(boardId, addedImageIds((Array.isArray(input.ops) ? input.ops : []).map((op) => (op?.op === 'add' ? op.element : null))));
      const applied = applyOps(current, input.ops, { baseRevision: input.baseRevision, actor, confirmReplace: input.confirmReplace, now });
      const stored = byActor(applied.board, actor);
      await store.write(stored); emit(stored, actor);
      return { board: publicWhiteboard(stored), changedElementIds: applied.elementIds };
    }),
    undo: (boardId, { actor = 'user', now = Date.now() } = {}) => enqueue(async () => {
      const result = undoLast(await readBoard(boardId), { now });
      result.board.lastChange.actor = actor;
      const stored = byActor(result.board, actor);
      await store.write(stored); emit(stored, actor);
      return { board: publicWhiteboard(stored), changedElementIds: result.elementIds };
    }),
    /** Stores a picture for a board; the caller adds the element that shows it. */
    saveImage: (boardId, bytes) => enqueue(async () => {
      const board = await readBoard(boardId);
      if (!images) throw new WhiteboardError('unavailable', 'Images are not available on this server', 500);
      // Pictures on the board, or ones undo could bring back, are never pruned as unattached.
      const keep = new Set([
        ...addedImageIds(board.elements),
        ...board.history.flatMap((entry) => addedImageIds(entry.before.map((item) => item.before))),
      ]);
      return images.save(boardId, bytes, keep);
    }),
    findImage: async (boardId, imageId) => (images ? images.find(boardId, imageId) : null),
    rename: (boardId, title, { actor = 'user', now = Date.now() } = {}) => enqueue(async () => {
      const current = await readBoard(boardId);
      const parsed = z.string().min(1).max(120).safeParse(title);
      if (!parsed.success) throw new WhiteboardError('invalid', 'Title must be 1 to 120 characters');
      const board = { ...current, title, revision: current.revision + 1, updatedAt: now, lastChange: { revision: current.revision + 1, actor, elementIds: [], at: now } };
      await store.write(board); emit(board, actor);
      return publicWhiteboard(board);
    }),
    /**
     * Comment changes: add one, reply, resolve or reopen, delete. Each returns
     * the board and the comment it touched; the agent may reply but the user
     * owns the rest of a thread's life.
     */
    comment: (boardId, input, { actor = 'user', now = Date.now() } = {}) => changeComments(boardId, actor, (board) => addComment(board, input, { actor, now }), now),
    reply: (boardId, commentId, input, { actor = 'user', now = Date.now() } = {}) => changeComments(boardId, actor, (board) => replyToComment(board, commentId, input, { actor, now }), now),
    resolveComment: (boardId, commentId, resolved, { actor = 'user', now = Date.now() } = {}) => changeComments(boardId, actor, (board) => setCommentResolved(board, commentId, resolved, { now }), now),
    deleteComment: (boardId, commentId, { actor = 'user', now = Date.now() } = {}) => changeComments(boardId, actor, (board) => deleteComment(board, commentId, { now }), now),
    delete: (boardId, { actor = 'user' } = {}) => enqueue(async () => {
      const board = await readBoard(boardId);
      await store.remove(boardId);
      commentChanges.delete(boardId);
      // Undo never brings a deleted board back, so its pictures go with it.
      await images?.removeBoard(boardId).catch((error) => console.warn(`[whiteboards] Could not remove images of ${boardId}`, error));
      emit({ ...board, revision: board.revision + 1 }, actor, true);
      return { deleted: true };
    }),
  };
};
