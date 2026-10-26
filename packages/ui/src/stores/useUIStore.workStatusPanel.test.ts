import { beforeEach, describe, expect, test } from 'bun:test';
import { useUIStore } from './useUIStore';

const card = () => {
  const { workStatusPanelEnabled, workStatusOverlayOpen } = useUIStore.getState();
  return { enabled: workStatusPanelEnabled, overlay: workStatusOverlayOpen };
};

describe('combined work-status panel', () => {
  beforeEach(() => {
    useUIStore.setState({
      workStatusPanelEnabled: false,
      workStatusPanelFits: true,
      workStatusOverlayOpen: false,
      workStatusHiddenSections: ['tasks', 'mcp'],
      workStatusExpandedSections: { tasks: false, usage: false },
    });
  });

  test('the Session button opens and closes the combined inline panel', () => {
    useUIStore.getState().toggleWorkStatusPanel();
    expect(card()).toEqual({ enabled: true, overlay: false });
    useUIStore.getState().toggleWorkStatusPanel();
    expect(card()).toEqual({ enabled: false, overlay: false });
  });

  test('without room the button opens the overlay and retains the enabled preference on close', () => {
    useUIStore.setState({ workStatusPanelFits: false });
    useUIStore.getState().toggleWorkStatusPanel();
    expect(card()).toEqual({ enabled: true, overlay: true });
    useUIStore.getState().toggleWorkStatusPanel();
    expect(card()).toEqual({ enabled: true, overlay: false });
  });

  test('Open tasks exposes Session and expands only Tasks, including when hidden', () => {
    useUIStore.getState().openWorkStatusTasks();
    expect(card()).toEqual({ enabled: true, overlay: false });
    expect(useUIStore.getState().workStatusHiddenSections).toEqual(['mcp']);
    expect(useUIStore.getState().workStatusHiddenSectionsExplicit).toBe(true);
    expect(useUIStore.getState().workStatusExpandedSections).toEqual({ tasks: true, usage: false });
    useUIStore.setState({ workStatusPanelFits: false });
    useUIStore.getState().openWorkStatusTasks();
    expect(card()).toEqual({ enabled: true, overlay: true });
  });

  test('legacy Tasks view preference is removed without resetting unrelated settings', async () => {
    const migrate = useUIStore.persist.getOptions().migrate;
    if (!migrate) throw new Error('Missing persisted UI migration');
    const migrated = await migrate({
      workStatusPanelView: 'tasks', workStatusPanelEnabled: true,
      workStatusExpandedSections: { tasks: false, usage: true },
      workStatusHiddenSections: ['mcp'], sidebarWidth: 321,
    }, 26);
    expect(migrated).not.toHaveProperty('workStatusPanelView');
    expect(migrated).toMatchObject({
      workStatusPanelEnabled: true, sidebarWidth: 321,
      workStatusHiddenSections: ['mcp'],
      workStatusExpandedSections: { tasks: false, usage: true },
    });
    const persisted = useUIStore.persist.getOptions().partialize?.(useUIStore.getState());
    expect(persisted).not.toHaveProperty('workStatusPanelView');
  });
});
