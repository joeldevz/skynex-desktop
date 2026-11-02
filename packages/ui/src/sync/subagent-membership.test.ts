import { describe, expect, test } from 'bun:test';
import type { Session } from '@/lib/opencode/model';
import { subagentMembers } from './subagent-membership';

const session = (id: string, parentID?: string): Session => ({
  id, projectID: 'project', directory: '/repo', title: id, time: { created: 1, updated: 1 }, parentID,
  cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
});

describe('subagent entries in the open sessions list', () => {
  test('selects only sessions whose loaded record has a parent', () => {
    const known = new Map([['root', session('root')], ['child', session('child', 'root')]]);
    expect(subagentMembers(['root', 'child', 'unloaded'], (id) => known.get(id))).toEqual(['child']);
  });
});
