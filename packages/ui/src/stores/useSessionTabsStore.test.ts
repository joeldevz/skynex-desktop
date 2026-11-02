import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { openSessionsStore, type OpenSessionReference } from './useOpenSessionsStore';
import { useSessionTabsStore } from './useSessionTabsStore';

const state = () => useSessionTabsStore.getState();
const references = (ids: string[]): OpenSessionReference[] => ids.map((sessionId) => ({
  sessionId, title: sessionId, primaryDirectory: '/repo', scope: null,
}));
const publish = (ids: string[]) => openSessionsStore.setState({ sessions: references(ids) });
const originalReorder = openSessionsStore.getState().reorderSession;
const originalClose = openSessionsStore.getState().closeSession;

describe('useSessionTabsStore explicit-owner projection', () => {
  beforeEach(() => {
    useSessionTabsStore.setState({ tabIds: [], previewTabId: null, pinOnOpenIds: [] });
    publish([]);
  });
  afterEach(() => openSessionsStore.setState({ reorderSession: originalReorder, closeSession: originalClose }));

  test('C3 mounting sessions cannot create or replace explicit membership', () => {
    publish(['a', 'b']);
    state().ensureTab('c');
    state().ensureTab('d');
    expect(state().tabIds).toEqual(['a', 'b']);
    expect(state().previewTabId).toBeNull();
    expect(openSessionsStore.getState().sessions).toEqual(references(['a', 'b']));
  });

  test('reopening a session that has a tab changes nothing', () => {
    publish(['a', 'b']);
    const before = state().tabIds;
    state().ensureTab('a');
    expect(state().tabIds).toBe(before);
    expect(state().previewTabId).toBeNull();
  });

  test('C3 pinning cannot give the header independent membership', () => {
    publish(['a']);
    state().pinTab('a');
    state().ensureTab('b');
    expect(state().tabIds).toEqual(['a']);
    expect(state().previewTabId).toBeNull();
  });

  test('C3 pinning a session before mounting does not open it', () => {
    publish(['a']);
    state().pinTab('new');
    state().ensureTab('new');
    expect(state().tabIds).toEqual(['a']);
    expect(state().pinOnOpenIds).toEqual([]);
  });

  test('C3 owner order is projected without preview state', () => {
    publish(['a', 'b']);
    publish(['b', 'a']);
    expect(state().tabIds).toEqual(['b', 'a']);
    expect(state().previewTabId).toBeNull();
  });

  test('C3 lane mounting cannot collapse independently opened sessions', () => {
    publish(['a', 'lane-1', 'b', 'lane-2']);
    state().ensureTab('lane-3', ['lane-1', 'lane-2', 'lane-3']);
    expect(state().tabIds).toEqual(['a', 'lane-1', 'b', 'lane-2']);
    expect(state().previewTabId).toBeNull();
    publish(['a', 'lane-1']);
    state().ensureTab('lane-2', ['lane-1', 'lane-2']);
    expect(state().tabIds).toEqual(['a', 'lane-1']);
  });

  test('C7 close commands use the owner transaction and acknowledged removal updates the header', async () => {
    const calls: Array<[string, string]> = [];
    let finished: () => void = () => undefined;
    let completion = new Promise<void>((resolve) => { finished = resolve; });
    openSessionsStore.setState({ closeSession: async (id, confirmation) => {
      calls.push([id, confirmation]);
      publish(openSessionsStore.getState().sessions.filter((row) => row.sessionId !== id).map((row) => row.sessionId));
      finished();
      return { kind: 'closed' };
    } });
    publish(['a', 'b', 'c']);
    state().closeTab('b');
    await completion;
    expect(state().tabIds).toEqual(['a', 'c']);
    expect(state().previewTabId).toBeNull();
    completion = new Promise<void>((resolve) => { finished = resolve; });
    state().closeOtherTabs('c');
    await completion;
    expect(state().tabIds).toEqual(['c']);
    expect(calls).toEqual([['b', 'unconfirmed'], ['a', 'unconfirmed']]);
    publish([]);
    expect(state().tabIds).toEqual([]);
  });

  test('reorderTabs ignores unknown ids', () => {
    publish(['a', 'b', 'c']);
    const calls: Array<[string, string]> = [];
    openSessionsStore.setState({ reorderSession: async (activeId, overId) => {
      calls.push([activeId, overId]);
      if (activeId === 'c' && overId === 'a') publish(['c', 'a', 'b']);
      return { kind: 'saved' };
    } });
    state().reorderTabs('c', 'a');
    expect(state().tabIds).toEqual(['c', 'a', 'b']);
    const before = state().tabIds;
    state().reorderTabs('x', 'a');
    expect(state().tabIds).toBe(before);
    expect(calls).toEqual([['c', 'a'], ['x', 'a']]);
  });

  test('C3 all 12 explicit sessions remain visible after pin and mount calls', () => {
    const ids = Array.from({ length: 12 }, (_, i) => `s${i}`);
    publish(ids);
    state().ensureTab('s-new');
    state().pinTab('s11');
    expect(state().tabIds).toEqual(ids);
    expect(openSessionsStore.getState().sessions).toEqual(references(ids));
  });

  test('C3/C12 cleanup cannot remove explicit membership even for missing history ids', () => {
    publish(['a', 'b']);
    const before = state().tabIds;
    state().removeTabs(['x']);
    expect(state().tabIds).toBe(before);
    state().removeTabs(['a']);
    expect(state().tabIds).toBe(before);
    expect(openSessionsStore.getState().sessions).toEqual(references(['a', 'b']));
  });
});
