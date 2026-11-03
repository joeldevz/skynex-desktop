// Extension-host side of the project setup routes
// (`GET/PUT /api/projects/:projectId/config`): the webview cannot reach the
// filesystem, so it bridges here and this module reads and writes
// `~/.config/openchamber/projects/<projectId>.json` with the same rules the
// OpenChamber server applies (`project-setup.ts`). Server-owned keys in the
// file (`version`, `scheduledTasks`) and keys from newer builds survive a
// write untouched. The store also owns the checkout's shared file
// `.skynex/project.json`, with a read fallback to `.openchamber/project.json`:
// the setup writer and the single-key writer
// Magic Prompts use (`updateSharedEntry`) run one at a time per checkout.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execGit } from './bridge-git-process-runtime';

import {
  EMPTY_SHARED_PROJECT_CONFIG,
  LEGACY_SHARED_CONFIG_RELATIVE_PATH,
  ProjectSetupValidationError,
  SHARED_CONFIG_RELATIVE_PATH,
  SHARED_SETUP_KEYS,
  applySharedProjectSetupPatch,
  isSharedProjectConfigEmpty,
  mergeProjectSetup,
  parseSharedProjectConfig,
  personalProjectSetupOf,
  projectSetupPatchToStored,
  serializeSharedProjectConfig,
  sharedTrustHashOf,
  type JsonObject,
  type JsonValue,
  type ProjectSetupView,
  type SharedProjectConfigRead,
} from './project-setup';

export type ProjectSetupBridgeMessage = { id: string; type: string; payload?: unknown };
export type ProjectSetupBridgeResponse = { id: string; type: string; success: boolean; data?: unknown; error?: string };

/** A read of the checkout's shared file as a whole document. */
export type SharedProjectFileRead =
  | { status: 'missing' }
  | { status: 'ok'; document: JsonObject }
  | { status: 'invalid'; reason: string; path: string };

/** Thrown by `updateSharedEntry` for a file it refuses to change. */
class SharedProjectFileError extends Error {
  readonly code: 'shared_config_invalid' | 'project_checkout_missing';

  constructor(message: string, code: SharedProjectFileError['code']) {
    super(message);
    this.code = code;
  }
}

export type ProjectSetupStore = {
  read: (projectId: string) => Promise<ProjectSetupView>;
  update: (projectId: string, patch: unknown) => Promise<ProjectSetupView>;
  updateShared: (projectId: string, patch: unknown) => Promise<ProjectSetupView>;
  readSharedFile: (projectPath: string) => Promise<SharedProjectFileRead>;
  updateSharedEntry: (
    projectPath: string,
    key: string,
    mutate: (current: JsonValue | undefined) => JsonValue | undefined,
  ) => Promise<JsonValue | undefined>;
};

export type SharedConfigIgnoreStatus =
  | { kind: 'committable' }
  | { kind: 'ignored'; source: string; line: number; pattern: string; fixable: boolean }
  | { kind: 'unknown'; reason: 'not-a-repository' | 'git-unavailable' | 'timeout' };

type SharedConfigIgnoreFixResult =
  | { kind: 'updated'; status: SharedConfigIgnoreStatus }
  | { kind: 'refused'; reason: 'not-fixable' | 'changed' | 'unsafe-file' | 'write-failed' };

type IgnoreDependencies = {
  workspaceRoots: string[];
  execGit: typeof import('./bridge-git-process-runtime').execGit;
};

const ignoreCheckOutputLimit = 16 * 1024;
const ignoreCheckTimeoutMs = 5000;

const realPathsEqual = async (first: string, second: string): Promise<boolean> => {
  const [firstReal, secondReal] = await Promise.all([
    fs.promises.realpath(first).catch(() => null),
    fs.promises.realpath(second).catch(() => null),
  ]);
  if (!firstReal || !secondReal) return false;
  return process.platform === 'win32'
    ? firstReal.toLowerCase() === secondReal.toLowerCase()
    : firstReal === secondReal;
};

const isKnownWorkspaceRoot = (projectId: string, roots: string[]): string | null => {
  const decoded = projectPathFromId(projectId);
  if (!decoded) return null;
  const root = path.resolve(decoded);
  return roots.some((candidate) => path.resolve(candidate) === root) ? root : null;
};

const readSharedConfigIgnoreStatus = async (
  root: string,
  runGit: IgnoreDependencies['execGit'],
): Promise<SharedConfigIgnoreStatus> => {
  const result = await runGit(['-c', 'core.fsmonitor=false', 'check-ignore', '-v', '--', '.skynex/project.json'], root, {
    timeoutMs: ignoreCheckTimeoutMs,
    maxOutputBytes: ignoreCheckOutputLimit,
  });
  if (result.stderr.includes('timed out')) return { kind: 'unknown', reason: 'timeout' };
  if (result.exitCode === 1 && !result.stderr) return { kind: 'committable' };
  if (result.exitCode === 128) return { kind: 'unknown', reason: 'not-a-repository' };
  if (result.exitCode !== 0) return { kind: 'unknown', reason: 'git-unavailable' };

  const match = /^(.*):(\d+):(.*)\t(.*)\r?$/.exec(result.stdout.trimEnd());
  if (!match) return { kind: 'unknown', reason: 'git-unavailable' };
  const topLevelResult = await runGit(['-c', 'core.fsmonitor=false', 'rev-parse', '--show-toplevel'], root, { timeoutMs: ignoreCheckTimeoutMs });
  if (topLevelResult.exitCode !== 0 || !topLevelResult.stdout.trim()) return { kind: 'unknown', reason: 'git-unavailable' };
  const topLevel = path.resolve(root, topLevelResult.stdout.trim());
  const sourcePath = path.resolve(topLevel, match[1]);
  const relativeSource = path.relative(topLevel, sourcePath);
  const source = relativeSource === '' || (!relativeSource.startsWith(`..${path.sep}`) && relativeSource !== '..' && !path.isAbsolute(relativeSource))
    ? relativeSource.split(path.sep).join('/')
    : sourcePath;
  const pattern = match[3];
  if (pattern === '!.skynex/project.json' || pattern === '!/.skynex/project.json') return { kind: 'committable' };
  const rootIgnore = path.join(root, '.gitignore');
  const sourceIsRootIgnore = await realPathsEqual(rootIgnore, sourcePath);
  const projectIsRepositoryRoot = await realPathsEqual(root, topLevel);
  return {
    kind: 'ignored',
    source,
    line: Number(match[2]),
    pattern,
    fixable: projectIsRepositoryRoot && sourceIsRootIgnore && (pattern === '.skynex/' || pattern === '/.skynex/'),
  };
};

const fixSharedConfigIgnore = async (
  root: string,
  runGit: IgnoreDependencies['execGit'],
): Promise<SharedConfigIgnoreFixResult> => {
  const gitignorePath = path.join(root, '.gitignore');
  try {
    const file = await fs.promises.lstat(gitignorePath);
    if (file.isSymbolicLink() || !file.isFile()) return { kind: 'refused', reason: 'unsafe-file' };
  } catch {
    // A missing file is not fixable; status below gives the authoritative result.
  }
  const status = await readSharedConfigIgnoreStatus(root, runGit);
  // Already committable (a stale notice, or fixed elsewhere): nothing to change, as on the server.
  if (status.kind === 'committable') return { kind: 'updated', status };
  if (status.kind !== 'ignored' || !status.fixable) return { kind: 'refused', reason: 'not-fixable' };
  const filePath = gitignorePath;
  let before: fs.Stats;
  let original: Buffer;
  try {
    before = await fs.promises.lstat(filePath);
    if (!before.isFile() || before.isSymbolicLink()) return { kind: 'refused', reason: 'unsafe-file' };
    original = await fs.promises.readFile(filePath);
  } catch {
    return { kind: 'refused', reason: 'unsafe-file' };
  }
  const text = original.toString('utf8');
  const lines = text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter((line) => line.length > 0) ?? [];
  const content = lines.map((line) => line.replace(/(?:\r\n|\n|\r)$/, ''));
  const index = status.line - 1;
  if (content[index] !== status.pattern) return { kind: 'refused', reason: 'changed' };
  const exception = status.pattern.startsWith('/') ? '!/.skynex/project.json' : '!.skynex/project.json';
  const targetTerminator = lines[index].match(/(?:\r\n|\n|\r)$/)?.[0] ?? '';
  const terminator = targetTerminator || lines.find((line) => /(?:\r\n|\n|\r)$/.test(line))?.match(/(?:\r\n|\n|\r)$/)?.[0] || '\n';
  content[index] = status.pattern.startsWith('/') ? '/.skynex/*' : '**/.skynex/*';
  lines[index] = `${content[index]}${terminator}`;
  const existingException = content.findIndex((line, lineIndex) => line === exception && lineIndex !== index);
  if (existingException >= 0) {
    content.splice(existingException, 1);
    lines.splice(existingException, 1);
  }
  const insertionIndex = existingException >= 0 && existingException < index ? index - 1 : index;
  content.splice(insertionIndex + 1, 0, exception);
  lines.splice(insertionIndex + 1, 0, `${exception}${targetTerminator}`);
  const nextText = lines.join('');
  if (nextText !== text) {
    const tempPath = path.join(root, `.gitignore.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    let handle: Awaited<ReturnType<typeof fs.promises.open>> | undefined;
    try {
      handle = await fs.promises.open(tempPath, 'wx', before.mode & 0o777);
      await handle.writeFile(nextText, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      const current = await fs.promises.lstat(filePath);
      const currentText = await fs.promises.readFile(filePath);
      if (current.dev !== before.dev || current.ino !== before.ino || current.mtimeMs !== before.mtimeMs || !currentText.equals(original)) {
        await fs.promises.rm(tempPath, { force: true });
        return { kind: 'refused', reason: 'changed' };
      }
      await fs.promises.rename(tempPath, filePath);
    } catch {
      if (handle) await handle.close().catch(() => {});
      await fs.promises.rm(tempPath, { force: true }).catch(() => {});
      return { kind: 'refused', reason: 'write-failed' };
    }
  }
  return { kind: 'updated', status: await readSharedConfigIgnoreStatus(root, runGit) };
};

const PROJECT_ID_PATTERN = /^[a-zA-Z0-9._:-]+$/;

// Mirror of `projectConfigFileStemOf` in the server's
// `packages/web/server/lib/projects/project-id.js`; keep the two in sync. The
// file is named by the id while that fits a file name; a `path_<base64url>`
// id grows with the checkout path, so a long one maps to a fixed-length
// digest instead of a name the filesystem rejects (ENAMETOOLONG).
const MAX_PROJECT_CONFIG_FILE_STEM_LENGTH = 200;
const HASHED_PROJECT_CONFIG_FILE_STEM_PREFIX = 'path_sha256_';

export const projectConfigFileStemOf = (projectId: string): string => {
  if (projectId.length <= MAX_PROJECT_CONFIG_FILE_STEM_LENGTH) return projectId;
  const digest = crypto.createHash('sha256').update(projectId, 'utf8').digest('hex');
  return `${HASHED_PROJECT_CONFIG_FILE_STEM_PREFIX}${digest}`;
};

/** The checkout a `path_<base64url>` id names, or `''` for ids of another form. */
export const projectPathFromId = (projectId: string): string => {
  if (!projectId.startsWith('path_')) return '';
  const encoded = projectId.slice('path_'.length);
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return '';
  return Buffer.from(encoded, 'base64url').toString('utf8');
};

const isObjectRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const sanitizeProjectId = (value: unknown): string => {
  const projectId = typeof value === 'string' ? value.trim() : '';
  if (!projectId) throw new ProjectSetupValidationError('projectId is required');
  if (!PROJECT_ID_PATTERN.test(projectId)) throw new ProjectSetupValidationError('projectId contains unsupported characters');
  return projectId;
};

// The parsed document, or null when there is no file (one of `missingCodes`).
// Malformed JSON still throws; it is a broken file, not an empty one.
const readJsonDocumentIfPresent = async (filePath: string, missingCodes: string[]): Promise<Record<string, unknown> | null> => {
  let raw: string;
  try {
    raw = await fs.promises.readFile(filePath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && typeof error.code === 'string' && missingCodes.includes(error.code)) return null;
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  return isObjectRecord(parsed) ? parsed : {};
};

const writeJsonAtomic = async (filePath: string, text: string): Promise<void> => {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await fs.promises.writeFile(tmp, text, 'utf8');
    await fs.promises.rename(tmp, filePath);
  } catch (error) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
};

/** A store over one projects directory; the default is the shared OpenChamber one. */
export const createProjectSetupStore = (
  projectsDir: string = path.join(os.homedir(), '.config', 'openchamber', 'projects'),
): ProjectSetupStore => {
  const filePathFor = (projectId: string): string => path.join(projectsDir, `${projectConfigFileStemOf(sanitizeProjectId(projectId))}.json`);
  // Where a build before the bounded name stored a long id's file, or null
  // when the id's own name is the current one. Read as a fallback and removed
  // once a write has moved its content to the bounded file, the same way the
  // server does it.
  const legacyFilePathFor = (projectId: string): string | null => {
    const safeProjectId = sanitizeProjectId(projectId);
    if (projectConfigFileStemOf(safeProjectId) === safeProjectId) return null;
    return path.join(projectsDir, `${safeProjectId}.json`);
  };
  const readPersonalDocument = async (projectId: string): Promise<Record<string, unknown>> => {
    const current = await readJsonDocumentIfPresent(filePathFor(projectId), ['ENOENT']);
    if (current) return current;
    const legacyPath = legacyFilePathFor(projectId);
    const legacy = legacyPath ? await readJsonDocumentIfPresent(legacyPath, ['ENOENT', 'ENAMETOOLONG']) : null;
    return legacy ?? {};
  };
  const writePersonalDocument = async (projectId: string, document: Record<string, unknown>): Promise<void> => {
    await writeJsonAtomic(filePathFor(projectId), JSON.stringify(document, null, 2));
    const legacyPath = legacyFilePathFor(projectId);
    if (legacyPath) await fs.promises.rm(legacyPath, { force: true }).catch(() => {});
  };
  // Writes to one file are chained so two quick saves from the webview cannot
  // interleave their read-modify-write. Personal files are keyed by their
  // path, shared files by `shared:<checkout>`; the setup writer takes the
  // personal key and then the shared one, the prompt writer only the shared
  // one, so the order never inverts.
  const writeChains = new Map<string, Promise<unknown>>();
  const serialized = <T,>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = writeChains.get(key) ?? Promise.resolve();
    const next = previous.then(task);
    const settled = next.catch(() => undefined);
    writeChains.set(key, settled);
    void settled.then(() => {
      if (writeChains.get(key) === settled) writeChains.delete(key);
    });
    return next;
  };
  // A checkout reached through a symlink or another spelling is one file.
  const sharedChainKeyOf = async (projectPath: string): Promise<string> => {
    const resolved = path.resolve(projectPath);
    return `shared:${await fs.promises.realpath(resolved).catch(() => resolved)}`;
  };

  // The shared file lives in the checkout the id names (the personal file's
  // `projectPath` is the fallback). A missing file is the normal case; an
  // unreadable or unparsable one is reported, never treated as empty.
  const projectPathOf = (projectId: string, personalRaw: Record<string, unknown>): string => {
    const storedPath = personalRaw.projectPath;
    return projectPathFromId(projectId) || (typeof storedPath === 'string' ? storedPath.trim() : '');
  };
  const sharedConfigPathOf = (projectPath: string): string => path.join(projectPath, ...SHARED_CONFIG_RELATIVE_PATH.split('/'));

  const validateSharedTarget = async (projectPath: string, relativePath: string): Promise<{ exists: boolean; filePath: string; directoryPath: string; directoryStat?: Awaited<ReturnType<typeof fs.promises.lstat>> }> => {
    const checkoutRealPath = await fs.promises.realpath(projectPath);
    const filePath = path.join(projectPath, ...relativePath.split('/'));
    const directoryPath = path.dirname(filePath);
    let directoryStat: Awaited<ReturnType<typeof fs.promises.lstat>>;
    try {
      directoryStat = await fs.promises.lstat(directoryPath);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { exists: false, filePath, directoryPath };
      throw error;
    }
    if (!directoryStat.isDirectory()) throw new Error(`${relativePath.split('/')[0]} is a symbolic link or not a directory`);
    const directoryRealPath = await fs.promises.realpath(directoryPath);
    if (directoryRealPath !== checkoutRealPath && !directoryRealPath.startsWith(`${checkoutRealPath}${path.sep}`)) {
      throw new Error(`${relativePath.split('/')[0]} resolves outside the project checkout`);
    }
    try {
      const fileStat = await fs.promises.lstat(filePath);
      if (!fileStat.isFile()) throw new Error(`${relativePath} is a symbolic link or not a regular file`);
      return { exists: true, filePath, directoryPath, directoryStat };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return { exists: false, filePath, directoryPath, directoryStat };
      throw error;
    }
  };

  const assertSharedDirectoryIdentity = async (directoryPath: string, expected: Awaited<ReturnType<typeof fs.promises.lstat>>): Promise<void> => {
    const current = await fs.promises.lstat(directoryPath);
    if (!current.isDirectory() || current.dev !== expected.dev || current.ino !== expected.ino) {
      throw new Error('shared config directory changed during the operation');
    }
  };

  const sharedTargetStat = async (filePath: string): Promise<Awaited<ReturnType<typeof fs.promises.lstat>> | null> => {
    try {
      const current = await fs.promises.lstat(filePath);
      if (!current.isFile()) throw new Error('shared config target is not a regular file');
      return current;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  };

  const readSharedText = async (projectPath: string): Promise<{ status: 'missing' } | { status: 'invalid'; reason: string; path: string } | { status: 'text'; raw: string; path: string }> => {
    for (const relativePath of [SHARED_CONFIG_RELATIVE_PATH, LEGACY_SHARED_CONFIG_RELATIVE_PATH]) {
      try {
        const target = await validateSharedTarget(projectPath, relativePath);
        if (!target.exists) continue;
        const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
        const handle = await fs.promises.open(target.filePath, flags);
        let raw: string;
        try {
          const fileStat = await handle.stat();
          if (!fileStat.isFile()) throw new Error(`${relativePath} is not a regular file`);
          if (!target.directoryStat) throw new Error('shared config directory identity is unavailable');
          await assertSharedDirectoryIdentity(target.directoryPath, target.directoryStat);
          raw = await handle.readFile('utf8');
        } finally {
          await handle.close();
        }
        return { status: 'text', raw, path: relativePath };
      } catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue;
        return { status: 'invalid', reason: error instanceof Error ? error.message : String(error), path: relativePath };
      }
    }
    return { status: 'missing' };
  };

  const readSharedAt = async (projectPath: string): Promise<SharedProjectConfigRead> => {
    const read = await readSharedText(projectPath);
    if (read.status !== 'text') return read;
    const parsed = parseSharedProjectConfig(read.raw);
    return parsed.status === 'invalid' ? { ...parsed, path: read.path } : parsed;
  };

  const readShared = async (projectId: string, personalRaw: Record<string, unknown>): Promise<SharedProjectConfigRead> => {
    const projectPath = projectPathOf(projectId, personalRaw);
    if (!projectPath) return { status: 'missing' };
    return readSharedAt(projectPath);
  };

  const isDirectory = (projectPath: string): Promise<boolean> =>
    fs.promises.stat(projectPath).then((stat) => stat.isDirectory()).catch(() => false);

  // Replace the shared file through a unique temporary sibling; `null`
  // removes it, and the `.skynex` folder when that leaves it empty.
  const writeSharedFile = async (projectPath: string, text: string | null): Promise<void> => {
    const sharedPath = sharedConfigPathOf(projectPath);
    const directoryPath = path.dirname(sharedPath);
    const validate = async (): Promise<void> => {
      await validateSharedTarget(projectPath, SHARED_CONFIG_RELATIVE_PATH);
      await validateSharedTarget(projectPath, LEGACY_SHARED_CONFIG_RELATIVE_PATH);
    };
    try { await validate(); } catch (error) {
      throw new SharedProjectFileError(`.skynex/project.json is invalid: ${error instanceof Error ? error.message : String(error)}`, 'shared_config_invalid');
    }
    if (text === null) {
      const target = await validateSharedTarget(projectPath, SHARED_CONFIG_RELATIVE_PATH);
      const legacy = await validateSharedTarget(projectPath, LEGACY_SHARED_CONFIG_RELATIVE_PATH);
      if (legacy.exists) text = '{"version":1}\n';
      else {
        if (!target.directoryStat) return;
        await assertSharedDirectoryIdentity(directoryPath, target.directoryStat);
        const existing = await sharedTargetStat(sharedPath);
        await assertSharedDirectoryIdentity(directoryPath, target.directoryStat);
        if (existing) await fs.promises.rm(sharedPath);
        await assertSharedDirectoryIdentity(directoryPath, target.directoryStat);
        await fs.promises.rmdir(directoryPath).catch(() => {});
        return;
      }
    }
    try {
      await fs.promises.mkdir(directoryPath);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
    }
    let canonical: Awaited<ReturnType<typeof validateSharedTarget>>;
    try { canonical = await validateSharedTarget(projectPath, SHARED_CONFIG_RELATIVE_PATH); await validateSharedTarget(projectPath, LEGACY_SHARED_CONFIG_RELATIVE_PATH); } catch (error) {
      throw new SharedProjectFileError(`.skynex/project.json is invalid: ${error instanceof Error ? error.message : String(error)}`, 'shared_config_invalid');
    }
    const temporaryPath = `${sharedPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let handle: Awaited<ReturnType<typeof fs.promises.open>> | undefined;
    let temporaryIdentity: Awaited<ReturnType<typeof fs.promises.lstat>> | undefined;
    try {
      if (!canonical.directoryStat) throw new Error('shared config directory identity is unavailable');
      const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW ?? 0);
      handle = await fs.promises.open(temporaryPath, flags, 0o666);
      temporaryIdentity = await handle.stat();
      await handle.writeFile(text, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      await assertSharedDirectoryIdentity(canonical.directoryPath, canonical.directoryStat);
      await sharedTargetStat(sharedPath);
      await assertSharedDirectoryIdentity(canonical.directoryPath, canonical.directoryStat);
      await fs.promises.rename(temporaryPath, sharedPath);
      await assertSharedDirectoryIdentity(canonical.directoryPath, canonical.directoryStat);
      const finalStat = await sharedTargetStat(sharedPath);
      if (!finalStat || !temporaryIdentity || finalStat.dev !== temporaryIdentity.dev || finalStat.ino !== temporaryIdentity.ino) {
        throw new Error('shared config file changed during the operation');
      }
    } catch (error) {
      await handle?.close().catch(() => {});
      try {
        if (canonical.directoryStat) {
          await assertSharedDirectoryIdentity(canonical.directoryPath, canonical.directoryStat);
          if (await sharedTargetStat(temporaryPath)) await fs.promises.rm(temporaryPath);
        }
      } catch {
        // Cleanup is best effort: the refusal below is what the caller sees.
      }
      throw new SharedProjectFileError(`.skynex/project.json is invalid: ${error instanceof Error ? error.message : String(error)}`, 'shared_config_invalid');
    }
  };

  // A missing file is `missing`; an unreadable, unparsable, other-version or
  // wrongly shaped setup file is `invalid` with a reason.
  const readSharedFile = async (projectPath: string): Promise<SharedProjectFileRead> => {
    const read = await readSharedAt(projectPath);
    if (read.status === 'ok') return { status: 'ok', document: read.document };
    if (read.status === 'invalid') return { status: 'invalid', reason: read.reason, path: read.path ?? SHARED_CONFIG_RELATIVE_PATH };
    return read;
  };

  /**
   * Change one key of the shared file the setup writer does not own (Magic
   * Prompts use `magicPrompts`), in the same chain as the setup writer of
   * that checkout. `mutate(current)` receives the stored value (`undefined`
   * when absent) and returns the next one; `undefined` removes the key and
   * the same value skips the write. The rest of the document goes back out
   * exactly as read, and no trust record changes. A file that does not
   * parse as valid version-1 setup is refused and left byte for byte; this
   * writer never repairs. Removing the last key removes the file.
   */
  const updateSharedEntry: ProjectSetupStore['updateSharedEntry'] = async (projectPath, key, mutate) => {
    if (SHARED_SETUP_KEYS.includes(key)) throw new Error(`${key} belongs to the shared setup writer`);
    return serialized(await sharedChainKeyOf(projectPath), async () => {
      if (!(await isDirectory(projectPath))) {
        throw new SharedProjectFileError('project checkout not found', 'project_checkout_missing');
      }
      const read = await readSharedFile(projectPath);
      if (read.status === 'invalid') {
        throw new SharedProjectFileError(`${read.path} is invalid: ${read.reason}`, 'shared_config_invalid');
      }
      const document = read.status === 'ok' ? read.document : Object.fromEntries([['version', 1]]);
      const current = Object.hasOwn(document, key) ? document[key] : undefined;
      const next = mutate(current);
      if (next === current) return current;

      // fromEntries keeps a `__proto__` key an own property.
      const entries = Object.entries(document).filter(([entryKey]) => entryKey !== key);
      if (next !== undefined) entries.push([key, next]);
      const nextDocument = Object.fromEntries(entries);
      const onlyVersion = Object.keys(nextDocument).every((entryKey) => entryKey === 'version');
      const legacyExists = (await validateSharedTarget(projectPath, LEGACY_SHARED_CONFIG_RELATIVE_PATH)).exists;
      await writeSharedFile(projectPath, onlyVersion ? (legacyExists ? '{"version":1}\n' : null) : `${JSON.stringify(nextDocument, null, 2)}\n`);
      return next;
    });
  };

  const mergedViewOf = async (projectId: string, personalRaw: Record<string, unknown>): Promise<ProjectSetupView> =>
    mergeProjectSetup(personalProjectSetupOf(personalRaw), await readShared(projectId, personalRaw));

  const read = async (projectId: string): Promise<ProjectSetupView> => mergedViewOf(projectId, await readPersonalDocument(projectId));

  const update = async (projectId: string, patch: unknown): Promise<ProjectSetupView> => {
    const filePath = filePathFor(projectId);
    const stored = projectSetupPatchToStored(patch);
    return serialized(filePath, async () => {
      const existing = await readPersonalDocument(projectId);
      const merged: Record<string, unknown> = { ...existing, ...stored };
      for (const [key, value] of Object.entries(stored)) {
        if (value === undefined) delete merged[key];
      }
      await writePersonalDocument(projectId, merged);
      return mergedViewOf(projectId, merged);
    });
  };

  // The team's shared file in the checkout; same rules as the server: a
  // broken file counts as empty, an empty result removes the file, and the
  // writer's own trust record is set to the new hash. Keys this writer does
  // not own survive, a repair of a wrongly shaped setup key too; only an
  // unreadable, unparsable or other-version file is replaced whole.
  const updateShared = async (projectId: string, patch: unknown): Promise<ProjectSetupView> => {
    const filePath = filePathFor(projectId);
    return serialized(filePath, async () => {
      const personalRaw = await readPersonalDocument(projectId);
      const projectPath = projectPathOf(projectId, personalRaw);
      if (!projectPath || !(await isDirectory(projectPath))) throw new ProjectSetupValidationError('project checkout not found');
      const nextShared = await serialized(await sharedChainKeyOf(projectPath), async () => {
        const currentRead = await readSharedAt(projectPath);
        let canonicalExists: boolean;
        let legacyExists: boolean;
        try {
          canonicalExists = (await validateSharedTarget(projectPath, SHARED_CONFIG_RELATIVE_PATH)).exists;
          legacyExists = (await validateSharedTarget(projectPath, LEGACY_SHARED_CONFIG_RELATIVE_PATH)).exists;
        } catch (error) {
          throw new SharedProjectFileError(`${SHARED_CONFIG_RELATIVE_PATH} is invalid: ${error instanceof Error ? error.message : String(error)}`, 'shared_config_invalid');
        }
        if (!canonicalExists && legacyExists && currentRead.status === 'invalid') {
          throw new SharedProjectFileError(`${LEGACY_SHARED_CONFIG_RELATIVE_PATH} is invalid: ${currentRead.reason}`, 'shared_config_invalid');
        }
        const current = currentRead.status === 'ok' ? currentRead.config : EMPTY_SHARED_PROJECT_CONFIG;
        const document = currentRead.status === 'missing' ? undefined : currentRead.document;
        const applied = applySharedProjectSetupPatch(current, patch);
        await writeSharedFile(
          projectPath,
          isSharedProjectConfigEmpty(applied, document) ? (legacyExists ? '{"version":1}\n' : null) : serializeSharedProjectConfig(applied, document),
        );
        return applied;
      });
      const hash = sharedTrustHashOf(nextShared);
      const personalNext: Record<string, unknown> = { ...personalRaw };
      if (hash) personalNext.sharedTrust = { hash, trustedAt: Date.now() };
      else delete personalNext.sharedTrust;
      await writePersonalDocument(projectId, personalNext);
      return mergedViewOf(projectId, personalNext);
    });
  };

  return { read, update, updateShared, readSharedFile, updateSharedEntry };
};

export async function handleProjectSetupBridgeMessage(
  message: ProjectSetupBridgeMessage,
  store: ProjectSetupStore,
  ignoreDependencies: IgnoreDependencies = { workspaceRoots: [], execGit },
): Promise<ProjectSetupBridgeResponse | null> {
  const { id, type, payload } = message;
  if (type !== 'api:project-setup:get' && type !== 'api:project-setup:update' && type !== 'api:project-setup:update-shared'
    && type !== 'api:project-setup:ignore-status' && type !== 'api:project-setup:ignore-fix') return null;

  try {
    const request = isObjectRecord(payload) ? payload : {};
    const projectId = sanitizeProjectId(request.projectId);
    if (type === 'api:project-setup:ignore-status' || type === 'api:project-setup:ignore-fix') {
      const root = isKnownWorkspaceRoot(projectId, ignoreDependencies.workspaceRoots);
      if (!root) throw new ProjectSetupValidationError('project checkout not found');
      const data = type === 'api:project-setup:ignore-status'
        ? await readSharedConfigIgnoreStatus(root, ignoreDependencies.execGit)
        : await fixSharedConfigIgnore(root, ignoreDependencies.execGit);
      return { id, type, success: true, data };
    }
    const data = type === 'api:project-setup:get'
      ? await store.read(projectId)
      : type === 'api:project-setup:update'
        ? await store.update(projectId, request.patch)
        : await store.updateShared(projectId, request.patch);
    return { id, type, success: true, data };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Project config request failed';
    return { id, type, success: false, error: message };
  }
}
