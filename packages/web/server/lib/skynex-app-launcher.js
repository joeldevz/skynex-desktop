import fs from 'node:fs';
import path from 'node:path';

const SKYNEX_APP_LAUNCHER_MARKER = '// skynex-app-managed-launcher format=1';

export function skynexAppLauncherContents(root) {
  const serializedRoot = JSON.stringify(path.resolve(root));
  return `#!/usr/bin/env node\n${SKYNEX_APP_LAUNCHER_MARKER}\nimport fs from 'node:fs';\nimport path from 'node:path';\nimport { spawn } from 'node:child_process';\nconst root = ${serializedRoot};\nconst active = JSON.parse(fs.readFileSync(path.join(root, 'active.json'), 'utf8'));\nif (!/^\\d+\\.\\d+\\.\\d+/.test(active.version) || active.directory !== 'versions/' + active.version) throw new Error('Invalid skynex-app active pointer');\nconst entry = path.join(root, active.directory, 'skynex-app', 'bin', 'cli.js');\nconst child = spawn(process.execPath, [entry, ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });\nchild.on('error', (error) => { console.error(error.message); process.exitCode = 1; });\nchild.on('exit', (code, signal) => { process.exitCode = signal ? 1 : (code ?? 1); });\n`;
}

export function isOwnedSkynexAppLauncher(file, root) {
  try {
    const info = fs.lstatSync(file);
    return info.isFile() && !info.isSymbolicLink()
      && fs.readFileSync(file, 'utf8') === skynexAppLauncherContents(root);
  } catch {
    return false;
  }
}
