import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { z } from 'zod';

import { WhiteboardError } from './model.js';

/**
 * Pictures placed on a board: screenshots, mockups, photos of a sketch. They
 * live beside the board, one folder per board, and are only ever served back
 * as the raster type their bytes prove. SVG is refused: it is a document that
 * can carry script, not a picture.
 */
export const WHITEBOARD_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
/**
 * Disk the pictures may take: per board and for every board together, so
 * repeated uploads cannot fill the data folder. A board holds a few dozen
 * screenshots comfortably within these.
 */
const WHITEBOARD_IMAGE_LIMITS = Object.freeze({ boardImages: 200, boardBytes: 300 * 1024 * 1024, totalBytes: 2 * 1024 * 1024 * 1024 });
// An upload not yet on the board is kept this long, the time a client needs to add the element that shows it.
const UNATTACHED_GRACE_MS = 10 * 60 * 1000;
// About an 8K screenshot; larger pictures are refused rather than decoded by every viewer.
const MAX_PIXELS = 40_000_000;
const IMAGE_ID = /^img_[a-f0-9]{24}$/;
const BOARD_ID = /^wb_[A-Za-z0-9_-]{1,64}$/;

const EXTENSIONS = Object.freeze({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' });
const MIME_BY_EXTENSION = Object.freeze(Object.fromEntries(Object.entries(EXTENSIONS).map(([mime, ext]) => [ext, mime])));

const createImageId = () => `img_${randomBytes(12).toString('hex')}`;
const imageIdSchema = z.string().regex(IMAGE_ID);
const isImageId = (value) => imageIdSchema.safeParse(value).success;

const jpegSize = (bytes) => {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    const length = bytes.readUInt16BE(offset + 2);
    // Start-of-frame markers carry the size; the others are skipped by their length.
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
};

const webpSize = (bytes) => {
  const chunk = bytes.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && bytes.length >= 30) return { width: 1 + bytes.readUIntLE(24, 3), height: 1 + bytes.readUIntLE(27, 3) };
  if (chunk === 'VP8 ' && bytes.length >= 30) return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  if (chunk === 'VP8L' && bytes.length >= 25) {
    const bits = bytes.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
};

/** The type and pixel size the bytes themselves prove, or null for anything that is not a supported picture. */
export const inspectImage = (bytes) => {
  if (!Buffer.isBuffer(bytes) || bytes.length < 16) return null;
  let mime = null;
  let size = null;
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && bytes.length >= 24) {
    mime = 'image/png';
    size = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    mime = 'image/jpeg';
    size = jpegSize(bytes);
  } else if (bytes.toString('ascii', 0, 6) === 'GIF87a' || bytes.toString('ascii', 0, 6) === 'GIF89a') {
    mime = 'image/gif';
    size = { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  } else if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    mime = 'image/webp';
    size = webpSize(bytes);
  }
  // A small file can still claim a huge canvas that every viewer would have to decode.
  if (!mime || !size || size.width < 1 || size.height < 1 || size.width * size.height > MAX_PIXELS) return null;
  return { mime, extension: EXTENSIONS[mime], width: size.width, height: size.height };
};

const unsupported = () => new WhiteboardError('invalid', 'Use a PNG, JPEG, GIF or WebP picture up to 10 MB', 400);

/** Pictures on disk, `<directory>/<boardId>/<imageId>.<ext>`. */
export const createWhiteboardImageStore = ({ fsPromises, directory, limits = WHITEBOARD_IMAGE_LIMITS, now = () => Date.now() }) => {
  const boardDirectory = (boardId) => {
    if (!BOARD_ID.test(boardId)) throw new WhiteboardError('invalid', 'Invalid whiteboard id');
    return path.join(directory, boardId);
  };
  const find = async (boardId, imageId) => {
    if (!isImageId(imageId)) return null;
    for (const extension of Object.values(EXTENSIONS)) {
      const filePath = path.join(boardDirectory(boardId), `${imageId}.${extension}`);
      try {
        const stat = await fsPromises.stat(filePath);
        if (stat.isFile()) return { filePath, mime: MIME_BY_EXTENSION[extension] };
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    return null;
  };
  /** The pictures in one folder, with their size and age. */
  const listFolder = async (folder) => {
    let names = [];
    try {
      names = await fsPromises.readdir(folder);
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    const entries = [];
    for (const name of names) {
      const imageId = name.split('.')[0];
      if (!isImageId(imageId) || name.includes('.tmp-')) continue;
      const stat = await fsPromises.stat(path.join(folder, name)).catch(() => null);
      if (stat?.isFile()) entries.push({ imageId, filePath: path.join(folder, name), size: stat.size, modifiedAt: stat.mtimeMs });
    }
    return entries;
  };
  const totalBytes = async () => {
    let names = [];
    try {
      names = await fsPromises.readdir(directory);
    } catch (error) {
      if (error?.code === 'ENOENT') return 0;
      throw error;
    }
    let total = 0;
    for (const name of names.filter((entry) => BOARD_ID.test(entry))) {
      for (const entry of await listFolder(path.join(directory, name))) total += entry.size;
    }
    return total;
  };
  return {
    /**
     * Stores the bytes when they prove to be a supported picture; returns its
     * id and pixel size. `keep` names the pictures the board still uses (its
     * elements and its undo history); other uploads older than the grace
     * period are removed first, then the limits are enforced.
     */
    save: async (boardId, bytes, keep = new Set()) => {
      if (!Buffer.isBuffer(bytes) || bytes.length > WHITEBOARD_IMAGE_MAX_BYTES) throw unsupported();
      const info = inspectImage(bytes);
      if (!info) throw unsupported();
      const folder = boardDirectory(boardId);
      const existing = [];
      for (const entry of await listFolder(folder)) {
        if (!keep.has(entry.imageId) && now() - entry.modifiedAt > UNATTACHED_GRACE_MS) await fsPromises.rm(entry.filePath, { force: true });
        else existing.push(entry);
      }
      const boardBytes = existing.reduce((sum, entry) => sum + entry.size, 0);
      if (existing.length >= limits.boardImages || boardBytes + bytes.length > limits.boardBytes) {
        throw new WhiteboardError('invalid', 'This board has no room for more pictures; remove some first', 400);
      }
      if ((await totalBytes()) + bytes.length > limits.totalBytes) {
        throw new WhiteboardError('invalid', 'Whiteboard pictures have used all their space; remove some first', 400);
      }
      await fsPromises.mkdir(folder, { recursive: true });
      const imageId = createImageId();
      const target = path.join(folder, `${imageId}.${info.extension}`);
      const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
      try {
        await fsPromises.writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
        await fsPromises.rename(temporary, target);
      } catch (error) {
        await fsPromises.rm(temporary, { force: true }).catch(() => {});
        throw error;
      }
      return { imageId, width: info.width, height: info.height, mime: info.mime };
    },
    find,
    has: async (boardId, imageId) => (await find(boardId, imageId)) !== null,
    /** Removes every picture of a deleted board. */
    removeBoard: async (boardId) => {
      await fsPromises.rm(boardDirectory(boardId), { recursive: true, force: true });
    },
  };
};
