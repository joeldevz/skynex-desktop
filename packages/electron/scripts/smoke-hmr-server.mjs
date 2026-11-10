import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { instrumentModuleEvaluation } from './smoke-module-evaluation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const webDir = path.join(repoRoot, 'packages/web');
const requireWeb = createRequire(path.join(webDir, 'package.json'));

export async function createSmokeHmrServer(backendPort) {
  const previousPort = process.env.OPENCHAMBER_PORT;
  const previousPwa = process.env.OPENCHAMBER_DISABLE_PWA_DEV;
  process.env.OPENCHAMBER_PORT = String(backendPort);
  process.env.OPENCHAMBER_DISABLE_PWA_DEV = '1';
  try {
    const { createServer } = await import(pathToFileURL(requireWeb.resolve('vite')).href);
    return await createServer({
      configFile: path.join(webDir, 'vite.config.ts'),
      envFile: false,
      plugins: [{
        name: 'smoke-module-evaluation',
        enforce: 'post',
        transform(code, id) {
          const source = id.split('?')[0];
          if (!source.startsWith(`${path.join(repoRoot, 'packages')}${path.sep}`)
            || !/\.[cm]?[jt]sx?$/.test(source)) return null;
          return { code: instrumentModuleEvaluation(code, path.relative(repoRoot, source)), map: null };
        },
      }],
      server: { host: '127.0.0.1', port: 0, strictPort: false },
    });
  } finally {
    if (previousPort === undefined) delete process.env.OPENCHAMBER_PORT;
    else process.env.OPENCHAMBER_PORT = previousPort;
    if (previousPwa === undefined) delete process.env.OPENCHAMBER_DISABLE_PWA_DEV;
    else process.env.OPENCHAMBER_DISABLE_PWA_DEV = previousPwa;
  }
}
