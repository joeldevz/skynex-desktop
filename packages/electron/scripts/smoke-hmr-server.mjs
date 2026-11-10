import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
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

export async function startSmokeHmrServer(backendPort) {
  const worker = new Worker(new URL('./smoke-hmr-worker.mjs', import.meta.url), { workerData: { backendPort } });
  let failure;
  let closing = false;
  const exited = new Promise((resolve) => worker.once('exit', (code) => {
    if (!closing) failure ??= new Error(`HMR worker exited unexpectedly (${code}).`);
    resolve();
  }));
  worker.on('error', (error) => { failure = error; });
  let startupTimer;
  try {
    const port = await new Promise((resolve, reject) => {
      startupTimer = setTimeout(() => reject(new Error('HMR worker did not become ready within 60 seconds.')), 60_000);
      worker.once('error', reject);
      worker.once('exit', (code) => reject(new Error(`HMR worker exited before readiness (${code}).`)));
      worker.once('message', (message) => {
        if (message.type === 'ready' && Number.isInteger(message.port) && message.port > 0) resolve(message.port);
        else reject(new Error('HMR worker returned an invalid readiness message.'));
      });
    });
    return {
      port,
      threadId: worker.threadId,
      get failure() { return failure; },
      async close() {
        if (closing) return exited;
        closing = true;
        worker.postMessage({ type: 'close' });
        let graceTimer;
        try {
          await Promise.race([
            exited,
            new Promise((resolve) => { graceTimer = setTimeout(resolve, 5_000); }),
          ]);
          await worker.terminate();
        } finally {
          clearTimeout(graceTimer);
        }
      },
    };
  } catch (error) {
    closing = true;
    await worker.terminate();
    throw error;
  } finally {
    clearTimeout(startupTimer);
  }
}
