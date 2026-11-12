import assert from 'node:assert/strict';
import test from 'node:test';
import { probeElectronHostWithDeadline } from './electron-host-probe.mjs';

const response = (status, payload = null) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => payload,
});

const compatibleVersion = {
  status: 'ok',
  openchamberVersion: '2.1.1',
  compatibility: {
    capabilities: ['api.runtime-url.v1'],
    apiVersion: 1,
    minClientApiVersion: 1,
  },
};

const baseProbe = (overrides = {}) => probeElectronHostWithDeadline({
  url: 'https://instance.example',
  timeoutMs: 2_000,
  chromiumFetch: async (url) => url.endsWith('/api/version')
    ? response(200, compatibleVersion)
    : response(200, {}),
  isReady: () => true,
  ...overrides,
});

test('uses the Chromium transport as the authoritative ready-state transport', async () => {
  const calls = [];
  const result = await baseProbe({
    chromiumFetch: async (url) => {
      calls.push(url);
      return url.endsWith('/api/version') ? response(200, compatibleVersion) : response(200, {});
    },
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(calls.map((url) => new URL(url).pathname), ['/api/version', '/auth/session']);
});

test('shares one absolute deadline across version and session requests', async () => {
  let expire;
  let scheduled = 0;
  let clock = 0;
  const signals = [];
  const resultPromise = baseProbe({
    now: () => clock,
    scheduleTimeout: (callback) => {
      scheduled += 1;
      expire = callback;
      return 1;
    },
    cancelTimeout: () => {},
    chromiumFetch: async (url, options) => {
      signals.push(options.signal);
      if (url.endsWith('/api/version')) return response(200, compatibleVersion);
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    },
  });

  await Promise.resolve();
  await Promise.resolve();
  clock = 2_000;
  expire();
  const result = await resultPromise;
  assert.equal(scheduled, 1);
  assert.equal(new Set(signals).size, 1);
  assert.deepEqual(result, { status: 'unreachable', latencyMs: 2_000 });
});

test('checks unauthenticated identity before sending sanitized bearer headers', async () => {
  const calls = [];
  const result = await baseProbe({
    expectedServerId: 'server-a',
    clientToken: 'secret-token',
    requestHeaders: { 'X-Instance': 'remote', Authorization: 'attacker' },
    chromiumFetch: async (url, options) => {
      calls.push({ path: new URL(url).pathname, headers: options.headers });
      if (url.endsWith('/health')) return response(200, { serverId: 'server-a' });
      if (url.endsWith('/api/version')) return response(200, compatibleVersion);
      return response(200, {});
    },
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(calls.map((call) => call.path), ['/health', '/api/version', '/auth/session']);
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[1].headers.Authorization, 'Bearer secret-token');
  assert.equal(calls[1].headers['X-Instance'], 'remote');
});

test('accepts an OpenCode 2 capability on a 0.x server and still authenticates its session', async () => {
  const calls = [];
  const result = await baseProbe({
    clientToken: 'fixture-token',
    chromiumFetch: async (url, options) => {
      calls.push({ path: new URL(url).pathname, authorization: options.headers.Authorization });
      if (url.endsWith('/api/version')) {
        return response(200, {
          ...compatibleVersion,
          openchamberVersion: '0.1.1',
          compatibility: {
            ...compatibleVersion.compatibility,
            capabilities: [...compatibleVersion.compatibility.capabilities, 'opencode.api.v2'],
          },
        });
      }
      return response(200, {});
    },
  });

  assert.equal(result.status, 'ok');
  assert.deepEqual(calls.map(({ path }) => path), ['/api/version', '/auth/session']);
  assert.deepEqual(calls.map(({ authorization }) => authorization), ['Bearer fixture-token', 'Bearer fixture-token']);
});

for (const status of [401, 403]) {
  test(`keeps authenticated session ${status} authoritative for an OpenCode 2 server`, async () => {
    const result = await baseProbe({
      chromiumFetch: async (url) => url.endsWith('/api/version')
        ? response(200, {
          ...compatibleVersion,
          openchamberVersion: '0.1.1',
          compatibility: {
            ...compatibleVersion.compatibility,
            capabilities: [...compatibleVersion.compatibility.capabilities, 'opencode.api.v2'],
          },
        })
        : url.endsWith('/auth/session') ? response(status) : response(200, {}),
    });

    assert.equal(result.status, 'auth');
  });
}

for (const [name, versionResponse, expected] of [
  ['401 auth', response(401), 'auth'],
  ['403 auth', response(403), 'auth'],
  ['wrong service', response(200, {}), 'wrong-service'],
  ['null payload', response(200, null), 'wrong-service'],
  ['string compatibility', response(200, { status: 'ok', compatibility: 'yes' }), 'wrong-service'],
  ['boolean compatibility', response(200, { status: 'ok', compatibility: true }), 'wrong-service'],
  ['numeric compatibility', response(200, { status: 'ok', compatibility: 1 }), 'wrong-service'],
  ['array compatibility', response(200, { status: 'ok', compatibility: [] }), 'incompatible'],
  ['missing capability', response(200, { ...compatibleVersion, compatibility: { ...compatibleVersion.compatibility, capabilities: [] } }), 'incompatible'],
  ['server before OpenCode 2', response(200, { ...compatibleVersion, openchamberVersion: '1.24.2' }), 'incompatible'],
  ['OpenCode 2 marker without runtime URL capability', response(200, {
    ...compatibleVersion,
    openchamberVersion: '0.1.1',
    compatibility: { ...compatibleVersion.compatibility, capabilities: ['opencode.api.v2'] },
  }), 'incompatible'],
  ['OpenCode 2 marker with newer API', response(200, {
    ...compatibleVersion,
    openchamberVersion: '0.1.1',
    compatibility: { ...compatibleVersion.compatibility, capabilities: [...compatibleVersion.compatibility.capabilities, 'opencode.api.v2'], apiVersion: 2 },
  }), 'update-recommended'],
  ['OpenCode 2 marker with newer minimum client', response(200, {
    ...compatibleVersion,
    openchamberVersion: '0.1.1',
    compatibility: { ...compatibleVersion.compatibility, capabilities: [...compatibleVersion.compatibility.capabilities, 'opencode.api.v2'], minClientApiVersion: 2 },
  }), 'update-recommended'],
  ['server without a readable version', response(200, { ...compatibleVersion, openchamberVersion: 'unknown' }), 'ok'],
  ['server without a version field', response(200, { status: 'ok', compatibility: compatibleVersion.compatibility }), 'ok'],
  ['newer API', response(200, { ...compatibleVersion, compatibility: { ...compatibleVersion.compatibility, apiVersion: 2 } }), 'update-recommended'],
  ['newer minimum client', response(200, { ...compatibleVersion, compatibility: { ...compatibleVersion.compatibility, minClientApiVersion: 2 } }), 'update-recommended'],
]) {
  test(`preserves authoritative ${name} classification`, async () => {
    const result = await baseProbe({ chromiumFetch: async () => versionResponse });
    assert.equal(result.status, expected);
  });
}

test('rejects an explicit identity mismatch before bearer-bearing requests', async () => {
  let calls = 0;
  const result = await baseProbe({
    expectedServerId: 'server-a',
    clientToken: 'secret-token',
    chromiumFetch: async () => {
      calls += 1;
      return response(200, { serverId: 'server-b' });
    },
  });
  assert.equal(result.status, 'wrong-service');
  assert.equal(calls, 1);
});

test('rejects an identity mismatch before probing a marked OpenCode 2 server', async () => {
  const calls = [];
  const result = await baseProbe({
    expectedServerId: 'server-a',
    chromiumFetch: async (url) => {
      calls.push(new URL(url).pathname);
      if (url.endsWith('/health')) return response(200, { serverId: 'server-b' });
      return response(200, {
        ...compatibleVersion,
        openchamberVersion: '0.1.1',
        compatibility: {
          ...compatibleVersion.compatibility,
          capabilities: [...compatibleVersion.compatibility.capabilities, 'opencode.api.v2'],
        },
      });
    },
  });

  assert.equal(result.status, 'wrong-service');
  assert.deepEqual(calls, ['/health']);
});

test('rejects Electron manual-redirect errors before bearer-bearing requests', async () => {
  let calls = 0;
  const result = await baseProbe({
    expectedServerId: 'expected',
    clientToken: 'fixture-only',
    chromiumFetch: async (_url, options) => {
      calls++;
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.Authorization, undefined);
      throw new Error('Redirect was cancelled');
    },
  });
  assert.equal(result.status, 'wrong-service');
  assert.equal(calls, 1);
});

for (const serverId of [undefined, null, 123, true, {}, [], '', '   ', ' server-a ']) {
  test(`preserves optional health identity parsing for ${JSON.stringify(serverId)}`, async () => {
    const result = await baseProbe({
      expectedServerId: ' server-a ',
      chromiumFetch: async (url) => url.endsWith('/health')
        ? response(200, { serverId })
        : url.endsWith('/api/version') ? response(200, compatibleVersion) : response(200),
    });
    assert.equal(result.status, 'ok');
  });
}

test('malformed version JSON remains wrong-service', async () => {
  const result = await baseProbe({ chromiumFetch: async () => ({
    ...response(200), json: async () => { throw new SyntaxError('invalid fixture JSON'); },
  }) });
  assert.equal(result.status, 'wrong-service');
});

test('non-string expected identity and token retain upstream ignore semantics', async () => {
  const calls = [];
  const result = await baseProbe({
    expectedServerId: 123,
    clientToken: 123,
    chromiumFetch: async (url, options) => {
      calls.push(new URL(url).pathname);
      assert.equal(options.headers.Authorization, undefined);
      return url.endsWith('/api/version') ? response(200, compatibleVersion) : response(200);
    },
  });
  assert.equal(result.status, 'ok');
  assert.deepEqual(calls, ['/api/version', '/auth/session']);
});

test('aborts requests and cancels unused bodies before clearing the timer', async () => {
  const events = [];
  const result = await baseProbe({
    scheduleTimeout: () => 1,
    cancelTimeout: () => { events.push('timer-cleared'); },
    chromiumFetch: async (_url, { signal }) => {
      signal.addEventListener('abort', () => events.push('aborted'));
      return {
        ...response(403),
        body: { locked: false, cancel: async () => { events.push('body-cancelled'); } },
      };
    },
  });
  assert.equal(result.status, 'auth');
  assert.deepEqual(events, ['aborted', 'body-cancelled', 'timer-cleared']);
});
