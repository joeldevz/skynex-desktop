import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const GIT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 16 * 1024;
const TARGET = '.skynex/project.json';

const runGit = (cwd, args) => new Promise((resolve) => {
  let stdout = '';
  let stderr = '';
  let settled = false;
  let timedOut = false;
  const child = spawn('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const finish = (result) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(result);
  };
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, GIT_TIMEOUT_MS);
  const collect = (target, chunk) => {
    if (Buffer.byteLength(target.value) + chunk.length > MAX_OUTPUT_BYTES) { child.kill(); return; }
    target.value += chunk.toString('utf8');
  };
  child.stdout.on('data', (chunk) => collect({ get value() { return stdout; }, set value(value) { stdout = value; } }, chunk));
  child.stderr.on('data', (chunk) => collect({ get value() { return stderr; }, set value(value) { stderr = value; } }, chunk));
  child.on('error', () => finish({ kind: 'error' }));
  child.on('close', (code) => finish({ kind: timedOut ? 'timeout' : 'exit', code, stdout, stderr }));
});

const unknown = (reason) => ({ kind: 'unknown', reason });

export const createSharedConfigIgnore = ({ fsPromises = fs, pathApi = path } = {}) => {
  const checkoutRoot = async (projectPath) => {
    const probe = await runGit(projectPath, ['rev-parse', '--show-toplevel']);
    if (probe.kind === 'error') return { status: unknown('git-unavailable') };
    if (probe.kind === 'timeout') return { status: unknown('timeout') };
    if (probe.code !== 0) return { status: unknown('not-a-repository') };
    return { root: pathApi.resolve(probe.stdout.trim()) };
  };

  const read = async (projectPath) => {
    const checkout = await checkoutRoot(projectPath);
    if (checkout.status) return checkout.status;
    const probe = await runGit(projectPath, ['check-ignore', '-q', '--', TARGET]);
    if (probe.kind === 'error') return unknown('git-unavailable');
    if (probe.kind === 'timeout') return unknown('timeout');
    if (probe.code === 1) return { kind: 'committable' };
    if (probe.code !== 0) return unknown('not-a-repository');
    const result = await runGit(projectPath, ['check-ignore', '-v', '--', TARGET]);
    if (result.kind === 'error') return unknown('git-unavailable');
    if (result.kind === 'timeout') return unknown('timeout');
    if (result.code === 1) return { kind: 'committable' };
    if (result.code !== 0) return unknown('not-a-repository');
    const match = result.stdout.replace(/\r\n/g, '\n').trimEnd().match(/^(.*):(\d+):(.*)\t(.*)$/);
    if (!match) return unknown('git-unavailable');
    const [, rawSource, rawLine, pattern] = match;
    const root = checkout.root;
    const sourcePath = pathApi.resolve(root, rawSource);
    const source = sourcePath === pathApi.join(root, '.gitignore') ? '.gitignore'
      : sourcePath === pathApi.join(root, '.git', 'info', 'exclude') ? '.git/info/exclude'
        : pathApi.isAbsolute(rawSource) ? rawSource : pathApi.resolve(root, rawSource);
    const fixable = source === '.gitignore' && projectPath === root && (pattern === '.skynex/' || pattern === '/.skynex/');
    return { kind: 'ignored', source, line: Number(rawLine), pattern, fixable };
  };

  const fix = async (projectPath) => {
    const checkout = await checkoutRoot(projectPath);
    if (checkout.status) return { kind: 'refused', reason: 'not-fixable' };
    const file = pathApi.join(checkout.root, '.gitignore');
    let fileBytes;
    try {
      const preflightStat = await fsPromises.lstat(file);
      if (!preflightStat.isFile() || preflightStat.isSymbolicLink()) return { kind: 'refused', reason: 'unsafe-file' };
      fileBytes = await fsPromises.readFile(file);
    } catch { return { kind: 'refused', reason: 'unsafe-file' }; }
    const status = await read(projectPath);
    if (status.kind === 'committable') return { kind: 'updated', status };
    if (status.kind !== 'ignored' || !status.fixable) return { kind: 'refused', reason: 'not-fixable' };
    const root = checkout.root;
    let stat;
    let bytes;
    try {
      stat = await fsPromises.lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink()) return { kind: 'refused', reason: 'unsafe-file' };
      bytes = await fsPromises.readFile(file);
    } catch { return { kind: 'refused', reason: 'unsafe-file' }; }
    const original = bytes.toString('utf8');
    const lines = original.split(/(?<=\n)/);
    const lineContents = lines.map((line) => line.replace(/\r?\n$/, ''));
    const lineIndex = status.line - 1;
    if (lineContents[lineIndex] !== status.pattern) return { kind: 'refused', reason: 'changed' };
    const prefix = status.pattern.startsWith('/') ? '/' : '';
    const exception = `${prefix}.skynex/project.json`;
    const target = lines[lineIndex];
    const eol = target.endsWith('\r\n') ? '\r\n' : target.endsWith('\n') ? '\n'
      : (original.match(/\r\n|\n/) || ['\n'])[0];
    const ignorePattern = prefix ? '/.skynex/*' : '**/.skynex/*';
    const existingException = lineContents.slice(lineIndex + 1).some((line) => line === `!${exception}`);
    lines.splice(lineIndex, 1, `${ignorePattern}${eol}`);
    if (!existingException) lines.splice(lineIndex + 1, 0, `!${exception}${target.endsWith('\n') ? eol : ''}`);
    const next = Buffer.from(lines.join(''), 'utf8');
    const temp = pathApi.join(root, `.gitignore.${process.pid}.${crypto.randomUUID()}.tmp`);
    let handle;
    try {
      handle = await fsPromises.open(temp, 'wx', stat.mode & 0o777);
      await handle.writeFile(next);
      await handle.sync();
      await handle.close();
      handle = null;
      const currentStat = await fsPromises.lstat(file);
      const currentBytes = await fsPromises.readFile(file);
      if (!currentStat.isFile() || currentStat.isSymbolicLink() || currentStat.ino !== stat.ino || !currentBytes.equals(bytes)) {
        return { kind: 'refused', reason: 'changed' };
      }
      await fsPromises.rename(temp, file);
    } catch (error) {
      return { kind: 'refused', reason: error?.code === 'ENOENT' ? 'changed' : 'write-failed' };
    } finally {
      if (handle) await handle.close().catch(() => {});
      await fsPromises.unlink(temp).catch(() => {});
    }
    return { kind: 'updated', status: await read(projectPath) };
  };

  return { read, fix };
};
