import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createSmokeHmrServer } from './smoke-hmr-server.mjs';

test('the former web-default PWA setup pulls workbox into development startup', async () => {
  const previousPwa = process.env.OPENCHAMBER_DISABLE_PWA_DEV;
  process.env.OPENCHAMBER_DISABLE_PWA_DEV = '0';
  const webManifest = fileURLToPath(new URL('../../web/package.json', import.meta.url));
  const requireWeb = createRequire(webManifest);
  const { createServer } = await import(pathToFileURL(requireWeb.resolve('vite')).href);
  let server;
  try {
    server = await createServer({ configFile: fileURLToPath(new URL('../../web/vite.config.ts', import.meta.url)), envFile: false });
    const resolved = await server.environments.client.pluginContainer.resolveId('virtual:pwa-register');
    const module = await server.environments.client.pluginContainer.load(resolved.id);
    assert.match(typeof module === 'string' ? module : module.code, /workbox-window/);
  } finally {
    await server?.close();
    if (previousPwa === undefined) delete process.env.OPENCHAMBER_DISABLE_PWA_DEV;
    else process.env.OPENCHAMBER_DISABLE_PWA_DEV = previousPwa;
  }
});

test('uses normal Electron HMR PWA configuration and the reserved API proxy', async () => {
  const previousPort = process.env.OPENCHAMBER_PORT;
  const previousPwa = process.env.OPENCHAMBER_DISABLE_PWA_DEV;
  const server = await createSmokeHmrServer(45678);
  try {
    const resolved = await server.environments.client.pluginContainer.resolveId('virtual:pwa-register');
    assert.ok(resolved);
    const module = await server.environments.client.pluginContainer.load(resolved.id);
    const code = typeof module === 'string' ? module : module.code;
    assert.match(code, /function registerSW/);
    assert.doesNotMatch(code, /workbox-window/);
    assert.equal(server.config.server.proxy['/api'].target, 'http://127.0.0.1:45678');
    assert.equal(server.config.server.host, '127.0.0.1');
    assert.equal(process.env.OPENCHAMBER_PORT, previousPort);
    assert.equal(process.env.OPENCHAMBER_DISABLE_PWA_DEV, previousPwa);
  } finally {
    await server.close();
  }
});
