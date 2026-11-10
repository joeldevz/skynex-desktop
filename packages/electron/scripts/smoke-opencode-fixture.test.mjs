import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { OpenCode } from '@opencode/client';
import {
  getSmokeModelsDevResponse,
  getSmokeModelsDevAsset,
  getSmokeOpenCodeResponse,
  smokeModel,
  smokeModelsDevCatalog,
  smokeProvider,
} from './smoke-opencode-fixture.mjs';

test('the pinned OpenCode client can read the fixture bootstrap over HTTP', async () => {
  const directory = '/tmp/smoke-profile/chats';
  const requested = [];
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    requested.push(url.pathname);
    const selectedDirectory = decodeURIComponent(request.headers['x-opencode-directory']);
    const body = getSmokeOpenCodeResponse(request.method, url.pathname, selectedDirectory);
    response.writeHead(body === undefined ? 404 : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body ?? { message: 'Unknown fixture route' }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const client = OpenCode.make({
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      headers: { 'x-opencode-directory': encodeURIComponent(directory) },
    });
    const options = { signal: AbortSignal.timeout(5_000) };
    assert.deepEqual(await client.location.get(undefined, options), { directory });
    assert.deepEqual(await client.session.active(options), {});
    assert.deepEqual(await client.project.list(undefined, options), []);
    assert.deepEqual(await client.config.get(undefined, options), { location: { directory }, data: [] });
    assert.deepEqual(await client.mcp.list(undefined, options), { location: { directory }, data: [] });
    assert.deepEqual(await client.vcs.get(undefined, options), { location: { directory }, data: null });
    for (const read of [client.form.list, client.permission.request.list, client.shell.list, client.command.list, client.skill.list]) {
      assert.deepEqual(await read(undefined, options), { location: { directory }, data: [] });
    }
    assert.deepEqual(await client.model.default(undefined, options), { location: { directory }, data: smokeModel });
    assert.ok(requested.includes('/api/session/active'));
    assert.ok(requested.includes('/api/location'));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test('answers exercised OpenCode 2.1.4 boot routes with their wire response envelopes', () => {
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/credential'), []);
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/provider'), { location: { directory: '/smoke/project' }, data: [smokeProvider] });
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/model'), { location: { directory: '/smoke/project' }, data: [smokeModel] });
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/model/default'), { location: { directory: '/smoke/project' }, data: smokeModel });
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/agent'), { location: { directory: '/smoke/project' }, data: [] });
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/session'), { data: [], cursor: { previous: null, next: null } });
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/session/active'), { data: {} });
  const syntheticHome = '/tmp/smoke-profile/chats';
  for (const route of ['/api/location', '/api/agent/title', '/api/config', '/api/form', '/api/project', '/api/permission/request', '/api/vcs', '/api/vcs/status', '/api/shell', '/api/command', '/api/skill', '/api/mcp']) {
    assert.notEqual(getSmokeOpenCodeResponse('GET', route, syntheticHome), undefined, route);
  }
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/location', syntheticHome), { directory: syntheticHome });
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/config', syntheticHome), { location: { directory: syntheticHome }, data: [] });
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/form', syntheticHome), { location: { directory: syntheticHome }, data: [] });
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/permission/request', syntheticHome), { location: { directory: syntheticHome }, data: [] });
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/vcs', syntheticHome), { location: { directory: syntheticHome }, data: null });
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/vcs/status', syntheticHome), { location: { directory: syntheticHome }, data: [] });
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/event'), undefined);
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/not-registered'), undefined);
  assert.deepEqual(getSmokeOpenCodeResponse('POST', '/api/model'), undefined);
});

test('supplies only the exact offline models.dev catalog URL', () => {
  assert.equal(getSmokeModelsDevResponse('https://models.dev/api.json'), smokeModelsDevCatalog);
  assert.equal(getSmokeModelsDevResponse('https://models.dev/other.json'), undefined);
  assert.equal(getSmokeModelsDevResponse('https://example.com/api.json'), undefined);
});

test('serves only canonical public models.dev catalog and synthetic provider logos', () => {
  assert.deepEqual(getSmokeModelsDevAsset('https://models.dev/api.json'), {
    contentType: 'application/json',
    body: JSON.stringify(smokeModelsDevCatalog),
  });
  const logo = getSmokeModelsDevAsset('https://models.dev/logos/opencode-go.svg');
  assert.equal(logo.contentType, 'image/svg+xml');
  assert.match(logo.body, /^<svg\b/);
  assert.doesNotMatch(logo.body, /<script|(?:href|src)=|url\(/i);
  for (const url of [
    'https://models.dev/logos/Smoke.svg',
    'https://models.dev/logos/a.svg?x=1',
    'https://user@models.dev/logos/smoke.svg',
    'http://models.dev/logos/smoke.svg',
    'https://example.com/logos/smoke.svg',
    'https://models.dev/logos/%2e%2e.svg',
    'https://models.dev/logos/smoke.svg#logo',
  ]) assert.equal(getSmokeModelsDevAsset(url), undefined, url);
});
