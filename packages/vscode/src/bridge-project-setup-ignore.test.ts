import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { execGit } from './bridge-git-process-runtime';
import { createProjectSetupStore, handleProjectSetupBridgeMessage, type SharedConfigIgnoreStatus } from './bridge-project-setup-runtime';

const temporaryDirectory = (): string => fs.mkdtempSync(path.join(os.tmpdir(), 'oc-project-ignore-'));
const projectId = (root: string): string => `path_${Buffer.from(root, 'utf8').toString('base64url')}`;
const setupRepo = (root: string): void => {
  fs.mkdirSync(root, { recursive: true });
  assert.equal(spawnSync('git', ['init', '-q'], { cwd: root, stdio: 'ignore' }).status, 0);
};
const execFileSync = (binary: string, args: string[], cwd: string): number => {
  return spawnSync(binary, args, { cwd, stdio: 'ignore' }).status ?? 1;
};
const statusFor = async (root: string, runGit = execGit): Promise<SharedConfigIgnoreStatus> => {
  const response = await handleProjectSetupBridgeMessage(
    { id: '1', type: 'api:project-setup:ignore-status', payload: { projectId: projectId(root) } },
    createProjectSetupStore(path.join(root, 'personal')),
    { workspaceRoots: [root], execGit: runGit },
  );
  assert(response?.success);
  return response.data as SharedConfigIgnoreStatus;
};
const fixFor = async (root: string) => {
  const response = await handleProjectSetupBridgeMessage(
    { id: '1', type: 'api:project-setup:ignore-fix', payload: { projectId: projectId(root) } },
    createProjectSetupStore(path.join(root, 'personal')),
    { workspaceRoots: [root], execGit },
  );
  assert(response?.success);
  return response.data;
};

describe('VS Code shared config ignore bridge', () => {
  test('reports committable, supported root patterns, manual-only sources and tracked paths', async () => {
    const root = temporaryDirectory();
    try {
      setupRepo(root);
      assert.deepEqual(await statusFor(root), { kind: 'committable' });
      for (const pattern of ['.skynex/', '/.skynex/']) {
        fs.writeFileSync(path.join(root, '.gitignore'), `${pattern}\n`);
        assert.deepEqual(await statusFor(root), { kind: 'ignored', source: '.gitignore', line: 1, pattern, fixable: true });
        assert.deepEqual(await fixFor(root), { kind: 'updated', status: { kind: 'committable' } });
        assert.deepEqual(await statusFor(root), { kind: 'committable' });
      }
      fs.writeFileSync(path.join(root, '.gitignore'), 'other/\n');
      fs.mkdirSync(path.join(root, '.git', 'info'), { recursive: true });
      fs.writeFileSync(path.join(root, '.git', 'info', 'exclude'), '.skynex/\n');
      assert.deepEqual(await statusFor(root), { kind: 'ignored', source: '.git/info/exclude', line: 1, pattern: '.skynex/', fixable: false });
      fs.rmSync(path.join(root, '.git', 'info', 'exclude'));
      fs.writeFileSync(path.join(root, '.gitignore'), '');
      fs.mkdirSync(path.join(root, '.skynex'), { recursive: true });
      fs.writeFileSync(path.join(root, '.skynex', 'project.json'), '{}');
      assert.equal(execFileSync('git', ['add', '.skynex/project.json'], root), 0);
      assert.deepEqual(await statusFor(root), { kind: 'committable' });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('does not execute a configured fsmonitor hook while checking ignore status', async () => {
    if (process.platform === 'win32') return;
    const root = temporaryDirectory();
    try {
      setupRepo(root);
      const marker = path.join(root, 'fsmonitor-ran');
      const hook = path.join(root, 'fsmonitor.sh');
      fs.writeFileSync(hook, `#!/bin/sh\nprintf ran >> '${marker}'\n`);
      fs.chmodSync(hook, 0o755);
      assert.equal(execFileSync('git', ['config', 'core.fsmonitor', hook], root), 0);
      assert.deepEqual(await statusFor(root), { kind: 'committable' });
      assert.equal(fs.existsSync(marker), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('resolves ignore sources from repository top and only offers a root-project fix', async () => {
    const root = temporaryDirectory();
    const sub = path.join(root, 'sub');
    try {
      setupRepo(root);
      fs.mkdirSync(sub);
      fs.writeFileSync(path.join(root, '.gitignore'), '.skynex/\n');
      const status = await statusFor(sub);
      assert.deepEqual(status, { kind: 'ignored', source: '.gitignore', line: 1, pattern: '.skynex/', fixable: false });
      assert.deepEqual(await fixFor(sub), { kind: 'refused', reason: 'not-fixable' });
      assert.equal(fs.existsSync(path.join(sub, '.gitignore')), false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('recognizes a symlinked workspace root as the repository root', async () => {
    if (process.platform === 'win32') return;
    const parent = temporaryDirectory();
    const root = path.join(parent, 'repo');
    const link = path.join(parent, 'workspace-link');
    try {
      setupRepo(root);
      fs.writeFileSync(path.join(root, '.gitignore'), '.skynex/\n');
      fs.symlinkSync(root, link, 'dir');
      assert.deepEqual(await statusFor(link), { kind: 'ignored', source: '.gitignore', line: 1, pattern: '.skynex/', fixable: true });
      assert.deepEqual(await fixFor(link), { kind: 'updated', status: { kind: 'committable' } });
    } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  });

  test('only honors an exception after the ignore rule and reuses an earlier exception when fixing', async () => {
    const root = temporaryDirectory();
    try {
      setupRepo(root);
      const ignorePath = path.join(root, '.gitignore');
      fs.writeFileSync(ignorePath, '!.skynex/project.json\n.skynex/\n');
      assert.deepEqual(await statusFor(root), { kind: 'ignored', source: '.gitignore', line: 2, pattern: '.skynex/', fixable: true });
      assert.deepEqual(await fixFor(root), { kind: 'updated', status: { kind: 'committable' } });
      assert.equal(fs.readFileSync(ignorePath, 'utf8'), '**/.skynex/*\n!.skynex/project.json\n');

      fs.writeFileSync(ignorePath, '**/.skynex/*\n!.skynex/project.json\n');
      assert.deepEqual(await statusFor(root), { kind: 'committable' });

      fs.writeFileSync(ignorePath, '.skynex/');
      assert.deepEqual(await fixFor(root), { kind: 'updated', status: { kind: 'committable' } });
      assert.equal(fs.readFileSync(ignorePath, 'utf8'), '**/.skynex/*\n!.skynex/project.json');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('preserves line endings and final newline, is idempotent, and refuses unsafe or changed files', async () => {
    for (const original of ['.skynex/\nkeep\n', '.skynex/\r\nkeep\r\n', '.skynex/']) {
      const root = temporaryDirectory();
      try {
        setupRepo(root);
        fs.writeFileSync(path.join(root, '.gitignore'), original);
        assert.equal((await fixFor(root) as { kind: string }).kind, 'updated');
        const eol = original.includes('\r\n') ? '\r\n' : '\n';
        const suffix = original.includes('keep') ? `keep${original.endsWith(eol) ? eol : ''}` : '';
        const replacement = original.startsWith('/') ? '/.skynex/*' : '**/.skynex/*';
        assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), `${replacement}${eol}!.skynex/project.json${suffix ? `${eol}${suffix}` : ''}`);
        const after = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
        assert.deepEqual(await fixFor(root), { kind: 'updated', status: { kind: 'committable' } });
        assert.equal(fs.readFileSync(path.join(root, '.gitignore'), 'utf8'), after);
      } finally { fs.rmSync(root, { recursive: true, force: true }); }
    }

    const mixedRoot = temporaryDirectory();
    try {
      setupRepo(mixedRoot);
      fs.writeFileSync(path.join(mixedRoot, '.gitignore'), '.skynex/\r\nkeep\nlast\r\n');
      assert.equal((await fixFor(mixedRoot) as { kind: string }).kind, 'updated');
      assert.equal(fs.readFileSync(path.join(mixedRoot, '.gitignore'), 'utf8'), '**/.skynex/*\r\n!.skynex/project.json\r\nkeep\nlast\r\n');
    } finally { fs.rmSync(mixedRoot, { recursive: true, force: true }); }

    const symlinkRoot = temporaryDirectory();
    try {
      setupRepo(symlinkRoot);
      const target = path.join(symlinkRoot, 'real-ignore');
      fs.writeFileSync(target, '.skynex/\n');
      fs.symlinkSync(target, path.join(symlinkRoot, '.gitignore'));
      assert.deepEqual(await fixFor(symlinkRoot), { kind: 'refused', reason: 'unsafe-file' });
    } finally { fs.rmSync(symlinkRoot, { recursive: true, force: true }); }

    const changedRoot = temporaryDirectory();
    try {
      setupRepo(changedRoot);
      fs.writeFileSync(path.join(changedRoot, '.gitignore'), '.skynex/\n');
      let changed = false;
      const alterAfterCheck: typeof execGit = async (...args) => {
        const result = await execGit(...args);
        if (!changed && args[0].includes('check-ignore') && result.exitCode === 0) {
          changed = true;
          fs.writeFileSync(path.join(changedRoot, '.gitignore'), 'changed/\n');
        }
        return result;
      };
      const response = await handleProjectSetupBridgeMessage(
        { id: '1', type: 'api:project-setup:ignore-fix', payload: { projectId: projectId(changedRoot) } },
        createProjectSetupStore(path.join(changedRoot, 'personal')),
        { workspaceRoots: [changedRoot], execGit: alterAfterCheck },
      );
      assert(response?.success);
      assert.deepEqual(response.data, { kind: 'refused', reason: 'changed' });
    } finally { fs.rmSync(changedRoot, { recursive: true, force: true }); }
  });

  test('keeps nested .skynex files ignored when fixing a root rule', async () => {
    const root = temporaryDirectory();
    try {
      setupRepo(root);
      fs.writeFileSync(path.join(root, '.gitignore'), '.skynex/\n');
      assert.equal((await fixFor(root) as { kind: string }).kind, 'updated');
      fs.mkdirSync(path.join(root, 'pkg', 'a', '.skynex'), { recursive: true });
      fs.writeFileSync(path.join(root, 'pkg', 'a', '.skynex', 'x'), 'x');
      assert.equal(execFileSync('git', ['check-ignore', '-q', 'pkg/a/.skynex/x'], root), 0);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  test('returns unknown for a non-repository and rejects unregistered roots', async () => {
    const root = temporaryDirectory();
    try {
      assert.deepEqual(await statusFor(root), { kind: 'unknown', reason: 'not-a-repository' });
      const response = await handleProjectSetupBridgeMessage(
        { id: '1', type: 'api:project-setup:ignore-status', payload: { projectId: projectId(root) } },
        createProjectSetupStore(),
        { workspaceRoots: [], execGit },
      );
      assert.equal(response?.success, false);

      let gitRan = false;
      const unregistered = await handleProjectSetupBridgeMessage(
        { id: '2', type: 'api:project-setup:ignore-status', payload: { projectId: projectId(path.join(root, 'outside')) } },
        createProjectSetupStore(),
        { workspaceRoots: [root], execGit: async (...args) => { gitRan = true; return execGit(...args); } },
      );
      assert.equal(unregistered?.success, false);
      assert.equal(gitRan, false);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});
