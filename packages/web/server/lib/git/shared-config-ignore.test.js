import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createSharedConfigIgnore } from './shared-config-ignore.js';

const roots = [];
const repo = async (ignore = '') => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-ignore-'));
  roots.push(root);
  spawnSync('git', ['init', '-q'], { cwd: root });
  if (ignore) await fs.writeFile(path.join(root, '.gitignore'), ignore);
  return root;
};
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe('shared config ignore status', () => {
  it('reports committable files, including already tracked files', async () => {
    const root = await repo();
    const status = createSharedConfigIgnore();
    expect(await status.read(root)).toEqual({ kind: 'committable' });
    await fs.mkdir(path.join(root, '.skynex'));
    await fs.writeFile(path.join(root, '.skynex/project.json'), '{}');
    spawnSync('git', ['add', '.'], { cwd: root });
    await fs.writeFile(path.join(root, '.gitignore'), '.skynex/\n');
    expect(await status.read(root)).toEqual({ kind: 'committable' });
  });

  it.each(['.skynex/', '/.skynex/'])('fixes only the eligible rule %s preserving final newline state', async (rule) => {
    const root = await repo(`before\n${rule}\nafter`);
    const status = createSharedConfigIgnore();
    expect(await status.read(root)).toMatchObject({ kind: 'ignored', source: '.gitignore', line: 2, pattern: rule, fixable: true });
    expect(await status.fix(root)).toEqual({ kind: 'updated', status: { kind: 'committable' } });
    const prefix = rule.startsWith('/') ? '/' : '';
    expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toBe(`before\n${prefix ? '/.skynex/*' : '**/.skynex/*'}\n!${prefix}.skynex/project.json\nafter`);
    const fixed = await fs.readFile(path.join(root, '.gitignore'));
    expect(await status.fix(root)).toEqual({ kind: 'updated', status: { kind: 'committable' } });
    expect(await fs.readFile(path.join(root, '.gitignore'))).toEqual(fixed);
  });

  it('preserves CRLF and final newlines', async () => {
    const root = await repo('first\r\n.skynex/\r\n');
    await createSharedConfigIgnore().fix(root);
    expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toBe('first\r\n**/.skynex/*\r\n!.skynex/project.json\r\n');
  });

  it('ignores nested .skynex files but leaves root project.json committable after fixing', async () => {
    const root = await repo('.skynex/\n');
    const status = createSharedConfigIgnore();
    await fs.mkdir(path.join(root, 'pkg/a/.skynex'), { recursive: true });
    await fs.writeFile(path.join(root, 'pkg/a/.skynex/x'), 'x');
    await fs.mkdir(path.join(root, '.skynex'));
    await fs.writeFile(path.join(root, '.skynex/project.json'), '{}');
    expect(await status.fix(root)).toMatchObject({ kind: 'updated', status: { kind: 'committable' } });
    expect(spawnSync('git', ['check-ignore', '-q', 'pkg/a/.skynex/x'], { cwd: root }).status).toBe(0);
    expect(spawnSync('git', ['check-ignore', '-q', '.skynex/project.json'], { cwd: root }).status).toBe(1);
  });

  it('does not execute repository fsmonitor hooks while reading status', async () => {
    const root = await repo();
    const marker = path.join(root, 'fsmonitor-ran');
    const hook = path.join(root, 'fsmonitor.sh');
    await fs.writeFile(hook, `#!/bin/sh\ntouch '${marker}'\n`);
    await fs.chmod(hook, 0o755);
    spawnSync('git', ['config', 'core.fsmonitor', hook], { cwd: root });
    expect(await createSharedConfigIgnore().read(root)).toEqual({ kind: 'committable' });
    await expect(fs.access(marker)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('preserves mixed line terminators and does not duplicate an existing exception', async () => {
    const root = await repo('before\r\n.skynex/\nafter\r\n');
    expect(await createSharedConfigIgnore().fix(root)).toMatchObject({ kind: 'updated', status: { kind: 'committable' } });
    expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8')).toBe('before\r\n**/.skynex/*\n!.skynex/project.json\nafter\r\n');
    const withException = await repo('.skynex/\n!.skynex/project.json\n');
    expect(await createSharedConfigIgnore().fix(withException)).toMatchObject({ kind: 'updated' });
    expect(await fs.readFile(path.join(withException, '.gitignore'), 'utf8')).toBe('**/.skynex/*\n!.skynex/project.json\n');
  });

  it.each(['.skynex/', '/.skynex/'])('repairs unterminated final rule %s and keeps other nested files ignored', async (rule) => {
    const root = await repo(rule);
    const status = createSharedConfigIgnore();
    await fs.mkdir(path.join(root, '.skynex'));
    await fs.writeFile(path.join(root, '.skynex/project.json'), '{}');
    await fs.mkdir(path.join(root, '.skynex/other'), { recursive: true });
    await fs.writeFile(path.join(root, '.skynex/other/file'), 'x');
    expect(await status.fix(root)).toMatchObject({ kind: 'updated', status: { kind: 'committable' } });
    const prefix = rule.startsWith('/') ? '/' : '';
    expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8'))
      .toBe(`${prefix ? '/.skynex/*' : '**/.skynex/*'}\n!${prefix}.skynex/project.json`);
    expect(spawnSync('git', ['check-ignore', '-q', '.skynex/other/file'], { cwd: root }).status).toBe(0);
    expect(spawnSync('git', ['check-ignore', '-q', '.skynex/project.json'], { cwd: root }).status).toBe(1);
  });

  it('inserts the exception after the rule when an earlier exception exists', async () => {
    const root = await repo('!.skynex/project.json\n.skynex/\n');
    expect(await createSharedConfigIgnore().fix(root)).toMatchObject({ kind: 'updated' });
    expect(await fs.readFile(path.join(root, '.gitignore'), 'utf8'))
      .toBe('!.skynex/project.json\n**/.skynex/*\n!.skynex/project.json\n');
  });

  it('reports excludes as manual-only and non-repositories as unknown', async () => {
    const root = await repo();
    await fs.mkdir(path.join(root, '.git/info'), { recursive: true });
    await fs.writeFile(path.join(root, '.git/info/exclude'), '.skynex/\n');
    expect(await createSharedConfigIgnore().read(root)).toMatchObject({ kind: 'ignored', source: '.git/info/exclude', line: 1, fixable: false });
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'not-repo-'));
    roots.push(outside);
    expect(await createSharedConfigIgnore().read(outside)).toEqual({ kind: 'unknown', reason: 'not-a-repository' });
  });

  it('refuses a symlinked .gitignore', async () => {
    const root = await repo('.skynex/\n');
    await fs.rename(path.join(root, '.gitignore'), path.join(root, 'ignore-target'));
    await fs.symlink('ignore-target', path.join(root, '.gitignore'));
    expect(await createSharedConfigIgnore().fix(root)).toEqual({ kind: 'refused', reason: 'unsafe-file' });
  });

});
