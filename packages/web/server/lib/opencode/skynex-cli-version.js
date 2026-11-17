import { homedir } from 'node:os';
import path from 'node:path';
import { runCommand } from '../spaces/run-command.js';

export async function readSkynexCliVersion({
  run = runCommand,
  platform = process.platform,
  env = process.env,
  home = homedir(),
} = {}) {
  const windows = platform === 'win32';
  const paths = windows ? path.win32 : path.posix;
  const pathKey = Object.keys(env).find((key) => windows ? key.toLowerCase() === 'path' : key === 'PATH') ?? 'PATH';
  const executablePath = (env[pathKey] ?? '').split(paths.delimiter).filter((entry) => paths.isAbsolute(entry)).join(paths.delimiter);
  if (!executablePath || (windows && !paths.isAbsolute(env.SystemRoot ?? ''))) return null;

  try {
    const result = await run(
      windows ? paths.join(env.SystemRoot, 'System32', 'cmd.exe') : 'skynex',
      windows ? ['/d', '/s', '/c', 'skynex --version'] : ['--version'],
      {
        cwd: home,
        env: { ...env, [pathKey]: executablePath, NoDefaultCurrentDirectoryInExePath: '1' },
        timeoutMs: 3000,
        maxOutputBytes: 4096,
        killTree: true,
      },
    );
    if (result.code !== 0) return null;
    const match = result.stdout.trim().match(/^(?:Skynex(?: CLI)?\s+)?v?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/i);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}
