import { z } from 'zod';

import { runtimeFetch } from '@/lib/runtime-fetch';
import { whiteboardSchema, type CommentAnchor, type ElementInput, type Whiteboard, type WhiteboardOp } from './model';

const ROUTE = '/api/openchamber/whiteboards';

const errorSchema = z.object({
  error: z.string().optional(),
  code: z.string().optional(),
  board: whiteboardSchema.optional(),
}).catch({});

/** A change the server refused because the board moved on, with the board as it is now. */
export type WhiteboardChangeResult =
  | { kind: 'saved'; board: Whiteboard }
  | { kind: 'conflict'; board: Whiteboard }
  | { kind: 'needs-confirmation'; board: Whiteboard };

export class WhiteboardRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
  }
}

/** One request of the whiteboards route, as the server's contract names it. */
type WhiteboardRequest =
  | { operation: 'list'; workspaceId?: string }
  | { operation: 'read'; boardId: string }
  | { operation: 'create'; workspaceId: string; title: string; elements?: ElementInput[] }
  | { operation: 'apply'; boardId: string; baseRevision: number; ops: WhiteboardOp[]; confirmReplace?: true }
  | { operation: 'undo'; boardId: string }
  | { operation: 'rename'; boardId: string; title: string }
  | { operation: 'delete'; boardId: string }
  | { operation: 'comment'; boardId: string; comment: { anchor: CommentAnchor; text: string; sent: boolean } }
  | { operation: 'reply'; boardId: string; commentId: string; reply: { text: string; sent: boolean } }
  | { operation: 'resolveComment'; boardId: string; commentId: string; resolved: boolean }
  | { operation: 'deleteComment'; boardId: string; commentId: string };

const post = async (body: WhiteboardRequest): Promise<Response> => runtimeFetch(ROUTE, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const failure = async (response: Response): Promise<{ error: WhiteboardRequestError; board: Whiteboard | null }> => {
  const payload = errorSchema.parse(await response.json().catch(() => null));
  return {
    error: new WhiteboardRequestError(payload.error || `Whiteboard request failed (${response.status})`, payload.code ?? 'unavailable', response.status),
    board: payload.board ?? null,
  };
};

const readBoard = async (response: Response): Promise<Whiteboard> => {
  if (!response.ok) throw (await failure(response)).error;
  return z.object({ board: whiteboardSchema }).parse(await response.json()).board;
};

/** A change answered with the stored board, or with the current one when the server refused it for a known reason. */
const readChange = async (response: Response): Promise<WhiteboardChangeResult> => {
  if (response.ok) return { kind: 'saved', board: z.object({ board: whiteboardSchema }).parse(await response.json()).board };
  const { error, board } = await failure(response);
  if (response.status === 409 && board && (error.code === 'conflict' || error.code === 'needs-confirmation')) {
    return { kind: error.code, board };
  }
  throw error;
};

/** Every board of a workspace, or of all workspaces; throws when the server cannot answer. */
export async function listWhiteboards(workspaceId?: string): Promise<Whiteboard[]> {
  const request: WhiteboardRequest = { operation: 'list' };
  if (workspaceId) request.workspaceId = workspaceId;
  const response = await post(request);
  if (!response.ok) throw (await failure(response)).error;
  return z.object({ boards: z.array(whiteboardSchema) }).parse(await response.json()).boards;
}

export async function readWhiteboard(boardId: string): Promise<Whiteboard> {
  return readBoard(await post({ operation: 'read', boardId }));
}

export async function createWhiteboard(workspaceId: string, title: string, elements?: ElementInput[]): Promise<Whiteboard> {
  const request: WhiteboardRequest = { operation: 'create', workspaceId, title };
  if (elements) request.elements = elements;
  return readBoard(await post(request));
}

export async function applyWhiteboardOps(boardId: string, baseRevision: number, ops: WhiteboardOp[], confirmReplace = false): Promise<WhiteboardChangeResult> {
  const request: WhiteboardRequest = { operation: 'apply', boardId, baseRevision, ops };
  if (confirmReplace) request.confirmReplace = true;
  return readChange(await post(request));
}

export async function undoWhiteboard(boardId: string): Promise<WhiteboardChangeResult> {
  return readChange(await post({ operation: 'undo', boardId }));
}

export async function renameWhiteboard(boardId: string, title: string): Promise<Whiteboard> {
  return readBoard(await post({ operation: 'rename', boardId, title }));
}

export async function deleteWhiteboard(boardId: string): Promise<void> {
  const response = await post({ operation: 'delete', boardId });
  if (!response.ok) throw (await failure(response)).error;
}

const uploadedImageSchema = z.object({ image: z.object({ imageId: z.string().min(1), width: z.number().int().positive(), height: z.number().int().positive() }) });
const uploadTicketSchema = z.object({
  upload: z.object({
    method: z.literal('PUT'),
    uploadUrl: z.string().min(1),
    headers: z.record(z.string(), z.string()),
    completeUrl: z.string().min(1),
  }),
});

/**
 * Stores a picture for a board in three steps (server: whiteboards/uploads.js):
 * ask for a ticket, send the bytes where it says, then confirm. A ticket
 * pointing elsewhere (an object store's signed URL) is sent there directly,
 * without this server's credentials. The caller adds the element that shows it.
 */
export async function uploadWhiteboardImage(boardId: string, file: Blob): Promise<{ imageId: string; width: number; height: number }> {
  const asked = await runtimeFetch(`${ROUTE}/images/${encodeURIComponent(boardId)}/uploads`, { method: 'POST' });
  if (!asked.ok) throw (await failure(asked)).error;
  const { upload } = uploadTicketSchema.parse(await asked.json());
  const init = { method: upload.method, headers: { 'Content-Type': file.type || 'application/octet-stream', ...upload.headers }, body: file };
  const sent = /^https?:\/\//.test(upload.uploadUrl) ? await fetch(upload.uploadUrl, init) : await runtimeFetch(upload.uploadUrl, init);
  if (!sent.ok) throw (await failure(sent)).error;
  const completed = await runtimeFetch(upload.completeUrl, { method: 'POST' });
  if (!completed.ok) throw (await failure(completed)).error;
  return uploadedImageSchema.parse(await completed.json()).image;
}

/** A board's picture, read with the runtime's credentials. */
export async function fetchWhiteboardImage(boardId: string, imageId: string, signal?: AbortSignal): Promise<Blob> {
  const response = await runtimeFetch(`${ROUTE}/images/${encodeURIComponent(boardId)}/${encodeURIComponent(imageId)}`, { signal });
  if (!response.ok) throw new WhiteboardRequestError(`Whiteboard image failed (${response.status})`, 'unavailable', response.status);
  return response.blob();
}

/** A comment change answered with the stored board and the comment it touched. */
export type WhiteboardCommentResult = { board: Whiteboard; commentId: string };

const readCommentChange = async (response: Response): Promise<WhiteboardCommentResult> => {
  if (!response.ok) throw (await failure(response)).error;
  return z.object({ board: whiteboardSchema, commentId: z.string().min(1) }).parse(await response.json());
};

/** A comment, and whether it was also sent to the agent. */
export async function addWhiteboardComment(boardId: string, anchor: CommentAnchor, text: string, sent: boolean): Promise<WhiteboardCommentResult> {
  return readCommentChange(await post({ operation: 'comment', boardId, comment: { anchor, text, sent } }));
}

export async function replyToWhiteboardComment(boardId: string, commentId: string, text: string, sent: boolean): Promise<WhiteboardCommentResult> {
  return readCommentChange(await post({ operation: 'reply', boardId, commentId, reply: { text, sent } }));
}

export async function resolveWhiteboardComment(boardId: string, commentId: string, resolved: boolean): Promise<WhiteboardCommentResult> {
  return readCommentChange(await post({ operation: 'resolveComment', boardId, commentId, resolved }));
}

export async function deleteWhiteboardComment(boardId: string, commentId: string): Promise<WhiteboardCommentResult> {
  return readCommentChange(await post({ operation: 'deleteComment', boardId, commentId }));
}
