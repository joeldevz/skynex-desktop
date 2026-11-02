import { describe, expect, test } from 'bun:test';
import type { WorktreeMetadata } from '@/types/worktree';
import {
  buildWorktreeByPathIndex,
  findPrefixWorktreeEntry,
} from './worktreeIndex';

const meta = (path: string, branch: string): WorktreeMetadata => ({
  path,
  projectDirectory: '/workspace/app',
  branch,
  label: branch,
});

describe('worktreeIndex shared exact index', () => {
  test('normalizes keys, excludes the owning project root, and keeps the first duplicate', () => {
    const index = buildWorktreeByPathIndex(
      new Map([
        ['/workspace/app', [
          meta('/workspace/app', 'root-branch'),
          meta('/tmp/wt-feature/', 'feature-1'),
          meta('/tmp/wt-feature', 'feature-duplicate'),
        ]],
      ]),
      [{ id: 'app', label: 'App', normalizedPath: '/workspace/app' }],
    );
    expect(index.has('/workspace/app')).toBe(false);
    expect(index.get('/tmp/wt-feature')?.meta.branch).toBe('feature-1');
    expect(index.get('/tmp/wt-feature')?.project.id).toBe('app');
  });

  test('resolves the owning project through the normalized bucket key', () => {
    const index = buildWorktreeByPathIndex(
      new Map([['/workspace/app/', [meta('/tmp/wt-feature', 'feature-1')]]]),
      [{ id: 'app', label: 'App', normalizedPath: '/workspace/app/' }],
    );
    expect(index.get('/tmp/wt-feature')?.project.id).toBe('app');
  });

  test('ignores buckets whose project is not registered', () => {
    const index = buildWorktreeByPathIndex(
      new Map([['/workspace/unknown', [meta('/tmp/wt-feature', 'feature-1')]]]),
      [{ id: 'app', label: 'App', normalizedPath: '/workspace/app' }],
    );
    expect(index.size).toBe(0);
  });

  test('prefix lookup prefers the longest containing worktree and includes exact matches', () => {
    const index = buildWorktreeByPathIndex(
      new Map([
        ['/workspace/app', [
          meta('/tmp/wt', 'outer'),
          meta('/tmp/wt/nested', 'inner'),
        ]],
      ]),
      [{ id: 'app', label: 'App', normalizedPath: '/workspace/app' }],
    );
    expect(findPrefixWorktreeEntry('/tmp/wt', index)?.meta.branch).toBe('outer');
    expect(findPrefixWorktreeEntry('/tmp/wt/sub', index)?.meta.branch).toBe('outer');
    expect(findPrefixWorktreeEntry('/tmp/wt/nested/sub', index)?.meta.branch).toBe('inner');
    expect(findPrefixWorktreeEntry('/tmp/other', index)).toBeNull();
    expect(findPrefixWorktreeEntry('/tmp/wt-other', index)).toBeNull();
  });

});
