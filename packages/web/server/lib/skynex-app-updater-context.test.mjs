import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';
import test from 'node:test';
import { installSkynexAppRelease } from './skynex-app-updater.js';

function tarEntry(name, data, mode = 0o755) {
  const header = Buffer.alloc(512);
  const octal = (n, width) => `${n.toString(8).padStart(width - 1, '0')}\0`;
  header.write(name, 0, 100, 'utf8');
  header.write(octal(mode, 8), 100, 8);
  header.write(octal(0, 8), 108, 8);
  header.write(octal(0, 8), 116, 8);
  header.write(octal(data.length, 12), 124, 12);
  header.write(octal(0, 12), 136, 12);
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write('ustar\0', 257, 6);
  header.write('00', 263, 2);
  header.write(`${header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0')}\0 `, 148, 8);
  const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  data.copy(padded);
  return Buffer.concat([header, padded]);
}

function archiveFor(version, platform = process.platform, arch = process.arch) {
  const cli = Buffer.from(`#!/usr/bin/env node\nif (process.argv.includes('--version')) process.stdout.write('${version}\\n');\n`);
  const archive = gzipSync(Buffer.concat([
    tarEntry('skynex-app/package.json', Buffer.from(JSON.stringify({ version }))),
    tarEntry('skynex-app/skynex-release.json', Buffer.from(JSON.stringify({ format: 1, version, platform, arch }))),
    tarEntry('skynex-app/bin/cli.js', cli),
    Buffer.alloc(1024),
  ]));
  const archiveName = `skynex-app-${version}-${platform}-${arch}.tar.gz`;
  const archiveUrl = `https://github.com/joeldevz/skynex-desktop/releases/download/v${version}/${archiveName}`;
  return {
    bytes: archive,
    release: {
      version, platform, arch, archiveName, archiveUrl, checksumUrl: `${archiveUrl}.sha256`,
      sha256: createHash('sha256').update(archive).digest('hex'),
    },
  };
}

function writeOwnedInstall(root, version) {
  const app = path.join(root, 'versions', version, 'skynex-app');
  fs.mkdirSync(path.join(app, 'server', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'managed.json'), JSON.stringify({ format: 1, application: 'skynex-app' }));
  fs.writeFileSync(path.join(root, 'active.json'), JSON.stringify({ version, directory: `versions/${version}` }));
  return app;
}

test('managed install context follows the physical runtime and package-manager updates use its root', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'skynex-managed-context-'));
  try {
    const root = path.join(base, 'managed-data');
    const app = writeOwnedInstall(root, '1.2.3');
    const sourceDir = path.dirname(fileURLToPath(import.meta.url));
    const targetLib = path.join(app, 'server', 'lib');
    fs.copyFileSync(path.join(sourceDir, 'skynex-app-updater.js'), path.join(targetLib, 'skynex-app-updater.js'));
    fs.copyFileSync(path.join(sourceDir, 'package-manager.js'), path.join(targetLib, 'package-manager.js'));
    fs.writeFileSync(path.join(app, 'package.json'), '{"type":"module"}\n');
    const packageManagerUrl = pathToFileURL(path.join(targetLib, 'package-manager.js'));
    const manager = await import(`${packageManagerUrl.href}?test=${Date.now()}`);
    const updaterUrl = pathToFileURL(path.join(targetLib, 'skynex-app-updater.js'));
    const updater = await import(`${updaterUrl.href}?test=${Date.now()}`);
    assert.deepEqual(updater.getManagedSkynexAppInstallContext(), { root, applicationDirectory: app, version: '1.2.3' });
    const newVersion = '1.2.4';
    const { bytes, release } = archiveFor(newVersion);
    const metadataUrl = `https://api.github.com/repos/joeldevz/skynex-desktop/releases/tags/v${newVersion}`;
    const fetchCalls = [];
    const fetchImpl = async (url) => {
      fetchCalls.push(String(url));
      if (String(url) === metadataUrl) return { ok: true, url: String(url), json: async () => ({ tag_name: `v${newVersion}`, assets: [
        { name: release.archiveName, browser_download_url: release.archiveUrl },
        { name: `${release.archiveName}.sha256`, browser_download_url: release.checksumUrl },
      ] }) };
      if (String(url) === release.checksumUrl) return { ok: true, url: String(url), text: async () => `${release.sha256}  ${release.archiveName}\n` };
      if (String(url) === release.archiveUrl) return { ok: true, url: String(url), arrayBuffer: async () => bytes };
      throw new Error(`Unexpected fetch URL ${url}`);
    };

    const result = await manager.executeUpdate({ targetVersion: newVersion, fetchImpl, installRoot: path.join(base, 'wrong-root') });

    assert.equal(result.success, true, result.error);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'active.json'), 'utf8')).version, newVersion);
    assert.equal(fs.existsSync(path.join(base, 'wrong-root')), false);
    assert.deepEqual(fetchCalls, [metadataUrl, release.checksumUrl, release.archiveUrl]);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('fresh-root lock contention leaves the other installer lock intact', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'skynex-fresh-lock-'));
  const root = path.join(base, 'managed');
  const { bytes, release } = archiveFor('2.3.4');
  let releaseFirstFetch;
  let signalFetchStarted;
  const fetchStarted = new Promise((resolve) => { signalFetchStarted = resolve; });
  const firstFetch = new Promise((resolve) => { releaseFirstFetch = resolve; });
  const fetchImpl = async () => { signalFetchStarted(); await firstFetch; return { ok: true, arrayBuffer: async () => bytes }; };
  try {
    const firstInstall = installSkynexAppRelease({ release, installRoot: root, fetchImpl });
    await fetchStarted;
    const lock = path.join(root, '.install.lock');
    const ownerBytes = fs.readFileSync(lock);
    await assert.rejects(installSkynexAppRelease({ release, installRoot: root, fetchImpl: async () => { throw new Error('must not fetch'); } }), /unowned|managed|another install/i);
    assert.deepEqual(fs.readFileSync(lock), ownerBytes);
    releaseFirstFetch();
    const installed = await firstInstall;
    assert.equal(installed.applicationDirectory, path.join(root, 'versions', '2.3.4', 'skynex-app'));
    assert.equal(fs.existsSync(installed.applicationDirectory), true);
    assert.equal(fs.existsSync(lock), false);
  } finally {
    releaseFirstFetch();
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test('failed install preserves a preexisting empty managed-root directory', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'skynex-empty-root-'));
  const root = path.join(base, 'managed');
  fs.mkdirSync(root);
  const { release } = archiveFor('3.4.5');
  try {
    await assert.rejects(installSkynexAppRelease({ release, installRoot: root, fetchImpl: async () => { throw new Error('offline fixture'); } }), /release request failed/i);
    assert.equal(fs.existsSync(root), true);
    assert.deepEqual(fs.readdirSync(root), []);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('archive path aliases cannot overwrite staged files', async (t) => {
  for (const alias of ['skynex-app//bin/cli.js', 'skynex-app/bin//cli.js', 'skynex-app/bin/cli.js.', 'skynex-app/bin/cli.js ', 'skynex-app/bin/cli.js::$DATA']) {
    await t.test(alias, async () => {
      const base = fs.mkdtempSync(path.join(os.tmpdir(), 'skynex-archive-alias-'));
      const root = path.join(base, 'managed');
      const activeVersion = '4.5.6';
      const newVersion = '4.5.7';
      writeOwnedInstall(root, activeVersion);
      const sentinel = path.join(root, 'preserve.txt');
      fs.writeFileSync(sentinel, 'keep');
      const { bytes, release } = archiveFor(newVersion);
      const duplicateCli = Buffer.from(`#!/usr/bin/env node\nif (process.argv.includes('--version')) process.stdout.write('${newVersion}\\n');\n`);
      const originalTar = gunzipSync(bytes);
      const archive = gzipSync(Buffer.concat([
        originalTar.subarray(0, originalTar.length - 1024),
        tarEntry(alias, duplicateCli),
        Buffer.alloc(1024),
      ]));
      const checksumRelease = { ...release, sha256: createHash('sha256').update(archive).digest('hex') };
      try {
        await assert.rejects(installSkynexAppRelease({
          release: checksumRelease,
          installRoot: root,
          fetchImpl: async () => ({ ok: true, arrayBuffer: async () => archive }),
        }), /unsafe|empty|duplicate/i);
        assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'active.json'), 'utf8')).version, activeVersion);
        assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
        assert.equal(fs.existsSync(path.join(root, 'versions', newVersion)), false);
        assert.equal(fs.existsSync(path.join(root, '.staging')), false);
      } finally {
        fs.rmSync(base, { recursive: true, force: true });
      }
    });
  }
});

test('exclusive staged writes preserve a colliding existing file and roll back', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'skynex-exclusive-write-'));
  const root = path.join(base, 'managed');
  const activeVersion = '5.6.7';
  const newVersion = '5.6.8';
  writeOwnedInstall(root, activeVersion);
  const sentinel = path.join(root, 'preserve.txt');
  fs.writeFileSync(sentinel, 'keep');
  const { bytes, release } = archiveFor(newVersion);
  const originalWriteFileSync = fs.writeFileSync;
  const collisionContents = Buffer.from('preexisting staged sentinel');
  let observedCollisionContents;
  fs.writeFileSync = function (file, data, options) {
    if (typeof file === 'string' && file.endsWith(`${path.sep}bin${path.sep}cli.js`)) {
      originalWriteFileSync(file, collisionContents);
      try {
        return originalWriteFileSync(file, data, options);
      } finally {
        observedCollisionContents = fs.readFileSync(file);
      }
    }
    return originalWriteFileSync(file, data, options);
  };
  try {
    await assert.rejects(installSkynexAppRelease({
      release,
      installRoot: root,
      fetchImpl: async () => ({ ok: true, arrayBuffer: async () => bytes }),
    }), /EEXIST/);
    assert.deepEqual(observedCollisionContents, collisionContents);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'active.json'), 'utf8')).version, activeVersion);
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'keep');
    assert.equal(fs.existsSync(path.join(root, 'versions', newVersion)), false);
    assert.equal(fs.existsSync(path.join(root, '.staging')), false);
  } finally {
    fs.writeFileSync = originalWriteFileSync;
    fs.rmSync(base, { recursive: true, force: true });
  }
});
