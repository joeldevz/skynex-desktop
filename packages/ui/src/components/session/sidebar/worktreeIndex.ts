import type { WorktreeMetadata } from '@/types/worktree';
import { normalizePath } from '@/lib/pathNormalization';

type WorktreeIndexProject = {
  id: string;
  normalizedPath: string | null | undefined;
  label?: string | null;
};

type WorktreeIndexEntry<P extends WorktreeIndexProject = WorktreeIndexProject> = {
  meta: WorktreeMetadata;
  project: P;
};

/**
 * Canonical exact worktree index shared by Recent/Timeline, project grouping,
 * and the session switcher. Normalizes every key, excludes the owning project
 * root, and keeps the first entry on duplicate paths so repeated topology
 * publishes cannot flip ownership.
 */
export const buildWorktreeByPathIndex = <P extends WorktreeIndexProject>(
  availableWorktreesByProject: ReadonlyMap<string, readonly WorktreeMetadata[]>,
  projects: readonly P[],
): Map<string, WorktreeIndexEntry<P>> => {
  const byPath = new Map<string, WorktreeIndexEntry<P>>();
  const projectByNormalizedPath = new Map<string, P>();
  for (const project of projects) {
    const normalized = normalizePath(project.normalizedPath ?? null);
    if (normalized && !projectByNormalizedPath.has(normalized)) projectByNormalizedPath.set(normalized, project);
  }
  for (const [projectPath, worktrees] of availableWorktreesByProject) {
    const project = projectByNormalizedPath.get(normalizePath(projectPath) ?? '') ?? null;
    if (!project) continue;
    const projectRoot = normalizePath(project.normalizedPath ?? null);
    for (const entry of worktrees) {
      const entryPath = normalizePath(entry.path);
      if (!entryPath || entryPath === projectRoot || byPath.has(entryPath)) continue;
      byPath.set(entryPath, { meta: entry, project });
    }
  }
  return byPath;
};

/**
 * Longest-prefix worktree lookup for sessions inside `<worktree>/sub`.
 * Exact matches are included (`directory === path`). Returns null when no
 * indexed worktree contains the directory.
 */
export const findPrefixWorktreeEntry = <T>(
  directory: string,
  index: ReadonlyMap<string, T>,
): T | null => {
  let best: T | null = null;
  let bestLength = -1;
  for (const [path, entry] of index) {
    if (path.length <= bestLength) continue;
    if (directory === path || directory.startsWith(`${path}/`)) {
      best = entry;
      bestLength = path.length;
    }
  }
  return best;
};
