import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { gzipSync } from 'node:zlib';

const APP_DIR = 'skynex-app';

async function exists(file) {
  try { await access(file, constants.F_OK); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function rejectSymlinkPath(target) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new Error(`Destination path contains a symlink: ${current}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function copyTree(source, destination, root = source) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) {
    const target = await realpath(source);
    if (!inside(await realpath(root), target)) throw new Error(`Package symlink escapes source root: ${source}`);
    return copyTree(target, destination, root);
  }
  if (info.isDirectory()) {
    await mkdir(destination, { recursive: true, mode: info.mode & 0o777 });
    for (const name of await readdir(source)) {
      if (name === 'node_modules') continue;
      await copyTree(path.join(source, name), path.join(destination, name), root);
    }
    await chmod(destination, info.mode & 0o777);
  } else if (info.isFile()) {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, await readFile(source), { mode: info.mode & 0o777 });
    await chmod(destination, info.mode & 0o777);
  } else {
    throw new Error(`Unsupported package file type: ${source}`);
  }
}

async function findPackage(packageName, fromManifest, allowedRoots) {
  const resolver = createRequire(fromManifest);
  const packagePaths = resolver.resolve.paths(packageName) ?? [];
  for (const parent of packagePaths) {
    const candidate = path.join(parent, packageName, 'package.json');
    if (!(await exists(candidate))) continue;
    const resolved = await realpath(candidate);
    const root = path.dirname(resolved);
    if (!allowedRoots.some((allowed) => inside(allowed, root))) {
      throw new Error(`Dependency ${packageName} resolves outside allowed package roots: ${root}`);
    }
    return { root, manifestPath: resolved, manifest: JSON.parse(await readFile(resolved, 'utf8')) };
  }
  return null;
}

function dependencyNames(manifest) {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
  ]);
}

async function buildRuntime({ webRoot, stageRoot, platform, arch, version }) {
  const webReal = await realpath(webRoot);
  const webManifestPath = path.join(webReal, 'package.json');
  const webManifest = JSON.parse(await readFile(webManifestPath, 'utf8'));
  const sdkLink = path.join(webReal, 'node_modules', '@openchamber', 'sdk');
  let sdk;
  try {
    const sdkRoot = await realpath(sdkLink);
    const sdkManifestPath = path.join(sdkRoot, 'package.json');
    sdk = { root: sdkRoot, manifestPath: sdkManifestPath, manifest: JSON.parse(await readFile(sdkManifestPath, 'utf8')) };
  } catch (error) { throw new Error(`Unable to locate the workspace SDK package: ${error.message}`); }
  const workspaceRoot = path.resolve(webReal, '../..');
  const roots = [webReal, sdk.root, path.join(workspaceRoot, 'node_modules', '.bun')];
  const appRoot = path.join(stageRoot, APP_DIR);
  await mkdir(appRoot, { recursive: true });

  for (const directory of ['bin', 'server', 'dist', 'public']) {
    const source = path.join(webReal, directory);
    if (await exists(source)) await copyTree(source, path.join(appRoot, directory), webReal);
  }
  await copyTree(webManifestPath, path.join(appRoot, 'package.json'), webReal);
  const readme = path.join(webReal, 'README.md');
  const license = path.join(workspaceRoot, 'LICENSE');
  if (await exists(readme)) await copyTree(readme, path.join(appRoot, 'README.md'), webReal);
  if (await exists(license)) await copyTree(license, path.join(appRoot, 'LICENSE'), workspaceRoot);
  await copyTree(sdk.root, path.join(appRoot, 'node_modules', '@openchamber', 'sdk'), sdk.root);

  const installed = new Map();
  const rootBindings = new Map();
  async function installDependency(packageName, fromManifest, parentDestination, ancestry = new Set()) {
    const found = await findPackage(packageName, fromManifest, roots);
    if (!found) return;
    const rootDestination = path.join(appRoot, 'node_modules', ...packageName.split('/'));
    const boundSource = rootBindings.get(packageName);
    const nestedDestination = path.join(parentDestination, 'node_modules', ...packageName.split('/'));
    const nestedArchivePath = path.relative(stageRoot, path.join(nestedDestination, 'package.json')).split(path.sep).join('/');
    const shouldHoistForUstar = !boundSource && Buffer.byteLength(`${APP_DIR}/${nestedArchivePath}`, 'utf8') > 190;
    const isCycle = ancestry.has(found.root);
    const destination = isCycle
      ? nestedDestination
      : boundSource === found.root || (!boundSource && (parentDestination === appRoot || shouldHoistForUstar))
      ? rootDestination
      : nestedDestination;
    const identity = `${found.root}\0${destination}`;
    if (installed.has(identity)) return;
    if (destination === rootDestination) rootBindings.set(packageName, found.root);
    installed.set(identity, true);
    await copyTree(found.root, destination, found.root);
    if (isCycle) return;
    const nextAncestry = new Set(ancestry).add(found.root);
    for (const name of dependencyNames(found.manifest)) {
      const optional = Object.hasOwn(found.manifest.optionalDependencies ?? {}, name);
      const peer = Object.hasOwn(found.manifest.peerDependencies ?? {}, name);
      const optionalPeer = found.manifest.peerDependenciesMeta?.[name]?.optional === true;
      // A package's installed graph determines optional peer presence. Missing required peers fail.
      const child = await findPackage(name, found.manifestPath, roots);
      if (!child && (optional || optionalPeer)) continue;
      if (!child && peer && !optional && !optionalPeer) throw new Error(`Missing required peer dependency ${name} required by ${packageName}`);
      if (!child) throw new Error(`Missing required dependency ${name} required by ${packageName}`);
      await installDependency(name, found.manifestPath, destination, nextAncestry);
    }
  }

  for (const name of dependencyNames(webManifest)) {
    // Workspace SDK is copied explicitly so the workspace symlink never enters the archive.
    if (name === '@openchamber/sdk') continue;
    const optional = Object.hasOwn(webManifest.optionalDependencies ?? {}, name);
    const peer = Object.hasOwn(webManifest.peerDependencies ?? {}, name);
    const optionalPeer = webManifest.peerDependenciesMeta?.[name]?.optional === true;
    const found = await findPackage(name, webManifestPath, roots);
    if (!found && (optional || optionalPeer)) continue;
    if (!found && peer && !optionalPeer) throw new Error(`Missing required peer dependency: ${name}`);
    if (!found) throw new Error(`Missing required dependency: ${name}`);
    await installDependency(name, webManifestPath, appRoot, new Set());
  }
  for (const name of dependencyNames(sdk.manifest)) {
    const found = await findPackage(name, sdk.manifestPath, roots);
    if (!found) throw new Error(`Missing required SDK dependency: ${name}`);
    await installDependency(name, sdk.manifestPath, appRoot, new Set());
  }
  const releaseVersion = version ?? webManifest.version;
  if (typeof releaseVersion !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(releaseVersion)) throw new Error(`Invalid release version: ${releaseVersion}`);
  const packageJsonPath = path.join(appRoot, 'package.json');
  if (releaseVersion !== webManifest.version) {
    const shippedManifest = { ...webManifest, version: releaseVersion };
    await writeFile(packageJsonPath, `${JSON.stringify(shippedManifest, null, 2)}\n`);
  }
  await writeFile(path.join(appRoot, 'skynex-release.json'), `${JSON.stringify({ format: 1, version: releaseVersion, platform, arch }, null, 2)}\n`);
  return { ...webManifest, version: releaseVersion };
}

function tarOctal(number, length) {
  const value = Math.trunc(number).toString(8).padStart(length - 1, '0');
  if (value.length >= length) throw new Error(`USTAR numeric field overflow: ${number}`);
  return `${value}\0`;
}

function splitTarPath(archivePath) {
  if (Buffer.byteLength(archivePath, 'utf8') > 255) throw new Error(`USTAR path exceeds 255 bytes: ${archivePath}`);
  if (Buffer.byteLength(archivePath, 'utf8') <= 100) return { name: archivePath, prefix: '' };
  const pieces = archivePath.split('/');
  for (let index = pieces.length - 1; index > 0; index -= 1) {
    const prefix = pieces.slice(0, index).join('/');
    const name = pieces.slice(index).join('/');
    if (Buffer.byteLength(name, 'utf8') <= 100 && Buffer.byteLength(prefix, 'utf8') <= 155) return { name, prefix };
  }
  throw new Error(`USTAR path cannot fit name and prefix fields: ${archivePath}`);
}

function writeString(buffer, offset, length, value) {
  const bytes = Buffer.from(value, 'utf8');
  if (bytes.length > length) throw new Error(`USTAR field overflow: ${value}`);
  bytes.copy(buffer, offset);
}

async function createTar(stageRoot) {
  const blocks = [];
  async function visit(source, archivePath) {
    const info = await lstat(source);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error(`Unsupported archive entry: ${source}`);
    if (info.isDirectory()) {
      for (const entry of await readdir(source)) await visit(path.join(source, entry), `${archivePath}/${entry}`);
      return;
    }
    const { name, prefix } = splitTarPath(archivePath);
    const content = await readFile(source);
    const header = Buffer.alloc(512);
    writeString(header, 0, 100, name);
    writeString(header, 100, 8, tarOctal(info.mode & 0o777, 8));
    writeString(header, 108, 8, tarOctal(0, 8));
    writeString(header, 116, 8, tarOctal(0, 8));
    writeString(header, 124, 12, tarOctal(content.length, 12));
    writeString(header, 136, 12, tarOctal(Math.floor(info.mtimeMs / 1000), 12));
    header.fill(0x20, 148, 156);
    header[156] = 0x30;
    writeString(header, 257, 6, 'ustar\0');
    writeString(header, 263, 2, '00');
    writeString(header, 265, 32, '');
    writeString(header, 297, 32, '');
    writeString(header, 329, 8, tarOctal(0, 8));
    writeString(header, 337, 8, tarOctal(0, 8));
    writeString(header, 345, 155, prefix);
    let checksum = 0;
    for (const byte of header) checksum += byte;
    writeString(header, 148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
    blocks.push(header);
    if (content.length) {
      blocks.push(content);
      const remainder = content.length % 512;
      if (remainder) blocks.push(Buffer.alloc(512 - remainder));
    }
  }
  await visit(path.join(stageRoot, APP_DIR), APP_DIR);
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks), { level: 9, mtime: 0 });
}

async function verifyOutput(outputDir, archivePath, checksumPath) {
  await rejectSymlinkPath(outputDir);
  if (await exists(archivePath) || await exists(checksumPath)) throw new Error('Archive or checksum already exists; refusing to overwrite existing output');
}

export async function stageCliRuntime({ webRoot, outputRoot, platform = process.platform, arch = process.arch, version }) {
  if (platform !== process.platform || arch !== process.arch) throw new Error(`Cannot stage native runtime for cross-target ${platform}/${arch} on ${process.platform}/${process.arch}`);
  const webReal = await realpath(webRoot);
  const output = path.resolve(outputRoot);
  await rejectSymlinkPath(output);
  if (inside(webReal, output) || inside(output, webReal)) throw new Error('Staging output overlaps the source tree');
  if (await exists(output)) {
    const info = await lstat(output);
    if (!info.isDirectory()) throw new Error(`Staging destination is not a directory: ${output}`);
    if ((await readdir(output)).length) throw new Error(`Staging destination is nonempty and unowned: ${output}`);
  } else await mkdir(output, { recursive: true });
  try { await buildRuntime({ webRoot: webReal, stageRoot: output, platform, arch, version }); }
  catch (error) { await rm(path.join(output, APP_DIR), { recursive: true, force: true }); throw error; }
  return { outputRoot: output, appRoot: path.join(output, APP_DIR) };
}

export async function packageCliRuntime({ webRoot, outputDir, platform = process.platform, arch = process.arch, version }) {
  if (platform !== process.platform || arch !== process.arch) throw new Error(`Cannot package native runtime for cross-target ${platform}/${arch} on ${process.platform}/${process.arch}`);
  const webReal = await realpath(webRoot);
  const output = path.resolve(outputDir);
  if (inside(webReal, output) || inside(output, webReal)) throw new Error('Archive output overlaps the source tree');
  await rejectSymlinkPath(output);
  const sourceManifest = JSON.parse(await readFile(path.join(webReal, 'package.json'), 'utf8'));
  const releaseVersion = version ?? sourceManifest.version;
  if (typeof releaseVersion !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(releaseVersion)) throw new Error(`Invalid release version: ${releaseVersion}`);
  const manifest = { ...sourceManifest, version: releaseVersion };
  const archiveName = `skynex-app-${manifest.version}-${platform}-${arch}.tar.gz`;
  const archivePath = path.join(output, archiveName);
  const checksumPath = `${archivePath}.sha256`;
  await verifyOutput(output, archivePath, checksumPath);
  const parent = path.dirname(output);
  await mkdir(parent, { recursive: true });
  const temporary = await mkdtemp(path.join(parent, '.skynex-package-'));
  const stagedOutput = path.join(temporary, 'stage');
  await mkdir(stagedOutput);
  try {
    await buildRuntime({ webRoot: webReal, stageRoot: stagedOutput, platform, arch, version });
    const archive = await createTar(stagedOutput);
    const digest = createHash('sha256').update(archive).digest('hex');
    await mkdir(output, { recursive: true });
    await verifyOutput(output, archivePath, checksumPath);
    const tempArchive = path.join(output, `.${archiveName}.${process.pid}.tmp`);
    const tempChecksum = `${tempArchive}.sha256`;
    try {
      await writeFile(tempArchive, archive, { flag: 'wx' });
      await writeFile(tempChecksum, `${digest}  ${archiveName}\n`, { flag: 'wx' });
      await rename(tempArchive, archivePath);
      try { await rename(tempChecksum, checksumPath); }
      catch (error) { await rm(archivePath, { force: true }); throw error; }
    } catch (error) {
      await rm(tempArchive, { force: true });
      await rm(tempChecksum, { force: true });
      throw error;
    }
    return { archivePath, checksumPath, version: manifest.version, platform, arch };
  } finally { await rm(temporary, { recursive: true, force: true }); }
}
