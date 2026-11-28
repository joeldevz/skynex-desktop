import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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

test('the repository does not publish a VS Code extension', () => {
  const extensionWorkflowPath = fileURLToPath(new URL('../.github/workflows/vscode-extension.yml', import.meta.url));
  assert.equal(fs.existsSync(extensionWorkflowPath), false);
});

test('Skynex release uploads have write access while build-only jobs stay read-only', () => {
  const desktopWorkflowPath = fileURLToPath(new URL('../.github/workflows/desktop-release.yml', import.meta.url));
  const desktopWorkflow = yaml.parse(fs.readFileSync(desktopWorkflowPath, 'utf8'));

  assert.equal(desktopWorkflow.permissions.contents, 'read');
  assert.equal(desktopWorkflow.jobs['create-release'].if,
    "${{ github.repository == 'joeldevz/skynex-desktop' && github.ref == 'refs/heads/skynex' }}");
  for (const [name, job] of Object.entries(desktopWorkflow.jobs)) {
    if (name !== 'create-release') assert.ok([job.needs].flat().includes('create-release'), name);
  }
  for (const name of ['create-release', 'build-windows', 'publish']) {
    assert.equal(desktopWorkflow.jobs[name].permissions.contents, 'write');
  }
  for (const name of ['build-linux', 'build-cli-runtime']) {
    assert.equal(desktopWorkflow.jobs[name].permissions.contents, 'read');
  }
});

test('Skynex releases require the analytics project token and pass it only to desktop bundling', () => {
  const desktopWorkflowPath = fileURLToPath(new URL('../.github/workflows/desktop-release.yml', import.meta.url));
  const desktopWorkflow = yaml.parse(fs.readFileSync(desktopWorkflowPath, 'utf8'));
  const variable = 'SKYNEX_DESKTOP_POSTHOG_PROJECT_TOKEN';
  const reference = '${{ secrets.SKYNEX_DESKTOP_POSTHOG_PROJECT_TOKEN }}';
  const steps = desktopWorkflow.jobs['create-release'].steps;
  const validation = steps.find(({ name }) => name === 'Validate PostHog project token');
  assert.ok(validation);
  assert.ok(steps.indexOf(validation) < steps.findIndex(({ id }) => id === 'create_release'));

  const tokenSteps = [];
  for (const [job, definition] of Object.entries(desktopWorkflow.jobs)) {
    assert.ok(!Object.hasOwn(definition.env ?? {}, variable), job);
    for (const step of definition.steps) {
      if (!Object.hasOwn(step.env ?? {}, variable)) continue;
      assert.equal(step.env[variable], reference);
      if (step !== validation) assert.equal(step.run, 'bun run bundle:main');
      tokenSteps.push(`${job}:${step.name}`);
    }
  }
  assert.ok(!Object.hasOwn(desktopWorkflow.env ?? {}, variable));
  assert.deepEqual(tokenSteps, [
    'create-release:Validate PostHog project token',
    'build-windows:Bundle main process',
    'build-linux:Bundle main process',
  ]);
  for (const [value, expectedStatus] of [['', 1], ['phx_fake-private-key', 1], [`phc_${'a'.repeat(24)}`, 0]]) {
    const result = spawnSync('bash', ['-c', validation.run], { env: { ...process.env, [variable]: value }, encoding: 'utf8' });
    assert.equal(result.status, expectedStatus, result.stderr);
    if (value) assert.ok(!`${result.stdout}${result.stderr}`.includes(value));
  }
});

test('Skynex release selects and validates x64 by default and both ARM64 platforms on opt-in', (t) => {
  const desktopWorkflowPath = fileURLToPath(new URL('../.github/workflows/desktop-release.yml', import.meta.url));
  const desktopWorkflow = yaml.parse(fs.readFileSync(desktopWorkflowPath, 'utf8'));
  const input = desktopWorkflow.on.workflow_dispatch.inputs.include_arm64;
  assert.equal(input.type, 'boolean');
  assert.equal(input.default, false);
  const selection = desktopWorkflow.jobs['create-release'].steps.find(({ id }) => id === 'build_targets');
  const staging = desktopWorkflow.jobs.publish.steps.find(({ name }) => name === 'Prepare release assets');
  const inventory = desktopWorkflow.jobs.publish.steps.find(({ name }) => name === 'Verify complete release asset inventory');
  for (const step of [selection, staging, inventory]) {
    assert.equal(step.env.INCLUDE_ARM64, '${{ inputs.include_arm64 }}');
  }
  const version = '0.1.4';
  for (const includeArm64 of [false, true]) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'skynex-release-'));
    t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
    const output = path.join(cwd, 'output');
    const env = { ...process.env, GITHUB_OUTPUT: output, VERSION: version, INCLUDE_ARM64: String(includeArm64) };
    const run = (script) => spawnSync('bash', ['-e', '-c', script], { cwd, env, encoding: 'utf8' });
    const selected = run(selection.run);
    assert.equal(selected.status, 0, selected.stderr);
    const matrices = Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map((line) => {
      const [name, json] = line.split('=');
      return [name, JSON.parse(json).include];
    }));
    const arches = includeArm64 ? ['x64', 'arm64'] : ['x64'];
    for (const [matrix, job] of [['windows', 'build-windows'], ['linux', 'build-linux'], ['cli', 'build-cli-runtime']]) {
      assert.equal(desktopWorkflow.jobs[job].strategy.matrix, `\${{ fromJSON(needs.create-release.outputs.${matrix}_matrix) }}`);
      assert.equal(desktopWorkflow.jobs['create-release'].outputs[`${matrix}_matrix`], `\${{ steps.build_targets.outputs.${matrix} }}`);
    }
    assert.deepEqual(matrices.windows.map(({ arch }) => arch), arches);
    assert.deepEqual(matrices.linux.map(({ arch }) => arch), arches);
    assert.deepEqual(matrices.cli.map(({ platform, arch }) => `${platform}-${arch}`),
      ['linux', 'win32'].flatMap((platform) => arches.map((arch) => `${platform}-${arch}`)));
    const write = (file, data = 'fixture') => {
      fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
      fs.writeFileSync(path.join(cwd, file), data);
    };
    const windows = [];
    for (const arch of arches) {
      const manifest = `version: ${version}\n`;
      const installer = `Skynex-${version}-win-${arch}.exe`;
      windows.push(installer, `${installer}.blockmap`);
      write(`artifacts/windows/windows-manifest-${arch}/latest.yml`, manifest);
      const linux = arch === 'x64'
        ? ['x86_64', 'amd64', 'x86_64', 'latest-linux.yml']
        : ['arm64', 'arm64', 'aarch64', 'latest-linux-arm64.yml'];
      const [app, deb, rpm, name] = linux;
      for (const file of [`Skynex-${version}-linux-${app}.AppImage`, `Skynex-${version}-linux-${deb}.deb`, `Skynex-${version}-linux-${rpm}.rpm`, name]) {
        write(`artifacts/linux/linux-release-${arch}/${file}`, manifest);
      }
      for (const platform of ['linux', 'win32']) {
        const archive = `artifacts/cli/skynex-app-${version}-${platform}-${arch}.tar.gz`;
        write(archive);
        write(`${archive}.sha256`);
      }
    }
    write('scripts/install.sh');
    write('artifacts/cli/skynex-app-install.mjs');
    const staged = run(staging.run);
    assert.equal(staged.status, 0, staged.stderr);
    const assets = [...windows, ...fs.readdirSync(path.join(cwd, 'artifacts/ready'))].map((name) => ({ name, size: 1 }));
    assert.equal(assets.length, includeArm64 ? 24 : 13);
    const check = (files) => run(inventory.run.replace("node - <<'NODE'\n",
      `node - <<'NODE'\nglobalThis.fetch = async () => ({ ok: true, json: async () => (${JSON.stringify({ draft: true, assets: files })}) });\n`));
    const complete = check(assets);
    assert.equal(complete.status, 0, complete.stderr);
    assert.match(check(assets.slice(1)).stderr, /Expected exactly one/);
    assert.match(check([...assets, { name: 'unexpected.tar.gz', size: 1 }]).stderr, /Unexpected release assets/);
  }
});
