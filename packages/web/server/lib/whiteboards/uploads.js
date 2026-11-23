import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { WHITEBOARD_IMAGE_MAX_BYTES } from './images.js';
import { WhiteboardError } from './model.js';

/**
 * Picture uploads in three steps, the shape object stores use:
 *
 * 1. `create` hands out a ticket for one picture of one board: where to send
 *    the bytes (`uploadUrl`, `method`, `headers`) and where to confirm
 *    (`completeUrl`). Asking is cheap and never waits on another upload.
 * 2. The bytes go to `uploadUrl`. Here that is this server, which streams them
 *    to a staging file and never holds them in memory; an upload that sends
 *    nothing for `idleMs`, or takes longer than `totalMs` in all, is cut and
 *    its place freed. A future store (S3 or similar) hands out its own signed
 *    URL instead, and this server is not in the way at all.
 * 3. `complete` checks the bytes are a supported picture and stores it for the
 *    board, with the board's quotas (images.js).
 *
 * Tickets are single use, expire, and are bounded in number. At the bound
 * the oldest ticket not moving bytes right now gives way to the new one, so
 * asking for many tickets cannot lock anyone else out of uploading.
 */
const WHITEBOARD_UPLOAD_LIMITS = Object.freeze({
  openTickets: 16,
  activeTransfers: 4,
  // A ticket nobody uses is gone in a minute; uploading starts right after asking.
  ticketTtlMs: 60 * 1000,
  idleMs: 10 * 1000,
  totalMs: 60 * 1000,
});

const UPLOAD_ID = /^upl_[a-f0-9]{48}$/;
const ROUTE = '/api/openchamber/whiteboards/uploads';

const tooLarge = () => new WhiteboardError('too-large', 'Use a PNG, JPEG, GIF or WebP picture up to 10 MB', 413);
const expired = () => new WhiteboardError('not-found', 'This upload is no longer open; start it again', 404);
const busy = (message) => new WhiteboardError('busy', message, 429);

const isUploadId = (value) => UPLOAD_ID.test(String(value));

export const createWhiteboardImageUploads = ({ fs, fsPromises, directory, runtime, limits = WHITEBOARD_UPLOAD_LIMITS, now = () => Date.now() }) => {
  const tickets = new Map();
  let activeTransfers = 0;

  const stagingPath = (uploadId) => path.join(directory, `${uploadId}.part`);
  const discard = async (uploadId) => {
    tickets.delete(uploadId);
    await fsPromises.rm(stagingPath(uploadId), { force: true }).catch(() => {});
  };
  const sweep = async () => {
    for (const [uploadId, ticket] of tickets) {
      // Bytes on their way in, or being checked and stored, finish first: their own paths clean up after them.
      if (ticket.state !== 'receiving' && ticket.state !== 'completing' && ticket.expiresAt <= now()) await discard(uploadId);
    }
  };
  const openTicket = (uploadId) => {
    const ticket = isUploadId(uploadId) ? tickets.get(uploadId) : undefined;
    if (!ticket || (ticket.state !== 'receiving' && ticket.expiresAt <= now())) throw expired();
    return ticket;
  };

  return {
    /** A ticket to upload one picture to a board. */
    create: async (boardId) => {
      await runtime.read(boardId);
      await sweep();
      if (tickets.size >= limits.openTickets) {
        // Only a transfer in progress (at most `activeTransfers`, each under its
        // deadlines) or one being stored keeps its place; anything else idle yields.
        const idle = [...tickets].filter(([, ticket]) => ticket.state === 'open' || ticket.state === 'received');
        const oldest = idle.sort(([, a], [, b]) => a.createdAt - b.createdAt)[0];
        if (!oldest) throw busy('Too many pictures are uploading; try again in a moment');
        await discard(oldest[0]);
      }
      const uploadId = `upl_${randomBytes(24).toString('hex')}`;
      const expiresAt = now() + limits.ticketTtlMs;
      tickets.set(uploadId, { boardId, expiresAt, createdAt: now(), state: 'open' });
      return {
        uploadId,
        method: 'PUT',
        uploadUrl: `${ROUTE}/${uploadId}`,
        headers: {},
        completeUrl: `${ROUTE}/${uploadId}/complete`,
        maxBytes: WHITEBOARD_IMAGE_MAX_BYTES,
        expiresAt,
      };
    },

    /**
     * Streams an upload body to its staging file. Resolves once all of it is
     * there; rejects (and drops the ticket) when it is too large, stalls for
     * `idleMs`, or runs past `totalMs`.
     */
    receive: async (uploadId, body) => {
      const ticket = openTicket(uploadId);
      if (ticket.state !== 'open') throw new WhiteboardError('invalid', 'This upload already received its picture', 409);
      if (activeTransfers >= limits.activeTransfers) throw busy('Other pictures are uploading; try again in a moment');
      activeTransfers += 1;
      ticket.state = 'receiving';
      const controller = new AbortController();
      let idleTimer = null;
      const timeout = () => new WhiteboardError('timeout', 'The picture took too long to arrive; try again', 408);
      const armIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => controller.abort(timeout()), limits.idleMs);
      };
      const totalTimer = setTimeout(() => controller.abort(timeout()), limits.totalMs);
      let received = 0;
      const limiter = new Transform({
        transform(chunk, _encoding, done) {
          received += chunk.length;
          armIdle();
          if (received > WHITEBOARD_IMAGE_MAX_BYTES) done(tooLarge());
          else done(null, chunk);
        },
      });
      armIdle();
      try {
        await fsPromises.mkdir(directory, { recursive: true });
        await pipeline(body, limiter, fs.createWriteStream(stagingPath(uploadId), { flags: 'wx', mode: 0o600 }), { signal: controller.signal });
        ticket.state = 'received';
        ticket.size = received;
        return { received };
      } catch (error) {
        await discard(uploadId);
        throw controller.signal.aborted ? controller.signal.reason : error instanceof WhiteboardError ? error : new WhiteboardError('invalid', 'The picture did not arrive whole; try again', 400);
      } finally {
        clearTimeout(idleTimer);
        clearTimeout(totalTimer);
        activeTransfers -= 1;
      }
    },

    /** Checks the received bytes and stores the picture for the ticket's board. */
    complete: async (uploadId) => {
      const ticket = openTicket(uploadId);
      if (ticket.state !== 'received') throw new WhiteboardError('invalid', 'The picture has not arrived yet', 409);
      ticket.state = 'completing';
      try {
        const bytes = await fsPromises.readFile(stagingPath(uploadId));
        if (bytes.length > WHITEBOARD_IMAGE_MAX_BYTES) throw tooLarge();
        return await runtime.saveImage(ticket.boardId, bytes);
      } finally {
        await discard(uploadId);
      }
    },

    /** Staging files left by a previous run are never completed. */
    clearStaging: async () => {
      await fsPromises.rm(directory, { recursive: true, force: true }).catch(() => {});
    },
  };
};
