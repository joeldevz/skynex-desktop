import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { createProductAnalytics } from './product-analytics.js';

const PROJECT_TOKEN = 'phc_0123456789abcdefghijklmn';
const INSTALLATION_ID = '123e4567-e89b-42d3-a456-426614174000';

const createAnalytics = (overrides = {}) => {
  const send = async () => true;
  return createProductAnalytics({
    projectToken: PROJECT_TOKEN,
    version: '1.2.3',
    platform: 'darwin',
    isEnterpriseMode: () => false,
    isEnabled: () => true,
    getInstallationId: async () => INSTALLATION_ID,
    send,
    ...overrides,
  });
};

const expectedEnvelope = (event, eventProperties = {}) => ({
  api_key: PROJECT_TOKEN,
  event,
  properties: {
    distinct_id: INSTALLATION_ID,
    $geoip_disable: true,
    app_version: '1.2.3',
    os_family: 'darwin',
    event_schema_version: 1,
    ...eventProperties,
  },
});

describe('product analytics', () => {
  it('sends one canonical app-opened envelope with application-owned metadata', async () => {
    const envelopes = [];
    const analytics = createAnalytics({ send: async (envelope) => { envelopes.push(envelope); } });

    assert.equal(await analytics.record({ event: 'app_opened' }), true);
    assert.deepEqual(envelopes, [{
      api_key: PROJECT_TOKEN,
      event: 'app_opened',
      properties: {
        distinct_id: INSTALLATION_ID,
        $geoip_disable: true,
        app_version: '1.2.3',
        os_family: 'darwin',
        event_schema_version: 1,
      },
    }]);
  });

  it('accepts each declared event and its bounded properties', async () => {
    const cases = [
      { input: { event: 'app_opened' }, expected: expectedEnvelope('app_opened') },
      {
        input: { event: 'active_time_recorded', active_seconds: 60 },
        expected: expectedEnvelope('active_time_recorded', { active_seconds: 60 }),
      },
      { input: { event: 'conversation_created' }, expected: expectedEnvelope('conversation_created') },
      { input: { event: 'prompt_sent' }, expected: expectedEnvelope('prompt_sent') },
      ...['chat', 'terminal', 'browser', 'whiteboards', 'skills', 'integrations'].flatMap((feature) => (
        ['opened', 'used'].map((action) => ({
          input: { event: 'feature_used', feature, action },
          expected: expectedEnvelope('feature_used', { feature, action }),
        }))
      )),
      ...['success', 'error', 'cancelled'].map((outcome) => ({
        input: { event: 'agent_turn_finished', outcome, duration_ms: Number.MAX_SAFE_INTEGER },
        expected: expectedEnvelope('agent_turn_finished', { outcome, duration_ms: Number.MAX_SAFE_INTEGER }),
      })),
      ...['read', 'write', 'search', 'execute', 'browser', 'other'].map((tool_category) => ({
        input: { event: 'agent_tool_finished', outcome: 'error', duration_ms: 0, tool_category },
        expected: expectedEnvelope('agent_tool_finished', { outcome: 'error', duration_ms: 0, tool_category }),
      })),
    ];
    const sent = [];
    const analytics = createAnalytics({ send: async (envelope) => { sent.push(envelope); } });

    for (const { input } of cases) assert.equal(await analytics.record(input), true, input.event);
    assert.deepEqual(sent, cases.map(({ expected }) => expected));
  });

  it('does not create an installation ID or send when disabled or in enterprise mode', async () => {
    for (const overrides of [
      { isEnabled: () => false },
      { isEnterpriseMode: () => true },
    ]) {
      let idCalls = 0;
      let sendCalls = 0;
      const analytics = createAnalytics({
        getInstallationId: async () => { idCalls += 1; return INSTALLATION_ID; },
        send: async () => { sendCalls += 1; },
        ...overrides,
      });

      assert.equal(await analytics.record({ event: 'app_opened' }), false);
      assert.equal(idCalls, 0);
      assert.equal(sendCalls, 0);
    }
  });

  it('does not create an installation ID or send when the project token is absent or invalid', async () => {
    for (const projectToken of [undefined, 'not-a-posthog-project-token']) {
      let idCalls = 0;
      let sendCalls = 0;
      const analytics = createAnalytics({
        projectToken,
        getInstallationId: async () => { idCalls += 1; return INSTALLATION_ID; },
        send: async () => { sendCalls += 1; },
      });

      assert.equal(await analytics.record({ event: 'app_opened' }), false);
      assert.equal(idCalls, 0);
      assert.equal(sendCalls, 0);
    }
  });

  it('rechecks enablement and enterprise mode after installation ID lookup', async () => {
    for (const change of [
      { isEnabled: () => false },
      { isEnterpriseMode: () => true },
    ]) {
      let enabled = true;
      let enterprise = false;
      let sendCalls = 0;
      const analytics = createAnalytics({
        isEnabled: () => change.isEnabled ? enabled : true,
        isEnterpriseMode: () => change.isEnterpriseMode ? enterprise : false,
        getInstallationId: async () => {
          enabled = false;
          enterprise = true;
          return INSTALLATION_ID;
        },
        send: async () => { sendCalls += 1; },
      });

      assert.equal(await analytics.record({ event: 'app_opened' }), false);
      assert.equal(sendCalls, 0);
    }
  });

  it('rejects invalid event shapes before creating an installation ID', async () => {
    const invalidEvents = [
      { event: 'unknown_event' },
      { event: 'app_opened', extra: 'junk' },
      { event: 'active_time_recorded', active_seconds: 0 },
      { event: 'active_time_recorded', active_seconds: 61 },
      { event: 'active_time_recorded', active_seconds: 1.5 },
      { event: 'feature_used', feature: 'chat', action: 'deleted' },
      { event: 'feature_used', feature: 'chat', action: 'opened', path: '/private' },
      { event: 'agent_turn_finished', outcome: 'success', duration_ms: -1 },
      { event: 'agent_turn_finished', outcome: 'success', duration_ms: Number.MAX_SAFE_INTEGER + 1 },
      { event: 'agent_turn_finished', outcome: 'unknown', duration_ms: 1 },
      { event: 'agent_tool_finished', outcome: 'success', duration_ms: 1, tool_category: 'read', arguments: 'private' },
      { event: 'agent_tool_finished', outcome: 'success', duration_ms: 1, tool_category: 'credential' },
      { event: 'prompt_sent', prompt: 'free text must not be collected' },
      { event: 'conversation_created', conversation_id: 'conversation-123' },
    ];
    let idCalls = 0;
    let sendCalls = 0;
    const analytics = createAnalytics({
      getInstallationId: async () => { idCalls += 1; return INSTALLATION_ID; },
      send: async () => { sendCalls += 1; },
    });

    for (const event of invalidEvents) assert.equal(await analytics.record(event), false, JSON.stringify(event));
    assert.equal(idCalls, 0);
    assert.equal(sendCalls, 0);
  });

  it('returns false when the injected sender fails', async () => {
    const analytics = createAnalytics({ send: async () => { throw new Error('transport unavailable'); } });

    assert.equal(await analytics.record({ event: 'app_opened' }), false);
  });
});
