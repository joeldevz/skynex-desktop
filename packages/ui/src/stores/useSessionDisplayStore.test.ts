import { createJSONStorage } from 'zustand/middleware';
import { afterAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'window');
const testWindow = new Window();
Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow });
const { migrateSessionDisplayState, useSessionDisplayStore } = await import('./useSessionDisplayStore');
afterAll(() => {
  testWindow.close();
  if (previousStorage) Object.defineProperty(globalThis, 'window', previousStorage);
  else Reflect.deleteProperty(globalThis, 'window');
});

describe('useSessionDisplayStore worktree sorting', () => {
  test('v11 drops the worktree sort, which worktrees no longer have', () => {
    expect(migrateSessionDisplayState({ worktreeSortOrder: 'a-z' }, 10)).not.toHaveProperty('worktreeSortOrder');
  });
});

describe('useSessionDisplayStore detailed rows', () => {
  test('v12 keeps two lines for a phone that was on List', () => {
    expect(migrateSessionDisplayState({ sidebarViewMode: 'timeline', detailedZoneRows: false }, 11, 'mobile').detailedZoneRows).toBe(true);
  });

  test('v12 keeps a phone on Tree and every computer as they were', () => {
    expect(migrateSessionDisplayState({ sidebarViewMode: 'projects', detailedZoneRows: false }, 11, 'mobile').detailedZoneRows).toBe(false);
    expect(migrateSessionDisplayState({ sidebarViewMode: 'timeline', detailedZoneRows: false }, 11, 'desktop').detailedZoneRows).toBe(false);
  });
});

describe('useSessionDisplayStore removed settings', () => {
  test('v15 drops obsolete Chats visibility and project ordering keys', () => {
    const migrated = migrateSessionDisplayState(
      { showChatsSection: false, projectSortOrder: 'z-a', sidebarViewMode: 'projects' },
      14,
    );

    expect('showChatsSection' in migrated).toBe(false);
    expect('projectSortOrder' in migrated).toBe(false);
    expect(migrated.sidebarViewMode).toBe('projects');
  });
});

describe('useSessionDisplayStore project display', () => {
  test('defaults to showing all projects without a selected single project', () => {
    expect(useSessionDisplayStore.getState().projectDisplayMode).toBe('all');
    expect(useSessionDisplayStore.getState().singleProjectId).toBeNull();
  });

  test('stores the single-project mode independently from the view mode', () => {
    useSessionDisplayStore.getState().setProjectDisplayMode('single');
    useSessionDisplayStore.getState().setSingleProjectId('project-alpha');
    useSessionDisplayStore.getState().setSidebarViewMode('projects');

    expect(useSessionDisplayStore.getState().projectDisplayMode).toBe('single');
    expect(useSessionDisplayStore.getState().singleProjectId).toBe('project-alpha');
    expect(useSessionDisplayStore.getState().sidebarViewMode).toBe('projects');

    useSessionDisplayStore.setState({
      projectDisplayMode: 'all',
      singleProjectId: null,
      sidebarViewMode: 'timeline',
    });
  });
});

describe('useSessionDisplayStore view mode', () => {
  test('starts new installs on the timeline view', () => {
    expect(useSessionDisplayStore.getState().sidebarViewMode).toBe('timeline');
  });

  test('v9→v10 drops the removed Recent toggle and keeps the rest', () => {
    const migrated = migrateSessionDisplayState({ showRecentSection: true }, 9);

    expect('showRecentSection' in migrated).toBe(false);
  });

  test('v5→v6 drops the removed grouping key and keeps the rest', () => {
    const migrated = migrateSessionDisplayState(
      { sessionGroupingMode: 'flat' },
      5,
    );

    expect('sessionGroupingMode' in migrated).toBe(false);
  });
});


describe('useSessionDisplayStore animated activity', () => {
  test('hydrates existing v8 data with motion off and retains saved choices', async () => {
    const initialState = useSessionDisplayStore.getState();
    const originalStorage = useSessionDisplayStore.persist.getOptions().storage;
    let stored = JSON.stringify({ version: 8, state: { sidebarViewMode: 'timeline', showRecentSection: false } });
    const storage = createJSONStorage<Partial<ReturnType<typeof useSessionDisplayStore.getState>>>(() => ({
      getItem: () => stored,
      setItem: (_name, value) => { stored = value; },
      removeItem: () => { stored = ''; },
    }));
    useSessionDisplayStore.persist.setOptions({ storage });
    try {
      await useSessionDisplayStore.persist.rehydrate();
      expect(useSessionDisplayStore.getState().animatedActivityIndicators).toBe(false);
      expect(useSessionDisplayStore.getState().sidebarViewMode).toBe('timeline');
       expect(useSessionDisplayStore.persist.getOptions().version).toBe(15);
      useSessionDisplayStore.getState().setAnimatedActivityIndicators(true);
      const enabledSnapshot = stored;
      useSessionDisplayStore.setState({ animatedActivityIndicators: false });
      stored = enabledSnapshot;
      await useSessionDisplayStore.persist.rehydrate();
      expect(useSessionDisplayStore.getState().animatedActivityIndicators).toBe(true);
      expect('showRecentSection' in useSessionDisplayStore.getState()).toBe(false);
    } finally {
      useSessionDisplayStore.persist.setOptions({ storage: originalStorage });
      useSessionDisplayStore.setState(initialState);
    }
  });
});
