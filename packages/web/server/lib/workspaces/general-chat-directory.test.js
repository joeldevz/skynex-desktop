import { mkdtemp, mkdir, lstat, readdir, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { resolveWorkspaceChatDirectory } from './general-chat-directory.js';

const roots = [];

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'openchamber-general-chat-'));
  roots.push(root);
  const chatsRoot = path.join(root, 'managed-chats');
  await mkdir(chatsRoot);
  return { root, chatsRoot };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('resolveWorkspaceChatDirectory', () => {
  test('resolves one stable directory under the managed chat root for a workspace ID', async () => {
    const { root, chatsRoot } = await fixture();
    const workspaceId = 'workspace/../../outside';

    const first = await resolveWorkspaceChatDirectory({ chatsRoot, workspaceId });
    const second = await resolveWorkspaceChatDirectory({ chatsRoot, workspaceId });

    expect(first).toBe(second);
    expect(path.dirname(first)).toBe(chatsRoot);
    expect(first.startsWith(`${chatsRoot}${path.sep}`)).toBe(true);
    expect(first.startsWith(root)).toBe(true);
    expect((await lstat(first)).isDirectory()).toBe(true);
  });

  test('rejects a symlinked managed chats root without creating anything through it', async () => {
    const { root, chatsRoot } = await fixture();
    const outside = path.join(root, 'outside');
    const linkedRoot = path.join(root, 'linked-chats');
    await mkdir(outside);
    await symlink(outside, linkedRoot);

    await expect(resolveWorkspaceChatDirectory({ chatsRoot: linkedRoot, workspaceId: 'workspace-a' })).rejects.toThrow();
    expect(await readdir(outside)).toEqual([]);
  });

  test('rejects a symlinked workspace directory without writing through it', async () => {
    const { root, chatsRoot } = await fixture();
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    const workspaceDirectory = await resolveWorkspaceChatDirectory({ chatsRoot, workspaceId: 'workspace-a' });
    await rmdir(workspaceDirectory);
    await symlink(outside, workspaceDirectory);

    await expect(resolveWorkspaceChatDirectory({ chatsRoot, workspaceId: 'workspace-a' })).rejects.toThrow();
    expect(await lstat(outside).then((stat) => stat.isDirectory())).toBe(true);
    expect(await lstat(workspaceDirectory).then((stat) => stat.isSymbolicLink())).toBe(true);
  });

  test('rejects a non-directory workspace target', async () => {
    const { chatsRoot } = await fixture();
    const workspaceDirectory = await resolveWorkspaceChatDirectory({ chatsRoot, workspaceId: 'workspace-a' });
    await rmdir(workspaceDirectory);
    await writeFile(workspaceDirectory, 'occupied');

    await expect(resolveWorkspaceChatDirectory({ chatsRoot, workspaceId: 'workspace-a' })).rejects.toThrow();
  });

  test('does not create a workspace directory when a linked path cannot be canonicalized', async () => {
    const { chatsRoot } = await fixture();
    const workspaceId = 'workspace-a';
    const target = path.join(chatsRoot, `workspace-${createHash('sha256').update(workspaceId).digest('hex')}`);
    const missingLinkedPath = path.join(chatsRoot, 'missing-linked-path');

    await expect(resolveWorkspaceChatDirectory({
      chatsRoot,
      workspaceId,
      linkedPaths: [missingLinkedPath],
    })).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('treats the filesystem root as an ancestor of every workspace target', async () => {
    const { chatsRoot } = await fixture();
    const workspaceId = 'workspace-root-overlap';
    const target = path.join(chatsRoot, `workspace-${createHash('sha256').update(workspaceId).digest('hex')}`);

    await expect(resolveWorkspaceChatDirectory({
      chatsRoot,
      workspaceId,
      linkedPaths: [path.parse(chatsRoot).root],
    })).rejects.toThrow('overlaps a linked folder');
    await expect(lstat(target)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
