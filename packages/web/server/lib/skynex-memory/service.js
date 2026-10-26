import { execFile } from 'node:child_process';
import path from 'node:path';

const LIST_LIMIT = 50;
const RECALL_LIMIT = 20;
const TEXT_LIMIT = 1000;
const TITLE_LIMIT = 120;

export class MemoryError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const invalid = () => new MemoryError(400, 'invalid', 'Invalid memory request.');
const badCli = () => new MemoryError(502, 'badCLI', 'Memory returned an invalid response.');
const unavailable = () => new MemoryError(503, 'unavailable', 'Memory is unavailable.');

// Free text reaches the CLI as one argv element; a leading dash would read as a flag.
const validateText = (value, limit = TEXT_LIMIT) => {
  if (typeof value !== 'string' || /[\p{Cc}\p{Cf}]/u.test(value)) throw invalid();
  const text = value.trim();
  if (!text || text.length > limit || text.startsWith('-')) throw invalid();
  return text;
};

// The namespace is the project directory's basename, as the Memory design requires.
const namespaceOf = (directory) => {
  const name = path.basename(directory);
  if (!name || name.startsWith('-') || name.length > 120 || /[\p{Cc}\p{Cf}]/u.test(name)) throw invalid();
  return name;
};

const toMemory = (entry) => {
  if (!entry || typeof entry !== 'object') throw badCli();
  if (typeof entry.id !== 'string' && typeof entry.id !== 'number') throw badCli();
  if (typeof entry.content !== 'string') throw badCli();
  return {
    id: String(entry.id),
    title: typeof entry.title === 'string' ? entry.title : null,
    content: entry.content,
    observationType: typeof entry.observation_type === 'string' ? entry.observation_type : null,
    createdAt: typeof entry.created_at === 'string' ? entry.created_at : null,
  };
};

// `null` is the CLI's shape for an empty result, not a failure.
const readMemories = (stdout, key) => {
  let raw;
  try { raw = JSON.parse(stdout); } catch { throw badCli(); }
  if (!raw || typeof raw !== 'object' || !(raw[key] === null || Array.isArray(raw[key]))) throw badCli();
  return (raw[key] ?? []).map(toMemory);
};

export function createMemoryService() {
  let queue = Promise.resolve();
  const serial = (operation) => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const run = (args) => new Promise((resolve, reject) => {
    execFile('neurox', args, {
      shell: false, timeout: 15_000, maxBuffer: 1024 * 1024, encoding: 'utf8',
    }, (error, stdout) => {
      if (error) {
        reject(error.killed ? new MemoryError(504, 'timeout', 'Memory timed out. Reload before retrying.')
          : error.code === 'ENOENT' || error.code === 'EACCES' ? unavailable() : badCli());
        return;
      }
      resolve(stdout);
    });
  });
  return {
    list: (directory) => serial(async () => {
      const namespace = namespaceOf(directory);
      return readMemories(await run(['context', '-namespace', namespace, '-limit', String(LIST_LIMIT)]), 'items');
    }),
    save: (directory, note) => serial(async () => {
      const namespace = namespaceOf(directory);
      const what = validateText(note.what);
      const why = validateText(note.why);
      const where = validateText(note.where);
      const learned = validateText(note.learned);
      const content = `What: ${what}\nWhy: ${why}\nWhere: ${where}\nLearned: ${learned}`;
      const title = what.slice(0, TITLE_LIMIT);
      await run(['save', title, '-content', content, '-namespace', namespace, '-kind', 'semantic', '-confidence', '0.9', '-retention', 'durable']);
    }),
    recall: (directory, query) => serial(async () => {
      const namespace = namespaceOf(directory);
      const text = validateText(query, 200);
      return readMemories(await run(['recall', text, '-namespace', namespace, '-limit', String(RECALL_LIMIT)]), 'results');
    }),
  };
}
