import test from 'node:test';
import assert from 'node:assert/strict';
import { createDesktopProductAnalytics } from './product-analytics-runtime.mjs';

const token = `phc_${'a'.repeat(24)}`;
const id = '12345678-1234-4123-8123-123456789abc';
const flush = () => new Promise((resolve) => setImmediate(resolve));

test('re-enabling allows fresh interactions without replaying launch', async () => {
  const events = [];
  const runtime = createDesktopProductAnalytics({
    projectToken: token,
    recordStartup: true,
    version: '1.2.3', platform: 'linux', isEnterpriseMode: () => false,
    readPreference: () => false, writePreference: async () => {},
    getInstallationId: async () => id,
    fetchImpl: async (_url, options) => {
      events.push(JSON.parse(options.body).event);
      return { ok: true };
    },
  });
  assert.equal(await runtime.recordInteraction('prompt_sent'), false);
  await runtime.setEnabled(true);
  assert.equal(await runtime.recordInteraction('prompt_sent'), true);
  assert.deepEqual(events, ['prompt_sent']);
});

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

const options = (overrides = {}) => ({
  projectToken: token, version: '1.2.3', platform: 'linux', recordStartup: true, isEnterpriseMode: () => false,
  readPreference: () => true, writePreference: async () => {}, getInstallationId: async () => id,
  fetchImpl: async () => ({ ok: true }), ...overrides,
});

test('a launch without local foreground startup eligibility never records an opening', async () => {
  const events = [];
  let identities = 0;
  const runtime = createDesktopProductAnalytics(options({
    recordStartup: false,
    getInstallationId: async () => { identities++; return id; },
    fetchImpl: async (_url, request) => { events.push(JSON.parse(request.body).event); return { ok: true }; },
  }));
  await flush();
  assert.equal(identities, 0);
  assert.deepEqual(events, []);
  assert.equal(await runtime.recordInteraction('prompt_sent'), true);
  assert.deepEqual(events, ['prompt_sent']);
  runtime.stop();
});

test('feature events accept only the narrow allowlist and obey opt-out', async () => {
  const sent = [];
  let identities = 0;
  const runtime = createDesktopProductAnalytics(options({
    readPreference: () => false,
    getInstallationId: async () => { identities++; return id; },
    fetchImpl: async (_url, request) => { sent.push(JSON.parse(request.body)); return { ok: true }; },
  }));
  assert.equal(await runtime.recordFeature({ feature: 'chat', action: 'used' }), false);
  assert.equal(identities, 0);
  await runtime.setEnabled(true);
  for (const args of [{ feature: 'chat', action: 'used', text: 'secret' }, { feature: 'other', action: 'used' }, { feature: 'chat', action: 'bad' }]) {
    assert.equal(await runtime.recordFeature(args), false);
  }
  assert.equal(identities, 0);
  assert.equal(await runtime.recordFeature({ feature: 'browser', action: 'opened' }), true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].event, 'feature_used');
  assert.deepEqual(Object.keys(sent[0].properties).sort(), ['$geoip_disable', 'action', 'app_version', 'distinct_id', 'event_schema_version', 'feature', 'os_family'].sort());
  assert.equal(sent[0].properties.feature, 'browser');
  assert.equal(sent[0].properties.action, 'opened');
  runtime.stop();
});

test('feature events do not identify or send when enterprise or token blocks collection', async () => {
  for (const overrides of [{ projectToken: null }, { isEnterpriseMode: () => true }]) {
    let calls = 0;
    const runtime = createDesktopProductAnalytics(options({ ...overrides,
      getInstallationId: async () => { calls++; return id; },
      fetchImpl: async () => { calls++; return { ok: true }; },
    }));
    assert.equal(await runtime.recordFeature({ feature: 'skills', action: 'used' }), false);
    assert.equal(calls, 0);
    runtime.stop();
  }
});

test('unconfigured, enterprise and disabled startup create no identity or request and never replay', async () => {
  for (const overrides of [{ projectToken: null }, { isEnterpriseMode: () => true }, { readPreference: () => false }]) {
    let calls = 0;
    const runtime = createDesktopProductAnalytics(options({ ...overrides,
      getInstallationId: async () => { calls++; return id; }, fetchImpl: async () => { calls++; return { ok: true }; },
    }));
    await flush();
    await runtime.setEnabled(true);
    await flush();
    assert.equal(calls, 0);
    runtime.stop();
  }
});

test('sends one allowlisted startup event without replay after preference changes', async () => {
  let stored = true;
  const sent = [];
  const runtime = createDesktopProductAnalytics(options({
    readPreference: () => stored, writePreference: async (value) => { stored = value; },
    fetchImpl: async (url, request) => { sent.push({ url, request, payload: JSON.parse(request.body) }); return { ok: true }; },
  }));
  await flush();
  assert.deepEqual(sent.map((item) => item.payload.event), ['app_opened']);
  assert.equal(sent[0].url, 'https://eu.i.posthog.com/capture/');
  assert.equal(sent[0].request.redirect, 'error');
  assert.equal(sent[0].payload.properties.$geoip_disable, true);
  await runtime.setEnabled(false);
  assert.deepEqual(runtime.settings(), { enabled: false, available: true });
  await runtime.setEnabled(true);
  await flush();
  assert.equal(sent.length, 1);
  runtime.stop();
});

test('opt-out persists without configuration and rejects non-booleans', async () => {
  let stored = true;
  const runtime = createDesktopProductAnalytics(options({ projectToken: null,
    readPreference: () => stored, writePreference: async (value) => { stored = value; },
  }));
  assert.throws(() => runtime.setEnabled('false'), TypeError);
  assert.deepEqual(await runtime.setEnabled(false), { enabled: false, available: false });
  assert.equal(stored, false);
  runtime.stop();
});

test('failed opt-out stays disabled until an explicit enable is saved', async () => {
  let stored = true;
  let failEnable = true;
  let identities = 0;
  let sends = 0;
  const runtime = createDesktopProductAnalytics(options({
    recordStartup: false,
    readPreference: () => stored,
    writePreference: async (value) => {
      if (!value || failEnable) throw new Error('write failed');
      stored = value;
    },
    getInstallationId: async () => { identities++; return id; },
    fetchImpl: async () => { sends++; return { ok: true }; },
  }));
  await assert.rejects(runtime.setEnabled(false), /write failed/);
  assert.equal(stored, true);
  assert.equal(runtime.settings().enabled, false);
  assert.equal(await runtime.recordInteraction('prompt_sent'), false);
  await assert.rejects(runtime.setEnabled(true), /write failed/);
  assert.equal(runtime.settings().enabled, false);
  assert.equal(await runtime.recordInteraction('prompt_sent'), false);
  assert.equal(identities, 0);
  assert.equal(sends, 0);
  failEnable = false;
  await runtime.setEnabled(true);
  assert.equal(await runtime.recordInteraction('prompt_sent'), true);
  assert.equal(sends, 1);
  runtime.stop();
});

test('a queued failed opt-out overrides an earlier successful enable', async () => {
  const write = deferred();
  const runtime = createDesktopProductAnalytics(options({
    recordStartup: false,
    readPreference: () => false,
    writePreference: async (value) => {
      if (value) await write.promise;
      else throw new Error('write failed');
    },
  }));
  const enable = runtime.setEnabled(true);
  const disable = runtime.setEnabled(false);
  write.resolve();
  await enable;
  await assert.rejects(disable, /write failed/);
  assert.equal(runtime.settings().enabled, false);
  assert.equal(await runtime.recordInteraction('prompt_sent'), false);
  runtime.stop();
});

test('pending identity is gated after opt-out, reenable, stop or enterprise policy', async () => {
  for (const change of ['disable', 'reenable', 'stop', 'enterprise']) {
    const identity = deferred();
    let eligible; let enterprise = false; let requests = 0;
    const runtime = createDesktopProductAnalytics(options({
      isEnterpriseMode: () => enterprise,
      getInstallationId: (gate) => { eligible = gate; return identity.promise; },
      fetchImpl: async () => { requests++; return { ok: true }; },
    }));
    assert.equal(eligible(), true);
    if (change === 'disable' || change === 'reenable') await runtime.setEnabled(false);
    if (change === 'reenable') await runtime.setEnabled(true);
    if (change === 'stop') { runtime.stop(); await runtime.setEnabled(true); }
    if (change === 'enterprise') enterprise = true;
    assert.equal(eligible(), false);
    identity.resolve(id);
    await flush();
    assert.equal(requests, 0, change);
    runtime.stop();
  }
});

test('opt-out and stop abort an in-flight request', async () => {
  for (const action of ['disable', 'stop']) {
    let signal;
    const runtime = createDesktopProductAnalytics(options({ fetchImpl: async (_url, request) => {
      signal = request.signal;
      return new Promise((resolve) => signal.addEventListener('abort', () => resolve({ ok: false })));
    } }));
    await flush();
    assert.equal(signal.aborted, false);
    if (action === 'disable') await runtime.setEnabled(false); else runtime.stop();
    assert.equal(signal.aborted, true);
    runtime.stop();
    await flush();
  }
});

test('records only conversation_created and prompt_sent with the complete desktop envelope', async () => {
  const sent = [];
  const runtime = createDesktopProductAnalytics(options({
    fetchImpl: async (url, request) => {
      sent.push({ url, request, payload: JSON.parse(request.body) });
      return { ok: true };
    },
  }));
  await flush();

  for (const event of ['conversation_created', 'prompt_sent']) {
    assert.equal(await runtime.recordInteraction(event), true);
    const { url, request, payload } = sent.at(-1);
    assert.equal(url, 'https://eu.i.posthog.com/capture/');
    assert.equal(request.method, 'POST');
    assert.equal(request.headers['content-type'], 'application/json');
    assert.equal(request.redirect, 'error');
    assert.deepEqual(payload, {
      api_key: token,
      event,
      properties: {
        distinct_id: id,
        $geoip_disable: true,
        app_version: '1.2.3',
        os_family: 'linux',
        event_schema_version: 1,
      },
    });
  }
  runtime.stop();
});

test('interaction events reject free text, catalog-only events and objects without identity or send', async () => {
  let identityCalls = 0;
  let requests = 0;
  const runtime = createDesktopProductAnalytics(options({
    getInstallationId: async () => { identityCalls++; return id; },
    fetchImpl: async () => { requests++; return { ok: true }; },
  }));
  await flush();
  const identityBaseline = identityCalls;
  const requestBaseline = requests;

  for (const value of ['feature_used', 'free-form text', { event: 'prompt_sent' }]) {
    assert.equal(await runtime.recordInteraction(value), false);
  }
  assert.equal(identityCalls, identityBaseline);
  assert.equal(requests, requestBaseline);
  runtime.stop();
});

test('a missing project token prevents interaction identity lookup and send', async () => {
  let identityCalls = 0;
  let requests = 0;
  const runtime = createDesktopProductAnalytics(options({
    projectToken: null,
    getInstallationId: async () => { identityCalls++; return id; },
    fetchImpl: async () => { requests++; return { ok: true }; },
  }));

  assert.equal(await runtime.recordInteraction('prompt_sent'), false);
  assert.equal(identityCalls, 0);
  assert.equal(requests, 0);
  runtime.stop();
});

test('interaction events check Enterprise Mode before identity and send', async () => {
  let identityCalls = 0;
  let requests = 0;
  const runtime = createDesktopProductAnalytics(options({
    isEnterpriseMode: () => true,
    getInstallationId: async () => { identityCalls++; return id; },
    fetchImpl: async () => { requests++; return { ok: true }; },
  }));

  assert.equal(await runtime.recordInteraction('conversation_created'), false);
  assert.equal(identityCalls, 0);
  assert.equal(requests, 0);
  runtime.stop();
});

test('pending interaction events are invalidated by disable and re-enable or stop', async () => {
  for (const change of ['disable', 'reenable', 'stop']) {
    const pendingIdentity = deferred();
    let identityCalls = 0;
    const sent = [];
    const runtime = createDesktopProductAnalytics(options({
      getInstallationId: () => {
        identityCalls++;
        return identityCalls === 1 ? Promise.resolve(id) : pendingIdentity.promise;
      },
      fetchImpl: async (_url, request) => {
        sent.push(JSON.parse(request.body));
        return { ok: true };
      },
    }));
    await flush();

    const interaction = runtime.recordInteraction('prompt_sent');
    assert.equal(identityCalls, 2);
    if (change === 'disable' || change === 'reenable') {
      await runtime.setEnabled(false);
      if (change === 'reenable') await runtime.setEnabled(true);
    } else {
      runtime.stop();
    }
    pendingIdentity.resolve(id);

    assert.equal(await interaction, false, change);
    assert.deepEqual(sent.map((payload) => payload.event), ['app_opened'], change);
    runtime.stop();
  }
});
