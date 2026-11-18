import { describe, expect, test } from 'bun:test';
import { resolveGeneralWorkspaceAgent } from './general-chat-agent';

const agents = [
  { name: 'build', mode: 'primary' as const },
  { name: 'plan', mode: 'primary' as const },
  { name: 'review', mode: 'subagent' as const },
  { name: 'hidden', mode: 'primary' as const, hidden: true },
];

describe('general workspace agent resolution', () => {
  test('keeps an eligible saved primary agent ahead of the configured default', () => {
    expect(resolveGeneralWorkspaceAgent('plan', 'build', agents)).toEqual({
      agent: 'plan',
      unavailableSavedAgent: null,
    });
  });

  test('uses an eligible configured default when the saved agent is unavailable and reports the saved name', () => {
    expect(resolveGeneralWorkspaceAgent('review', 'plan', agents)).toEqual({
      agent: 'plan',
      unavailableSavedAgent: 'review',
    });
  });

  test('falls back to build, then the first eligible agent when the configured default is unavailable', () => {
    const withoutBuild = [
      { name: 'hidden', mode: 'primary' as const, hidden: true },
      ...agents.filter(({ name }) => name !== 'build' && name !== 'hidden'),
    ];
    expect(resolveGeneralWorkspaceAgent(undefined, 'review', agents)).toEqual({
      agent: 'build',
      unavailableSavedAgent: null,
    });
    expect(resolveGeneralWorkspaceAgent(undefined, 'review', withoutBuild)).toEqual({
      agent: 'plan',
      unavailableSavedAgent: null,
    });
  });

  test('accepts all-mode agents and excludes hidden agents from saved and default choices', () => {
    const available = [
      { name: 'first', mode: 'primary' as const },
      { name: 'all-mode', mode: 'all' as const },
      { name: 'hidden', mode: 'primary' as const, hidden: true },
    ];
    expect(resolveGeneralWorkspaceAgent('all-mode', 'first', available)).toEqual({
      agent: 'all-mode',
      unavailableSavedAgent: null,
    });
    expect(resolveGeneralWorkspaceAgent('hidden', 'hidden', available)).toEqual({
      agent: 'first',
      unavailableSavedAgent: 'hidden',
    });
  });

  test('returns no agent when there are no eligible agents and only marks a supplied unavailable saved agent', () => {
    const unavailable = [
      { name: 'subagent', mode: 'subagent' as const },
      { name: 'hidden', mode: 'primary' as const, hidden: true },
    ];
    expect(resolveGeneralWorkspaceAgent(undefined, undefined, unavailable)).toEqual({
      agent: null,
      unavailableSavedAgent: null,
    });
    expect(resolveGeneralWorkspaceAgent('removed', undefined, unavailable)).toEqual({
      agent: null,
      unavailableSavedAgent: 'removed',
    });
  });
});
