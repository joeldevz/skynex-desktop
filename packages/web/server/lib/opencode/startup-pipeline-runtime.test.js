import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { createStartupPipelineRuntime } from './startup-pipeline-runtime.js';
import { isRequestAuthorized } from './core-routes.js';

describe('startup pipeline runtime', () => {
  it('publishes the listening port before bootstrapping managed OpenCode', async () => {
    const order = [];
    const runtime = createStartupPipelineRuntime({
      createTerminalRuntime: () => ({}),
      createDictationRuntime: () => ({}),
      createMessageStreamWsRuntime: () => ({}),
      createServerStartupRuntime: () => ({
        resolveBindHost: () => '127.0.0.1',
        startListeningAndMaybeTunnel: async () => {
          order.push('listen');
          return { activePort: 3901 };
        },
        attachProcessHandlers: vi.fn(),
      }),
    });

    await runtime.run({
      app: {},
      setupProxy: vi.fn(),
      staticRoutesRuntime: { registerStaticRoutes: vi.fn() },
      apiOnly: false,
      tunnelRuntimeContext: {
        setActivePort: (port) => order.push(`port:${port}`),
      },
      scheduleOpenCodeApiDetection: () => order.push('detect'),
      bootstrapOpenCodeAtStartup: () => order.push('bootstrap'),
      process: {},
      crypto: {},
      server: {},
      attachSignals: false,
    });

    expect(order).toEqual(['listen', 'port:3901', 'detect', 'bootstrap']);
  });

  it('registers authenticated base routes before the generic proxy', async () => {
    const app = express();
    const order = [];
    const resolveAuthContext = vi.fn(async () => null);
    const runtime = createStartupPipelineRuntime({
      createTerminalRuntime: () => ({}),
      createDictationRuntime: () => ({}),
      createMessageStreamWsRuntime: () => ({}),
      createServerStartupRuntime: () => ({
        resolveBindHost: () => '127.0.0.1',
        startListeningAndMaybeTunnel: async () => ({ activePort: 3901 }),
        attachProcessHandlers: vi.fn(),
      }),
    });

    await runtime.run({
      app,
      registerBaseRoutes: (baseApp) => {
        order.push('base');
        baseApp.get('/api/openchamber/open-sessions', async (req, res) => {
          const authorized = await isRequestAuthorized(req, res, {
            uiAuthController: { resolveAuthContext },
          });
          if (!authorized) return res.status(401).json({ error: 'Unauthorized' });
          return res.json({ sessions: [] });
        });
      },
      setupProxy: (proxyApp) => {
        order.push('proxy');
        proxyApp.all('/api/{*path}', (_req, res) => res.status(200).json({ source: 'proxy-sentinel' }));
      },
      staticRoutesRuntime: { registerStaticRoutes: vi.fn() },
      apiOnly: false,
      tunnelRuntimeContext: { setActivePort: vi.fn() },
      scheduleOpenCodeApiDetection: vi.fn(),
      bootstrapOpenCodeAtStartup: vi.fn(),
      process: {},
      crypto: {},
      server: {},
      attachSignals: false,
    });

    const response = await request(app).get('/api/openchamber/open-sessions');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'Unauthorized' });
    expect(resolveAuthContext).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/api/openchamber/open-sessions' }),
      expect.any(Object),
      { allowUrlToken: false },
    );
    expect(order).toEqual(['base', 'proxy']);
  });
});
