import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const workflowPath = fileURLToPath(new URL('../.github/workflows/release.yml', import.meta.url));
const workflow = yaml.parse(fs.readFileSync(workflowPath, 'utf8'));

test('manifests combine after partial build failures while publication stays strict', () => {
  assert.equal(workflow.jobs['create-release'].if, "${{ github.repository == 'openchamber/openchamber' }}");
  assert.equal(
    workflow.jobs['combine-electron-manifests'].if,
    "${{ !cancelled() && needs.create-release.result == 'success' }}",
  );
  // Skipped jobs count as done; any failure still stops the release.
  assert.equal(
    workflow.jobs['finalize-release'].if,
    "${{ github.repository == 'openchamber/openchamber' && !cancelled() && !failure() }}",
  );
});

test('VS Code extension publication runs only in the upstream repository', () => {
  const extensionWorkflowPath = fileURLToPath(new URL('../.github/workflows/vscode-extension.yml', import.meta.url));
  const extensionWorkflow = yaml.parse(fs.readFileSync(extensionWorkflowPath, 'utf8'));

  assert.equal(extensionWorkflow.jobs.publish.if, "${{ github.repository == 'openchamber/openchamber' }}");
});

test('Skynex release uploads have write access while build-only jobs stay read-only', () => {
  const desktopWorkflowPath = fileURLToPath(new URL('../.github/workflows/desktop-release.yml', import.meta.url));
  const desktopWorkflow = yaml.parse(fs.readFileSync(desktopWorkflowPath, 'utf8'));

  assert.equal(desktopWorkflow.permissions.contents, 'read');
  for (const name of ['create-release', 'build-windows', 'publish']) {
    assert.equal(desktopWorkflow.jobs[name].permissions.contents, 'write');
  }
  for (const name of ['build-linux', 'build-cli-runtime']) {
    assert.equal(desktopWorkflow.jobs[name].permissions.contents, 'read');
  }
});

test('Skynex publication builds and requires only Windows and Linux CLI packages', () => {
  const desktopWorkflowPath = fileURLToPath(new URL('../.github/workflows/desktop-release.yml', import.meta.url));
  const desktopWorkflow = yaml.parse(fs.readFileSync(desktopWorkflowPath, 'utf8'));
  const targets = desktopWorkflow.jobs['build-cli-runtime'].strategy.matrix.include;
  assert.deepEqual(targets.map(({ platform, arch }) => `${platform}-${arch}`), [
    'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64',
  ]);
  assert.ok(targets.every(({ runner }) => !runner.startsWith('macos')));

  const inventory = desktopWorkflow.jobs.publish.steps.find(({ name }) => name === 'Verify complete release asset inventory');
  assert.ok(!inventory.run.includes('darwin'));
  for (const target of ['linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']) {
    assert.ok(inventory.run.includes(`'${target}'`));
  }
});
