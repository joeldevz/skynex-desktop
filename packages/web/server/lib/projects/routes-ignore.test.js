import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { registerCommonRequestMiddleware } from '../opencode/core-routes.js';
import { registerProjectSetupRoutes } from './routes.js';

const setup = () => {
  const app = express();
  registerCommonRequestMiddleware(app, { express });
  const projectConfigRuntime = {
    sharedConfigIgnoreStatus: vi.fn(async () => ({ kind: 'committable' })),
    fixSharedConfigIgnore: vi.fn(async () => ({ kind: 'refused', reason: 'not-fixable' })),
  };
  registerProjectSetupRoutes(app, { projectConfigRuntime });
  return { app, projectConfigRuntime };
};

describe('shared config ignore routes', () => {
  it('returns diagnostic status and calls the project runtime with the route id', async () => {
    const { app, projectConfigRuntime } = setup();
    await request(app).get('/api/projects/project-a/config/shared-ignore').expect(200, { kind: 'committable' });
    expect(projectConfigRuntime.sharedConfigIgnoreStatus).toHaveBeenCalledWith('project-a');
  });

  it('requires an empty object to authorize an exception operation', async () => {
    const { app, projectConfigRuntime } = setup();
    await request(app).post('/api/projects/project-a/config/shared-ignore/fix').send({}).expect(200, { kind: 'refused', reason: 'not-fixable' });
    await request(app).post('/api/projects/project-a/config/shared-ignore/fix').send({ force: true }).expect(400);
    expect(projectConfigRuntime.fixSharedConfigIgnore).toHaveBeenCalledTimes(1);
  });
});
