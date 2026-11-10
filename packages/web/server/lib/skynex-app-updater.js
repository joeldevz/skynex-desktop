import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const OWNER = 'joeldevz/skynex-desktop';
const API = `https://api.github.com/repos/${OWNER}/releases`;
const GITHUB_ASSET_HOSTS = new Set(['api.github.com', 'github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const VALID_TARGETS = new Set(['linux:x64', 'linux:arm64', 'darwin:x64', 'darwin:arm64', 'win32:x64', 'win32:arm64']);
const DEFAULT_LIMITS = { maxArchiveBytes: 256 * 1024 * 1024, maxDecompressedBytes: 1024 * 1024 * 1024, maxFiles: 100000 };
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function validVersion(version) {
  return typeof version === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version);
}

function assertTarget(platform, arch) {
  if (!VALID_TARGETS.has(`${platform}:${arch}`)) throw new Error(`Unsupported platform or architecture: ${platform}/${arch}`);
}

function canonicalAsset(version, platform, arch) {
  const archiveName = `skynex-app-${version}-${platform}-${arch}.tar.gz`;
  const archiveUrl = `https://github.com/${OWNER}/releases/download/v${version}/${archiveName}`;
  return { archiveName, archiveUrl, checksumUrl: `${archiveUrl}.sha256` };
}

async function request(fetchImpl, url, accept) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { Accept: accept, 'User-Agent': 'skynex-app-updater' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error('GitHub release request failed');
  }
  if (!response.ok) throw new Error(`GitHub release request failed with status ${response.status}`);
  if (response.url) {
    const final = new URL(response.url);
    if (final.protocol !== 'https:' || !GITHUB_ASSET_HOSTS.has(final.hostname)) throw new Error('GitHub asset redirected to an untrusted host');
  }
  return response;
}

async function responseBytes(response, limit) {
  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) throw new Error('Release archive exceeds compressed size limit');
        chunks.push(Buffer.from(value));
      }
    } finally {
      if (total > limit) await reader.cancel().catch(() => {});
    }
    return Buffer.concat(chunks, total);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > limit) throw new Error('Release archive exceeds compressed size limit');
  return bytes;
}

async function responseText(response, limit) {
  if (!response.body?.getReader && typeof response.arrayBuffer !== 'function' && typeof response.text === 'function') {
    const value = await response.text();
    if (Buffer.byteLength(value) > limit) throw new Error('GitHub checksum response exceeds size limit');
    return value;
  }
  const bytes = await responseBytes(response, limit);
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function parseChecksum(value, archiveName) {
  const match = /^([a-fA-F0-9]{64})(?:\s+\*?([^\r\n]+))?\s*$/.exec(value);
  if (!match || (match[2] && match[2] !== archiveName)) throw new Error('Invalid release SHA-256 checksum file');
  return match[1].toLowerCase();
}

async function getRelease({ fetchImpl = globalThis.fetch, platform = process.platform, arch = process.arch, version, includeChecksum = true } = {}) {
  assertTarget(platform, arch);
  if (version !== undefined && !validVersion(version)) throw new Error(`Invalid release version: ${String(version)}`);
  const url = version ? `${API}/tags/v${version}` : `${API}/latest`;
  const metadata = await (await request(fetchImpl, url, 'application/vnd.github+json')).json();
  const releaseVersion = typeof metadata?.tag_name === 'string' && metadata.tag_name.startsWith('v') ? metadata.tag_name.slice(1) : '';
  if (!validVersion(releaseVersion) || (version && releaseVersion !== version)) throw new Error('GitHub release tag does not match the requested version');
  const canonical = canonicalAsset(releaseVersion, platform, arch);
  const assets = Array.isArray(metadata.assets) ? metadata.assets : [];
  const archive = assets.find((asset) => asset?.name === canonical.archiveName);
  const checksum = assets.find((asset) => asset?.name === `${canonical.archiveName}.sha256`);
  if (archive?.browser_download_url !== canonical.archiveUrl || checksum?.browser_download_url !== canonical.checksumUrl) {
    throw new Error('GitHub release is missing canonical archive or checksum assets');
  }
  const checksumResponse = includeChecksum ? await request(fetchImpl, canonical.checksumUrl, 'text/plain') : null;
  const sha256 = checksumResponse ? parseChecksum(await responseText(checksumResponse, 4096), canonical.archiveName) : undefined;
  return { version: releaseVersion, platform, arch, ...canonical, sha256 };
}

export function getLatestSkynexAppRelease(options = {}) {
  return getRelease(options);
}

function parseOctal(field) {
  const raw = field.toString('ascii').replace(/\0.*$/, '').trim();
  if (!/^[0-7]+$/.test(raw)) throw new Error('Invalid ustar numeric field');
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value)) throw new Error('Invalid ustar numeric field');
  return value;
}

function decodeName(field) {
  const end = field.indexOf(0);
  const bytes = end === -1 ? field : field.subarray(0, end);
  const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.split('/').some((part) => part === '..' || part === '.')) throw new Error('Unsafe archive path');
  return value.replace(/\/$/, '');
}

function parseArchive(tar, limits) {
  const entries = [];
  const names = new Set();
  const folded = new Set();
  const pathCases = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (tar.subarray(offset).some((byte) => byte !== 0)) throw new Error('Invalid ustar trailing data');
      return entries;
    }
    if (header.toString('ascii', 257, 263) !== 'ustar\0') throw new Error('Invalid ustar header');
    const stored = parseOctal(header.subarray(148, 156));
    let calculated = 0;
    for (let i = 0; i < 512; i += 1) calculated += i >= 148 && i < 156 ? 32 : header[i];
    if (calculated !== stored) throw new Error('Invalid ustar header checksum');
    const name = decodeName(header.subarray(0, 100));
    const prefix = decodeName(header.subarray(345, 500));
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = parseOctal(header.subarray(124, 136));
    const type = header[156];
    const directory = type === 53 || type === 0 && fullName.endsWith('/');
    if (type !== 0 && type !== 48 && !directory) throw new Error('Archive contains a link or unsupported member type');
    if (directory && size !== 0) throw new Error('Archive directory contains data');
    if (fullName === 'skynex-app' && !directory) throw new Error('Archive root must be a directory');
    if (!fullName || (fullName !== 'skynex-app' && !fullName.startsWith('skynex-app/'))) throw new Error('Archive member is outside skynex-app/');
    const normalized = fullName.toLowerCase();
    if (names.has(fullName) || folded.has(normalized)) throw new Error('Archive contains duplicate or case-colliding members');
    const components = fullName.split('/');
    if (components.some((component) => !component || component.includes(':') || component.endsWith('.') || component.endsWith(' '))) throw new Error('Unsafe archive path component');
    for (let index = 0; index < components.length; index += 1) {
      const prefixPath = components.slice(0, index + 1).join('/');
      const prefixFolded = prefixPath.toLowerCase();
      const previousSpelling = pathCases.get(prefixFolded);
      if (previousSpelling && previousSpelling !== prefixPath) throw new Error('Archive contains duplicate or case-colliding paths');
      pathCases.set(prefixFolded, prefixPath);
    }
    names.add(fullName);
    folded.add(normalized);
    if (entries.length >= limits.maxFiles) throw new Error('Archive member count limit exceeded');
    const dataOffset = offset + 512;
    const end = dataOffset + size;
    if (end > tar.length) throw new Error('Truncated ustar member');
    entries.push({ name: fullName, directory, size, mode: parseOctal(header.subarray(100, 108)), data: tar.subarray(dataOffset, end) });
    offset = dataOffset + Math.ceil(size / 512) * 512;
  }
  throw new Error('Archive is missing its ustar terminator');
}

function assertSafePath(root, target) {
  if (path.resolve(root) === path.resolve(target)) return;
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw new Error('Invalid managed install path');
}

function assertNoSymlinkAncestors(target) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlinked install path refused: ${current}`);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function validateOwnership(root) {
  assertNoSymlinkAncestors(root);
  if (!fs.existsSync(root)) return { owned: false, empty: true };
  const stat = fs.lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Managed install root must be a real directory');
  const entries = fs.readdirSync(root);
  if (!entries.length) return { owned: false, empty: true };
  const markerPath = path.join(root, 'managed.json');
  const activePath = path.join(root, 'active.json');
  if (!fs.existsSync(markerPath) || !fs.existsSync(activePath)) throw new Error('Refusing to modify a nonempty unowned install root');
  if (fs.lstatSync(markerPath).isSymbolicLink() || fs.lstatSync(activePath).isSymbolicLink()) throw new Error('Symlinked managed install pointer refused');
  const marker = readJson(markerPath);
  if (marker?.format !== 1 || marker?.application !== 'skynex-app') throw new Error('Install root is owned by another application');
  const active = readJson(activePath);
  if (!validVersion(active?.version) || active.directory !== `versions/${active.version}`) throw new Error('Invalid active install pointer');
  const versions = path.join(root, 'versions');
  if (fs.existsSync(versions) && (fs.lstatSync(versions).isSymbolicLink() || !fs.lstatSync(versions).isDirectory())) throw new Error('Invalid versions directory');
  const activeDir = path.join(root, active.directory);
  assertSafePath(root, activeDir);
  assertNoSymlinkAncestors(activeDir);
  return { owned: true, empty: false, active };
}

async function downloadArchive(fetchImpl, url, maxBytes) {
  return responseBytes(await request(fetchImpl, url, 'application/gzip'), maxBytes);
}

function checkNodeVersion() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 24 || major === 24 && minor < 14) throw new Error('skynex-app requires Node.js 24.14 or newer');
}

function verifyCli(entryPath, version) {
  const result = spawnSync(process.execPath, [entryPath, '--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  if (result.status !== 0 || result.stdout.trim() !== version) throw new Error('Staged CLI failed version verification');
}

export async function installSkynexAppRelease({ release, installRoot, fetchImpl = globalThis.fetch, limits = {}, onPhase } = {}) {
  checkNodeVersion();
  if (!release || !validVersion(release.version)) throw new Error('A valid release is required');
  const { version, archiveName, archiveUrl, checksumUrl, sha256 } = release;
  const target = { platform: release.platform ?? process.platform, arch: release.arch ?? process.arch };
  assertTarget(target.platform, target.arch);
  const canonical = canonicalAsset(version, target.platform, target.arch);
  if (archiveName !== canonical.archiveName || archiveUrl !== canonical.archiveUrl || checksumUrl !== canonical.checksumUrl || !/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('Release metadata is not canonical');
  }
  const root = path.resolve(installRoot || path.join(process.env.XDG_DATA_HOME || path.join(process.env.HOME || process.env.USERPROFILE || '', '.local', 'share'), 'skynex-app'));
  const ownership = validateOwnership(root);
  const effectiveLimits = { ...DEFAULT_LIMITS, ...limits };
  for (const key of Object.keys(DEFAULT_LIMITS)) {
    if (!Number.isSafeInteger(effectiveLimits[key]) || effectiveLimits[key] <= 0) throw new Error(`Invalid ${key} limit`);
  }
  let lockPath;
  let lockHeld = false;
  let stageRoot;
  let pointerTemp;
  let installedVersionPath;
  let stagedVersionPath;
  let previousPointer;
  let activated = false;
  let createdRoot = false;
  try {
    if (!ownership.owned) {
      createdRoot = Boolean(fs.mkdirSync(root, { recursive: true }));
      assertNoSymlinkAncestors(root);
    }
    lockPath = path.join(root, '.install.lock');
    let lock;
    try { lock = fs.openSync(lockPath, 'wx', 0o600); lockHeld = true; }
    catch (error) { if (error?.code === 'EEXIST') throw new Error('Another install is already running'); throw error; }
    try { fs.writeFileSync(lock, `${process.pid}\n`); } catch (error) { fs.closeSync(lock); throw error; }
    fs.closeSync(lock);
    const archiveBytes = await downloadArchive(fetchImpl, archiveUrl, effectiveLimits.maxArchiveBytes);
    const actualDigest = crypto.createHash('sha256').update(archiveBytes).digest('hex');
    if (actualDigest !== sha256) throw new Error('Release SHA-256 checksum mismatch');
    let tar;
    try { tar = zlib.gunzipSync(archiveBytes, { maxOutputLength: effectiveLimits.maxDecompressedBytes }); } catch (error) { throw new Error(`Invalid or oversized gzip archive: ${error.message}`); }
    if (tar.length > effectiveLimits.maxDecompressedBytes) throw new Error('Decompressed archive size limit exceeded');
    const entries = parseArchive(tar, effectiveLimits);
    const payload = entries.find((entry) => entry.name === 'skynex-app/skynex-release.json' && !entry.directory);
    const manifest = entries.find((entry) => entry.name === 'skynex-app/package.json' && !entry.directory);
    const cli = entries.find((entry) => entry.name === 'skynex-app/bin/cli.js' && !entry.directory);
    if (!payload || !manifest || !cli || !(cli.mode & 0o111)) throw new Error('Release bundle is missing required application files');
    let markerData;
    let packageData;
    try { markerData = JSON.parse(payload.data.toString('utf8')); packageData = JSON.parse(manifest.data.toString('utf8')); } catch { throw new Error('Invalid release metadata in archive'); }
    if (markerData?.format !== 1 || markerData.version !== version || markerData.platform !== target.platform || markerData.arch !== target.arch || packageData?.version !== version) {
      throw new Error('Release version or target metadata does not match the selected release');
    }
    const stageParent = path.join(root, '.staging');
    if (fs.existsSync(stageParent) && (fs.lstatSync(stageParent).isSymbolicLink() || !fs.lstatSync(stageParent).isDirectory())) {
      throw new Error('Invalid staging directory');
    }
    fs.mkdirSync(stageParent, { recursive: true });
    stageRoot = fs.mkdtempSync(path.join(stageParent, `${version}-`));
    for (const entry of entries) {
      const relative = entry.name === 'skynex-app' ? '' : entry.name.slice('skynex-app/'.length);
      const destination = path.resolve(stageRoot, 'skynex-app', relative);
      assertSafePath(path.resolve(stageRoot, 'skynex-app'), destination);
      if (entry.directory) fs.mkdirSync(destination, { recursive: true, mode: entry.mode & 0o777 });
      else {
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, entry.data, { mode: entry.mode & 0o777, flag: 'wx' });
      }
    }
    const stagedCli = path.join(stageRoot, 'skynex-app', 'bin', 'cli.js');
    verifyCli(stagedCli, version);
    const versionsDir = path.join(root, 'versions');
    fs.mkdirSync(versionsDir, { recursive: true });
    const finalDir = path.join(versionsDir, version);
    if (fs.existsSync(finalDir)) throw new Error(`Release ${version} is already installed`);
    stagedVersionPath = path.join(versionsDir, `.staging-${version}-${crypto.randomUUID()}`);
    fs.renameSync(stageRoot, stagedVersionPath);
    stageRoot = null;
    fs.renameSync(stagedVersionPath, finalDir);
    stagedVersionPath = null;
    installedVersionPath = finalDir;
    const activeFile = path.join(root, 'active.json');
    previousPointer = fs.existsSync(activeFile) ? fs.readFileSync(activeFile) : null;
    await onPhase?.('before-activate');
    pointerTemp = path.join(root, `.active-${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(pointerTemp, `${JSON.stringify({ version, directory: `versions/${version}` })}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(pointerTemp, activeFile);
    pointerTemp = null;
    activated = true;
    if (!ownership.owned) fs.writeFileSync(path.join(root, 'managed.json'), `${JSON.stringify({ format: 1, application: 'skynex-app' })}\n`, { mode: 0o600, flag: 'wx' });
    await onPhase?.('after-activate');
    return { version, directory: `versions/${version}`, applicationDirectory: path.join(finalDir, 'skynex-app') };
  } catch (error) {
    if (activated) {
      const activeFile = path.join(root, 'active.json');
      if (previousPointer === null) fs.rmSync(activeFile, { force: true });
      else {
        const restore = path.join(root, `.active-restore-${crypto.randomUUID()}.tmp`);
        fs.writeFileSync(restore, previousPointer, { flag: 'wx' });
        fs.renameSync(restore, activeFile);
      }
      if (!ownership.owned) fs.rmSync(path.join(root, 'managed.json'), { force: true });
      fs.rmSync(path.join(root, 'versions', version), { recursive: true, force: true });
    }
    else if (installedVersionPath) fs.rmSync(installedVersionPath, { recursive: true, force: true });
    throw error;
  } finally {
    if (stageRoot) fs.rmSync(stageRoot, { recursive: true, force: true });
    if (stagedVersionPath) fs.rmSync(stagedVersionPath, { recursive: true, force: true });
    if (pointerTemp) fs.rmSync(pointerTemp, { force: true });
    if (stageRoot || installedVersionPath || stagedVersionPath) {
      const stagingDirectory = path.join(root, '.staging');
      if (fs.existsSync(stagingDirectory) && fs.readdirSync(stagingDirectory).length === 0) fs.rmdirSync(stagingDirectory);
      const versionsDirectory = path.join(root, 'versions');
      if (fs.existsSync(versionsDirectory) && fs.readdirSync(versionsDirectory).length === 0) fs.rmdirSync(versionsDirectory);
    }
    if (lockHeld && lockPath) fs.rmSync(lockPath, { force: true });
    if (createdRoot && fs.existsSync(root) && fs.readdirSync(root).length === 0) fs.rmdirSync(root);
  }
}

export function isManagedSkynexAppInstall() {
  return getManagedSkynexAppInstallContext() !== null;
}

export function getManagedSkynexAppInstallContext() {
  try {
    const physical = fs.realpathSync(__dirname);
    let applicationDirectory = physical;
    while (path.dirname(applicationDirectory) !== applicationDirectory && path.basename(applicationDirectory) !== 'skynex-app') {
      applicationDirectory = path.dirname(applicationDirectory);
    }
    if (path.basename(applicationDirectory) !== 'skynex-app') return null;
    const versionDirectory = path.dirname(applicationDirectory);
    const version = path.basename(versionDirectory);
    if (!validVersion(version) || path.basename(path.dirname(versionDirectory)) !== 'versions') return null;
    const root = path.dirname(path.dirname(versionDirectory));
    const state = validateOwnership(root);
    if (!state.owned || state.active.version !== version || fs.realpathSync(path.join(root, state.active.directory, 'skynex-app')) !== fs.realpathSync(applicationDirectory)) return null;
    return { root, applicationDirectory, version };
  } catch {
    return null;
  }
}
