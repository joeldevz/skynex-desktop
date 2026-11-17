import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const workflowFile = path.join(repositoryRoot, '.github/workflows/desktop-release.yml');
const expectedBuildPrefix = ['bun', 'build', 'packages/web/scripts/skynex-app-install.mjs'];

test('desktop release bootstrap bundle imports installSkynexApp under plain Node without project dependencies', async () => {
  const workflow = await readFile(workflowFile, 'utf8');
  const buildLine = workflow.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith('bun build packages/web/scripts/skynex-app-install.mjs '));
  assert.ok(buildLine, 'desktop release workflow contains the installer bundle command');
  const workflowArgs = buildLine.split(/\s+/);
  assert.deepEqual(workflowArgs.slice(0, expectedBuildPrefix.length), expectedBuildPrefix, 'workflow command uses the known installer build invocation');
  assert.ok(workflowArgs.includes('--target=node'), 'workflow command targets Node');
  assert.equal(workflowArgs.filter((argument) => argument === '--outfile').length, 1, 'workflow command has exactly one output option');
  const outfileIndex = workflowArgs.indexOf('--outfile');
  assert.ok(workflowArgs[outfileIndex + 1] && !workflowArgs[outfileIndex + 1].startsWith('--'), 'output option has a path value');
  assert.equal(workflowArgs.some((argument) => ['&&', '||', ';', '|', '>', '<'].includes(argument)), false, 'workflow command contains no shell operators');

  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'skynex-app-bootstrap-bundle-'));
  const bundleFile = path.join(temporaryRoot, 'skynex-app-install.mjs');
  try {
    const buildArgs = workflowArgs.slice(1);
    buildArgs[outfileIndex] = bundleFile;
    const build = spawnSync('bun', buildArgs, { cwd: repositoryRoot, encoding: 'utf8' });
    assert.equal(build.status, 0, `workflow bundle build failed\n${build.stdout}\n${build.stderr}`);

    const importUrl = pathToFileURL(bundleFile).href;
    const node = spawnSync(process.execPath, ['--input-type=module', '-e', `const module = await import(${JSON.stringify(importUrl)}); if (typeof module.installSkynexApp !== 'function') throw new Error('installSkynexApp export missing');`], {
      cwd: temporaryRoot,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: temporaryRoot },
    });
    assert.equal(node.status, 0, `plain Node could not import the release bundle without node_modules\n${node.stdout}\n${node.stderr}`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
