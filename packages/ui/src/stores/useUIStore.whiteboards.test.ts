import { beforeEach, describe, expect, test } from 'bun:test';
import { useUIStore } from './useUIStore';

beforeEach(() => {
  useUIStore.setState({ whiteboardsEnabled: false, isWhiteboardsPageOpen: false, contextPanelByDirectory: {} });
});

describe('Whiteboards beta switch', () => {
  test('off by default: nothing opens the Whiteboards page', () => {
    useUIStore.getState().setWhiteboardsPageOpen(true);
    expect(useUIStore.getState().isWhiteboardsPageOpen).toBe(false);
  });

  test('on, the page opens; turned off, the page and every board tab close', () => {
    useUIStore.getState().setWhiteboardsEnabled(true);
    useUIStore.getState().setWhiteboardsPageOpen(true);
    expect(useUIStore.getState().isWhiteboardsPageOpen).toBe(true);
    useUIStore.getState().openContextPanelTab('/repo', { mode: 'whiteboard', targetPath: 'wb_a', dedupeKey: 'wb_a', label: 'A' });
    expect(useUIStore.getState().contextPanelByDirectory['/repo']?.tabs.some((tab) => tab.mode === 'whiteboard')).toBe(true);

    useUIStore.getState().setWhiteboardsEnabled(false);

    expect(useUIStore.getState().isWhiteboardsPageOpen).toBe(false);
    expect(useUIStore.getState().contextPanelByDirectory['/repo']?.tabs.some((tab) => tab.mode === 'whiteboard') ?? false).toBe(false);
  });
});
