import { expect, test } from 'bun:test';
import { tunnelStartResponseSchema } from './tunnelStartResponse';

test('parses password-required and provider error responses', () => {
  const response = { ok: false, code: 'ui_password_required', error: 'Password required' };
  expect(tunnelStartResponseSchema.parse(response)).toEqual(response);
  expect(tunnelStartResponseSchema.parse({ ok: false, error: 'Enable HTTPS', approvalUrl: 'https://example.com/approve' }))
    .toEqual({ ok: false, error: 'Enable HTTPS', approvalUrl: 'https://example.com/approve' });
});

test('preserves the start result consumed by the tunnel UI', () => {
  const response = {
    ok: true, url: 'https://example.com', connectUrl: null, bootstrapExpiresAt: null,
    activeTunnelMode: 'quick', mode: 'quick', localPort: 5180,
    activeSessions: [{ sessionId: 'session', mode: null, status: 'active', createdAt: 1, lastSeenAt: 2, expiresAt: 3, publicUrl: null }],
    managedRemoteTunnelTokenPresetIds: ['preset'], replacedTunnel: true,
    revokedBootstrapCount: 1, invalidatedSessionCount: 0,
  };
  expect(tunnelStartResponseSchema.parse(response)).toEqual(response);
});

test('does not pass unrecognized response fields into shared UI', () => {
  expect(tunnelStartResponseSchema.parse({ ok: false, code: 'ui_password_required', unexpected: 'ignored' }))
    .toEqual({ ok: false, code: 'ui_password_required' });
});

test('rejects malformed tunnel start payloads', () => {
  for (const payload of [null, [], 'invalid', { code: 403 }, { url: 123 }, { ok: 'true' }, { activeSessions: [{ sessionId: 'incomplete' }] }]) {
    expect(tunnelStartResponseSchema.safeParse(payload).success).toBe(false);
  }
});
