import { execFile } from 'node:child_process';
import { lstat, mkdir } from 'node:fs/promises';
import path from 'node:path';

const executable = '/home/clasing/.local/share/pnpm/bin/skynex';
const taskPattern = /^[a-z0-9][a-z0-9-]{0,79}$/;
const stepPattern = /^step-[0-9]{3,}$/;

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
  if (typeof id !== 'string' || !taskPattern.test(id)) throw invalid();
  return id;
};
const isStepId = (id) => typeof id === 'string' && id.length <= 80 && stepPattern.test(id);
export const validateStepId = (id) => {
  if (!isStepId(id)) throw invalid();
  return id;
};
export const validateTitle = (value) => {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value)) throw invalid();
  const title = value.trim();
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
    if (!raw || raw.taskId !== id || typeof raw.title !== 'string' || !Array.isArray(raw.steps)) throw badCli();
    const seen = new Set();
    const steps = raw.steps.map((step) => {
      if (!step || !isStepId(step.id) || seen.has(step.id)
        || typeof step.title !== 'string' || !['pending', 'in_progress', 'done', 'blocked'].includes(step.status)
        || (step.parent !== undefined && step.parent !== null && !isStepId(step.parent))) throw badCli();
      seen.add(step.id);
      return { id: step.id, title: step.title, done: step.status === 'done', parent: step.parent ?? null };
    });
    return { id, title: raw.title, steps, progress: { done: steps.filter((step) => step.done).length, total: steps.length } };
  };
  const ids = async (root) => {
    const raw = await run(root, ['list']);
    if (!raw || !Array.isArray(raw.tasks)) throw badCli();
    return raw.tasks.map((task) => {
      const id = task?.taskId ?? task?.id;
      if (typeof id !== 'string' || !taskPattern.test(id)) throw badCli();
      return { id, format: task?.format };
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
      if (!raw || typeof raw.taskId !== 'string' || !taskPattern.test(raw.taskId)) throw badCli();
      return read(root, raw.taskId);
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
      if (!raw || typeof raw.stepId !== 'string' || !stepPattern.test(raw.stepId)) throw badCli();
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
