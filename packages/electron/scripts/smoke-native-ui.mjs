#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { buildStartupProbeSource, STARTUP_PROBE_GLOBAL } from '../../../scripts/perf/startup-probe.mjs';
import { MODULE_EVALUATION_GLOBAL } from './smoke-module-evaluation.mjs';
import { createSmokeHmrServer } from './smoke-hmr-server.mjs';
import { getSmokeModelsDevAsset, getSmokeOpenCodeResponse } from './smoke-opencode-fixture.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../../..');
const electronDir = path.resolve(scriptDir, '..');
const outputDir = path.resolve(process.env.SMOKE_OUTPUT_DIR || process.argv[2] || '/tmp/opencode/skynex-native-ui-smoke');
const timeoutMs = 60_000;
const requireElectron = createRequire(path.join(electronDir, 'package.json'));
const electronBinary = requireElectron('electron');
const appImagePath = process.env.SMOKE_APPIMAGE_PATH ? path.resolve(process.env.SMOKE_APPIMAGE_PATH) : undefined;
const appImageExecutable = process.env.SMOKE_APPIMAGE_EXECUTABLE ? path.resolve(process.env.SMOKE_APPIMAGE_EXECUTABLE) : undefined;
const appImageDirectory = process.env.SMOKE_APPIMAGE_DIR ? path.resolve(process.env.SMOKE_APPIMAGE_DIR) : undefined;
if (process.platform !== 'linux') throw new Error('This graphical smoke runner requires Linux.');
if (!process.env.DISPLAY) throw new Error('DISPLAY is required. Run this script under the CI Xvfb display.');

const fixtureRequests = [];
const fixture = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  const method = request.method || 'GET';
  const route = `${method} ${url.pathname}`;
  if (route === 'GET /api/event') {
    fixtureRequests.push({ method, path: url.pathname, status: 200 });
    response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    response.write(': synthetic OpenCode event stream ready\n\n');
    return;
  }
  let directory = request.headers['x-opencode-directory'];
  if (typeof directory === 'string') {
    try { directory = decodeURIComponent(directory); } catch {}
  }
  const body = getSmokeOpenCodeResponse(method, url.pathname, directory || '/smoke/project');
  const status = body === undefined ? 404 : 200;
  fixtureRequests.push({ method, path: url.pathname, status });
  if (fixtureRequests.length > 500) fixtureRequests.shift();
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', '*');
  response.setHeader('access-control-allow-methods', '*');
  response.setHeader('content-type', 'application/json');
  response.statusCode = status;
  response.end(JSON.stringify(body || { name: 'NotFoundError', data: { message: 'No synthetic OpenCode route is registered.' } }));
});

let vite;
let child;
let tempRoot;
let childOutput = '';
const results = [];
const noExternalRequests = [];
const fulfilledMetadataRequests = [];
const rendererDiagnostics = [];
let activeCdp;

const redact = (value) => String(value)
  .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
  .replace(/oc_client_[A-Za-z0-9_-]+/g, '[redacted]')
  .replace(/([?&][^=&#\s]+=)[^&#\s]*/g, '$1[redacted]')
  .replace(/(["']?(?:password|token|secret|authorization|credential|nonce|csrf|cookie)["']?\s*[:=]\s*)(["'][^"']*["']|[^\s,;]+)/gi, '$1[redacted]')
  .replace(/(https?:\/\/)[^/@\s]+:[^/@\s]+@/gi, '$1[redacted]@');

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

const createProfile = async (name, backendPort, development = true) => {
  const home = path.join(tempRoot, name);
  for (const dir of ['config', 'data', 'cache', 'runtime', 'tmp', 'opencode']) {
    await mkdir(path.join(home, dir), { recursive: true, mode: 0o700 });
  }
  await mkdir(path.join(home, 'data', 'openchamber'), { recursive: true, mode: 0o700 });
  await writeFile(path.join(home, 'data', 'openchamber', 'settings.json'), JSON.stringify({ desktopLocalPort: backendPort }), { mode: 0o600, flag: 'wx' });
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
      OPENCHAMBER_RELAY_HOST: 'off',
      OPENCHAMBER_DESKTOP_USER_DATA_DIR: path.join(home, 'electron-profile'),
      ...(development ? { OPENCHAMBER_ELECTRON_DEV: '1', OPENCHAMBER_DISABLE_PWA_DEV: '1' } : {}),
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
  const responses = [];
  const moduleRequests = { started: 0, finished: 0, failed: 0, dropped: 0, pending: new Map() };
  const apiTimeline = { events: [], pending: new Map(), droppedEvents: 0, origin: null };
  const recordApi = (kind, params, request, details = {}) => {
    apiTimeline.origin ??= params.timestamp;
    const event = { kind, requestId: params.requestId, atMs: Math.round((params.timestamp - apiTimeline.origin) * 1000), ...request, ...details };
    if (apiTimeline.events.length < 200) apiTimeline.events.push(event);
    else apiTimeline.droppedEvents += 1;
  };
  const ready = once(socket, 'open');

  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(redact(message.params.exceptionDetails.text).slice(0, 2_000));
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      consoleErrors.push(redact(message.params.args.map((arg) => arg.value || arg.description || '').join(' ')).slice(0, 2_000));
    }
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') consoleErrors.push(redact(message.params.entry.text).slice(0, 2_000));
    if (message.method === 'Network.requestWillBeSent') {
      const params = message.params;
      requests.push(redact(params.request.url));
      if (params.type === 'Script') {
        moduleRequests.started += 1;
        if (moduleRequests.pending.size < 512) moduleRequests.pending.set(params.requestId, {
          path: redact(new URL(params.request.url).pathname).slice(0, 500), timestamp: params.timestamp,
        });
        else moduleRequests.dropped += 1;
      }
      const previous = apiTimeline.pending.get(params.requestId);
      if (previous && params.redirectResponse) recordApi('redirect', params, previous, { status: params.redirectResponse.status });
      const pathname = new URL(params.request.url).pathname;
      const selected = pathname.startsWith('/auth/')
        || ['/api/fs/home', '/api/session-folders', '/src/main.tsx'].includes(pathname)
        || pathname.endsWith('/packages/ui/src/main.tsx')
        || pathname.endsWith('/packages/web/src/main.tsx');
      if (selected || previous) {
        const request = { method: params.request.method, path: redact(pathname).slice(0, 500), loaderId: params.loaderId };
        recordApi('request', params, request);
        if (apiTimeline.pending.size < 100 || previous) apiTimeline.pending.set(params.requestId, request);
        else apiTimeline.droppedEvents += 1;
      }
    }
    if (message.method === 'Network.responseReceived') {
      responses.push({ url: redact(message.params.response.url), status: message.params.response.status });
      const request = apiTimeline.pending.get(message.params.requestId);
      if (request) recordApi('response', message.params, request, { status: message.params.response.status });
    }
    if (message.method === 'Network.loadingFinished' || message.method === 'Network.loadingFailed') {
      if (moduleRequests.pending.delete(message.params.requestId)) {
        if (message.method === 'Network.loadingFinished') moduleRequests.finished += 1;
        else moduleRequests.failed += 1;
      }
      const request = apiTimeline.pending.get(message.params.requestId);
      if (request) {
        recordApi(message.method === 'Network.loadingFinished' ? 'finished' : 'failed', message.params, request,
          message.params.errorText ? { error: redact(message.params.errorText).slice(0, 500) } : {});
        apiTimeline.pending.delete(message.params.requestId);
      }
    }
    if (message.method === 'Fetch.requestPaused') {
      let allowed = false;
      let origin = 'invalid-url';
      let metadata;
      try {
        const url = new URL(message.params.request.url);
        origin = url.origin;
        metadata = message.params.request.method === 'GET' ? getSmokeModelsDevAsset(url.href) : undefined;
        allowed = ['127.0.0.1', 'localhost'].includes(url.hostname)
          || ['file:', 'data:', 'blob:', 'openchamber-ui:', 'devtools:'].includes(url.protocol);
      } catch {}
      if (metadata) {
        fulfilledMetadataRequests.push(message.params.request.url);
        socket.send(JSON.stringify({
          id: ++nextId,
          method: 'Fetch.fulfillRequest',
          params: {
            requestId: message.params.requestId,
            responseCode: 200,
            responseHeaders: [{ name: 'content-type', value: metadata.contentType }, { name: 'access-control-allow-origin', value: '*' }],
            body: Buffer.from(metadata.body).toString('base64'),
          },
        }));
        return;
      }
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

  return { socket, ready, call, exceptions, consoleErrors, requests, responses, apiTimeline, moduleRequests };
}

async function readStartupSnapshot(cdp) {
  try {
    const response = await cdp.call('Runtime.evaluate', {
      expression: `(() => { const probe = window[${JSON.stringify(STARTUP_PROBE_GLOBAL)}]; if (!probe) return null; const value = probe.read(); return { frames: value.frames, seen: value.seen, marks: value.marks, trace: value.trace.map(({name, at}) => ({name, at})) }; })()`,
      returnByValue: true,
    });
    const snapshot = response.result.value;
    if (!snapshot) return { available: false };
    return {
      available: true,
      frames: snapshot.frames,
      seen: snapshot.seen,
      marks: snapshot.marks,
      trace: snapshot.trace.slice(0, 100).map(({ name, at }) => ({ name: redact(name).slice(0, 200), at })),
      traceDropped: Math.max(0, snapshot.trace.length - 100),
    };
  } catch (error) {
    return { available: false, error: redact(error instanceof Error ? error.message : error) };
  }
}

async function readModuleEvaluation(cdp) {
  const response = await cdp.call('Runtime.evaluate', {
    expression: `(() => { const state = window[${JSON.stringify(MODULE_EVALUATION_GLOBAL)}]; if (!state) return null; const started = Object.entries(state.started); const finished = Object.entries(state.finished); return { startedCount: started.length, finishedCount: finished.length, unfinished: started.filter(([name]) => state.finished[name] === undefined).slice(0, 100), lastFinished: finished.sort((a,b) => b[1]-a[1]).slice(0,30) }; })()`,
    returnByValue: true,
  });
  return response.result.value;
}

async function exerciseComposer(cdp) {
  const point = await cdp.call('Runtime.evaluate', {
    expression: `(() => { const host = document.querySelector('[data-chat-input="true"]'); if (!host) return null; const rect = host.getBoundingClientRect(); return {x: rect.left + rect.width / 2, y: rect.top + rect.height / 2}; })()`,
    returnByValue: true,
  }).then((response) => response.result.value);
  if (!point || point.x <= 0 || point.y <= 0) throw new Error('The usable composer has no on-screen hit target.');
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y });
  await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 });
  const focused = await cdp.call('Runtime.evaluate', {
    expression: `(() => { const host = document.querySelector('[data-chat-input="true"]'); const editor = host?.querySelector('[contenteditable="true"], textarea') ?? (host?.isContentEditable ? host : null); return !!editor && (editor === document.activeElement || editor.contains(document.activeElement)); })()`,
    returnByValue: true,
  }).then((response) => response.result.value);
  if (!focused) throw new Error('A real pointer click did not focus the composer editor.');
  const marker = `native-smoke-${Date.now()}`;
  await cdp.call('Input.insertText', { text: marker });
  const entered = await cdp.call('Runtime.evaluate', {
    expression: `(() => { const host = document.querySelector('[data-chat-input="true"]'); const editor = host?.querySelector('[contenteditable="true"], textarea') ?? (host?.isContentEditable ? host : null); return (editor?.value ?? editor?.textContent ?? '').includes(${JSON.stringify(marker)}); })()`,
    returnByValue: true,
  }).then((response) => response.result.value);
  if (!entered) throw new Error('The composer did not accept native keyboard input.');
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2 });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2 });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace' });
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace' });
  return { pointerClickFocusedEditor: true, insertedTextObserved: true };
}

function readApiTimeline(cdp) {
  return { afterCdpAttachOnly: true, clock: 'milliseconds since first selected CDP network event',
    events: [...cdp.apiTimeline.events], droppedEvents: cdp.apiTimeline.droppedEvents,
    pendingRequests: [...cdp.apiTimeline.pending.values()] };
}

async function captureFailureEvidence({ cdp, mode, theme, state }) {
  const startup = await readStartupSnapshot(cdp);
  const evidence = { mode, theme, state: state ? { ...state, url: redact(state.url), text: redact(state.text) } : state, rendererExceptions: cdp.exceptions.slice(-100), consoleErrors: cdp.consoleErrors.slice(-100), requests: cdp.requests.slice(-100), responses: cdp.responses.slice(-100), startup, apiTimeline: readApiTimeline(cdp) };
  try { evidence.moduleEvaluation = await readModuleEvaluation(cdp); } catch (error) {
    evidence.moduleEvaluationError = redact(String(error));
  }
  evidence.moduleRequests = {
    started: cdp.moduleRequests.started, finished: cdp.moduleRequests.finished,
    failed: cdp.moduleRequests.failed, dropped: cdp.moduleRequests.dropped,
    afterCdpAttachOnly: true,
    pending: [...cdp.moduleRequests.pending.values()].slice(0, 50),
    pendingTruncated: Math.max(0, cdp.moduleRequests.pending.size - 50),
  };
  try {
    const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const screenshotPath = path.join(outputDir, `native-ui-${mode}-${theme}-failure.png`);
    await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
    evidence.screenshot = screenshotPath;
  } catch (error) {
    evidence.screenshotError = redact(error instanceof Error ? error.message : error);
  }
  rendererDiagnostics.push(evidence);
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
  activeCdp = { cdp, mode, theme };
  await cdp.ready;
  await cdp.call('Page.enable');
  await cdp.call('Runtime.enable');
  await cdp.call('Log.enable');
  await cdp.call('Network.enable');
  const startupProbeScript = `if (window === window.top) { ${buildStartupProbeSource()} }`;
  await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: startupProbeScript });
  await cdp.call('Runtime.evaluate', { expression: startupProbeScript });
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
    activeCdp.state = state;
    const expectedUrl = mode === 'hmr'
      ? state.url.startsWith(`http://127.0.0.1:${vitePort}/`)
      : state.url.startsWith('openchamber-ui://app/');
    const readiness = await readStartupSnapshot(cdp);
    if (state.root && state.text.trim().length > 15 && state.theme === theme && expectedUrl
      && readiness.available && readiness.marks.usable !== undefined) break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!state?.root || state.text.trim().length <= 15 || state.theme !== theme) {
    await captureFailureEvidence(activeCdp);
    cdp.socket.close();
    activeCdp = undefined;
    throw new Error(`Renderer did not mount beyond the splash for ${mode}/${theme}: ${JSON.stringify(state)}`);
  }
  if (mode === 'hmr' && !state.url.startsWith(`http://127.0.0.1:${vitePort}/`)) {
    await captureFailureEvidence(activeCdp);
    cdp.socket.close();
    activeCdp = undefined;
    throw new Error(`HMR loaded from an unexpected origin: ${state.url}`);
  }
  if (mode !== 'hmr' && !state.url.startsWith('openchamber-ui://app/')) {
    await captureFailureEvidence(activeCdp);
    cdp.socket.close();
    activeCdp = undefined;
    throw new Error(`Bundled UI loaded from an unexpected origin: ${state.url}`);
  }
  if (cdp.exceptions.length) {
    await captureFailureEvidence(activeCdp);
    cdp.socket.close();
    activeCdp = undefined;
    throw new Error(`Renderer exception in ${mode}/${theme}: ${cdp.exceptions.join('; ')}`);
  }
  const startup = await readStartupSnapshot(cdp);
  if (!startup.available || startup.marks.reactMounted === undefined || startup.marks.usable === undefined) {
    await captureFailureEvidence(activeCdp);
    cdp.socket.close();
    activeCdp = undefined;
    throw new Error(`Renderer did not prove a React commit and usable composer for ${mode}/${theme}: ${JSON.stringify(startup)}`);
  }
  let inputEvidence;
  try {
    inputEvidence = await exerciseComposer(cdp);
  } catch (error) {
    await captureFailureEvidence(activeCdp);
    cdp.socket.close();
    activeCdp = undefined;
    throw error;
  }
  const sessionBootstrap = cdp.responses.filter(({ url }) => new URL(url).pathname === '/auth/session');
  if (!sessionBootstrap.some(({ status }) => status >= 200 && status < 300)) {
    await captureFailureEvidence(activeCdp);
    cdp.socket.close();
    activeCdp = undefined;
    throw new Error(`Renderer did not exercise the normal session bootstrap for ${mode}/${theme}.`);
  }
  const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const screenshotPath = path.join(outputDir, `native-ui-${mode}-${theme}.png`);
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'));
  const fixtureErrors = fixtureRequests.slice(fixtureRequestStart).filter((request) => request.status >= 400);
  if (fixtureErrors.length) {
    await captureFailureEvidence(activeCdp);
    cdp.socket.close();
    activeCdp = undefined;
    throw new Error(`Synthetic OpenCode fixture has unimplemented requests in ${mode}/${theme}: ${JSON.stringify(fixtureErrors)}`);
  }
  results.push({
    mode,
    theme,
    origin: new URL(state.url).origin,
    title: await cdp.call('Runtime.evaluate', { expression: 'document.title', returnByValue: true }).then((response) => response.result.value),
    mountedText: redact(state.text),
    screenshot: screenshotPath,
    rendererExceptions: cdp.exceptions.slice(-100),
    consoleErrors: cdp.consoleErrors.slice(-100),
    fixtureApiNonSuccess: fixtureErrors,
    requestCount: cdp.requests.length,
    sessionBootstrap,
    startup,
    inputEvidence,
    apiTimeline: readApiTimeline(cdp),
  });
  cdp.socket.close();
  activeCdp = undefined;
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
  await mkdir('/tmp/opencode', { recursive: true });
  tempRoot = await mkdtemp(path.join('/tmp/opencode', 'skynex-native-ui-'));
  const backendPort = await reservePort();
  vite = await createSmokeHmrServer(backendPort);
  await vite.listen();
  const vitePort = vite.httpServer.address().port;
  const stagedUi = path.join(electronDir, 'resources/web-dist/index.html');
  const { access } = await import('node:fs/promises');
  await access(stagedUi).catch(() => {
    throw new Error(`${stagedUi} is missing. Build staged web assets before running this smoke.`);
  });

  const modes = process.env.SMOKE_APPIMAGE_ONLY === '1' ? ['appimage'] : ['hmr', 'bundled'];
  if (modes.includes('appimage') && (!appImagePath || !appImageExecutable || !appImageDirectory)) {
    throw new Error('SMOKE_APPIMAGE_PATH, extracted SMOKE_APPIMAGE_EXECUTABLE and SMOKE_APPIMAGE_DIR are required.');
  }
  for (const mode of modes) {
    for (const theme of ['light', 'dark']) {
      const { env } = await createProfile(`${mode}-${theme}`, backendPort, mode !== 'appimage');
      const fixtureRequestStart = fixtureRequests.length;
      const debugPort = await reservePort();
      const runEnv = {
        ...env,
        ...(mode === 'appimage'
          ? { APPIMAGE: appImagePath, APPDIR: appImageDirectory }
          : { OPENCHAMBER_ELECTRON_REMOTE_DEBUGGING_PORT: String(debugPort) }),
        OPENCHAMBER_STARTUP_PERF: '1',
        OPENCHAMBER_PORT: String(backendPort),
        OPENCHAMBER_HMR_API_PORT: String(backendPort),
        ...(mode === 'hmr'
          ? { OPENCHAMBER_HMR_UI_PORT: String(vitePort) }
          : mode === 'bundled' ? { OPENCHAMBER_ELECTRON_USE_BUNDLED_UI: '1' } : {}),
      };
      childOutput = '';
      child = spawn(mode === 'appimage' ? appImageExecutable : electronBinary,
        mode === 'appimage' ? [`--remote-debugging-port=${debugPort}`] : [path.join(electronDir, 'entry.mjs')], {
        cwd: repoRoot,
        env: runEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      });
      child.stdout.on('data', (chunk) => { childOutput = `${childOutput}${chunk}`.slice(-32_000); });
      child.stderr.on('data', (chunk) => { childOutput = `${childOutput}${chunk}`.slice(-32_000); });
      await waitForPage(debugPort, mode, theme, vitePort, fixtureRequestStart);
      await stopProcessTree();
      const residual = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then((response) => response.ok).catch(() => false);
      if (residual) throw new Error(`Electron debugging endpoint remained after cleanup for ${mode}/${theme}.`);
    }
  }
  if (noExternalRequests.length) {
    throw new Error(`Blocked non-loopback renderer requests: ${[...new Set(noExternalRequests)].join(', ')}`);
  }
  const summary = {
    status: 'passed',
    display: process.env.DISPLAY,
    electronBinary,
    vitePort,
    fixturePort,
    backendPort,
    results,
    blockedExternalRequests: [...new Set(noExternalRequests)],
    fulfilledMetadataRequests: [...new Set(fulfilledMetadataRequests)],
    fixtureRequests,
  };
  await writeFile(path.join(outputDir, 'native-ui-smoke.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

try {
  await run();
} catch (error) {
  if (activeCdp) await captureFailureEvidence(activeCdp);
  const summary = {
    status: 'failed',
    error: redact(error instanceof Error ? error.message : error),
    childOutput: redact(childOutput.slice(-8_000)),
    fixtureApiNonSuccess: fixtureRequests.filter((request) => request.status >= 400),
    blockedExternalRequests: [...new Set(noExternalRequests)],
    fulfilledMetadataRequests: [...new Set(fulfilledMetadataRequests)],
    fixtureRequests,
    rendererDiagnostics,
    results,
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, 'native-ui-smoke.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.error(JSON.stringify(summary, null, 2));
  process.exitCode = 1;
} finally {
  try {
    activeCdp?.cdp.socket.close();
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
