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

const smokeSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path fill="#777" d="M0 0h1v1H0z"/></svg>';

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
    case '/api/agent/title': return locatedList({
      id: 'title',
      name: 'Title',
      request: { settings: {}, headers: {}, body: {} },
      mode: 'primary',
      hidden: true,
      permissions: [],
    });
    case '/api/session': return { data: [], cursor: { previous: null, next: null } };
    case '/api/session/active': return { data: {} };
    case '/api/integration': return locatedList([]);
    case '/api/websearch/provider': return locatedList([]);
    case '/api/location': return { directory };
    case '/api/config': return locatedList([]);
    case '/api/form': return locatedList([]);
    case '/api/project': return [];
    case '/api/permission/request': return locatedList([]);
    case '/api/vcs': return locatedList(null);
    case '/api/vcs/status': return locatedList([]);
    case '/api/shell': return locatedList([]);
    case '/api/command': return locatedList([]);
    case '/api/skill': return locatedList([]);
    case '/api/mcp': return locatedList([]);
    default: return undefined;
  }
}

export function getSmokeModelsDevResponse(url) {
  return url === 'https://models.dev/api.json' ? smokeModelsDevCatalog : undefined;
}

export function getSmokeModelsDevAsset(url) {
  if (url === 'https://models.dev/api.json') {
    return { contentType: 'application/json', body: JSON.stringify(smokeModelsDevCatalog) };
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.origin !== 'https://models.dev' || parsed.username || parsed.password || parsed.search || parsed.hash) return undefined;
  if (!/^\/logos\/[a-z0-9][a-z0-9-]*\.svg$/.test(parsed.pathname) || parsed.href !== url) return undefined;
  return { contentType: 'image/svg+xml', body: smokeSvg };
}
