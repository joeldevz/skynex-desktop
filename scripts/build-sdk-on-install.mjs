import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

if (process.env.OPENCHAMBER_PREBUILT_SDK === '1') {
  for (const entry of ['index.js', 'schemas.js', 'ui/index.js']) {
    const artifact = new URL(`../packages/sdk/dist/${entry}`, import.meta.url);
    if (!statSync(artifact, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Missing prebuilt SDK entry: ${entry}`);
    }
  }
  console.log('[sdk] using prebuilt dist');
} else {
  const result = spawnSync(process.execPath, ['run', 'build'], {
    cwd: fileURLToPath(new URL('../packages/sdk/', import.meta.url)),
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
