import express from 'express';
import path from 'node:path';
import { z } from 'zod';

const requestBodySchema = z.object({
  workspaceId: z.string().min(1),
}).strict();
const nonEmptyStringSchema = z.string().min(1);

function pathsOverlap(first, second) {
  const left = path.resolve(first);
  const right = path.resolve(second);
  return left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
}

function getWorkspace(settings, workspaceId) {
  const workspaces = settings?.workspaceCatalog?.workspaces;
  if (!Array.isArray(workspaces)) return undefined;
  return workspaces.find((workspace) => workspace && workspace.id === workspaceId);
}

export function registerWorkspaceGeneralChatRoutes(app, { authorize, readSettings, resolveDirectory }) {
  const parseJsonBody = express.json({ limit: '4kb' });
  app.post('/api/openchamber/workspaces/general-chat', async (req, res, next) => {
    try {
      if (!await authorize(req, res)) {
        if (!res.headersSent) res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      parseJsonBody(req, res, next);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'Unable to authorize workspace chat request' });
    }
  }, async (req, res) => {
    const body = requestBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }

    try {
      const settings = await readSettings();
      const workspace = getWorkspace(settings, body.data.workspaceId);
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }

      const folders = Array.isArray(workspace.folders) ? workspace.folders : [];
      const folderPaths = folders
        .map((folder) => folder?.path)
        .filter((folderPath) => nonEmptyStringSchema.safeParse(folderPath).success);
      if (folderPaths.length === 0) {
        res.status(409).json({ error: 'Workspace has no linked folders' });
        return;
      }

      const directory = await resolveDirectory(workspace.id, folderPaths);
      if (folderPaths.some((folderPath) => pathsOverlap(directory, folderPath))) {
        res.status(500).json({ error: 'Unable to resolve workspace chat directory' });
        return;
      }
      res.status(200).json({ directory });
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'Unable to resolve workspace chat directory' });
    }
  });
}
