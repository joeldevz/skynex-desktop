import express from 'express';
import { isRecord } from '../shared/guards.js';

const parseJsonBody = express.json({ limit: '1mb' });
const asNonEmptyString = (value) => typeof value === 'string' ? value.trim() : '';

export const registerSessionKnowledgeRoutes = (app, { sessionKnowledgeRuntime }) => {
  app.post('/api/session-knowledge/sync', parseJsonBody, async (req, res) => {
    const body = isRecord(req.body) ? req.body : {};
    const sessionId = asNonEmptyString(body.sessionId);
    const directory = asNonEmptyString(body.directory);
    if (!sessionId || !directory) {
      return res.status(400).json({ error: 'sessionId and directory are required' });
    }
    return res.json({ synced: await sessionKnowledgeRuntime.sync(sessionId, directory) });
  });
};
