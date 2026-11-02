import { describe, expect, test } from 'bun:test';
import type { PrVisualSummary } from '@/stores/useGitHubPrStatusStore';
import { getPrStatusLabelKey } from './sessionPrSummaries';

const summary = (number: number, visualState: string, overrides: Partial<PrVisualSummary> = {}): PrVisualSummary => ({
  provider: 'github',
  number,
  visualState,
  prState: visualState === 'merged' || visualState === 'closed' ? visualState : 'open',
  draft: visualState === 'draft',
  title: `PR ${number}`,
  url: `https://github.com/acme/app/pull/${number}`,
  base: null,
  head: null,
  checks: null,
  canMerge: null,
  mergeableState: null,
  repo: { owner: 'acme', repo: 'app' },
  ...overrides,
});

describe('getPrStatusLabelKey', () => {
  test('a PR waiting for a required review is open, not ready to merge', () => {
    expect(getPrStatusLabelKey(summary(1, 'open', { mergeableState: 'blocked', canMerge: true })))
      .toBe('sessions.sidebar.group.pr.status.open');
  });

  test('names the reason an orange PR needs fixing', () => {
    expect(getPrStatusLabelKey(summary(1, 'blocked', { mergeableState: 'dirty' }))).toBe('sessions.sidebar.group.pr.status.mergeConflicts');
    expect(getPrStatusLabelKey(summary(1, 'blocked', { checks: { state: 'failure', total: 2, success: 1, failure: 1, pending: 0 } })))
      .toBe('sessions.sidebar.group.pr.status.checksFailing');
  });

  test('an open PR with checks still running says so, never ready to merge', () => {
    expect(getPrStatusLabelKey(summary(1, 'open', { canMerge: true, mergeableState: 'clean', checks: { state: 'pending', total: 2, success: 1, failure: 0, pending: 1 } })))
      .toBe('sessions.sidebar.group.pr.status.checksRunning');
  });

  test('a conflict outranks checks still running', () => {
    expect(getPrStatusLabelKey(summary(1, 'blocked', { mergeableState: 'dirty', checks: { state: 'pending', total: 2, success: 1, failure: 0, pending: 1 } })))
      .toBe('sessions.sidebar.group.pr.status.mergeConflicts');
  });
});
