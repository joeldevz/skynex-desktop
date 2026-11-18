import { createHash } from 'node:crypto';
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const stringSchema = z.string();
const nonEmptyStringSchema = stringSchema.min(1);

async function requireCanonicalDirectory(directory) {
  const absolute = path.resolve(directory);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const segment of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Workspace chat path contains a symlink or non-directory');
    }
  }
  const canonical = await realpath(absolute);
  if (canonical !== absolute) throw new Error('Workspace chat path is not canonical');
  return canonical;
}

function isPathWithin(candidate, root) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function pathsOverlap(first, second) {
  const left = path.resolve(first);
  const right = path.resolve(second);
  return isPathWithin(left, right) || isPathWithin(right, left);
}

async function canonicalizeIfPresent(directory) {
  return realpath(path.resolve(directory));
}

export async function resolveWorkspaceChatDirectory({ chatsRoot, workspaceId, linkedPaths = [] }) {
  if (!nonEmptyStringSchema.safeParse(workspaceId).success) {
    throw new TypeError('Workspace ID must be a non-empty string');
  }
  const root = await requireCanonicalDirectory(chatsRoot);
  const directoryName = `workspace-${createHash('sha256').update(workspaceId).digest('hex')}`;
  const target = path.join(root, directoryName);
  for (const linkedPath of linkedPaths) {
    if (!stringSchema.safeParse(linkedPath).success) throw new TypeError('Linked folder path must be a string');
    const canonicalLinkedPath = await canonicalizeIfPresent(linkedPath);
    if (pathsOverlap(target, canonicalLinkedPath)) {
      throw new Error('Workspace chat directory overlaps a linked folder');
    }
  }
  try {
    await mkdir(target, { mode: 0o700 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
  }
  const canonicalTarget = await requireCanonicalDirectory(target);
  if (path.dirname(canonicalTarget) !== root || !canonicalTarget.startsWith(`${root}${path.sep}`)) {
    throw new Error('Workspace chat directory escaped the managed chats root');
  }
  return canonicalTarget;
}
