import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getSmokeModelsDevResponse,
  getSmokeOpenCodeResponse,
  smokeModel,
  smokeModelsDevCatalog,
  smokeProvider,
} from './smoke-opencode-fixture.mjs';

test('answers exercised OpenCode 2.1.4 boot routes with their wire response envelopes', () => {
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/credential'), []);
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/provider'), { location: { directory: '/smoke/project' }, data: [smokeProvider] });
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/model'), { location: { directory: '/smoke/project' }, data: [smokeModel] });
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/model/default'), { location: { directory: '/smoke/project' }, data: smokeModel });
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/agent'), { location: { directory: '/smoke/project' }, data: [] });
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/session'), { data: [], cursor: { previous: null, next: null } });
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/event'), undefined);
  assert.deepEqual(getSmokeOpenCodeResponse('GET', '/api/not-registered'), undefined);
  assert.deepEqual(getSmokeOpenCodeResponse('POST', '/api/model'), undefined);
});

test('supplies only the exact offline models.dev catalog URL', () => {
  assert.equal(getSmokeModelsDevResponse('https://models.dev/api.json'), smokeModelsDevCatalog);
  assert.equal(getSmokeModelsDevResponse('https://models.dev/other.json'), undefined);
  assert.equal(getSmokeModelsDevResponse('https://example.com/api.json'), undefined);
});
