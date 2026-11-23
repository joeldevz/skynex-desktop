import express from 'express';
import { z } from 'zod';
import { isRequestAuthorized } from '../opencode/core-routes.js';
import { WHITEBOARD_IMAGE_MAX_BYTES } from './images.js';
import { commentIdSchema, commentInputSchema, replyInputSchema } from './comments.js';
import { WhiteboardError, whiteboardSchemas } from './model.js';

const { elementInputSchema, opSchema } = whiteboardSchemas;
const boardIdSchema = z.string().regex(/^wb_[A-Za-z0-9_-]{1,64}$/);
const requestSchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('list'), workspaceId: z.string().min(1).optional() }),
  z.strictObject({ operation: z.literal('read'), boardId: boardIdSchema }),
  z.strictObject({ operation: z.literal('create'), workspaceId: z.string().min(1), title: z.string().min(1).max(120), elements: z.array(elementInputSchema).max(800).optional() }),
  z.strictObject({ operation: z.literal('apply'), boardId: boardIdSchema, baseRevision: z.number().int().positive(), ops: z.array(opSchema).max(400), confirmReplace: z.boolean().optional() }),
  z.strictObject({ operation: z.literal('undo'), boardId: boardIdSchema }),
  z.strictObject({ operation: z.literal('rename'), boardId: boardIdSchema, title: z.string().min(1).max(120) }),
  z.strictObject({ operation: z.literal('delete'), boardId: boardIdSchema }),
  z.strictObject({ operation: z.literal('comment'), boardId: boardIdSchema, comment: commentInputSchema }),
  z.strictObject({ operation: z.literal('reply'), boardId: boardIdSchema, commentId: commentIdSchema, reply: replyInputSchema }),
  z.strictObject({ operation: z.literal('resolveComment'), boardId: boardIdSchema, commentId: commentIdSchema, resolved: z.boolean() }),
  z.strictObject({ operation: z.literal('deleteComment'), boardId: boardIdSchema, commentId: commentIdSchema }),
]);

const sendError = (res, error) => {
  if (error instanceof WhiteboardError) {
    const body = { error: error.message, code: error.code };
    if (error.board) body.board = error.board;
    return res.status(error.status).json(body);
  }
  return res.status(500).json({ error: 'Whiteboards unavailable', code: 'unavailable' });
};

const imageIdSchema = z.string().regex(/^img_[a-f0-9]{24}$/);
const uploadIdSchema = z.string().regex(/^upl_[a-f0-9]{48}$/);

export const registerWhiteboardsRoutes = (app, { runtime, uploads, tunnelAuthController, uiAuthController, isEnabled = async () => true }) => {
  const parseJson = express.json({ limit: '2mb' });
  // Whiteboards are a beta switched in Settings: while off, nothing of them answers.
  app.use('/api/openchamber/whiteboards', async (req, res, next) => {
    if (await isEnabled().catch(() => false)) return next();
    return res.status(404).json({ error: 'Whiteboards are turned off', code: 'disabled' });
  });
  const authorize = async (req, res) => {
    const authorized = await isRequestAuthorized(req, res, { tunnelAuthController, uiAuthController });
    if (!authorized) res.status(401).json({ error: 'Unauthorized', code: 'invalid' });
    return authorized;
  };

  // Step 1 of an upload (uploads.js): a ticket saying where the bytes go.
  app.post('/api/openchamber/whiteboards/images/:boardId/uploads', async (req, res) => {
    if (!(await authorize(req, res))) return undefined;
    const boardId = boardIdSchema.safeParse(req.params.boardId);
    if (!boardId.success) return res.status(400).json({ error: 'Invalid whiteboard', code: 'invalid' });
    try {
      return res.json({ upload: await uploads.create(boardId.data) });
    } catch (error) { return sendError(res, error); }
  });

  // Step 2: the bytes, streamed to disk under the upload's deadlines.
  app.put('/api/openchamber/whiteboards/uploads/:uploadId', async (req, res) => {
    if (!(await authorize(req, res))) return undefined;
    const uploadId = uploadIdSchema.safeParse(req.params.uploadId);
    if (!uploadId.success) return res.status(400).json({ error: 'Invalid upload', code: 'invalid' });
    const declared = Number(req.get('content-length'));
    if (Number.isFinite(declared) && declared > WHITEBOARD_IMAGE_MAX_BYTES) {
      return res.status(413).json({ error: 'Use a PNG, JPEG, GIF or WebP picture up to 10 MB', code: 'too-large' });
    }
    try {
      return res.json(await uploads.receive(uploadId.data, req));
    } catch (error) {
      if (error instanceof WhiteboardError && error.status === 429) res.setHeader('Retry-After', '1');
      // A cut upload may have its connection closed already; there is nobody left to answer.
      if (res.headersSent || res.destroyed) return undefined;
      return sendError(res, error);
    }
  });

  // Step 3: check and store the picture for its board.
  app.post('/api/openchamber/whiteboards/uploads/:uploadId/complete', async (req, res) => {
    if (!(await authorize(req, res))) return undefined;
    const uploadId = uploadIdSchema.safeParse(req.params.uploadId);
    if (!uploadId.success) return res.status(400).json({ error: 'Invalid upload', code: 'invalid' });
    try {
      return res.json({ image: await uploads.complete(uploadId.data) });
    } catch (error) { return sendError(res, error); }
  });

  app.get('/api/openchamber/whiteboards/images/:boardId/:imageId', async (req, res) => {
    const authorized = await isRequestAuthorized(req, res, { tunnelAuthController, uiAuthController });
    if (!authorized) return res.status(401).json({ error: 'Unauthorized', code: 'invalid' });
    const boardId = boardIdSchema.safeParse(req.params.boardId);
    const imageId = imageIdSchema.safeParse(req.params.imageId);
    if (!boardId.success || !imageId.success) return res.status(400).json({ error: 'Invalid image', code: 'invalid' });
    try {
      const image = await runtime.findImage(boardId.data, imageId.data);
      if (!image) return res.status(404).json({ error: 'Image not found', code: 'not-found' });
      // Served as the picture type its bytes proved, never sniffed into something that runs.
      res.setHeader('Content-Type', image.mime);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
      // The data folder may sit under a dot folder (~/.config); the path is our own, not the caller's.
      return res.sendFile(image.filePath, { dotfiles: 'allow' }, (error) => {
        if (error && !res.headersSent) res.status(500).json({ error: 'Whiteboards unavailable', code: 'unavailable' });
      });
    } catch (error) { return sendError(res, error); }
  });

  app.post('/api/openchamber/whiteboards', (req, res, next) => parseJson(req, res, (error) => {
    if (error) return res.status(error.status === 413 ? 413 : 400).json({ error: 'Invalid whiteboard request body', code: 'invalid' });
    return next();
  }), async (req, res) => {
    const authorized = await isRequestAuthorized(req, res, { tunnelAuthController, uiAuthController });
    if (!authorized) return res.status(401).json({ error: 'Unauthorized', code: 'invalid' });
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid whiteboard request', code: 'invalid' });
    const input = parsed.data;
    try {
      switch (input.operation) {
        case 'list': return res.json({ boards: await runtime.list(input.workspaceId) });
        case 'read': return res.json({ board: await runtime.read(input.boardId) });
        case 'create': return res.json({ board: (await runtime.create({ workspaceId: input.workspaceId, title: input.title, elements: input.elements }, { actor: 'user' })).board });
        case 'apply': return res.json({ board: (await runtime.apply(input.boardId, input, { actor: 'user' })).board });
        case 'undo': return res.json({ board: (await runtime.undo(input.boardId, { actor: 'user' })).board });
        case 'rename': return res.json({ board: await runtime.rename(input.boardId, input.title, { actor: 'user' }) });
        case 'delete': return res.json(await runtime.delete(input.boardId, { actor: 'user' }));
        case 'comment': return res.json(await runtime.comment(input.boardId, input.comment, { actor: 'user' }));
        case 'reply': return res.json(await runtime.reply(input.boardId, input.commentId, input.reply, { actor: 'user' }));
        case 'resolveComment': return res.json(await runtime.resolveComment(input.boardId, input.commentId, input.resolved, { actor: 'user' }));
        case 'deleteComment': return res.json(await runtime.deleteComment(input.boardId, input.commentId, { actor: 'user' }));
      }
    } catch (error) { return sendError(res, error); }
  });
};
