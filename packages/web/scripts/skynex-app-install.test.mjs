import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import test from 'node:test';
import { installSkynexApp } from './skynex-app-install.mjs';

const version = '8.7.6-test.2';

function tarEntry(name, contents, mode = 0o755) {
  const header = Buffer.alloc(512);
  const octal = (number, width) => `${number.toString(8).padStart(width - 1, '0')}\0`;
  header.write(name, 0, 100, 'utf8');
  header.write(octal(mode, 8), 100, 8, 'ascii');
  header.write(octal(0, 8), 108, 8, 'ascii');
  header.write(octal(0, 8), 116, 8, 'ascii');
  header.write(octal(contents.length, 12), 124, 12, 'ascii');
  header.write(octal(0, 12), 136, 12, 'ascii');
  header.fill(0x20, 148, 156);
  header[156] = 0x30;
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  const padded = Buffer.alloc(Math.ceil(contents.length / 512) * 512);
  contents.copy(padded);
  return Buffer.concat([header, padded]);
}

function makeRelease(releaseVersion = version) {
  const version = releaseVersion;
  const cli = Buffer.from(`#!/usr/bin/env node\nif (process.argv.includes('--version')) process.stdout.write('${version}\\n');\n`);
  const tar = Buffer.concat([
    tarEntry('skynex-app/package.json', Buffer.from(JSON.stringify({ version }))),
    tarEntry('skynex-app/skynex-release.json', Buffer.from(JSON.stringify({ format: 1, version, platform: process.platform, arch: process.arch }))),
    tarEntry('skynex-app/bin/cli.js', cli),
    Buffer.alloc(1024),
  ]);
  const bytes = gzipSync(tar);
  const archiveName = `skynex-app-${version}-${process.platform}-${process.arch}.tar.gz`;
  const archiveUrl = `https://github.com/joeldevz/skynex-desktop/releases/download/v${version}/${archiveName}`;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const routes = new Map([
    [`https://api.github.com/repos/joeldevz/skynex-desktop/releases/tags/v${version}`, {
      json: async () => ({ tag_name: `v${version}`, assets: [
        { name: archiveName, browser_download_url: archiveUrl },
        { name: `${archiveName}.sha256`, browser_download_url: `${archiveUrl}.sha256` },
      ] }),
    }],
    [`${archiveUrl}.sha256`, { text: async () => `${sha256}  ${archiveName}\n` }],
    [archiveUrl, { arrayBuffer: async () => bytes }],
  ]);
  const fetchImpl = async (url) => {
    const value = routes.get(String(url));
    if (!value) throw new Error(`Unexpected URL ${url}`);
    return { ok: true, url: String(url), ...value };
  };
  return { fetchImpl };
}

async function fixture(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'skynex-install-bootstrap-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('refuses an unowned stable launcher before requesting release data', async () => {
  await fixture(async (root) => {
    const bindir = path.join(root, 'bin');
    await mkdir(bindir);
    await writeFile(path.join(bindir, 'skynex-app'), 'user-owned launcher\n');
    const { fetchImpl } = makeRelease();
    let requested = false;
    const observedFetch = async (...args) => { requested = true; return fetchImpl(...args); };

    await assert.rejects(installSkynexApp({ installRoot: path.join(root, 'data'), binDir: bindir, fetchImpl: observedFetch }), /unowned|modified launcher/i);
    assert.equal(requested, false);
    assert.equal(await readFile(path.join(bindir, 'skynex-app'), 'utf8'), 'user-owned launcher\n');
  });
});

test('activates verified payload and installs stable launchers without touching the real home', async () => {
  await fixture(async (root) => {
    const installRoot = path.join(root, 'data', 'skynex-app');
    const binDir = path.join(root, 'bin');
    const { fetchImpl } = makeRelease();
    const result = await installSkynexApp({ version, installRoot, binDir, fetchImpl });

    assert.equal(result.version, version);
    assert.equal(await readFile(path.join(installRoot, 'managed.json'), 'utf8'), '{"format":1,"application":"skynex-app"}\n');
    assert.deepEqual((await readdir(binDir)).sort(), ['openchamber', 'skynex-app']);
    assert.equal(fs.existsSync(path.join(installRoot, 'launcher.mjs')), true);
    const launched = spawnSync(process.execPath, [path.join(binDir, 'skynex-app'), '--version'], { encoding: 'utf8' });
    assert.equal(launched.status, 0, launched.stderr);
    assert.equal(launched.stdout.trim(), version);
  });
});

test('installs a newer version through existing owned launchers and preserves the previous release', async () => {
  await fixture(async (root) => {
    const installRoot = path.join(root, 'data', 'skynex-app');
    const binDir = path.join(root, 'bin');
    await installSkynexApp({ version, installRoot, binDir, fetchImpl: makeRelease().fetchImpl });
    const originalLauncher = await readFile(path.join(binDir, 'skynex-app'));
    const nextVersion = '8.7.7-test.2';

    await installSkynexApp({ version: nextVersion, installRoot, binDir, fetchImpl: makeRelease(nextVersion).fetchImpl });

    assert.deepEqual(await readFile(path.join(binDir, 'skynex-app')), originalLauncher);
    assert.deepEqual(JSON.parse(await readFile(path.join(installRoot, 'active.json'), 'utf8')), {
      version: nextVersion, directory: `versions/${nextVersion}`,
    });
    assert.equal(fs.existsSync(path.join(installRoot, 'versions', version, 'skynex-app', 'bin', 'cli.js')), true);
    for (const name of ['skynex-app', 'openchamber']) {
      const launched = spawnSync(process.execPath, [path.join(binDir, name), '--version'], { encoding: 'utf8' });
      assert.equal(launched.status, 0, launched.stderr);
      assert.equal(launched.stdout.trim(), nextVersion);
    }
    const registeredStartup = spawnSync(process.execPath, [path.join(installRoot, 'launcher.mjs'), '--version'], { encoding: 'utf8' });
    assert.equal(registeredStartup.status, 0, registeredStartup.stderr);
    assert.equal(registeredStartup.stdout.trim(), nextVersion);
  });
});

test('refuses an unowned managed startup dispatcher before requesting release data', async () => {
  await fixture(async (root) => {
    const installRoot = path.join(root, 'data', 'skynex-app');
    const binDir = path.join(root, 'bin');
    await installSkynexApp({ version, installRoot, binDir, fetchImpl: makeRelease().fetchImpl });
    const dispatcher = path.join(installRoot, 'launcher.mjs');
    await writeFile(dispatcher, 'user-owned startup command\n');
    let requested = false;
    const fetchImpl = async (...args) => { requested = true; return makeRelease('8.7.7-test.2').fetchImpl(...args); };

    await assert.rejects(installSkynexApp({ version: '8.7.7-test.2', installRoot, binDir, fetchImpl }), /unowned|modified launcher/i);
    assert.equal(requested, false);
    assert.equal(await readFile(dispatcher, 'utf8'), 'user-owned startup command\n');
  });
});

test('rolls activation and launcher files back when launcher installation fails', async () => {
  await fixture(async (root) => {
    const installRoot = path.join(root, 'data', 'skynex-app');
    const binDir = path.join(root, 'bin');
    const { fetchImpl } = makeRelease();
    let writes = 0;
    const failSecondWrite = (...args) => {
      writes += 1;
      if (writes === 2) throw new Error('injected launcher write failure');
      return fs.writeFileSync(...args);
    };

    await assert.rejects(installSkynexApp({ version, installRoot, binDir, fetchImpl, writeFileImpl: failSecondWrite }), /injected launcher write failure/);
    assert.deepEqual(await readdir(binDir), []);
    assert.equal(fs.existsSync(path.join(installRoot, 'launcher.mjs')), false);
    assert.equal(fs.existsSync(path.join(installRoot, 'active.json')), false);
    assert.equal(fs.existsSync(installRoot), false);
  });
});
