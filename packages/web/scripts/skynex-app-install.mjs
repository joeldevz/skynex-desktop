#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLatestSkynexAppRelease, installSkynexAppRelease } from '../server/lib/skynex-app-updater.js';
import { skynexAppLauncherContents } from '../server/lib/skynex-app-launcher.js';

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const ROOT_LAUNCHER = 'launcher.mjs';

function defaultInstallRoot(env = process.env, platform = process.platform) {
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(env.USERPROFILE || os.homedir(), 'AppData', 'Local'), 'SkynexApp');
  return path.join(env.XDG_DATA_HOME || path.join(env.HOME || os.homedir(), '.local', 'share'), 'skynex-app');
}

function defaultBinDir(env = process.env, platform = process.platform) {
  if (platform === 'win32') return path.join(env.USERPROFILE || os.homedir(), '.local', 'bin');
  return path.join(env.HOME || os.homedir(), '.local', 'bin');
}

function validateLocation(target) {
  const absolute = path.resolve(target);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlinked install or launcher path refused: ${current}`);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function launcherPaths(binDir, platform) {
  return platform === 'win32'
    ? ['skynex-app.cmd', 'openchamber.cmd']
      .map((name) => ({ name, file: path.join(binDir, name), command: path.join(binDir, 'skynex-app-launcher.js') }))
    : ['skynex-app', 'openchamber'].map((name) => ({ name, file: path.join(binDir, name) }));
}

function assertInstallRootOwnedOrEmpty(root) {
  if (!fs.existsSync(root)) return;
  const info = fs.lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Managed install root must be a real directory');
  const entries = fs.readdirSync(root);
  if (!entries.length) return;
  const markerPath = path.join(root, 'managed.json');
  const activePath = path.join(root, 'active.json');
  if (!fs.existsSync(markerPath) || !fs.existsSync(activePath)) throw new Error('Refusing to modify a nonempty unowned install root');
  if (fs.lstatSync(markerPath).isSymbolicLink() || fs.lstatSync(activePath).isSymbolicLink()) throw new Error('Symlinked managed install pointer refused');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  const active = JSON.parse(fs.readFileSync(activePath, 'utf8'));
  if (marker?.format !== 1 || marker?.application !== 'skynex-app' || !VERSION_PATTERN.test(active?.version) || active.directory !== `versions/${active.version}`) {
    throw new Error('Install root is not owned by a valid skynex-app installation');
  }
}

function installLaunchers({ root, binDir, platform = process.platform, writeFileImpl = fs.writeFileSync, renameImpl = fs.renameSync }) {
  const rootLauncher = path.join(root, ROOT_LAUNCHER);
  validateLocation(rootLauncher);
  validateLocation(binDir);
  fs.mkdirSync(binDir, { recursive: true });
  validateLocation(binDir);
  const jsContent = skynexAppLauncherContents(root);
  const destinations = launcherPaths(binDir, platform);
  const files = [{ file: rootLauncher, content: jsContent }, ...(platform === 'win32'
    ? [{ file: path.join(binDir, 'skynex-app-launcher.js'), content: jsContent }, ...destinations.map(({ file }) => ({ file, content: `@echo off\r\nnode "%~dp0\\skynex-app-launcher.js" %*\r\n` }))]
    : destinations.map(({ file }) => ({ file, content: jsContent })) )];
  const prior = new Map();
  for (const { file, content } of files) {
    validateLocation(file);
    if (!fs.existsSync(file)) { prior.set(file, null); continue; }
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Refusing to replace an unowned launcher: ${file}`);
    const bytes = fs.readFileSync(file);
    const text = bytes.toString('utf8');
    const owned = file.endsWith('.cmd')
      ? text.startsWith('@echo off\r\nnode "%~dp0\\skynex-app-launcher.js" %*')
      : text.startsWith(`${jsContent.split('\n')[0]}\n// skynex-app-managed-launcher format=1\n`);
    if (!owned || text !== content) throw new Error(`Refusing to replace an unowned or modified launcher: ${file}`);
    prior.set(file, bytes);
  }
  const created = [];
  try {
    for (const { file, content } of files) {
      const temporary = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
      writeFileImpl(temporary, content, { mode: 0o755, flag: 'wx' });
      try { renameImpl(temporary, file); }
      catch (error) { fs.rmSync(temporary, { force: true }); throw error; }
      created.push(file);
      if (platform !== 'win32') fs.chmodSync(file, 0o755);
    }
  } catch (error) {
    for (const file of created.reverse()) {
      const previous = prior.get(file);
      if (previous === null) fs.rmSync(file, { force: true });
      else {
        const restore = `${file}.${process.pid}.restore`;
        fs.writeFileSync(restore, previous, { mode: 0o755, flag: 'wx' });
        fs.renameSync(restore, file);
      }
    }
    throw error;
  }
  return destinations.map(({ name, file }) => ({ name, file }));
}

export async function installSkynexApp({ version, installRoot, binDir, platform = process.platform, arch = process.arch, fetchImpl = globalThis.fetch, writeFileImpl = fs.writeFileSync } = {}) {
  if (version !== undefined && !VERSION_PATTERN.test(version)) throw new Error(`Invalid release version: ${String(version)}`);
  const root = path.resolve(installRoot || defaultInstallRoot(process.env, platform));
  const bindir = path.resolve(binDir || defaultBinDir(process.env, platform));
  validateLocation(root);
  validateLocation(bindir);
  assertInstallRootOwnedOrEmpty(root);
  const launcherFiles = launcherPaths(bindir, platform).map(({ file }) => file);
  const expectedJs = skynexAppLauncherContents(root);
  const expectedCmd = '@echo off\r\nnode "%~dp0\\skynex-app-launcher.js" %*\r\n';
  if (platform === 'win32') launcherFiles.push(path.join(bindir, 'skynex-app-launcher.js'));
  launcherFiles.push(path.join(root, ROOT_LAUNCHER));
  for (const file of launcherFiles) {
    if (!fs.existsSync(file)) continue;
    const info = fs.lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Refusing to replace an unowned launcher: ${file}`);
    const text = fs.readFileSync(file, 'utf8');
    const owned = file.endsWith('.cmd')
      ? text === expectedCmd
      : text === expectedJs;
    if (!owned) throw new Error(`Refusing to replace an unowned or modified launcher: ${file}`);
  }
  const release = await getLatestSkynexAppRelease({ fetchImpl, platform, arch, version });
  const installed = await installSkynexAppRelease({
    release,
    installRoot: root,
    fetchImpl,
    onPhase(phase) {
      if (phase === 'after-activate') installLaunchers({ root, binDir: bindir, platform, writeFileImpl });
    },
  });
  return { ...installed, launchers: launcherPaths(bindir, platform).map(({ name, file }) => ({ name, file })) };
}

function parseArgs(args) {
  let version;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--version' || version !== undefined || !args[index + 1]) throw new Error('Usage: node skynex-app-install.mjs [--version <semver>]');
    version = args[++index];
  }
  return version;
}

const invokedPath = process.argv[1] && path.resolve(process.argv[1]);
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    const result = await installSkynexApp({ version: parseArgs(process.argv.slice(2)) });
    console.log(`Installed skynex-app ${result.version} at ${result.applicationDirectory}`);
    console.log(`Launchers: ${result.launchers.map(({ file }) => file).join(', ')}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Installation failed');
    process.exitCode = 1;
  }
}
