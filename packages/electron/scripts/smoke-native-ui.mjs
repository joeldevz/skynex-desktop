#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const electronDir = path.resolve(scriptDir, '..');
const webDir = path.join(repoRoot, 'packages/web');
const outputDir = path.resolve(process.env.SMOKE_OUTPUT_DIR || process.argv[2] || '/tmp/opencode/skynex-native-ui-smoke');
const timeoutMs = 60_000;
const requireElectron = createRequire(path.join(electronDir, 'package.json'));
const electronBinary = requireElectron('electron');
const requireWeb = createRequire(path.join(webDir, 'package.json'));
if (process.platform !== 'linux') throw new Error('This graphical smoke runner requires Linux.');
if (!process.env.DISPLAY) throw new Error('DISPLAY is required. Run this script under the CI Xvfb display.');

const fixtureRequests = [];
const fixture = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  fixtureRequests.push({ method: request.method || 'GET', path: url.pathname, status: url.pathname === '/health' ? 200 : 503 });
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', '*');
  response.setHeader('access-control-allow-methods', '*');
  response.setHeader('content-type', 'application/json');
  response.statusCode = url.pathname === '/health' ? 200 : 503;
  response.end(JSON.stringify(url.pathname === '/health'
    ? { status: 'ok', fixture: true }
    : { error: 'isolated graphical smoke fixture has no application API' }));
});

let vite;
let child;
let tempRoot;
let childOutput = '';
const results = [];
const noExternalRequests = [];

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const reservePort = async () => {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
};

const createProfile = async (name) => {
  const home = path.join(tempRoot, name);
  for (const dir of ['config', 'data', 'cache', 'runtime', 'tmp', 'opencode']) {
    await mkdir(path.join(home, dir), { recursive: true, mode: 0o700 });
  }
  return {
    home,
    env: {
      PATH: process.env.PATH || '/usr/bin:/bin',
      LANG: process.env.LANG || 'C.UTF-8',
      DISPLAY: process.env.DISPLAY,
      XAUTHORITY: process.env.XAUTHORITY,
      HOME: home,
      XDG_CONFIG_HOME: path.join(home, 'config'),
      XDG_DATA_HOME: path.join(home, 'data'),
      XDG_CACHE_HOME: path.join(home, 'cache'),
      XDG_RUNTIME_DIR: path.join(home, 'runtime'),
      TMPDIR: path.join(home, 'tmp'),
      SHELL: '/bin/false',
      OPENCHAMBER_DATA_DIR: path.join(home, 'data', 'openchamber'),
      OPENCHAMBER_DESKTOP_USER_DATA_DIR: path.join(home, 'electron-profile'),
      OPENCHAMBER_ELECTRON_DEV: '1',
      OPENCHAMBER_SKIP_LOCAL_SERVER: '1',
      OPENCODE_CONFIG_DIR: path.join(home, 'opencode'),
      OPENCODE_PORT: String(fixturePort),
      OPENCODE_HOST: '127.0.0.1',
      OPENCODE_SKIP_START: '1',
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    },
  };
};

const fixturePort = await listen(fixture);

function makeCdpClient(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  let nextId = 0;
  const exceptions = [];
  const consoleErrors = [];
  const requests = [];
  const ready = once(socket, 'open');

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(message.params.args.map((arg) => arg.value || arg.description || '').join(' '));
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') consoleErrors.push(message.params.entry.text);
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url);
    if (message.method === 'Fetch.requestPaused') {
      let allowed = false;
      let origin = 'invalid-url';
      try {
        const url = new URL(message.params.request.url);
        origin = url.origin;
        allowed = ['127.0.0.1', 'localhost'].includes(url.hostname)
          || ['file:', 'data:', 'blob:', 'openchamber-ui:', 'devtools:'].includes(url.protocol);
      } catch {}
      if (!allowed) noExternalRequests.push(origin);
      const method = allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest';
      const params = allowed
        ? { requestId: message.params.requestId }
        : { requestId: message.params.requestId, errorReason: 'BlockedByClient' };
      socket.send(JSON.stringify({ id: ++nextId, method, params }));
    }
    if (message.id && pending.has(message.id)) {
      const { resolve, reject, timer } = pending.get(message.id);
      clearTimeout(timer);
      pending.delete(message.id);
      if (message.error) reject(new Error(`${message.method || 'CDP'}: ${message.error.message}`));
      else resolve(message.result);
    }
  });

  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP timed out: ${method}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });

  return { socket, ready, call, exceptions, consoleErrors, requests };
}

async function waitForPage(debugPort, mode, theme, vitePort, fixtureRequestStart) {
  const deadline = Date.now() + timeoutMs;
  let page;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`Electron exited early (${child.exitCode ?? child.signalCode}): ${childOutput.slice(-4000)}`);
    }
    const targets = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.json()).catch(() => []);
    page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
    if (page) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!page) throw new Error(`Electron did not expose a renderer page for ${mode}/${theme}. ${childOutput.slice(-4000)}`);

  const cdp = makeCdpClient(page.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Log.enable');
  await cdp.call('Network.enable');
  await cdp.call('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  await cdp.call('Emulation.setEmulatedMedia', {
    media: 'screen',
    features: [{ name: 'prefers-color-scheme', value: theme }],
  });

  let state;
  const mountDeadline = Date.now() + timeoutMs;
  while (Date.now() < mountDeadline) {
    state = await cdp.call('Runtime.evaluate', {
      expression: `({url:location.href, ready:document.readyState, root:!!document.querySelector('#root')?.childElementCount, text:(document.body?.innerText||'').slice(0,800), theme:matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'})`,
      returnByValue: true,
    }).then((response) => response.result.value);
    const expectedUrl = mode === 'hmr'
      ? state.url.startsWith(`http://127.0.0.1:${vitePort}/`)
      : state.url.startsWith('openchamber-ui://app/');
    if (state.root && state.text.trim().length > 15 && state.theme === theme && expectedUrl) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!state?.root || state.text.trim().length <= 15 || state.theme !== theme) {
    cdp.socket.close();
    throw new Error(`Renderer did not mount beyond the splash for ${mode}/${theme}: ${JSON.stringify(state)}`);
  }
  if (mode === 'hmr' && !state.url.startsWith(`http://127.0.0.1:${vitePort}/`)) {
    cdp.socket.close();
    throw new Error(`HMR loaded from an unexpected origin: ${state.url}`);
  }
  if (mode === 'bundled' && !state.url.startsWith('openchamber-ui://app/')) {
    cdp.socket.close();
    throw new Error(`Bundled UI loaded from an unexpected origin: ${state.url}`);
  }
  if (cdp.exceptions.length) {
    cdp.socket.close();
    throw new Error(`Renderer exception in ${mode}/${theme}: ${cdp.exceptions.join('; ')}`);
  }
  const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshotPath = path.join(outputDir, `native-ui-${mode}-${theme}.png`);
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  const fixtureErrors = fixtureRequests.slice(fixtureRequestStart).filter((request) => request.status >= 400);
  results.push({
    mode,
    theme,
    origin: new URL(state.url).origin,
    title: await cdp.call('Runtime.evaluate', { expression: 'document.title', returnByValue: true }).then((response) => response.result.value),
    mountedText: state.text,
    screenshot: screenshotPath,
    rendererExceptions: cdp.exceptions,
    consoleErrors: cdp.consoleErrors,
    fixtureApiFailures: fixtureErrors,
    requestCount: cdp.requests.length,
  });
  cdp.socket.close();
}

async function stopProcessTree() {
  if (!child) return;
  const processGroup = child.pid;
  const exited = child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : once(child, 'exit');
  try { process.kill(-processGroup, 'SIGTERM'); } catch {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 8_000))]);
  let groupExists = true;
  try { process.kill(-processGroup, 0); } catch { groupExists = false; }
  if (groupExists) {
    try { process.kill(-processGroup, 'SIGKILL'); } catch {}
    if (child.exitCode === null && child.signalCode === null) await exited;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try { process.kill(-processGroup, 0); } catch { groupExists = false; break; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  child = null;
  if (groupExists) throw new Error(`Electron process group ${processGroup} remained after SIGKILL.`);
}

async function run() {
  await mkdir(outputDir, { recursive: true });
  tempRoot = await mkdtemp(path.join(os.tmpdir(), 'skynex-native-ui-'));
  const previousOpenChamberPort = process.env.OPENCHAMBER_PORT;
  process.env.OPENCHAMBER_PORT = String(fixturePort);
  const { createServer: createViteServer } = await import(pathToFileURL(requireWeb.resolve('vite')).href);
  vite = await createViteServer({
    configFile: path.join(webDir, 'vite.config.ts'),
    envFile: false,
    server: { host: '127.0.0.1', port: 0, strictPort: false },
  });
  await vite.listen();
  const vitePort = vite.httpServer.address().port;
  const fixtureHealth = await fetch(`http://127.0.0.1:${fixturePort}/health`);
  if (!fixtureHealth.ok) throw new Error('Loopback API fixture health check failed.');
  const stagedUi = path.join(electronDir, 'resources/web-dist/index.html');
  const { access } = await import('node:fs/promises');
  await access(stagedUi).catch(() => {
    throw new Error(`${stagedUi} is missing. Build staged web assets before running this smoke.`);
  });

  for (const mode of ['hmr', 'bundled']) {
    for (const theme of ['light', 'dark']) {
      const { env } = await createProfile(`${mode}-${theme}`);
      const fixtureRequestStart = fixtureRequests.length;
      const debugPort = await reservePort();
      const runEnv = {
        ...env,
        OPENCHAMBER_ELECTRON_REMOTE_DEBUGGING_PORT: String(debugPort),
        OPENCHAMBER_HMR_API_PORT: String(fixturePort),
        ...(mode === 'hmr'
          ? { OPENCHAMBER_HMR_UI_PORT: String(vitePort) }
          : { OPENCHAMBER_ELECTRON_USE_BUNDLED_UI: '1' }),
      };
      childOutput = '';
      child = spawn(electronBinary, [path.join(electronDir, 'entry.mjs')], {
        cwd: repoRoot,
        env: runEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      child.stdout.on('data', (chunk) => { childOutput += chunk.toString(); });
      child.stderr.on('data', (chunk) => { childOutput += chunk.toString(); });
      await waitForPage(debugPort, mode, theme, vitePort, fixtureRequestStart);
      await stopProcessTree();
      const residual = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.ok).catch(() => false);
      if (residual) throw new Error(`Electron debugging endpoint remained after cleanup for ${mode}/${theme}.`);
    }
  }
  if (previousOpenChamberPort === undefined) delete process.env.OPENCHAMBER_PORT;
  else process.env.OPENCHAMBER_PORT = previousOpenChamberPort;
  if (noExternalRequests.length) {
    throw new Error(`Blocked non-loopback renderer requests: ${[...new Set(noExternalRequests)].join(', ')}`);
  }
  const summary = {
    status: 'passed',
    display: process.env.DISPLAY,
    electronBinary,
    vitePort,
    fixturePort,
    results,
    blockedExternalRequests: [...new Set(noExternalRequests)],
  };
  await writeFile(path.join(outputDir, 'native-ui-smoke.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

try {
  await run();
} catch (error) {
  const summary = {
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
    childOutput: childOutput.slice(-8_000).replace(/Bearer\s+\S+|oc_client_[A-Za-z0-9_-]+/g, '[redacted]'),
    fixtureApiFailures: fixtureRequests.filter((request) => request.status >= 400),
    blockedExternalRequests: [...new Set(noExternalRequests)],
    results,
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'native-ui-smoke.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.error(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
} finally {
  try {
    await stopProcessTree();
  } finally {
    try {
      await vite?.close();
    } finally {
      await new Promise((resolve) => fixture.close(resolve));
      if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
    }
  }
}
