import { describe, expect, test } from 'bun:test';
import { fetchConnectedServerCompatibility, isServerBeforeOpenCode2 } from './serverCompatibility';

const answer = (status: number, body: string) => async () => new Response(body, { status });

describe('isServerBeforeOpenCode2', () => {
  test('flags only a server whose major version is below 2', () => {
    expect(isServerBeforeOpenCode2('1.24.2')).toBe(true);
    expect(isServerBeforeOpenCode2('0.9.0')).toBe(true);
    expect(isServerBeforeOpenCode2('2.0.0')).toBe(false);
    expect(isServerBeforeOpenCode2('2.1.1')).toBe(false);
    expect(isServerBeforeOpenCode2('10.0.0')).toBe(false);
  });

  test('does not flag a version it cannot read', () => {
    expect(isServerBeforeOpenCode2('unknown')).toBe(false);
    expect(isServerBeforeOpenCode2('')).toBe(false);
  });

  test('does not flag a pre-2.0 product version when the server advertises OpenCode 2 support', () => {
    expect(isServerBeforeOpenCode2('0.1.1', true)).toBe(false);
    expect(isServerBeforeOpenCode2('1.24.2')).toBe(true);
  });
});

describe('fetchConnectedServerCompatibility', () => {
  const signal = new AbortController().signal;

  test('returns the trimmed product version and explicit OpenCode 2 capability', async () => {
    expect(await fetchConnectedServerCompatibility(signal, answer(200, JSON.stringify({
      status: 'ok',
      openchamberVersion: ' 0.1.1 ',
      compatibility: { capabilities: ['api.runtime-url.v1', 'opencode.api.v2'] },
    })))).toEqual({ version: '0.1.1', supportsOpenCode2: true });
  });

  test('keeps the version when capability metadata is missing, malformed, or lacks the marker', async () => {
    for (const compatibility of [undefined, null, 'invalid', { capabilities: 'invalid' }, { capabilities: ['api.runtime-url.v1'] }]) {
      expect(await fetchConnectedServerCompatibility(signal, answer(200, JSON.stringify({
        openchamberVersion: ' 1.24.2 ',
        compatibility,
      })))).toEqual({ version: '1.24.2', supportsOpenCode2: false });
    }
  });

  test('says nothing for a failed request, a web page, or a missing version', async () => {
    expect(await fetchConnectedServerCompatibility(signal, answer(500, '{}'))).toBeNull();
    expect(await fetchConnectedServerCompatibility(signal, answer(200, '<!doctype html>'))).toBeNull();
    expect(await fetchConnectedServerCompatibility(signal, answer(200, JSON.stringify({ status: 'ok' })))).toBeNull();
  });

  test('says nothing when the request rejects before compatibility metadata is available', async () => {
    expect(await fetchConnectedServerCompatibility(signal, async () => {
      throw new Error('network unavailable');
    })).toBeNull();
  });
});
