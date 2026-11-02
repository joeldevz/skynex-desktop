import { describe, expect, test } from 'bun:test';
import {
  isPathWithinProject,
  selectExpandedParentKeysForContext,
} from './utils';

describe('isPathWithinProject', () => {
  test('matches child directories for root projects', () => {
    expect(isPathWithinProject('/workspace/app', '/')).toBe(true);
    expect(isPathWithinProject('c:\\Users\\Developer', 'C:/')).toBe(true);
    expect(isPathWithinProject('D:/Users/Developer', 'C:/')).toBe(false);
    expect(isPathWithinProject('//?/C:/Users/Developer', '//?/C:/')).toBe(true);
    expect(isPathWithinProject('//Server/Share/Project', '//Server/Share')).toBe(true);
    expect(isPathWithinProject('//Server/Share2/Project', '//Server/Share')).toBe(false);
  });

  test('matches exact project directories', () => {
    expect(isPathWithinProject('/workspace/app', '/workspace/app')).toBe(true);
  });

  test('does not match sibling directory prefixes', () => {
    expect(isPathWithinProject('/workspace/app2', '/workspace/app')).toBe(false);
  });

  test('returns false when directory is null', () => {
    expect(isPathWithinProject(null, '/workspace/app')).toBe(false);
  });

  test('returns false when projectPath is null', () => {
    expect(isPathWithinProject('/workspace/app', null)).toBe(false);
  });

  test('matches deep child directories', () => {
    expect(isPathWithinProject('/workspace/app/sub/dir', '/workspace/app')).toBe(true);
  });
});

describe('selectExpandedParentKeysForContext', () => {
  test('keeps project and recent expansion state isolated', () => {
    const expanded = new Set([
      'project:active:parent-a',
      'project:archived:parent-b',
      'recent:active:parent-a',
    ]);

    expect(selectExpandedParentKeysForContext(new Set(), expanded, 'project')).toEqual(new Set([
      'project:active:parent-a',
      'project:archived:parent-b',
    ]));
    expect(selectExpandedParentKeysForContext(new Set(), expanded, 'recent')).toEqual(new Set([
      'recent:active:parent-a',
    ]));
  });

  test('preserves a context projection when only another context changes', () => {
    const recent = new Set(['recent:active:parent-a']);
    const expanded = new Set(['recent:active:parent-a', 'project:active:parent-a']);

    expect(selectExpandedParentKeysForContext(recent, expanded, 'recent')).toBe(recent);
  });
});
