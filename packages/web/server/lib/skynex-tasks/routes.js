import { TasksError, validateTaskId, validateStepId, validateTitle } from './service.js';
import express from 'express';
import { z } from 'zod';

const parseJsonBody = express.json({ limit: '1mb' });
const bodySchema = z.record(z.string(), z.string());

export function registerSkynexTasksRoutes(app, { service, resolveProjectDirectory }) {
  const route = (status, fields, operation) => async (req, res) => {
    try {
      const project = await resolveProjectDirectory(req);
      if (!project.directory) throw new TasksError(400, 'invalid', 'Active workspace is required.');
      if (Object.keys(req.query).some((key) => key !== 'directory')) throw new TasksError(400, 'invalid', 'Invalid task request.');
      if (req.method === 'POST' && (!req.is('application/json') || req.body === undefined)) throw new TasksError(400, 'invalid', 'Expected a JSON object.');
      const parsedBody = bodySchema.safeParse(req.body === undefined ? {} : req.body);
      if (!parsedBody.success) throw new TasksError(400, 'invalid', 'Invalid task request.');
      const body = parsedBody.data;
      if (Object.keys(body).some((key) => !fields.includes(key))) throw new TasksError(400, 'invalid', 'Invalid task request.');
      if (fields.includes('title')) validateTitle(body.title);
      if (req.params.taskId) validateTaskId(req.params.taskId);
      if (req.params.stepId) validateStepId(req.params.stepId);
      res.set('Cache-Control', 'no-store').status(status).json(await operation(req, body, project.directory));
    } catch (error) {
      const safe = error instanceof TasksError ? error : new TasksError(503, 'unavailable', 'Tasks are unavailable.');
      res.status(safe.status).json({ error: { code: safe.code, message: safe.message } });
    }
  };
  app.get('/api/skynex/tasks', route(200, [], async (_req, _body, directory) => ({ tasks: await service.list(directory) })));
  app.post('/api/skynex/tasks', parseJsonBody, route(201, ['title'], async (_req, body, directory) => ({ task: await service.create(directory, body.title) })));
  app.post('/api/skynex/tasks/:taskId/steps', parseJsonBody, route(201, ['title', 'parent'], async (req, body, directory) => ({
    task: await service.addStep(directory, req.params.taskId, body.title, body.parent),
  })));
  app.post('/api/skynex/tasks/:taskId/steps/:stepId/complete', parseJsonBody, route(200, [], async (req, _body, directory) => ({
    task: await service.completeStep(directory, req.params.taskId, req.params.stepId),
  })));
  app.use('/api/skynex/tasks', (error, _req, res, _next) => {
    const invalid = error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large';
    res.status(invalid ? 400 : 503).json({ error: { code: invalid ? 'invalid' : 'unavailable', message: invalid ? 'Invalid task request.' : 'Tasks are unavailable.' } });
  });
}
