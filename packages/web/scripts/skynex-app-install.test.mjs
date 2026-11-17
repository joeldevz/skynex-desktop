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
  const cli = Buffer.from(`#!/usr/bin/env node\nif (process.argv.includes('--version')) process.stdout.write('${releaseVersion}\\n');\n`);
  const tar = Buffer.concat([
    tarEntry('skynex-app/package.json', Buffer.from(JSON.stringify({ version: releaseVersion }))),
    tarEntry('skynex-app/skynex-release.json', Buffer.from(JSON.stringify({ format: 1, version: releaseVersion, platform: process.platform, arch: process.arch }))),
    tarEntry('skynex-app/bin/cli.js', cli),
    Buffer.alloc(1024),
  ]);
  const bytes = gzipSync(tar);
  const archiveName = `skynex-app-${releaseVersion}-${process.platform}-${process.arch}.tar.gz`;
  const archiveUrl = `https://github.com/joeldevz/skynex-desktop/releases/download/v${releaseVersion}/${archiveName}`;
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const routes = new Map([
    [`https://api.github.com/repos/joeldevz/skynex-desktop/releases/tags/v${releaseVersion}`, {
      json: async () => ({ tag_name: `v${releaseVersion}`, assets: [
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
  const root = await mkdtemp(path.join(os.tmpdir(), 'skynex-install-app-only-'));
  const home = path.join(root, 'home');
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
  };
  try { await run(root, env); } finally { await rm(root, { recursive: true, force: true }); }
}

function install(root, env, releaseVersion = version, overrides = {}) {
  return installSkynexApp({
    version: releaseVersion,
    installRoot: path.join(root, 'data', 'skynex-app'),
    binDir: path.join(root, 'bin'),
    fetchImpl: makeRelease(releaseVersion).fetchImpl,
    env,
    ...overrides,
  });
}

test('installs only the application and leaves manual tool configuration and files untouched', async () => {
  await fixture(async (root, env) => {
    const configRoot = path.join(env.XDG_CONFIG_HOME, 'opencode');
    const config = path.join(configRoot, 'opencode.jsonc');
    const binDir = path.join(root, 'bin');
    const stateRoot = path.join(env.XDG_STATE_HOME, 'skynex');
    const memoryRoot = path.join(env.XDG_DATA_HOME, 'neurox');
    await mkdir(path.join(configRoot, 'agents'), { recursive: true });
    await mkdir(binDir, { recursive: true });
    await mkdir(stateRoot, { recursive: true });
    await mkdir(memoryRoot, { recursive: true });
    const configBytes = Buffer.from('// preserve malformed user config\n{ "mcp": { "servers": { "neurox": { "command": "custom-neurox" } }\n');
    const skynexLauncher = Buffer.from('manual skynex tool\n');
    const neuroxLauncher = Buffer.from('manual neurox tool\n');
    const agent = Buffer.from('user agent\n');
    const lock = Buffer.from('manual lock\n');
    const memory = Buffer.from([0, 1, 2, 255]);
    await writeFile(config, configBytes);
    await writeFile(path.join(binDir, 'skynex'), skynexLauncher);
    await writeFile(path.join(binDir, 'neurox'), neuroxLauncher);
    await writeFile(path.join(configRoot, 'agents', 'custom.md'), agent);
    await writeFile(path.join(stateRoot, 'lock.json'), lock);
    await writeFile(path.join(memoryRoot, 'memory.db'), memory);

    const result = await install(root, env);

    const appRoot = path.join(root, 'data', 'skynex-app', 'versions', version, 'skynex-app');
    assert.equal(result.version, version);
    assert.deepEqual((await readdir(binDir)).sort(), ['neurox', 'openchamber', 'skynex', 'skynex-app']);
    assert.deepEqual(await readFile(config), configBytes);
    assert.deepEqual(await readFile(path.join(binDir, 'skynex')), skynexLauncher);
    assert.deepEqual(await readFile(path.join(binDir, 'neurox')), neuroxLauncher);
    assert.deepEqual(await readFile(path.join(configRoot, 'agents', 'custom.md')), agent);
    assert.deepEqual(await readFile(path.join(stateRoot, 'lock.json')), lock);
    assert.deepEqual(await readFile(path.join(memoryRoot, 'memory.db')), memory);
    assert.equal(fs.existsSync(path.join(appRoot, 'companions')), false);
    assert.equal(fs.existsSync(path.join(appRoot, 'node_modules', '@skynex-ai', 'cli')), false);
    const launched = spawnSync(process.execPath, [path.join(root, 'bin', 'skynex-app'), '--version'], { encoding: 'utf8' });
    assert.equal(launched.status, 0, launched.stderr);
    assert.equal(launched.stdout.trim(), version);
  });
});

test('does not create OpenCode configuration on a clean application install', async () => {
  await fixture(async (root, env) => {
    const configRoot = path.join(env.XDG_CONFIG_HOME, 'opencode');
    await install(root, env);
    assert.equal(fs.existsSync(configRoot), false);
  });
});

test('activates a newer app version through the existing owned launchers', async () => {
  await fixture(async (root, env) => {
    const first = await install(root, env);
    const launcher = await readFile(path.join(root, 'bin', 'skynex-app'));
    const nextVersion = '8.7.7-test.2';
    const next = await install(root, env, nextVersion);
    assert.equal(first.version, version);
    assert.equal(next.version, nextVersion);
    assert.deepEqual(await readFile(path.join(root, 'bin', 'skynex-app')), launcher);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, 'data', 'skynex-app', 'active.json'), 'utf8')), {
      version: nextVersion, directory: `versions/${nextVersion}`,
    });
    assert.equal(fs.existsSync(path.join(root, 'data', 'skynex-app', 'versions', version, 'skynex-app', 'bin', 'cli.js')), true);
    for (const file of [path.join(root, 'bin', 'skynex-app'), path.join(root, 'bin', 'openchamber'), path.join(root, 'data', 'skynex-app', 'launcher.mjs')]) {
      const launched = spawnSync(process.execPath, [file, '--version'], { encoding: 'utf8', env });
      assert.equal(launched.status, 0, launched.stderr);
      assert.equal(launched.stdout.trim(), nextVersion);
    }
  });
});

test('refuses an unowned managed startup dispatcher before requesting release data', async () => {
  await fixture(async (root, env) => {
    await install(root, env);
    const dispatcher = path.join(root, 'data', 'skynex-app', 'launcher.mjs');
    await writeFile(dispatcher, 'user-owned startup command\n');
    let requested = false;
    await assert.rejects(install(root, env, '8.7.7-test.2', {
      fetchImpl: async (...args) => { requested = true; return makeRelease('8.7.7-test.2').fetchImpl(...args); },
    }), /unowned|modified launcher/i);
    assert.equal(requested, false);
    assert.equal(await readFile(dispatcher, 'utf8'), 'user-owned startup command\n');
  });
});

test('refuses an unowned application launcher before requesting release data', async () => {
  await fixture(async (root, env) => {
    const binDir = path.join(root, 'bin');
    await mkdir(binDir);
    const userLauncher = Buffer.from('user-owned launcher\n');
    await writeFile(path.join(binDir, 'skynex-app'), userLauncher);
    let requested = false;
    await assert.rejects(install(root, env, version, {
      fetchImpl: async (...args) => { requested = true; return makeRelease().fetchImpl(...args); },
    }), /unowned|modified launcher/i);
    assert.equal(requested, false);
    assert.deepEqual(await readFile(path.join(binDir, 'skynex-app')), userLauncher);
  });
});

test('rolls back activation and app launchers when launcher installation fails', async () => {
  await fixture(async (root, env) => {
    let writes = 0;
    const failSecondWrite = (...args) => {
      writes += 1;
      if (writes === 2) throw new Error('injected launcher write failure');
      return fs.writeFileSync(...args);
    };
    await assert.rejects(install(root, env, version, { writeFileImpl: failSecondWrite }), /injected launcher write failure/);
    assert.deepEqual(await readdir(path.join(root, 'bin')).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error)), []);
    assert.equal(fs.existsSync(path.join(root, 'data', 'skynex-app')), false);
  });
});
