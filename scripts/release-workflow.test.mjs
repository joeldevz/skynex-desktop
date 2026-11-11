import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import yaml from 'yaml';

const workflowPath = fileURLToPath(new URL('../.github/workflows/release.yml', import.meta.url));
const workflow = yaml.parse(fs.readFileSync(workflowPath, 'utf8'));

test('manifests combine after partial build failures while publication stays strict', () => {
  assert.equal(
    workflow.jobs['combine-electron-manifests'].if,
    "${{ !cancelled() && needs.create-release.result == 'success' }}",
  );
  // Skipped jobs count as done; any failure still stops the release.
  assert.equal(workflow.jobs['finalize-release'].if, "${{ !cancelled() && !failure() }}");
});

test('desktop release publishers can upload assets while build-only jobs remain read-only', () => {
  const desktop = yaml.parse(fs.readFileSync(new URL('../.github/workflows/desktop-release.yml', import.meta.url), 'utf8'));
  const publishers = Object.entries(desktop.jobs).filter(([, job]) => job.steps.some((step) => step.uses?.startsWith('softprops/action-gh-release@')));
  assert.deepEqual(publishers.map(([name]) => name), ['create-release', 'build-windows', 'publish']);
  for (const [name, job] of publishers) {
    assert.equal(job.permissions.contents, 'write', `${name} must upload release assets`);
  }
  assert.equal(desktop.permissions.contents, 'read');
  assert.equal(desktop.jobs['build-linux'].permissions.contents, 'read');
  assert.equal(desktop.jobs['build-cli-runtime'].permissions.contents, 'read');
});
