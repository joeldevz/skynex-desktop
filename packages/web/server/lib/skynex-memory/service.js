import { execFile } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';

const LIST_LIMIT = 50;
const RECALL_LIMIT = 20;
const TEXT_LIMIT = 1000;
const TITLE_LIMIT = 120;
const textSchema = z.string();
const memoryEntrySchema = z.object({
  id: z.union([z.string(), z.number()]),
  content: z.string(),
  title: z.json().optional(),
  observation_type: z.json().optional(),
  created_at: z.json().optional(),
}).passthrough();

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
  const parsed = textSchema.safeParse(value);
  if (!parsed.success || /[\p{Cc}\p{Cf}]/u.test(parsed.data)) throw invalid();
  const text = parsed.data.trim();
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
  const parsed = memoryEntrySchema.safeParse(entry);
  if (!parsed.success) throw badCli();
  const memory = parsed.data;
  const title = textSchema.safeParse(memory.title);
  const observationType = textSchema.safeParse(memory.observation_type);
  const createdAt = textSchema.safeParse(memory.created_at);
  return {
    id: String(memory.id),
    title: title.success ? title.data : null,
    content: memory.content,
    observationType: observationType.success ? observationType.data : null,
    createdAt: createdAt.success ? createdAt.data : null,
  };
};

// `null` is the CLI's shape for an empty result, not a failure.
const readMemories = (stdout, key) => {
  let raw;
  try { raw = JSON.parse(stdout); } catch { throw badCli(); }
  const parsed = z.object({ [key]: z.union([z.null(), z.array(z.json())]) }).passthrough().safeParse(raw);
  if (!parsed.success) throw badCli();
  return (parsed.data[key] ?? []).map(toMemory);
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
