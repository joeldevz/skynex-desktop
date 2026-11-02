import { execFile } from 'node:child_process';
import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

const executable = '/home/clasing/.local/share/pnpm/bin/skynex';
const taskPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
const stepPattern = /^step-[0-9]{3,}$/;
const stringSchema = z.string();
const jsonValueSchema = z.json();
const statusSchema = z.enum(['pending', 'in_progress', 'done', 'blocked']);

export class TasksError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const invalid = () => new TasksError(400, 'invalid', 'Invalid task request.');
const badCli = () => new TasksError(502, 'badCLI', 'Tasks returned an invalid response.');
const unavailable = () => new TasksError(503, 'unavailable', 'Tasks are unavailable.');
const missingTask = () => new TasksError(404, 'missing', 'Task not found.');
export const validateTaskId = (id) => {
  const parsed = stringSchema.safeParse(id);
  if (!parsed.success || !taskPattern.test(parsed.data)) throw invalid();
  return parsed.data;
};
const isStepId = (id) => {
  const parsed = stringSchema.safeParse(id);
  return parsed.success && parsed.data.length <= 80 && stepPattern.test(parsed.data);
};
export const validateStepId = (id) => {
  if (!isStepId(id)) throw invalid();
  return id;
};
export const validateTitle = (value) => {
  const parsed = stringSchema.safeParse(value);
  if (!parsed.success || /[\p{Cc}\p{Cf}]/u.test(parsed.data)) throw invalid();
  const title = parsed.data.trim();
  if (!title || title.length > 200 || title.startsWith('-')) throw invalid();
  return title;
};

// The notebook of a project is the CLI's default `.skynex/tasks`, passed to every
// call explicitly so the CLI never guesses its root from the working directory.
const notebookRoot = (directory) => path.join(directory, '.skynex', 'tasks');

// Reads see a missing notebook as no tasks; only a write creates it.
const notebookAt = async (directory, { create }) => {
  const root = notebookRoot(directory);
  try {
    if (create) await mkdir(root, { recursive: true, mode: 0o700 });
    for (const entry of [path.dirname(root), root]) {
      const stat = await lstat(entry).catch((error) => {
        if (error?.code === 'ENOENT') return null;
        throw error;
      });
      if (!stat) return null;
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw unavailable();
    }
    return root;
  } catch (error) {
    if (error instanceof TasksError) throw error;
    throw unavailable();
  }
};

const requireNotebook = async (directory) => {
  const root = await notebookAt(directory, { create: false });
  if (!root) throw missingTask();
  return root;
};

export function createTasksService() {
  let queue = Promise.resolve();
  const serial = (operation) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const run = (root, args) => new Promise((resolve, reject) => {
    execFile(executable, ['task', ...args, '--tasks-root', root, '--json'], {
      cwd: root, shell: false, timeout: 10_000, maxBuffer: 1024 * 1024, encoding: 'utf8',
    }, (error, stdout) => {
      if (error) {
        reject(error.killed ? new TasksError(504, 'timeout', 'Tasks timed out. Reload before retrying.')
          : error.code === 'ENOENT' || error.code === 'EACCES' ? unavailable() : badCli());
        return;
      }
      try { resolve(JSON.parse(stdout)); } catch { reject(badCli()); }
    });
  });
  const read = async (root, id) => {
    const raw = await run(root, ['status', '--task', id]);
    const response = z.object({ taskId: z.string(), title: z.string(), steps: z.array(z.json()) }).passthrough().safeParse(raw);
    if (!response.success || response.data.taskId !== id) throw badCli();
    const seen = new Set();
    const steps = response.data.steps.map((rawStep) => {
      const step = z.object({ id: jsonValueSchema, title: jsonValueSchema, status: jsonValueSchema, parent: jsonValueSchema.optional() }).passthrough().safeParse(rawStep);
      if (!step.success) throw badCli();
      const stepId = stringSchema.safeParse(step.data.id);
      const title = stringSchema.safeParse(step.data.title);
      const status = statusSchema.safeParse(step.data.status);
      const parent = step.data.parent === undefined || step.data.parent === null ? null : stringSchema.safeParse(step.data.parent);
      if (!stepId.success || !isStepId(stepId.data) || seen.has(stepId.data)
        || !title.success || !status.success || (parent !== null && (!parent.success || !isStepId(parent.data)))) throw badCli();
      seen.add(stepId.data);
      return { id: stepId.data, title: title.data, done: status.data === 'done', parent: parent === null ? null : parent.data };
    });
    return { id, title: response.data.title, steps, progress: { done: steps.filter((step) => step.done).length, total: steps.length } };
  };
  const ids = async (root) => {
    const raw = await run(root, ['list']);
    const response = z.object({ tasks: z.array(z.json()) }).passthrough().safeParse(raw);
    if (!response.success) throw badCli();
    return response.data.tasks.map((rawTask) => {
      const task = z.object({ taskId: jsonValueSchema.optional(), id: jsonValueSchema.optional(), format: jsonValueSchema.optional() }).passthrough().safeParse(rawTask);
      if (!task.success) throw badCli();
      const taskId = task.data.taskId ?? task.data.id;
      const id = stringSchema.safeParse(taskId);
      if (!id.success || !taskPattern.test(id.data)) throw badCli();
      return { id: id.data, format: task.data.format };
    });
  };
  const existing = async (root, id) => {
    if (!(await ids(root)).some((task) => task.id === id)) throw missingTask();
    return read(root, id);
  };
  return {
    list: (directory) => serial(async () => {
      const root = await notebookAt(directory, { create: false });
      if (!root) return [];
      const tasks = [];
      // Legacy or unreadable notebook entries (format other than 'task') are skipped so they cannot hide the current tasks.
      for (const task of await ids(root)) {
        if (task.format !== 'task') continue;
        // One unreadable notebook entry must not hide every other task.
        try { tasks.push(await read(root, task.id)); } catch { continue; }
      }
      return tasks;
    }),
    create: (directory, value) => serial(async () => {
      const title = validateTitle(value);
      const root = await notebookAt(directory, { create: true });
      const raw = await run(root, ['init', title]);
      const response = z.object({ taskId: z.string() }).passthrough().safeParse(raw);
      if (!response.success || !taskPattern.test(response.data.taskId)) throw badCli();
      return read(root, response.data.taskId);
    }),
    addStep: (directory, taskId, value, parentValue) => serial(async () => {
      const id = validateTaskId(taskId);
      const title = validateTitle(value);
      const parent = parentValue === undefined || parentValue === null ? null : validateStepId(parentValue);
      const root = await requireNotebook(directory);
      const task = await existing(root, id);
      // Subtasks are one level deep: the parent must be a top-level step of this task.
      if (parent && !task.steps.some((step) => step.id === parent && step.parent === null)) throw invalid();
      const args = ['next', 'add', title, '--scope', 'sandbox', '--done-when', 'observed', '--evidence', 'test'];
      if (parent) args.push('--parent', parent);
      const raw = await run(root, [...args, '--task', id]);
      const response = z.object({ stepId: z.string() }).passthrough().safeParse(raw);
      if (!response.success || !stepPattern.test(response.data.stepId)) throw badCli();
      return read(root, id);
    }),
    completeStep: (directory, taskId, stepId) => serial(async () => {
      const id = validateTaskId(taskId);
      const step = validateStepId(stepId);
      const root = await requireNotebook(directory);
      const task = await existing(root, id);
      const found = task.steps.find((entry) => entry.id === step);
      if (!found) throw new TasksError(404, 'missing', 'Step not found.');
      if (!found.done) await run(root, ['next', 'done', step, '--task', id]);
      return read(root, id);
    }),
  };
}
