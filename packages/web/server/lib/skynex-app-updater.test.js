import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import zlib from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

const RELEASE_API = 'https://api.github.com/repos/joeldevz/skynex-desktop/releases/latest';
const OWNER_MARKER = { format: 1, application: 'skynex-app' };
const TARGET = { version: '1.2.3', platform: 'linux', arch: 'x64' };
const DEFAULT_LIMITS = { maxArchiveBytes: 8_000_000, maxDecompressedBytes: 24_000_000, maxFiles: 1000 };

function makeTarEntry(name, contents = Buffer.alloc(0), options = {}) {
  const { type = '0', mode = type === '5' ? 0o755 : 0o755, linkName = '' } = options;
  const header = Buffer.alloc(512);
  const write = (value, start, length) => header.write(String(value), start, length, 'utf8');
  const octal = (value, length) => value.toString(8).padStart(length - 1, '0') + '\0';
  write(name, 0, 100);
  write(octal(mode, 8), 100, 8);
  write(octal(0, 8), 108, 8);
  write(octal(0, 8), 116, 8);
  write(octal(contents.length, 12), 124, 12);
  write(octal(0, 12), 136, 12);
  header.fill(0x20, 148, 156);
  write(type, 156, 1);
  write(linkName, 157, 100);
  write('ustar\0', 257, 6);
  write('00', 263, 2);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8);
  const paddedContents = Buffer.alloc(Math.ceil(contents.length / 512) * 512);
  contents.copy(paddedContents);
  return Buffer.concat([header, paddedContents]);
}

function makeArchive({
  version = TARGET.version,
  platform = TARGET.platform,
  arch = TARGET.arch,
  marker = { format: 1, version, platform, arch },
  packageVersion = version,
  includePackage = true,
  includeCli = true,
  cliScript = null,
  extraEntries = [],
} = {}) {
  const cli = Buffer.from(cliScript ?? `#!/usr/bin/env node\nif (process.argv.includes('--version')) process.stdout.write('${version}\\n');\n`);
  const entries = [makeTarEntry('skynex-app/', Buffer.alloc(0), { type: '5' })];
  if (includePackage) {
    entries.push(makeTarEntry('skynex-app/package.json', Buffer.from(JSON.stringify({ version: packageVersion }))));
  }
  if (marker !== null) {
    entries.push(makeTarEntry('skynex-app/skynex-release.json', Buffer.from(JSON.stringify(marker))));
  }
  if (includeCli) entries.push(makeTarEntry('skynex-app/bin/cli.js', cli));
  entries.push(...extraEntries, Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(entries));
}

function readFixtureTar(archive) {
  const tar = zlib.gunzipSync(archive);
  const members = [];
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const storedChecksum = Number.parseInt(header.subarray(148, 156).toString('ascii').trim().replace(/\0/g, ''), 8);
    const checksumHeader = Buffer.from(header);
    checksumHeader.fill(0x20, 148, 156);
    expect(checksumHeader.reduce((sum, byte) => sum + byte, 0)).toBe(storedChecksum);
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/s, '');
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
    const size = Number.parseInt(header.subarray(124, 136).toString('ascii').trim().replace(/\0/g, ''), 8) || 0;
    members.push({ name: prefix ? `${prefix}/${name}` : name, type: header[156], size, mode: Number.parseInt(header.subarray(100, 108).toString('ascii').trim().replace(/\0/g, ''), 8) });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return members;
}

function makeFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    const key = String(url);
    calls.push(key);
    if (!Object.hasOwn(routes, key)) throw new Error(`Unexpected URL: ${key}`);
    return routes[key];
  };
  return { fetchImpl, calls };
}

function responseJson(value) {
  return { ok: true, json: async () => value };
}

function releaseFor(version, platform, arch, archiveBytes) {
  const archiveName = `skynex-app-${version}-${platform}-${arch}.tar.gz`;
  const prefix = `https://github.com/joeldevz/skynex-desktop/releases/download/v${version}/${archiveName}`;
  return {
    version,
    archiveName,
    archiveUrl: prefix,
    checksumUrl: `${prefix}.sha256`,
    sha256: crypto.createHash('sha256').update(archiveBytes).digest('hex'),
  };
}

function releaseListing(release) {
  return {
    tag_name: `v${release.version}`,
    assets: [
      { name: release.archiveName, browser_download_url: release.archiveUrl },
      { name: `${release.archiveName}.sha256`, browser_download_url: release.checksumUrl },
    ],
  };
}

function archiveRoutes(release, bytes) {
  return {
    [release.archiveUrl]: { ok: true, arrayBuffer: async () => bytes },
  };
}

function createOwnedInstall(root) {
  fs.mkdirSync(path.join(root, 'versions', '1.2.2', 'skynex-app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'managed.json'), JSON.stringify(OWNER_MARKER));
  fs.writeFileSync(path.join(root, 'active.json'), JSON.stringify({ version: '1.2.2', directory: 'versions/1.2.2' }));
  fs.writeFileSync(path.join(root, 'versions', '1.2.2', 'skynex-app', 'preserved.txt'), 'old release bytes');
  fs.writeFileSync(path.join(root, 'unrelated.txt'), 'unrelated bytes');
}

function snapshotTree(root) {
  const entries = [];
  const visit = (current, relative = '') => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const child = path.join(current, entry.name);
      if (entry.isDirectory()) {
        entries.push([childRelative, 'directory']);
        visit(child, childRelative);
      } else if (entry.isSymbolicLink()) {
        entries.push([childRelative, `symlink:${fs.readlinkSync(child)}`]);
      } else {
        entries.push([childRelative, crypto.createHash('sha256').update(fs.readFileSync(child)).digest('hex')]);
      }
    }
  };
  visit(root);
  return entries;
}

describe('skynex-app release discovery and installation', () => {
  let tempRoot;
  let children = [];

  afterEach(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        await once(child, 'exit');
      }
    }
    children = [];
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  function newTempRoot() {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'skynex-app-updater-'));
    return tempRoot;
  }

  it('builds checksum-valid ustar fixtures with the required root metadata and executable', () => {
    const members = readFixtureTar(makeArchive());
    expect(members.map(({ name }) => name)).toEqual([
      'skynex-app/',
      'skynex-app/package.json',
      'skynex-app/skynex-release.json',
      'skynex-app/bin/cli.js',
    ]);
    expect(members[0].type).toBe('5'.charCodeAt(0));
    expect(members[3].mode & 0o111).not.toBe(0);
    expect(members[3].size).toBeGreaterThan(0);
  });

  it.each([
    ['linux', 'x64'], ['linux', 'arm64'],
    ['darwin', 'x64'], ['darwin', 'arm64'],
    ['win32', 'x64'], ['win32', 'arm64'],
  ])('discovers only canonical assets for %s %s', async (platform, arch) => {
    const { getLatestSkynexAppRelease } = await import('./skynex-app-updater.js');
    const bytes = makeArchive({ platform, arch });
    const release = releaseFor(TARGET.version, platform, arch, bytes);
    const { fetchImpl, calls } = makeFetch({
      [RELEASE_API]: responseJson(releaseListing(release)),
      [release.checksumUrl]: { ok: true, text: async () => `${release.sha256}  ${release.archiveName}\n` },
    });

    const found = await getLatestSkynexAppRelease({ fetchImpl, platform, arch });

    expect(calls).toEqual([RELEASE_API, release.checksumUrl]);
    expect(found).toMatchObject(release);
  });

  it.each([
    ['unexpected publisher host', (listing) => { listing.assets[0].browser_download_url = listing.assets[0].browser_download_url.replace('github.com', 'downloads.example'); }],
    ['noncanonical archive name', (listing) => { listing.assets[0].name = 'skynex-app-1.2.3-linux-arm64.tar.gz'; }],
    ['release tag mismatch', (listing) => { listing.tag_name = 'v1.2.4'; }],
    ['missing checksum asset', (listing) => { listing.assets.pop(); }],
  ])('rejects %s during release discovery', async (_case, mutate) => {
    const { getLatestSkynexAppRelease } = await import('./skynex-app-updater.js');
    const bytes = makeArchive();
    const release = releaseFor(TARGET.version, TARGET.platform, TARGET.arch, bytes);
    const listing = releaseListing(release);
    mutate(listing);
    const { fetchImpl } = makeFetch({ [RELEASE_API]: responseJson(listing) });

    await expect(getLatestSkynexAppRelease({ fetchImpl, platform: TARGET.platform, arch: TARGET.arch }))
      .rejects.toThrow();
  });

  it('rejects a noncanonical checksum asset URL even when that URL serves a valid digest', async () => {
    const { getLatestSkynexAppRelease } = await import('./skynex-app-updater.js');
    const bytes = makeArchive();
    const release = releaseFor(TARGET.version, TARGET.platform, TARGET.arch, bytes);
    const noncanonicalChecksumUrl = `https://github.com/joeldevz/skynex-app/releases/download/v${TARGET.version}/${release.archiveName}.sha256`;
    const listing = releaseListing(release);
    listing.assets[1].browser_download_url = noncanonicalChecksumUrl;
    const { fetchImpl, calls } = makeFetch({
      [RELEASE_API]: responseJson(listing),
      [noncanonicalChecksumUrl]: { ok: true, text: async () => `${release.sha256}  ${release.archiveName}\n` },
    });

    await expect(getLatestSkynexAppRelease({ fetchImpl, platform: TARGET.platform, arch: TARGET.arch }))
      .rejects.toThrow();

    expect(calls).toEqual([RELEASE_API]);
  });

  it('reports unsupported platform or architecture without attempting release discovery', async () => {
    const { getLatestSkynexAppRelease } = await import('./skynex-app-updater.js');
    const { fetchImpl, calls } = makeFetch({});

    await expect(getLatestSkynexAppRelease({ fetchImpl, platform: 'freebsd', arch: 'x64' }))
      .rejects.toThrow(/unsupported/i);
    await expect(getLatestSkynexAppRelease({ fetchImpl, platform: 'linux', arch: 'riscv64' }))
      .rejects.toThrow(/unsupported/i);
    expect(calls).toEqual([]);
  });

  it.each([
    ['marker format', { marker: { format: 2, version: TARGET.version, platform: TARGET.platform, arch: TARGET.arch } }],
    ['marker version', { marker: { format: 1, version: '1.2.4', platform: TARGET.platform, arch: TARGET.arch } }],
    ['marker platform', { marker: { format: 1, version: TARGET.version, platform: 'darwin', arch: TARGET.arch } }],
    ['marker architecture', { marker: { format: 1, version: TARGET.version, platform: TARGET.platform, arch: 'arm64' } }],
    ['missing release marker', { marker: null }],
    ['missing package manifest', { includePackage: false }],
    ['package version mismatch', { packageVersion: '1.2.4' }],
    ['missing CLI entrypoint', { includeCli: false }],
  ])('refuses %s and leaves an owned install byte-for-byte unchanged', async (_case, archiveOptions) => {
    const { installSkynexAppRelease } = await import('./skynex-app-updater.js');
    const root = path.join(newTempRoot(), 'install');
    fs.mkdirSync(root);
    createOwnedInstall(root);
    const before = snapshotTree(root);
    const bytes = makeArchive(archiveOptions);
    const release = releaseFor(TARGET.version, TARGET.platform, TARGET.arch, bytes);
    const { fetchImpl } = makeFetch(archiveRoutes(release, bytes));

    await expect(installSkynexAppRelease({ release, installRoot: root, fetchImpl })).rejects.toThrow();

    expect(snapshotTree(root)).toEqual(before);
  });

  it('rejects a digest mismatch when the archive metadata matches the requested release', async () => {
    const { installSkynexAppRelease } = await import('./skynex-app-updater.js');
    const root = path.join(newTempRoot(), 'install');
    fs.mkdirSync(root);
    createOwnedInstall(root);
    const before = snapshotTree(root);
    const bytes = makeArchive();
    const release = { ...releaseFor(TARGET.version, TARGET.platform, TARGET.arch, bytes), sha256: '0'.repeat(64) };
    const { fetchImpl } = makeFetch(archiveRoutes(release, bytes));

    await expect(installSkynexAppRelease({ release, installRoot: root, fetchImpl }))
      .rejects.toThrow(/checksum|digest|sha-?256/i);

    expect(snapshotTree(root)).toEqual(before);
  });

  it('rejects an archive version mismatch in an owned installation without replacing prior state', async () => {
    const { installSkynexAppRelease } = await import('./skynex-app-updater.js');
    const root = path.join(newTempRoot(), 'install');
    fs.mkdirSync(root);
    createOwnedInstall(root);
    const before = snapshotTree(root);
    const bytes = makeArchive({ version: '1.2.4' });
    const release = releaseFor(TARGET.version, TARGET.platform, TARGET.arch, bytes);
    const { fetchImpl } = makeFetch(archiveRoutes(release, bytes));

    await expect(installSkynexAppRelease({ release, installRoot: root, fetchImpl })).rejects.toThrow(/version/i);

    expect(snapshotTree(root)).toEqual(before);
  });

  it.each([
    ['wrong version', `#!/usr/bin/env node\nprocess.stdout.write('9.9.9\\n');\n`],
    ['nonzero exit', `#!/usr/bin/env node\nprocess.exit(7);\n`],
  ])('rejects a staged CLI that reports a %s and preserves the complete previous install', async (_case, cliScript) => {
    const { installSkynexAppRelease } = await import('./skynex-app-updater.js');
    const root = path.join(newTempRoot(), 'install');
    fs.mkdirSync(root);
    createOwnedInstall(root);
    const before = snapshotTree(root);
    const bytes = makeArchive({ cliScript });
    const release = releaseFor(TARGET.version, TARGET.platform, TARGET.arch, bytes);
    const { fetchImpl } = makeFetch(archiveRoutes(release, bytes));

    await expect(installSkynexAppRelease({ release, installRoot: root, fetchImpl }))
      .rejects.toThrow(/version|cli|exit|status/i);

    expect(snapshotTree(root)).toEqual(before);
  });

  it.each([
    ['absolute path', '/outside-sentinel'],
    ['backslash path', 'skynex-app\\outside-sentinel'],
    ['drive path', 'C:\\outside-sentinel'],
    ['traversal', 'skynex-app/../../../../outside-sentinel'],
    ['symbolic link', 'skynex-app/evil-link', '2', 'target'],
    ['hard link', 'skynex-app/evil-hardlink', '1', 'skynex-app/package.json'],
    ['special member', 'skynex-app/device', '3', ''],
    ['duplicate member', 'skynex-app/package.json', '0', ''],
    ['case collision', 'skynex-app/bin/CLI.js', '0', ''],
  ])('rejects %s without changing the old install or creating an outside sentinel', async (_case, name, type = '0', linkName = '') => {
    const { installSkynexAppRelease } = await import('./skynex-app-updater.js');
    const root = path.join(newTempRoot(), 'install');
    fs.mkdirSync(root);
    createOwnedInstall(root);
    const before = snapshotTree(root);
    const payload = type === '0' ? Buffer.from('malicious') : Buffer.alloc(0);
    const bytes = makeArchive({ extraEntries: [makeTarEntry(name, payload, { type, linkName })] });
    const release = releaseFor(TARGET.version, TARGET.platform, TARGET.arch, bytes);
    const { fetchImpl } = makeFetch(archiveRoutes(release, bytes));

    await expect(installSkynexAppRelease({ release, installRoot: root, fetchImpl })).rejects.toThrow();

    expect(snapshotTree(root)).toEqual(before);
    expect(fs.existsSync(path.join(root, 'outside-sentinel'))).toBe(false);
    expect(fs.existsSync(path.join(tempRoot, 'outside-sentinel'))).toBe(false);
  });

  it.each([
    ['invalid gzip stream', () => Buffer.from('not a gzip stream')],
    ['invalid ustar header checksum', () => {
      const tar = zlib.gunzipSync(makeArchive());
      tar[0] ^= 0xff;
      return zlib.gzipSync(tar);
    }],
  ])('refuses an %s before changing the owned install', async (_case, makeBadArchive) => {
    const { installSkynexAppRelease } = await import('./skynex-app-updater.js');
    const root = path.join(newTempRoot(), 'install');
    fs.mkdirSync(root);
    createOwnedInstall(root);
    const before = snapshotTree(root);
    const bytes = makeBadArchive();
    const release = releaseFor(TARGET.version, TARGET.platform, TARGET.arch, bytes);
    const { fetchImpl } = makeFetch(archiveRoutes(release, bytes));

    await expect(installSkynexAppRelease({ release, installRoot: root, fetchImpl })).rejects.toThrow();

    expect(snapshotTree(root)).toEqual(before);
  });

  it.each([
    ['compressed bytes', (bytes) => ({ maxArchiveBytes: bytes.length - 1 })],
    ['decompressed bytes', (bytes) => ({ maxDecompressedBytes: zlib.gunzipSync(bytes).length - 1 })],
    ['archive member count', () => ({ maxFiles: 3 })],
  ])('enforces the %s limit before changing the final install', async (_case, selectLimit) => {
    const { installSkynexAppRelease } = await import('./skynex-app-updater.js');
    const root = path.join(newTempRoot(), 'install');
    fs.mkdirSync(root);
    createOwnedInstall(root);
    const before = snapshotTree(root);
    const bytes = makeArchive();
    const release = releaseFor(TARGET.version, TARGET.platform, TARGET.arch, bytes);
    const limits = { ...DEFAULT_LIMITS, ...selectLimit(bytes) };
    const { fetchImpl } = makeFetch(archiveRoutes(release, bytes));

    await expect(installSkynexAppRelease({ release, installRoot: root, fetchImpl, limits }))
      .rejects.toThrow(/limit|large|member|file/i);

    expect(snapshotTree(root)).toEqual(before);
  });

  it('refuses a nonempty unowned root before downloading or writing', async () => {
    const { installSkynexAppRelease } = await import('./skynex-app-updater.js');
    const root = path.join(newTempRoot(), 'install');
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'user-data.txt'), 'leave untouched');
    const before = snapshotTree(root);
    const bytes = makeArchive();
    const release = releaseFor(TARGET.version, TARGET.platform, TARGET.arch, bytes);
    const { fetchImpl, calls } = makeFetch({});

    await expect(installSkynexAppRelease({ release, installRoot: root, fetchImpl })).rejects.toThrow(/owned|managed|install/i);

    expect(calls).toEqual([]);
    expect(snapshotTree(root)).toEqual(before);
  });

  it.each(['root', 'ancestor', 'active pointer'])('refuses a symlinked %s without following or changing its target', async (symlinkKind) => {
    const { installSkynexAppRelease } = await import('./skynex-app-updater.js');
    const base = newTempRoot();
    const actual = path.join(base, 'actual');
    fs.mkdirSync(actual);
    createOwnedInstall(actual);
    const targetPointer = path.join(base, 'outside-active.json');
    fs.writeFileSync(targetPointer, 'outside pointer bytes');
    let root = actual;
    if (symlinkKind === 'root') {
      root = path.join(base, 'root-link');
      fs.symlinkSync(actual, root, process.platform === 'win32' ? 'junction' : 'dir');
    } else if (symlinkKind === 'ancestor') {
      const ancestor = path.join(base, 'ancestor-link');
      fs.symlinkSync(base, ancestor, process.platform === 'win32' ? 'junction' : 'dir');
      root = path.join(ancestor, 'actual');
    } else {
      fs.rmSync(path.join(actual, 'active.json'));
      fs.symlinkSync(targetPointer, path.join(actual, 'active.json'), 'file');
      root = actual;
    }
    const before = snapshotTree(actual);
    const bytes = makeArchive();
    const release = releaseFor(TARGET.version, TARGET.platform, TARGET.arch, bytes);
    const { fetchImpl, calls } = makeFetch(archiveRoutes(release, bytes));

    await expect(installSkynexAppRelease({ release, installRoot: root, fetchImpl })).rejects.toThrow(/symlink|symbolic|path|owned/i);

    expect(calls).toEqual([]);
    expect(snapshotTree(actual)).toEqual(before);
    expect(fs.readFileSync(targetPointer, 'utf8')).toBe('outside pointer bytes');
  });

  it('takes the exclusive install lock and preserves an existing lock on contention', async () => {
    const { installSkynexAppRelease } = await import('./skynex-app-updater.js');
    const root = path.join(newTempRoot(), 'install');
    fs.mkdirSync(root);
    createOwnedInstall(root);
    const lockPath = path.join(root, '.install.lock');
    fs.writeFileSync(lockPath, 'other installer owns lock');
    const before = snapshotTree(root);
    const bytes = makeArchive();
    const release = releaseFor(TARGET.version, TARGET.platform, TARGET.arch, bytes);
    const { fetchImpl, calls } = makeFetch(archiveRoutes(release, bytes));

    await expect(installSkynexAppRelease({ release, installRoot: root, fetchImpl })).rejects.toThrow(/lock|install/i);

    expect(calls).toEqual([]);
    expect(snapshotTree(root)).toEqual(before);
  });

  it('rolls back pointer activation on an injected post-activation fault and preserves the previous release', async () => {
    const { installSkynexAppRelease } = await import('./skynex-app-updater.js');
    const root = path.join(newTempRoot(), 'install');
    fs.mkdirSync(root);
    createOwnedInstall(root);
    const before = snapshotTree(root);
    const bytes = makeArchive();
    const release = releaseFor(TARGET.version, TARGET.platform, TARGET.arch, bytes);
    const { fetchImpl } = makeFetch(archiveRoutes(release, bytes));
    const phases = [];

    await expect(installSkynexAppRelease({
      release,
      installRoot: root,
      fetchImpl,
      onPhase(phase) {
        phases.push(phase);
        if (phase === 'after-activate') throw new Error('injected activation fault');
      },
    })).rejects.toThrow('injected activation fault');

    expect(phases).toEqual(['before-activate', 'after-activate']);
    expect(snapshotTree(root)).toEqual(before);
  });

  it('initializes ownership only after a successful install and retains the previous version on success', async () => {
    const { installSkynexAppRelease } = await import('./skynex-app-updater.js');
    const root = path.join(newTempRoot(), 'install');
    const bytes = makeArchive();
    const release = releaseFor(TARGET.version, TARGET.platform, TARGET.arch, bytes);
    const { fetchImpl } = makeFetch(archiveRoutes(release, bytes));
    const result = await installSkynexAppRelease({ release, installRoot: root, fetchImpl });

    expect(JSON.parse(fs.readFileSync(path.join(root, 'managed.json'), 'utf8'))).toEqual(OWNER_MARKER);
    expect(JSON.parse(fs.readFileSync(path.join(root, 'active.json'), 'utf8')))
      .toEqual({ version: TARGET.version, directory: `versions/${TARGET.version}` });
    expect(result).toMatchObject({ version: TARGET.version });
  });

  it('installs a verified version without signaling an unrelated live process', async () => {
    const { installSkynexAppRelease } = await import('./skynex-app-updater.js');
    const root = path.join(newTempRoot(), 'install');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    children.push(child);
    await once(child, 'spawn');
    const bytes = makeArchive();
    const release = releaseFor(TARGET.version, TARGET.platform, TARGET.arch, bytes);
    const { fetchImpl } = makeFetch(archiveRoutes(release, bytes));

    await installSkynexAppRelease({ release, installRoot: root, fetchImpl });

    expect(() => process.kill(child.pid, 0)).not.toThrow();
  });

  it('activates the verified payload and its CLI prints the matching version', async () => {
    const { installSkynexAppRelease } = await import('./skynex-app-updater.js');
    const root = path.join(newTempRoot(), 'install');
    const bytes = makeArchive();
    const release = releaseFor(TARGET.version, TARGET.platform, TARGET.arch, bytes);
    const { fetchImpl } = makeFetch(archiveRoutes(release, bytes));

    await installSkynexAppRelease({ release, installRoot: root, fetchImpl });

    const active = JSON.parse(fs.readFileSync(path.join(root, 'active.json'), 'utf8'));
    const cliPath = path.join(root, active.directory, 'skynex-app', 'bin', 'cli.js');
    const cli = spawnSync(process.execPath, [cliPath, '--version'], { encoding: 'utf8' });
    expect(cli.status).toBe(0);
    expect(cli.stdout.trim()).toBe(TARGET.version);
    if (process.platform !== 'win32') expect(fs.statSync(cliPath).mode & 0o111).not.toBe(0);
  });
});
