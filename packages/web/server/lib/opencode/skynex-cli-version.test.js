import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readSkynexCliVersion } from './skynex-cli-version.js';

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(source) {
  const directory = await mkdtemp(path.join(tmpdir(), 'skynex-version-'));
  directories.push(directory);
  const executable = path.join(directory, 'skynex');
  if (source !== null) await writeFile(executable, `#!${process.execPath}\n${source}\n`, { mode: 0o700 });
  return { executable, options: { env: { PATH: directory }, home: directory } };
}

describe.skipIf(process.platform === 'win32')('installed Skynex CLI version', () => {
  it('runs only --version and sees an updated installation on the next read', async () => {
    const { executable, options } = await fixture('if (process.argv.slice(2).join() !== "--version") process.exit(1); console.log("0.4.0");');
    expect(await readSkynexCliVersion(options)).toBe('0.4.0');
    await writeFile(executable, `#!${process.execPath}\nconsole.log('Skynex CLI v0.5.1-beta.2+build.7');\n`);
    expect(await readSkynexCliVersion(options)).toBe('0.5.1-beta.2+build.7');
  });

  it.each([
    [null, 'missing executable'],
    ['console.log("0.4.0"); process.exit(1);', 'failed command'],
    ['console.log("Skynex v2\\nUsage: skynex install");', 'help output'],
    ['console.error("0.4.0");', 'stderr alone'],
    ['console.log("0.4.0\\nprivate diagnostics");', 'mixed output'],
    ['console.log("x".repeat(5000));', 'oversized output'],
  ])('returns unknown for %s (%s)', async (source) => {
    const { options } = await fixture(source);
    expect(await readSkynexCliVersion(options)).toBeNull();
  });

  it('terminates a hung CLI before returning unknown', async () => {
    const { options } = await fixture('process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);');
    expect(await readSkynexCliVersion(options)).toBeNull();
  }, 15_000);

  it('does not resolve executables from relative PATH entries', async () => {
    const { options } = await fixture('console.log("9.9.9");');
    expect(await readSkynexCliVersion({ ...options, env: { PATH: '.:' } })).toBeNull();
  });
});

it('uses a fixed Windows command with bounded tree cleanup and no current-directory lookup', async () => {
  const calls = [];
  const version = await readSkynexCliVersion({
    platform: 'win32',
    home: 'C:\\Users\\Test',
    env: { SystemRoot: 'C:\\Windows', Path: '.;C:\\Tools;relative' },
    run: async (...args) => { calls.push(args); return { code: 0, stdout: '0.4.0\r\n', stderr: '' }; },
  });
  expect(version).toBe('0.4.0');
  expect(calls).toEqual([[
    'C:\\Windows\\System32\\cmd.exe',
    ['/d', '/s', '/c', 'skynex --version'],
    {
      cwd: 'C:\\Users\\Test',
      env: { SystemRoot: 'C:\\Windows', Path: 'C:\\Tools', NoDefaultCurrentDirectoryInExePath: '1' },
      timeoutMs: 3000,
      maxOutputBytes: 4096,
      killTree: true,
    },
  ]]);
});
