import { MemoryError } from './service.js';
import express from 'express';

const parseJsonBody = express.json({ limit: '1mb' });

const NOTE_FIELDS = ['what', 'why', 'where', 'learned'];

export function registerSkynexMemoryRoutes(app, { service, resolveProjectDirectory }) {
  const route = (status, fields, operation) => async (req, res) => {
    try {
      const project = await resolveProjectDirectory(req);
      if (!project.directory) throw new MemoryError(400, 'invalid', 'Active workspace is required.');
      if (Object.keys(req.query).some((key) => key !== 'directory')) throw new MemoryError(400, 'invalid', 'Invalid memory request.');
      if (req.method === 'POST' && (!req.is('application/json') || req.body === undefined)) throw new MemoryError(400, 'invalid', 'Expected a JSON object.');
      if (req.body !== undefined && (req.body === null || typeof req.body !== 'object' || Array.isArray(req.body))) {
        throw new MemoryError(400, 'invalid', 'Invalid memory request.');
      }
      const body = req.body ?? {};
      if (Object.keys(body).some((key) => !fields.includes(key))) throw new MemoryError(400, 'invalid', 'Invalid memory request.');
      res.set('Cache-Control', 'no-store').status(status).json(await operation(body, project.directory));
    } catch (error) {
      const safe = error instanceof MemoryError ? error : new MemoryError(503, 'unavailable', 'Memory is unavailable.');
      res.status(safe.status).json({ error: { code: safe.code, message: safe.message } });
    }
  };
  app.get('/api/skynex/memory', route(200, [], async (_body, directory) => ({ memories: await service.list(directory) })));
  app.post('/api/skynex/memory', parseJsonBody, route(201, NOTE_FIELDS, async (body, directory) => {
    await service.save(directory, body);
    return { saved: true };
  }));
  app.post('/api/skynex/memory/recall', parseJsonBody, route(200, ['query'], async (body, directory) => ({
    memories: await service.recall(directory, body.query),
  })));
  app.use('/api/skynex/memory', (error, _req, res, _next) => {
    const invalid = error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large';
    res.status(invalid ? 400 : 503).json({ error: { code: invalid ? 'invalid' : 'unavailable', message: invalid ? 'Invalid memory request.' : 'Memory is unavailable.' } });
  });
}
