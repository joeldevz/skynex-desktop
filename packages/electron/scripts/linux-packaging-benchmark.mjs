import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.env.BENCHMARK_MODE;
const app = path.join(root, 'dist/benchmark-unpacked/linux-unpacked');
const outputRoot = path.join(root, 'dist/benchmark-results');
const targets = ['AppImage', 'deb', 'rpm'];

const run = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', (code, signal) => {
    if (code === 0) resolve();
    else reject(new Error(`${command} exited ${code ?? signal}`));
  });
});

const timed = async (label, action) => {
  const started = process.hrtime.bigint();
  await action();
  console.log(`benchmark=${mode} phase=${label} seconds=${Number(process.hrtime.bigint() - started) / 1e9}`);
};

if (!['benchmark-linux-serial', 'benchmark-linux-parallel'].includes(mode)) {
  throw new Error('BENCHMARK_MODE must select a Linux benchmark mode');
}
if (!fs.statSync(app).isDirectory()) throw new Error(`Unpacked application not found: ${app}`);
fs.mkdirSync(outputRoot);
const benchmarkStarted = process.hrtime.bigint();
const workflowStarted = BigInt(fs.readFileSync(path.join(root, 'dist/benchmark-started'), 'utf8').trim());

const build = async (target, order) => {
  const label = `${order}-${target.toLowerCase()}`;
  const targetRoot = path.join(outputRoot, label);
  const clone = path.join(targetRoot, 'linux-unpacked');
  const output = path.join(targetRoot, 'artifacts');
  fs.mkdirSync(targetRoot, { recursive: true });
  await timed(`${label}-clone`, () => run('cp', ['-a', '--reflink=auto', app, clone]));
  await timed(`${label}-package`, () => run('node', [
    './scripts/package.mjs', '--prepackaged', clone, '--linux', '--x64',
    `--config.linux.target=${target}`, `--config.directories.output=${output}`,
    '--publish=never',
  ]));
  const files = fs.readdirSync(output);
  const extension = target === 'AppImage' ? '.AppImage' : target === 'deb' ? '.deb' : '.rpm';
  const installers = files.filter((name) => /\.(?:AppImage|deb|rpm)$/.test(name));
  const manifest = path.join(output, 'latest-linux.yml');
  if (installers.length !== 1 || !installers[0].endsWith(extension) || !fs.existsSync(manifest)) {
    throw new Error(`${label} did not produce exactly its package and update manifest`);
  }
  const artifact = path.join(output, installers[0]);
  const resources = path.join(clone, 'resources');
  if (!fs.statSync(path.join(resources, 'app-update.yml')).size) {
    throw new Error(`${label} has no updater configuration`);
  }
  if (target === 'AppImage'
    ? fs.existsSync(path.join(resources, 'package-type'))
    : fs.readFileSync(path.join(resources, 'package-type'), 'utf8').trim() !== target) {
    throw new Error(`${label} has the wrong updater package type`);
  }
  await timed(`${label}-manifest-verification`, () => run('node', [
    './scripts/verify-update-manifest.mjs', manifest, JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, artifact,
  ]));
  if (target === 'AppImage') {
    await timed(`${label}-appimage-verification`, () => run('node', [
      './scripts/verify-linux-appimage.mjs', artifact,
    ]));
  }
};

if (mode === 'benchmark-linux-serial') {
  for (const target of targets) await build(target, 'serial');
} else {
  const coordinationStarted = process.hrtime.bigint();
  const results = await Promise.allSettled(targets.map((target) => build(target, 'parallel')));
  const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
  if (failures.length > 0) throw new AggregateError(failures, 'Parallel packaging failed');
  console.log(`benchmark=${mode} phase=parallel-coordination seconds=${Number(process.hrtime.bigint() - coordinationStarted) / 1e9}`);
}
console.log(`benchmark=${mode} phase=packaging-end-to-end seconds=${Number(process.hrtime.bigint() - benchmarkStarted) / 1e9}`);
console.log(`benchmark=${mode} phase=app-build-through-package-verification seconds=${(BigInt(Date.now()) * 1_000_000n - workflowStarted) / 1_000_000_000n}`);
