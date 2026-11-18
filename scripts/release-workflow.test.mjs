import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
  for (const name of ['create-release', 'publish']) {
    assert.equal(desktopWorkflow.jobs[name].permissions.contents, 'write');
  }
  for (const name of ['build-windows', 'build-linux', 'build-cli-runtime']) {
    assert.equal(desktopWorkflow.jobs[name].permissions.contents, 'read');
    assert.ok(desktopWorkflow.jobs[name].steps.every(({ uses }) => !uses?.startsWith('softprops/action-gh-release@')));
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

test('desktop benchmark stages one shared payload and keeps all packaging targets', () => {
  const desktopWorkflowPath = fileURLToPath(new URL('../.github/workflows/desktop-release.yml', import.meta.url));
  const desktopWorkflow = yaml.parse(fs.readFileSync(desktopWorkflowPath, 'utf8'));
  const input = desktopWorkflow.on.workflow_dispatch.inputs.mode;
  const sharedOnly = "inputs.mode == 'benchmark-shared'";
  const publishOnly = "inputs.mode == 'publish'";
  assert.equal(input.type, 'choice');
  assert.equal(input.default, 'publish');
  assert.deepEqual(input.options, ['publish', 'benchmark-baseline', 'benchmark-shared', 'benchmark-fast']);
  assert.equal(desktopWorkflow.jobs['shared-web-assets'].if, sharedOnly);
  assert.ok(desktopWorkflow.jobs['shared-web-assets'].steps.some(({ uses }) => uses?.startsWith('actions/upload-artifact@')));
  assert.ok(desktopWorkflow.jobs['shared-web-assets'].steps.every(({ uses }) => !uses || /@[0-9a-f]{40}$/.test(uses)));
  const sharedAssetPaths = desktopWorkflow.jobs['shared-web-assets'].steps
    .find(({ uses }) => uses?.startsWith('actions/upload-artifact@')).with.path;
  assert.ok(sharedAssetPaths.includes('packages/sdk/dist/'));
  assert.ok(sharedAssetPaths.includes('packages/web/dist/'));
  assert.ok(!sharedAssetPaths.includes('node_modules'));

  for (const name of ['build-windows', 'build-linux', 'build-cli-runtime']) {
    const job = desktopWorkflow.jobs[name];
    assert.ok(job.needs.includes('shared-web-assets'));
    assert.match(job.if, /inputs\.mode == 'benchmark-baseline'/);
    assert.ok(job.steps.some(({ uses, if: condition }) => uses?.startsWith('actions/download-artifact@') && condition === sharedOnly));
    const stagingIndex = job.steps.findIndex(({ run }) => run?.includes('--dist-only'));
    const installIndex = job.steps.findIndex(({ name }) => name === 'Install dependencies');
    assert.ok(stagingIndex >= 0 && stagingIndex < installIndex);
    assert.match(job.steps[installIndex].env.OPENCHAMBER_PREBUILT_SDK, /benchmark-shared/);
  }
  assert.equal(desktopWorkflow.jobs['create-release'].if, publishOnly);
  assert.equal(desktopWorkflow.jobs.publish.if, publishOnly);
  assert.ok(desktopWorkflow.jobs['shared-web-assets'].steps.every(({ run }) => !run?.includes('packages/sdk build')));

  const packagingTargets = [
    desktopWorkflow.jobs['build-windows'].strategy.matrix.include.length,
    desktopWorkflow.jobs['build-linux'].strategy.matrix.include.length,
    desktopWorkflow.jobs['build-cli-runtime'].strategy.matrix.include.length,
  ].reduce((total, count) => total + count, 0);
  assert.equal(packagingTargets, 8);
  const windowsOutputs = desktopWorkflow.jobs['build-windows'].steps.find(({ name }) => name === 'Upload Windows installers artifact');
  assert.ok(windowsOutputs.with.path.includes('.exe.blockmap'));
  assert.match(windowsOutputs.with.path, /\.exe(?:\n|$)/);
  const inventory = desktopWorkflow.jobs.publish.steps.find(({ name }) => name === 'Verify complete release asset inventory');
  assert.ok(inventory.run.includes('`Skynex-${version}-win-arm64.exe.blockmap`'));
  assert.ok(inventory.run.includes("['linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']"));
});

test('fast benchmark keeps per-job builds and native checks while limiting optimizations', () => {
  const desktopWorkflowPath = fileURLToPath(new URL('../.github/workflows/desktop-release.yml', import.meta.url));
  const desktopWorkflow = yaml.parse(fs.readFileSync(desktopWorkflowPath, 'utf8'));
  const fastOnly = "inputs.mode == 'benchmark-fast'";

  assert.equal(desktopWorkflow.jobs['shared-web-assets'].if, "inputs.mode == 'benchmark-shared'");
  for (const name of ['build-windows', 'build-linux', 'build-cli-runtime']) {
    const job = desktopWorkflow.jobs[name];
    assert.match(job.if, /inputs\.mode == 'benchmark-fast'/);
    assert.ok(!job.steps.some(({ name: stepName }) => stepName === 'Build shared SDK and web assets'));
    assert.ok(job.steps.some(({ uses, if: condition }) => uses?.startsWith('actions/download-artifact@')
      && condition === "inputs.mode == 'benchmark-shared'"));
  }

  for (const jobName of ['build-windows', 'build-cli-runtime']) {
    const job = desktopWorkflow.jobs[jobName];
    const cache = job.steps.find(({ uses, if: condition }) => uses?.startsWith('actions/cache@')
      && condition?.includes(fastOnly));
    assert.ok(cache);
    assert.ok(cache.with.path.includes('bun-install-cache'));
    assert.ok(!cache.with.path.includes('node_modules'));
    assert.match(cache.with.key, /^benchmark-fast-bun-copy-v1-/);
    assert.equal(cache.with['restore-keys'], undefined);
    assert.match(cache.with.key, /matrix\.arch/);
    assert.match(cache.with.key, /steps\.bun_version\.outputs\.version/);
    assert.match(cache.with.key, /hashFiles\('bun\.lock'\)/);
    assert.match(cache.with.key, /runner\.temp|matrix\.runner|windows-2022/);
    assert.ok(job.steps.some(({ name, env, run, if: condition }) => name === 'Install dependencies with download cache'
      && condition?.includes(fastOnly) && env.BUN_INSTALL_CACHE_DIR?.includes('bun-install-cache')
      && run === 'bun install --frozen-lockfile --backend=copyfile'));
  }
  assert.notEqual(
    desktopWorkflow.jobs['build-windows'].steps.find(({ uses, if: condition }) => uses?.startsWith('actions/cache@') && condition?.includes(fastOnly)).with.key,
    desktopWorkflow.jobs['build-cli-runtime'].steps.find(({ uses, if: condition }) => uses?.startsWith('actions/cache@') && condition?.includes(fastOnly)).with.key,
  );

  const linux = desktopWorkflow.jobs['build-linux'];
  assert.ok(linux.steps.every(({ env }) => !env?.BUN_INSTALL_CACHE_DIR));
  const linuxBuild = linux.steps.find(({ name }) => name === 'Prepare native runtime and package Linux outputs');
  assert.ok(linuxBuild.run.includes('run_phase native-rebuild'));
  assert.ok(linuxBuild.run.includes('run_phase linux-packages'));
  assert.ok(linuxBuild.run.includes('--config.deb.compression=gz'));
  assert.ok(!linuxBuild.run.includes('--config.rpm.compression'));
  assert.ok(linuxBuild.run.includes('package_args=(--linux --${{ matrix.arch }} --publish=never)'));
  assert.ok(linuxBuild.run.includes('run_phase appimage-verification'));
  assert.ok(linux.steps.some(({ name }) => name === 'Validate Linux update manifest'));

  const cli = desktopWorkflow.jobs['build-cli-runtime'];
  const cliPackage = cli.steps.find(({ name }) => name === 'Package and smoke-test standalone CLI');
  assert.equal(cliPackage.env.SKYNEX_CLI_GZIP_LEVEL, "${{ inputs.mode == 'benchmark-fast' && '6' || '' }}");
  for (const fragment of ['--version', '--help', 'node-pty', '@vscode/ripgrep', 'LICENSE', 'README.md']) {
    assert.ok(cliPackage.run.includes(fragment));
  }
  assert.equal(desktopWorkflow.jobs['create-release'].if, "inputs.mode == 'publish'");
  assert.equal(desktopWorkflow.jobs.publish.if, "inputs.mode == 'publish'");
});

test('prebuilt web asset staging replaces package dist outputs and fails closed', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'release-assets-test-'));
  const scriptSource = fileURLToPath(new URL('../packages/electron/scripts/build-web-assets.mjs', import.meta.url));
  const script = path.join(root, 'packages/electron/scripts/build-web-assets.mjs');
  const prebuilt = path.join(root, 'artifacts/shared-web-assets');
  const makeFile = (filename, content) => {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
  };

  try {
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.copyFileSync(scriptSource, script);
    makeFile(path.join(prebuilt, 'sdk/dist/index.js'), 'new sdk');
    makeFile(path.join(prebuilt, 'web/dist/index.html'), 'new web');
    makeFile(path.join(root, 'packages/sdk/dist/stale.js'), 'stale');
    makeFile(path.join(root, 'packages/web/dist/stale.html'), 'stale');

    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, OPENCHAMBER_PREBUILT_WEB_ASSETS: prebuilt },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(path.join(root, 'packages/sdk/dist/index.js'), 'utf8'), 'new sdk');
    assert.equal(fs.existsSync(path.join(root, 'packages/sdk/dist/stale.js')), false);
    assert.equal(fs.readFileSync(path.join(root, 'packages/web/dist/index.html'), 'utf8'), 'new web');
    assert.equal(fs.existsSync(path.join(root, 'packages/web/dist/stale.html')), false);
    assert.equal(fs.readFileSync(path.join(root, 'packages/electron/resources/web-dist/index.html'), 'utf8'), 'new web');

    makeFile(path.join(prebuilt, 'web/dist/index.html'), 'new cli web');
    const cliStaging = spawnSync(process.execPath, [script, '--dist-only'], {
      encoding: 'utf8',
      env: { ...process.env, OPENCHAMBER_PREBUILT_WEB_ASSETS: prebuilt },
    });
    assert.equal(cliStaging.status, 0, cliStaging.stderr);
    assert.equal(fs.readFileSync(path.join(root, 'packages/web/dist/index.html'), 'utf8'), 'new cli web');
    assert.equal(fs.readFileSync(path.join(root, 'packages/electron/resources/web-dist/index.html'), 'utf8'), 'new web');

    const sdkHookSource = new URL('../scripts/build-sdk-on-install.mjs', import.meta.url);
    const sdkHook = path.join(root, 'scripts/build-sdk-on-install.mjs');
    fs.mkdirSync(path.dirname(sdkHook), { recursive: true });
    fs.copyFileSync(sdkHookSource, sdkHook);
    const sdkHookOptions = { encoding: 'utf8', env: { ...process.env, OPENCHAMBER_PREBUILT_SDK: '1' } };
    assert.notEqual(spawnSync(process.execPath, [sdkHook], sdkHookOptions).status, 0);
    makeFile(path.join(root, 'packages/sdk/dist/schemas.js'), 'schemas');
    makeFile(path.join(root, 'packages/sdk/dist/ui/index.js'), 'ui');
    const stagedSdkInstall = spawnSync(process.execPath, [sdkHook], sdkHookOptions);
    assert.equal(stagedSdkInstall.status, 0, stagedSdkInstall.stderr);

    const desktopStaging = spawnSync(process.execPath, [script, '--stage-only'], {
      encoding: 'utf8',
      env: { ...process.env, OPENCHAMBER_PREBUILT_WEB_ASSETS: '' },
    });
    assert.equal(desktopStaging.status, 0, desktopStaging.stderr);
    assert.equal(fs.readFileSync(path.join(root, 'packages/electron/resources/web-dist/index.html'), 'utf8'), 'new cli web');

    fs.rmSync(path.join(prebuilt, 'web'), { recursive: true });
    makeFile(path.join(root, 'packages/sdk/dist/retained.js'), 'retained');
    const missing = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, OPENCHAMBER_PREBUILT_WEB_ASSETS: prebuilt },
    });
    assert.notEqual(missing.status, 0);
    assert.equal(fs.readFileSync(path.join(root, 'packages/sdk/dist/retained.js'), 'utf8'), 'retained');

    const fakeBunScript = path.join(root, 'fake-bun.cjs');
    fs.writeFileSync(fakeBunScript, `#!${process.execPath}\nconst fs = require('node:fs');\nconst path = require('node:path');\nconst pkg = path.basename(process.cwd());\nconst dist = path.join(process.cwd(), 'dist');\nfs.mkdirSync(dist, { recursive: true });\nfs.writeFileSync(path.join(dist, pkg === 'sdk' ? 'default.js' : 'default.html'), pkg);\n`);
    const fakeBun = process.platform === 'win32' ? path.join(root, 'fake-bun.cmd') : fakeBunScript;
    if (process.platform === 'win32') {
      fs.writeFileSync(fakeBun, `@"${process.execPath}" "${fakeBunScript}"\r\n`);
    } else {
      fs.chmodSync(fakeBun, 0o755);
    }
    const defaultBuild = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, BUN: fakeBun, OPENCHAMBER_PREBUILT_WEB_ASSETS: '' },
    });
    assert.equal(defaultBuild.status, 0, defaultBuild.stderr);
    assert.equal(fs.readFileSync(path.join(root, 'packages/sdk/dist/default.js'), 'utf8'), 'sdk');
    assert.equal(fs.readFileSync(path.join(root, 'packages/web/dist/default.html'), 'utf8'), 'web');
    assert.equal(fs.readFileSync(path.join(root, 'packages/electron/resources/web-dist/default.html'), 'utf8'), 'web');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
