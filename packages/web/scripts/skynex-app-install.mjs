#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLatestSkynexAppRelease, installSkynexAppRelease } from '../server/lib/skynex-app-updater.js';
import { skynexAppLauncherContents } from '../server/lib/skynex-app-launcher.js';

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function defaultInstallRoot(env, platform) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  if (platform === 'win32') return path.join(env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'SkynexApp');
  return path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'skynex-app');
}

function appLaunchers(root, binDir, platform) {
  const content = skynexAppLauncherContents(root);
  const files = [{ file: path.join(root, 'launcher.mjs'), content }];
  const launchers = (platform === 'win32' ? ['skynex-app.cmd', 'openchamber.cmd'] : ['skynex-app', 'openchamber']).map((name) => ({
    name, file: path.join(binDir, name), content: platform === 'win32' ? '@echo off\r\nnode "%~dp0\\skynex-app-launcher.js" %*\r\n' : content,
  }));
  if (platform === 'win32') files.push({ file: path.join(binDir, 'skynex-app-launcher.js'), content });
  return { files: [...files, ...launchers], launchers };
}

function assertInstallRootOwnedOrEmpty(root) {
  if (!fs.existsSync(root)) return;
  const info = fs.lstatSync(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Managed install root must be a real directory');
  if (!fs.readdirSync(root).length) return;
  const markerPath = path.join(root, 'managed.json');
  const activePath = path.join(root, 'active.json');
  if (!fs.existsSync(markerPath) || !fs.existsSync(activePath)) throw new Error('Refusing to modify a nonempty unowned install root');
  if (fs.lstatSync(markerPath).isSymbolicLink() || fs.lstatSync(activePath).isSymbolicLink()) throw new Error('Symlinked managed install pointer refused');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  const active = JSON.parse(fs.readFileSync(activePath, 'utf8'));
  if (marker?.format !== 1 || marker?.application !== 'skynex-app' || !VERSION_PATTERN.test(active?.version) || active.directory !== `versions/${active.version}`) throw new Error('Install root is not owned by a valid skynex-app installation');
}

export async function installSkynexApp({
  version, installRoot, binDir, platform = process.platform, arch = process.arch,
  fetchImpl = globalThis.fetch, writeFileImpl = fs.writeFileSync, env = process.env,
} = {}) {
  if (version !== undefined && !VERSION_PATTERN.test(version)) throw new Error(`Invalid release version: ${String(version)}`);
  const installEnv = Object.freeze({ ...env });
  const root = path.resolve(installRoot || defaultInstallRoot(installEnv, platform));
  const bindir = path.resolve(binDir || path.join(installEnv.HOME || installEnv.USERPROFILE || os.homedir(), '.local', 'bin'));
  validateInstallPath(root);
  validateInstallPath(bindir);
  assertInstallRootOwnedOrEmpty(root);
  const rootExisted = fs.existsSync(root);
  const app = appLaunchers(root, bindir, platform);
  checkAppLaunchers(app.files);
  const release = await getLatestSkynexAppRelease({ fetchImpl, platform, arch, version });
  try {
    const installed = await installSkynexAppRelease({
      release, installRoot: root, fetchImpl,
      onPhase(phase) {
        if (phase === 'after-activate') installAppLaunchers({ app, platform, writeFileImpl });
      },
    });
    return { ...installed, launchers: app.launchers.map(({ name, file }) => ({ name, file })) };
  } catch (error) {
    if (!rootExisted && fs.existsSync(root)) {
      validateInstallPath(root);
      try { fs.rmdirSync(root); }
      catch (cleanupError) {
        if (!['ENOTEMPTY', 'EEXIST', 'ENOENT'].includes(cleanupError.code)) throw new AggregateError([error, cleanupError], 'Installation failed and its empty install directory could not be removed');
      }
    }
    throw error;
  }
}

function validateInstallPath(file) {
  let current = path.parse(path.resolve(file)).root;
  for (const part of path.resolve(file).slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Symlinked installation path refused: ${current}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}

function checkAppLaunchers(files) {
  for (const { file, content } of files) {
    validateInstallPath(file);
    if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.readFileSync(file, 'utf8') !== content)) throw new Error(`Refusing to replace an unowned or modified launcher: ${file}`);
  }
}

function installAppLaunchers({ app, platform, writeFileImpl }) {
  checkAppLaunchers(app.files);
  const previous = new Map(app.files.map(({ file }) => [file, fs.existsSync(file) ? fs.readFileSync(file) : null]));
  const written = [];
  try {
    for (const { file, content } of app.files) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      try {
        writeFileImpl(temporary, content, { mode: 0o755, flag: 'wx' });
        fs.renameSync(temporary, file);
        written.push(file);
        if (platform !== 'win32' && app.launchers.some((launcher) => launcher.file === file)) fs.chmodSync(file, 0o755);
      } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
  } catch (error) {
    for (const file of written.reverse()) {
      const bytes = previous.get(file);
      if (bytes === null) fs.rmSync(file, { force: true });
      else {
        const restore = `${file}.${process.pid}.restore`;
        fs.writeFileSync(restore, bytes, { mode: 0o755, flag: 'wx' });
        fs.renameSync(restore, file);
      }
    }
    throw error;
  }
}

function parseArgs(args) {
  let version;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--version' || version !== undefined || !args[index + 1]) throw new Error('Usage: node skynex-app-install.mjs [--version <semver>]');
    version = args[++index];
  }
  return version;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await installSkynexApp({ version: parseArgs(process.argv.slice(2)) });
    console.log(`Installed skynex-app ${result.version} at ${result.applicationDirectory}`);
    console.log(`Launchers: ${result.launchers.map(({ file }) => file).join(', ')}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Installation failed');
    process.exitCode = 1;
  }
}
