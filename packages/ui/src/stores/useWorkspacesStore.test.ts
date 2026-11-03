import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { registerRuntimeAPIs } from '../contexts/runtimeAPIRegistry';
import type { RuntimeAPIs, SettingsAPI, SettingsPayload } from '../lib/api/types';
import { invalidateSettingsCache } from '../lib/persistence';
import { switchRuntimeEndpoint } from '../lib/runtime-switch';
import type { WorkspaceCatalog } from '../lib/workspaces/model';
import { useWorkspacesStore } from './useWorkspacesStore';

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const durableValues = new Map<string, string>();
const durableStorage: Storage = {
  getItem: (key) => durableValues.get(key) ?? null,
  setItem: (key, value) => { durableValues.set(key, value); },
  removeItem: (key) => { durableValues.delete(key); },
  clear: () => { durableValues.clear(); },
  key: (index) => Array.from(durableValues.keys())[index] ?? null,
  get length() { return durableValues.size; },
};
let runtime = 0;
const baseline: WorkspaceCatalog = { version: 1, workspaces: [
  { id: 'workspace-a', name: 'A', description: 'Saved', folders: [{ id: 'folder-a', path: '/repo', role: 'Source' }], defaults: {} },
] };

function registerSettings(settings: SettingsAPI): void {
  // Only the settings boundary is exercised; unrelated runtime services are never called.
  registerRuntimeAPIs({ runtime: { platform: 'web', isDesktop: false, isVSCode: false }, settings } as RuntimeAPIs);
}

beforeEach(() => {
  durableValues.clear();
  const events = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: durableStorage,
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  } });
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: durableStorage });
  globalThis.fetch = async () => new Response(null, { status: 503 });
  switchRuntimeEndpoint({ apiBaseUrl: '', runtimeKey: `catalog-contract-${++runtime}` });
  invalidateSettingsCache();
  useWorkspacesStore.getState().resetForRuntimeSwitch();
});
afterEach(() => {
  registerRuntimeAPIs(null);
  useWorkspacesStore.getState().resetForRuntimeSwitch();
  invalidateSettingsCache();
  globalThis.fetch = originalFetch;
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('acknowledged workspace catalog baseline', () => {
  test('C1/C5 an initial failed load cannot save edits over unknown durable content', async () => {
    const saves: Partial<SettingsPayload>[] = [];
    registerSettings({
      load: async () => { throw new Error('settings unavailable'); },
      save: async (changes) => { saves.push(changes); return changes; },
    });
    expect((await useWorkspacesStore.getState().load()).kind).toBe('retained');
    expect(useWorkspacesStore.getState().status).toBe('failed');
    expect(useWorkspacesStore.getState().hasBaseline).toBe(false);
    const result = await useWorkspacesStore.getState().create({ name: 'New', description: '', folders: [], defaults: {} });
    expect(saves).toEqual([]);
    expect(result.kind).toBe('retained');
    expect(useWorkspacesStore.getState().catalog).toEqual({ version: 1, workspaces: [] });
  });

  test('C1/C5 a failed save preserves the known baseline and permits an explicit retry', async () => {
    const saves: Partial<SettingsPayload>[] = [];
    let fail = true;
    registerSettings({
      load: async () => ({ settings: { workspaceCatalog: baseline }, source: 'web' }),
      save: async (changes) => {
        saves.push(changes);
        if (fail) throw new Error('save denied');
        return changes;
      },
    });
    expect(await useWorkspacesStore.getState().load()).toEqual({ kind: 'saved' });
    expect(useWorkspacesStore.getState().hasBaseline).toBe(true);
    expect((await useWorkspacesStore.getState().update('workspace-a', { name: 'Edited' })).kind).toBe('retained');
    expect(useWorkspacesStore.getState().catalog).toEqual(baseline);
    expect(useWorkspacesStore.getState().status).toBe('failed');
    expect(useWorkspacesStore.getState().hasBaseline).toBe(true);
    fail = false;
    expect(await useWorkspacesStore.getState().update('workspace-a', { name: 'Edited' })).toEqual({ kind: 'saved' });
    const edited = { version: 1, workspaces: [{ ...baseline.workspaces[0], name: 'Edited' }] };
    expect(saves).toEqual([{ workspaceCatalog: edited }, { workspaceCatalog: edited }]);
    expect(useWorkspacesStore.getState().catalog).toEqual(edited);
  });
});
