import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { WHITEBOARD_IMAGE_MAX_BYTES } from './images.js';
import { commentIdSchema } from './comments.js';
import { createElementId, crowdedArrowLabels, describeCrowdedLabels, WhiteboardError } from './model.js';

const boardId = z.string().regex(/^wb_[A-Za-z0-9_-]{1,64}$/);
const actionInputSchemas = {
  'whiteboard.list': z.strictObject({ action: z.string().optional(), workspaceId: z.string().min(1).optional() }),
  'whiteboard.read': z.strictObject({ action: z.string().optional(), boardId }),
  'whiteboard.create': z.strictObject({ action: z.string().optional(), workspaceId: z.string().min(1).optional(), title: z.string().min(1).max(120), elements: z.array(z.unknown()).max(800).optional() }),
  'whiteboard.apply': z.strictObject({ action: z.string().optional(), boardId, revision: z.number().int().positive().optional(), baseRevision: z.number().int().positive().optional(), ops: z.array(z.unknown()).max(400), confirmReplace: z.boolean().optional() }).refine(({ revision, baseRevision }) => revision !== undefined || baseRevision !== undefined),
  'whiteboard.undo': z.strictObject({ action: z.string().optional(), boardId }),
  'whiteboard.open': z.strictObject({ action: z.string().optional(), boardId }),
  'whiteboard.comment.reply': z.strictObject({ action: z.string().optional(), boardId, commentId: commentIdSchema, text: z.string().min(1).max(4000) }),
  'whiteboard.addImage': z.strictObject({
    action: z.string().optional(),
    boardId,
    path: z.string().min(1).max(4096),
    x: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
    y: z.number().finite().min(-1_000_000).max(1_000_000).optional(),
    w: z.number().finite().min(8).max(20_000).optional(),
    caption: z.string().max(4000).optional(),
  }),
};

const contains = (folderPath, directory) => {
  const root = path.resolve(folderPath);
  const target = path.resolve(directory);
  return target === root || target.startsWith(`${root}${path.sep}`);
};

const DEFAULT_IMAGE_SIDE = 480;

export const createWhiteboardAgentActions = ({ runtime, readWorkspaces, broadcast, fsPromises, isEnabled = async () => true }) => {
  /**
   * The picture file an agent names, read only when it sits inside the folders
   * of the board's workspace or the calling session's folder. Links are
   * followed before the check, so a link cannot lead outside them.
   */
  const readWorkspaceImage = async (board, requested, directory) => {
    const workspace = (await readWorkspaces()).find(({ id }) => id === board.workspaceId);
    const roots = [...(workspace?.folders ?? []), ...(directory ? [directory] : [])];
    const resolveReal = async (target) => fsPromises.realpath(target).catch(() => null);
    const realRoots = (await Promise.all(roots.map((root) => resolveReal(path.resolve(root))))).filter(Boolean);
    const target = await resolveReal(path.resolve(directory || roots[0] || '/', requested));
    if (!target) throw new WhiteboardError('not-found', `File not found: ${requested}`, 404);
    if (!realRoots.some((root) => contains(root, target))) {
      throw new WhiteboardError('invalid', 'The picture must be a file inside the workspace folders or this session\'s folder', 400);
    }
    const tooLarge = () => new WhiteboardError('invalid', 'Use a PNG, JPEG, GIF or WebP picture up to 10 MB', 400);
    // The check above names a path; what is read is the file actually opened.
    // A link swapped in between them is not followed at the last step
    // (O_NOFOLLOW), and the opened file itself is checked against the roots.
    const handle = await fsPromises.open(target, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0)).catch(() => {
      throw new WhiteboardError('invalid', 'The picture must be a file inside the workspace folders or this session\'s folder', 400);
    });
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || opened.size > WHITEBOARD_IMAGE_MAX_BYTES) throw tooLarge();
      // Linux names the opened file exactly; elsewhere the path is resolved
      // again and must still lead to the same file.
      const openedPath = await fsPromises.readlink(`/proc/self/fd/${handle.fd}`).catch(() => null);
      const confirmedPath = openedPath ?? await resolveReal(target);
      const outside = () => new WhiteboardError('invalid', 'The picture must be a file inside the workspace folders or this session\'s folder', 400);
      if (!confirmedPath || !realRoots.some((root) => contains(root, confirmedPath))) throw outside();
      if (!openedPath) {
        const again = await fsPromises.stat(confirmedPath);
        if (again.dev !== opened.dev || again.ino !== opened.ino) throw outside();
      }
      const bytes = await handle.readFile();
      if (bytes.length > WHITEBOARD_IMAGE_MAX_BYTES) throw tooLarge();
      return bytes;
    } finally {
      await handle.close();
    }
  };

  const resolveWorkspace = async (workspaceId, directory) => {
    const workspaces = await readWorkspaces();
    if (workspaceId) {
      const workspace = workspaces.find(({ id }) => id === workspaceId);
      if (!workspace) throw new WhiteboardError('not-found', 'Workspace not found', 404);
      return { workspace, workspaces };
    }
    const matches = directory ? workspaces.filter(({ folders = [] }) => folders.some((folder) => contains(folder, directory))) : [];
    return { workspace: matches.length === 1 ? matches[0] : null, workspaces, matches };
  };
  const usageWorkspaceError = (workspaces) => {
    const choices = workspaces.map(({ id, name }) => `${id} (${name})`).join(', ') || 'none';
    const error = new WhiteboardError('invalid', `workspaceId is required. Candidate workspaces: ${choices}`, 400);
    error.statusCode = 400;
    return error;
  };
  const withStatusCode = (error) => {
    if (error instanceof WhiteboardError) error.statusCode = error.status;
    return error;
  };
  // After the agent writes, labelled arrows it left without room are named, so it can space the boxes.
  const withLayoutCheck = (result) => {
    const crowded = crowdedArrowLabels(result.board.elements, result.changedElementIds);
    return crowded.length > 0
      ? { board: result.board, changedElementIds: result.changedElementIds, layoutWarnings: describeCrowdedLabels(crowded) }
      : { board: result.board, changedElementIds: result.changedElementIds };
  };
  const execute = async (action, input = {}, { directory, sessionId } = {}) => {
    try {
      // A tool left over from before Whiteboards were turned off in Settings still gets nothing.
      if (!(await isEnabled().catch(() => false))) throw new WhiteboardError('disabled', 'Whiteboards are turned off in Settings', 404);
      const schema = actionInputSchemas[action];
      if (!schema) throw new WhiteboardError('invalid', `Unsupported whiteboard action: ${action}`);
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        // The model reads this message: name the fields so it can correct the call.
        const details = parsed.error.issues.map((issue) => `${issue.path.join('.') || 'input'}: ${issue.message}`).join('; ');
        throw new WhiteboardError('invalid', `Invalid ${action} input: ${details}`);
      }
      const params = { ...parsed.data };
      delete params.action;
      if (action === 'whiteboard.list') {
        const resolved = await resolveWorkspace(params.workspaceId, directory);
        const workspaces = resolved.workspace ? [resolved.workspace] : resolved.workspaces;
        const boards = (await Promise.all(workspaces.map(async (workspace) => (await runtime.list(workspace.id)).map((board) => ({ ...board, workspaceName: workspace.name }))))).flat();
        return { boards: boards.sort((a, b) => b.updatedAt - a.updatedAt).map(({ id, title, workspaceId, workspaceName, revision, elements, updatedAt }) => ({ id, title, workspaceId, workspaceName, revision, elementCount: elements.length, updatedAt })) };
      }
      if (action === 'whiteboard.create') {
        const resolved = await resolveWorkspace(params.workspaceId, directory);
        if (!resolved.workspace) throw usageWorkspaceError(resolved.matches?.length ? resolved.matches : resolved.workspaces);
        const result = await runtime.create({ ...params, workspaceId: resolved.workspace.id }, { actor: 'agent' });
        return withLayoutCheck(result);
      }
      if (action === 'whiteboard.read') {
        const board = await runtime.read(params.boardId);
        return { board: { id: board.id, title: board.title, workspaceId: board.workspaceId, revision: board.revision, elements: board.elements, lastChange: board.lastChange, canUndo: board.canUndo } };
      }
      if (action === 'whiteboard.apply') {
        const result = await runtime.apply(params.boardId, { ...params, baseRevision: params.revision ?? params.baseRevision }, { actor: 'agent' });
        return withLayoutCheck(result);
      }
      if (action === 'whiteboard.undo') {
        const result = await runtime.undo(params.boardId, { actor: 'agent' });
        return { board: result.board, changedElementIds: result.changedElementIds };
      }
      if (action === 'whiteboard.addImage') {
        const board = await runtime.read(params.boardId);
        const image = await runtime.saveImage(board.id, await readWorkspaceImage(board, params.path, directory));
        // Without a width the picture fits in DEFAULT_IMAGE_SIDE on both sides, keeping its proportions.
        const w = params.w ?? Math.max(8, Math.round(image.width * Math.min(1, DEFAULT_IMAGE_SIDE / image.width, DEFAULT_IMAGE_SIDE / image.height)));
        const h = Math.max(8, Math.round(w * (image.height / image.width)));
        // Without a position the picture goes to the right of everything on the board.
        const boxes = board.elements.filter((element) => element.kind !== 'arrow');
        const right = boxes.length > 0 ? Math.max(...boxes.map((element) => element.x + element.w)) + 80 : 0;
        const top = boxes.length > 0 ? Math.min(...boxes.map((element) => element.y)) : 0;
        const element = { id: createElementId(), kind: 'image', x: params.x ?? right, y: params.y ?? top, w, h, imageId: image.imageId, text: params.caption ?? '' };
        const result = await runtime.apply(board.id, { baseRevision: board.revision, ops: [{ op: 'add', element }] }, { actor: 'agent' });
        return { board: result.board, changedElementIds: result.changedElementIds, imageId: image.imageId };
      }
      if (action === 'whiteboard.comment.reply') {
        // The agent answers in the thread of the comment that asked it, as the agent.
        const result = await runtime.reply(params.boardId, params.commentId, { text: params.text }, { actor: 'agent' });
        return { replied: true, commentId: result.commentId, revision: result.board.revision };
      }
      if (action === 'whiteboard.open') {
        const board = await runtime.read(params.boardId);
        broadcast({ type: 'openchamber:whiteboard-open', properties: { boardId: board.id, workspaceId: board.workspaceId, sessionID: sessionId } });
        return { opened: true };
      }
      throw new WhiteboardError('invalid', `Unsupported whiteboard action: ${action}`);
    } catch (error) { throw withStatusCode(error); }
  };
  return { execute };
};
