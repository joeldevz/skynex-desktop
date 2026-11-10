import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const packageRuntimeUrl = new URL('./package-cli-runtime.mjs', import.meta.url);

async function loadPackageRuntime() {
  return import(packageRuntimeUrl.href);
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createPackage(root, name, version, options = {}) {
  const packageRoot = path.join(root, ...name.split('/'));
  await writeJson(path.join(packageRoot, 'package.json'), {
    name,
    version,
    main: 'index.js',
    ...(options.dependencies ? { dependencies: options.dependencies } : {}),
    ...(options.optionalDependencies ? { optionalDependencies: options.optionalDependencies } : {}),
    ...(options.peerDependencies ? { peerDependencies: options.peerDependencies } : {}),
    ...(options.exports ? { exports: options.exports } : {}),
  });
  await writeFile(path.join(packageRoot, 'index.js'), `module.exports = ${JSON.stringify(`${name}@${version}`)};\n`);
  return packageRoot;
}

async function createFixture() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'skynex-package-runtime-'));
  const webRoot = path.join(tempRoot, 'web');
  const workspaceRoot = path.join(tempRoot, 'workspace');
  const outputDir = path.join(tempRoot, 'release');
  const nodeModules = path.join(webRoot, 'node_modules');

  await writeJson(path.join(webRoot, 'package.json'), {
    name: '@openchamber/web',
    version: '9.8.7-test.1',
    dependencies: {
      '@openchamber/sdk': 'workspace:0.1.1',
      'root-lib': '1.0.0',
      'sibling-lib': '1.0.0',
      'cycle-a': '1.0.0',
    },
    optionalDependencies: { 'native-addon': '1.0.0' },
    peerDependencies: { 'required-peer': '^1.0.0' },
    devDependencies: { 'dev-only-package': '1.0.0' },
  });
  await mkdir(path.join(webRoot, 'bin'), { recursive: true });
  await mkdir(path.join(webRoot, 'dist'), { recursive: true });
  await mkdir(path.join(webRoot, 'public'), { recursive: true });
  await writeFile(path.join(webRoot, 'bin', 'cli.js'), '#!/usr/bin/env node\n');
  await mkdir(path.join(webRoot, 'server', 'built-in-extensions'), { recursive: true });
  await writeFile(path.join(webRoot, 'server', 'index.js'), 'export const server = true;\n');
  await writeFile(path.join(webRoot, 'server', 'built-in-extensions', 'fixture.js'), 'export default "built-in";\n');
  await writeFile(path.join(webRoot, 'dist', 'index.html'), '<main>runtime</main>\n');
  await writeFile(path.join(webRoot, 'public', 'asset.svg'), '<svg/>\n');
  await writeFile(path.join(webRoot, '.env'), 'SHOULD_NOT_SHIP=secret\n');
  await mkdir(path.join(webRoot, '.git'), { recursive: true });
  await writeFile(path.join(webRoot, '.git', 'config'), 'SHOULD_NOT_SHIP\n');

  const linkedSdk = path.join(workspaceRoot, 'packages', 'sdk');
  await writeJson(path.join(linkedSdk, 'package.json'), {
    name: '@openchamber/sdk',
    version: '0.1.1',
    main: 'dist/index.js',
    dependencies: { 'sdk-dependency': '1.0.0' },
  });
  await mkdir(path.join(linkedSdk, 'dist'), { recursive: true });
  await writeFile(path.join(linkedSdk, 'dist', 'index.js'), 'export const sdk = true;\n');
  await mkdir(path.join(linkedSdk, 'node_modules'), { recursive: true });
  await createPackage(path.join(linkedSdk, 'node_modules'), 'sdk-dependency', '1.0.0');
  await mkdir(path.join(nodeModules, '@openchamber'), { recursive: true });
  await symlink(linkedSdk, path.join(nodeModules, '@openchamber', 'sdk'), 'dir');

  const nativeDependency = await createPackage(nodeModules, 'root-lib', '1.0.0', {
    dependencies: { 'shared-lib': '1.0.0' },
    exports: { '.': './index.js' },
  });
  await createPackage(path.join(nativeDependency, 'node_modules'), 'shared-lib', '1.0.0');
  const sibling = await createPackage(nodeModules, 'sibling-lib', '1.0.0', {
    dependencies: { 'shared-lib': '2.0.0' },
  });
  await createPackage(path.join(sibling, 'node_modules'), 'shared-lib', '2.0.0');
  const cycleA = await createPackage(nodeModules, 'cycle-a', '1.0.0', {
    dependencies: { 'cycle-b': '1.0.0' },
  });
  await createPackage(path.join(cycleA, 'node_modules'), 'cycle-b', '1.0.0', {
    dependencies: { 'cycle-a': '1.0.0' },
  });
  await createPackage(nodeModules, 'native-addon', '1.0.0');
  await writeFile(path.join(nodeModules, 'native-addon', 'binding.node'), Buffer.from([0, 255, 1, 127, 0]));
  await chmod(path.join(nodeModules, 'native-addon', 'binding.node'), 0o755);
  await createPackage(nodeModules, 'required-peer', '1.2.0');
  await createPackage(nodeModules, 'dev-only-package', '1.0.0');

  return { tempRoot, webRoot, outputDir };
}

async function withFixture(run) {
  const fixture = await createFixture();
  try {
    await run(fixture);
  } finally {
    await rm(fixture.tempRoot, { recursive: true, force: true });
  }
}

function readTarMembers(tarBuffer) {
  const members = new Map();
  for (let offset = 0; offset + 512 <= tarBuffer.length;) {
    const header = tarBuffer.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
    const name = field(0, 100);
    const prefix = field(345, 155);
    const archivePath = prefix ? `${prefix}/${name}` : name;
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1) || '0';
    const contentStart = offset + 512;
    members.set(archivePath, {
      content: tarBuffer.subarray(contentStart, contentStart + size),
      mode: Number.parseInt(field(100, 8).trim() || '0', 8),
      type,
      name,
      prefix,
    });
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return members;
}

async function packageFixture(fixture, overrides = {}) {
  const { packageCliRuntime } = await loadPackageRuntime();
  return packageCliRuntime({
    webRoot: fixture.webRoot,
    outputDir: fixture.outputDir,
    ...overrides,
  });
}

test('packages the complete production closure and dereferences the workspace SDK link', async () => {
  await withFixture(async (fixture) => {
    const result = await packageFixture(fixture);
    const archive = gunzipSync(await readFile(result.archivePath));
    const members = readTarMembers(archive);
    const files = [...members.keys()];

    assert.ok(files.includes('skynex-app/package.json'));
    assert.ok(files.includes('skynex-app/bin/cli.js'));
    assert.ok(files.includes('skynex-app/server/index.js'));
    assert.ok(files.includes('skynex-app/server/built-in-extensions/fixture.js'));
    assert.ok(files.includes('skynex-app/dist/index.html'));
    assert.ok(files.includes('skynex-app/public/asset.svg'));
    assert.ok(files.includes('skynex-app/node_modules/@openchamber/sdk/dist/index.js'));
    assert.ok(files.includes('skynex-app/node_modules/sdk-dependency/index.js'));
    assert.ok(files.includes('skynex-app/node_modules/root-lib/node_modules/shared-lib/index.js'));
    assert.ok(files.includes('skynex-app/node_modules/required-peer/index.js'));
    assert.ok(files.includes('skynex-app/node_modules/native-addon/binding.node'));
    assert.equal(files.some((name) => /dev-only-package|\.env|\.git/.test(name)), false);

    assert.equal(members.get('skynex-app/node_modules/@openchamber/sdk/dist/index.js').type, '0');
  });
});

test('preserves conflicting nested dependency versions and terminates cyclic dependency traversal', async () => {
  await withFixture(async (fixture) => {
    const result = await packageFixture(fixture);
    const members = readTarMembers(gunzipSync(await readFile(result.archivePath)));
    const packageJson = (name) => JSON.parse(members.get(name).content.toString('utf8'));

    assert.equal(packageJson('skynex-app/node_modules/root-lib/node_modules/shared-lib/package.json').version, '1.0.0');
    assert.equal(packageJson('skynex-app/node_modules/sibling-lib/node_modules/shared-lib/package.json').version, '2.0.0');
    assert.ok(members.has('skynex-app/node_modules/cycle-a/node_modules/cycle-b/index.js'));
    assert.ok(members.has('skynex-app/node_modules/cycle-a/node_modules/cycle-b/node_modules/cycle-a/index.js'));
    assert.ok(members.size < 100, 'dependency cycles must not create unbounded archive entries');
  });
});

test('writes a release marker, safe USTAR members, platform archive name, and matching SHA256', async () => {
  await withFixture(async (fixture) => {
    const result = await packageFixture(fixture);
    const archiveBytes = await readFile(result.archivePath);
    const members = readTarMembers(gunzipSync(archiveBytes));
    const names = [...members.keys()];
    const marker = JSON.parse(members.get('skynex-app/skynex-release.json').content.toString('utf8'));
    const binary = members.get('skynex-app/node_modules/native-addon/binding.node');
    const checksum = (await readFile(result.checksumPath, 'utf8')).trim();
    const expectedDigest = createHash('sha256').update(archiveBytes).digest('hex');

    assert.deepEqual(marker, {
      format: 1,
      version: '9.8.7-test.1',
      platform: process.platform,
      arch: process.arch,
    });
    assert.match(path.basename(result.archivePath), new RegExp(`^skynex-app-9\\.8\\.7-test\\.1-${process.platform}-${process.arch}\\.tar\\.gz$`));
    assert.match(checksum, new RegExp(`^${expectedDigest}(?:\\s|$)`));
    assert.deepEqual(binary.content, Buffer.from([0, 255, 1, 127, 0]));
    assert.equal(binary.mode & 0o111, 0o111);
    assert.deepEqual(archiveBytes.subarray(0, 2), Buffer.from([0x1f, 0x8b]));

    for (const [archivePath, member] of members) {
      assert.ok(archivePath.startsWith('skynex-app/'));
      assert.ok(Buffer.byteLength(archivePath, 'utf8') <= 255, `USTAR path too long: ${archivePath}`);
      assert.ok(Buffer.byteLength(member.name, 'utf8') <= 100);
      assert.ok(Buffer.byteLength(member.prefix, 'utf8') <= 155);
      assert.equal(member.prefix ? `${member.prefix}/${member.name}` : member.name, archivePath);
      assert.ok(member.type === '0' || member.type === '5', `unexpected link or special tar member at ${archivePath}`);
    }
    assert.deepEqual(names.filter((name) => name.startsWith('skynex-app/')).length, names.length);
  });
});

test('refuses to package a native runtime for a different host platform or architecture', async () => {
  await withFixture(async (fixture) => {
    const { stageCliRuntime } = await loadPackageRuntime();
    const otherPlatform = process.platform === 'linux' ? 'darwin' : 'linux';
    await assert.rejects(
      stageCliRuntime({
        webRoot: fixture.webRoot,
        outputRoot: path.join(fixture.tempRoot, 'stage-cross-target'),
        platform: otherPlatform,
        arch: process.arch,
      }),
      /host|native|cross[- ]target/i,
    );
    await assert.rejects(
      stageCliRuntime({
        webRoot: fixture.webRoot,
        outputRoot: path.join(fixture.tempRoot, 'stage-cross-arch'),
        platform: process.platform,
        arch: process.arch === 'x64' ? 'arm64' : 'x64',
      }),
      /host|native|cross[- ]target/i,
    );
  });
});

test('fails with the missing required dependency name', async () => {
  await withFixture(async (fixture) => {
    const { packageCliRuntime } = await loadPackageRuntime();
    const manifestPath = path.join(fixture.webRoot, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.dependencies['missing-required-package'] = '1.0.0';
    await writeJson(manifestPath, manifest);

    await assert.rejects(
      packageCliRuntime({ webRoot: fixture.webRoot, outputDir: fixture.outputDir }),
      /missing-required-package/,
    );
  });
});

test('rejects staging inside the source tree and a symlink destination', async () => {
  await withFixture(async (fixture) => {
    const { stageCliRuntime } = await loadPackageRuntime();
    await assert.rejects(
      stageCliRuntime({
        webRoot: fixture.webRoot,
        outputRoot: path.join(fixture.webRoot, 'stage'),
      }),
      /source|inside|overlap|collision/i,
    );

    const realDestination = path.join(fixture.tempRoot, 'real-stage');
    const symlinkDestination = path.join(fixture.tempRoot, 'linked-stage');
    await mkdir(realDestination);
    await symlink(realDestination, symlinkDestination, 'dir');
    await assert.rejects(
      stageCliRuntime({ webRoot: fixture.webRoot, outputRoot: symlinkDestination }),
      /symlink|symbolic|destination/i,
    );
    assert.deepEqual(await readdir(realDestination), []);
  });
});

test('rejects an archive output directory that resolves through a symlink', async () => {
  await withFixture(async (fixture) => {
    const { packageCliRuntime } = await loadPackageRuntime();
    const realOutput = path.join(fixture.tempRoot, 'real-release');
    const linkedOutput = path.join(fixture.tempRoot, 'linked-release');
    await mkdir(realOutput);
    await symlink(realOutput, linkedOutput, 'dir');

    await assert.rejects(
      packageCliRuntime({ webRoot: fixture.webRoot, outputDir: linkedOutput }),
      /symlink|symbolic|destination/i,
    );
    assert.deepEqual(await readdir(realOutput), []);
  });
});

test('refuses package-content symlinks outside the source roots without changing external data', async () => {
  await withFixture(async (fixture) => {
    const { stageCliRuntime } = await loadPackageRuntime();
    const externalRoot = path.join(fixture.tempRoot, 'external-data');
    const externalSentinel = path.join(externalRoot, 'sentinel.txt');
    const packageRoot = await createPackage(path.join(fixture.webRoot, 'node_modules'), 'escape-package', '1.0.0');
    const manifestPath = path.join(fixture.webRoot, 'package.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.dependencies['escape-package'] = '1.0.0';
    await writeJson(manifestPath, manifest);
    await mkdir(externalRoot, { recursive: true });
    await writeFile(externalSentinel, 'external data must remain untouched\n');
    await symlink(externalRoot, path.join(packageRoot, 'external-link'), 'dir');

    await assert.rejects(
      stageCliRuntime({
        webRoot: fixture.webRoot,
        outputRoot: path.join(fixture.tempRoot, 'stage-package-symlink'),
      }),
      /symlink|symbolic|outside|escape/i,
    );
    assert.equal(await readFile(externalSentinel, 'utf8'), 'external data must remain untouched\n');
  });
});

test('refuses a nonempty unowned staging directory without replacing its contents', async () => {
  await withFixture(async (fixture) => {
    const { stageCliRuntime } = await loadPackageRuntime();
    const outputRoot = path.join(fixture.tempRoot, 'unowned-stage');
    const markerPath = path.join(outputRoot, 'keep.marker');
    const sentinelPath = path.join(outputRoot, 'sentinel.txt');
    await mkdir(outputRoot);
    await writeFile(markerPath, 'owned by another operation\n');
    await writeFile(sentinelPath, 'preserve this file\n');

    await assert.rejects(
      stageCliRuntime({ webRoot: fixture.webRoot, outputRoot }),
      /nonempty|non-empty|owned|collision|existing/i,
    );
    assert.equal(await readFile(markerPath, 'utf8'), 'owned by another operation\n');
    assert.equal(await readFile(sentinelPath, 'utf8'), 'preserve this file\n');
    assert.deepEqual((await readdir(outputRoot)).sort(), ['keep.marker', 'sentinel.txt']);
  });
});

test('encodes a long UTF-8 path with valid USTAR prefix and name fields', async () => {
  await withFixture(async (fixture) => {
    const longRelativePath = path.join('dist', 'ü'.repeat(60), '界'.repeat(30), 'asset.txt');
    const sourceFile = path.join(fixture.webRoot, longRelativePath);
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, 'long path asset\n');

    const result = await packageFixture(fixture);
    const members = readTarMembers(gunzipSync(await readFile(result.archivePath)));
    const archivePath = `skynex-app/${longRelativePath.split(path.sep).join('/')}`;
    const member = members.get(archivePath);

    assert.ok(member, `missing UTF-8 path ${archivePath}`);
    assert.ok(Buffer.byteLength(archivePath, 'utf8') > 100);
    assert.ok(Buffer.byteLength(archivePath, 'utf8') <= 255);
    assert.ok(member.prefix.length > 0, 'USTAR prefix must carry the path before the basename');
    assert.ok(Buffer.byteLength(member.name, 'utf8') <= 100);
    assert.ok(Buffer.byteLength(member.prefix, 'utf8') <= 155);
    assert.equal(`${member.prefix}/${member.name}`, archivePath);
    assert.equal(member.content.toString('utf8'), 'long path asset\n');
  });
});

test('rejects an overlong UTF-8 USTAR path without leaving a partial archive', async () => {
  await withFixture(async (fixture) => {
    const longRelativePath = path.join(
      'dist',
      'ü'.repeat(50),
      '界'.repeat(40),
      'é'.repeat(50),
      'asset.txt',
    );
    const sourceFile = path.join(fixture.webRoot, longRelativePath);
    await mkdir(path.dirname(sourceFile), { recursive: true });
    await writeFile(sourceFile, 'must not be archived\n');
    assert.ok(Buffer.byteLength(`skynex-app/${longRelativePath.split(path.sep).join('/')}`, 'utf8') > 255);
    const { packageCliRuntime } = await loadPackageRuntime();

    await assert.rejects(
      packageCliRuntime({ webRoot: fixture.webRoot, outputDir: fixture.outputDir }),
      /USTAR|tar path|path.{0,20}(255|length|long)|255/i,
    );
    const outputEntries = await readdir(fixture.outputDir).catch((error) => {
      assert.equal(error.code, 'ENOENT');
      return [];
    });
    assert.deepEqual(outputEntries, []);
  });
});

test('refuses archive and checksum collisions without changing the output directory', async (t) => {
  for (const collisionKind of ['archive', 'checksum']) {
    await t.test(`preserves a preexisting ${collisionKind}`, async () => {
      await withFixture(async (fixture) => {
        const { packageCliRuntime } = await loadPackageRuntime();
        const manifest = JSON.parse(await readFile(path.join(fixture.webRoot, 'package.json'), 'utf8'));
        const archiveName = `skynex-app-${manifest.version}-${process.platform}-${process.arch}.tar.gz`;
        const collisionName = collisionKind === 'archive' ? archiveName : `${archiveName}.sha256`;
        const collisionBytes = Buffer.from(`preexisting ${collisionKind} must remain unchanged\n`);
        const unrelatedName = 'unrelated.keep';
        const unrelatedBytes = Buffer.from('preserve unrelated output\n');
        await mkdir(fixture.outputDir);
        await writeFile(path.join(fixture.outputDir, collisionName), collisionBytes);
        await writeFile(path.join(fixture.outputDir, unrelatedName), unrelatedBytes);

        await assert.rejects(
          packageCliRuntime({ webRoot: fixture.webRoot, outputDir: fixture.outputDir }),
          /exist|collision|overwrite|refus|already/i,
        );
        assert.deepEqual((await readdir(fixture.outputDir)).sort(), [collisionName, unrelatedName].sort());
        assert.deepEqual(await readFile(path.join(fixture.outputDir, collisionName)), collisionBytes);
        assert.deepEqual(await readFile(path.join(fixture.outputDir, unrelatedName)), unrelatedBytes);
      });
    });
  }
});
