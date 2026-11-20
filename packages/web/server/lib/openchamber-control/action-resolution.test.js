import { describe, expect, test } from 'bun:test';

import { OPENCHAMBER_WEB_ACTIONS, resolveAgentToolAction } from './actions.js';

describe('a namespace the tool name already implies', () => {
  test('resolves a bare action inside the calling tool', () => {
    expect(resolveAgentToolAction('snapshot', 'skynex_web')).toEqual({ action: 'browser.snapshot' });
    expect(resolveAgentToolAction('create', 'openchamber_schedule')).toEqual({ action: 'schedule.create' });
  });

  test('resolves a bare name that is ambiguous only across tools', () => {
    expect(resolveAgentToolAction('delete', 'openchamber_schedule')).toEqual({ action: 'schedule.delete' });
  });

  test('resolves the same browser actions for the new tool and a skewed legacy callback', () => {
    for (const tool of ['skynex_web', 'openchamber_web']) {
      for (const action of OPENCHAMBER_WEB_ACTIONS) {
        expect(resolveAgentToolAction(action, tool)).toEqual({ action });
      }
      for (const action of ['projects.list', 'session.create', 'schedule.list']) {
        expect(resolveAgentToolAction(action, tool).action).toBeUndefined();
      }
    }
  });

  test('rejects retired knowledge and memory actions for every caller', () => {
    for (const tool of ['openchamber', 'openchamber_knowledge', 'openchamber_memory', null]) {
      for (const action of ['knowledge.list', 'knowledge.save', 'knowledge.delete', 'knowledge.show', 'memory.list', 'memory.read', 'memory.save', 'memory.delete']) {
        expect(resolveAgentToolAction(action, tool).action).toBeUndefined();
      }
    }
  });

  test('keeps a fully qualified action as it is', () => {
    expect(resolveAgentToolAction('browser.snapshot', 'skynex_web')).toEqual({ action: 'browser.snapshot' });
  });

  test('does not reach outside the tool that asked', () => {
    expect(resolveAgentToolAction('open', 'openchamber_schedule').action).toBeUndefined();
  });
});

describe('an unidentified caller', () => {
  test('still resolves a bare name that means one thing everywhere', () => {
    expect(resolveAgentToolAction('snapshot', null)).toEqual({ action: 'browser.snapshot' });
  });

  test('refuses a bare name that several actions share', () => {
    expect(resolveAgentToolAction('list', null).action).toBeUndefined();
  });
});

describe('what an unresolvable action reports', () => {
  test('names the actions the calling tool actually has', () => {
    const { error } = resolveAgentToolAction('get', 'openchamber_schedule');

    expect(error).toContain('schedule.list');
    expect(error).toContain('schedule.create');
    // Listing every action of every tool would bury the four that apply.
    expect(error).not.toContain('browser.open');
  });

  test('reports a missing action rather than resolving to something', () => {
    const { error, action } = resolveAgentToolAction('', 'openchamber_schedule');

    expect(action).toBeUndefined();
    expect(error).toContain('missing');
  });

  test('an unknown tool cannot dispatch another capability', () => {
    const { error } = resolveAgentToolAction('nonsense', 'openchamber_future');

    expect(error).toBe('Unsupported OpenChamber tool: openchamber_future');
  });
});
