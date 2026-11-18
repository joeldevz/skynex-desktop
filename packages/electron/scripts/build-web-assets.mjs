import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const webDir = path.join(repoRoot, 'packages', 'web');
const sdkDir = path.join(repoRoot, 'packages', 'sdk');
const electronDir = path.join(repoRoot, 'packages', 'electron');

const resourcesDir = path.join(electronDir, 'resources');
const resourcesWebDistDir = path.join(resourcesDir, 'web-dist');
const webDistDir = path.join(webDir, 'dist');
const prebuiltAssetsDir = process.env.OPENCHAMBER_PREBUILT_WEB_ASSETS?.trim();
const distOnly = process.argv.includes('--dist-only');
const stageOnly = process.argv.includes('--stage-only');

const quoteWindowsCommandArg = (value) => `"${String(value).replace(/"/g, '""')}"`;

const run = (cmd, args, cwd) => {
  const isWindowsCommandScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd);
  const result = isWindowsCommandScript
    ? spawnSync(
        process.env.ComSpec || 'cmd.exe',
        ['/d', '/s', '/c', ['call', quoteWindowsCommandArg(cmd), ...args.map(quoteWindowsCommandArg)].join(' ')],
        { cwd, stdio: 'inherit', windowsVerbatimArguments: true },
      )
    : spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd} ${args.join(' ')}`);
  }
};

const resolveBun = () => {
  if (typeof process.env.BUN === 'string' && process.env.BUN.trim()) {
    return process.env.BUN.trim();
  }
  if (process.platform === 'win32') {
    const result = spawnSync('where.exe', ['bun'], { encoding: 'utf8' });
    const candidates = String(result.stdout || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const resolved = candidates.find((entry) => /\.(exe|cmd|bat)$/i.test(entry)) || candidates[0];
    return resolved || 'bun';
  }
  const result = spawnSync('/bin/bash', ['-lc', 'command -v bun'], { encoding: 'utf8' });
  const resolved = (result.stdout || '').trim();
  return resolved || 'bun';
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const removeDir = async (target) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      if (!['ENOTEMPTY', 'EBUSY', 'EPERM'].includes(error?.code)) throw error;
      await sleep(100 * (attempt + 1));
    }
  }
};

const copyDir = async (src, dst) => {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(src, entry.name);
    const to = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
};

if (distOnly && (!prebuiltAssetsDir || stageOnly)) {
  throw new Error('--dist-only requires prebuilt SDK and web assets');
}

if (stageOnly) {
  if (!(await fs.stat(path.join(webDistDir, 'index.html'))).isFile()) {
    throw new Error('Missing staged web entry');
  }
} else if (prebuiltAssetsDir) {
  const sourceSdkDistDir = path.join(prebuiltAssetsDir, 'sdk', 'dist');
  const sourceWebDistDir = path.join(prebuiltAssetsDir, 'web', 'dist');
  for (const sourceDir of [sourceSdkDistDir, sourceWebDistDir]) {
    const entries = await fs.readdir(sourceDir).catch(() => []);
    if (entries.length === 0) {
      throw new Error(`Prebuilt web assets are missing or empty: ${sourceDir}`);
    }
  }

  const replaceDist = async (sourceDir, destinationDir) => {
    const stagedDir = await fs.mkdtemp(path.join(path.dirname(destinationDir), `${path.basename(destinationDir)}-staging-`));
    try {
      await copyDir(sourceDir, stagedDir);
      await removeDir(destinationDir);
      await fs.rename(stagedDir, destinationDir);
    } catch (error) {
      await removeDir(stagedDir);
      throw error;
    }
  };

  console.log('[electron] staging prebuilt SDK and web assets...');
  await replaceDist(sourceSdkDistDir, path.join(sdkDir, 'dist'));
  await replaceDist(sourceWebDistDir, webDistDir);
} else {
  const bunExe = resolveBun();
  // The bundled server imports @openchamber/sdk from its built `dist`, which
  // nothing else in packaging rebuilds. A stale dist can omit a required export.
  console.log('[electron] building @openchamber/sdk dist...');
  run(bunExe, ['run', 'build'], sdkDir);

  console.log('[electron] building web UI dist...');
  run(bunExe, ['run', 'build'], webDir);
}

if (distOnly) process.exit(0);

console.log('[electron] staging packaged resources...');
await fs.mkdir(resourcesDir, { recursive: true });
const stagedWebDistDir = await fs.mkdtemp(path.join(resourcesDir, 'web-dist-staging-'));
try {
  await copyDir(webDistDir, stagedWebDistDir);
  await removeDir(resourcesWebDistDir);
  await fs.rename(stagedWebDistDir, resourcesWebDistDir);
} catch (error) {
  // A failed copy (a full disk, say) must not leave a half-staged dir behind.
  await removeDir(stagedWebDistDir);
  throw error;
}

console.log(`[electron] web assets ready: ${resourcesWebDistDir}`);
