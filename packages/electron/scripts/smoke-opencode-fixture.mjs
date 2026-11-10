export const SMOKE_PROVIDER_ID = 'smoke';
export const SMOKE_MODEL_ID = 'smoke-chat';

export const smokeModel = {
  id: `${SMOKE_PROVIDER_ID}/${SMOKE_MODEL_ID}`,
  modelID: SMOKE_MODEL_ID,
  providerID: SMOKE_PROVIDER_ID,
  name: 'Synthetic smoke model',
  capabilities: { tools: true, input: ['text'], output: ['text'] },
  variants: [],
  time: { released: 0 },
  cost: [],
  status: 'active',
  enabled: true,
  limit: { context: 8192, output: 2048 },
};

export const smokeProvider = {
  id: SMOKE_PROVIDER_ID,
  name: 'Synthetic smoke provider',
  activation: 'auto',
  package: '',
};

export const smokeModelsDevCatalog = {
  [SMOKE_PROVIDER_ID]: {
    id: SMOKE_PROVIDER_ID,
    models: {
      [SMOKE_MODEL_ID]: {
        id: SMOKE_MODEL_ID,
        name: 'Synthetic smoke model',
        tool_call: true,
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 8192, output: 2048 },
      },
    },
  },
};

export function getSmokeOpenCodeResponse(method, pathname, directory = '/smoke/project') {
  if (method !== 'GET') return undefined;
  const location = { directory };
  const locatedList = (data) => ({ location, data });
  switch (pathname) {
    case '/global/health': return { healthy: true, version: '2.1.0' };
    case '/api/info': return { version: '2.1.0' };
    case '/api/credential': return [];
    case '/api/provider': return locatedList([smokeProvider]);
    case '/api/model': return locatedList([smokeModel]);
    case '/api/model/default': return locatedList(smokeModel);
    case '/api/agent': return locatedList([]);
    case '/api/session': return { data: [], cursor: { previous: null, next: null } };
    case '/api/session/active': return [];
    case '/api/integration': return locatedList([]);
    case '/api/websearch/provider': return locatedList([]);
    default: return undefined;
  }
}

export function getSmokeModelsDevResponse(url) {
  return url === 'https://models.dev/api.json' ? smokeModelsDevCatalog : undefined;
}
