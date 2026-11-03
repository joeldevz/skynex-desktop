import { create } from 'zustand';
import { z } from 'zod';
import { getRegisteredRuntimeAPIs } from '../contexts/runtimeAPIRegistry';
import type { ProjectEntry } from '../lib/api/types';
import { getDurableStorage } from './utils/safeStorage';
import { getRuntimeKey, isTransientRuntimeKey } from '../lib/runtime-switch';
import type { Workspace, WorkspaceCatalog, WorkspacePatch } from '../lib/workspaces/model';
import { parseWorkspaceCatalog, patchWorkspace, putWorkspace, removeWorkspace, unlinkWorkspaceFolder } from '../lib/workspaces/schema';

type CatalogResult = { kind: 'saved' } | { kind: 'retained'; reason: string };
type WorkspacesState = {
  runtimeKey: string | null;
  catalog: WorkspaceCatalog;
  status: 'unloaded' | 'loading' | 'ready' | 'failed';
  hasBaseline: boolean;
  error: string | null;
  selectedWorkspaceId: string | null;
  selectWorkspace(id: string | null): void;
  load(): Promise<CatalogResult>;
  adopt(catalog: WorkspaceCatalog): void;
  create(input: Omit<Workspace, 'id'>): Promise<CatalogResult>;
  update(id: string, patch: WorkspacePatch): Promise<CatalogResult>;
  remove(id: string): Promise<CatalogResult>;
  unlinkFolder(workspaceId: string, folderId: string): Promise<CatalogResult>;
  resetForRuntimeSwitch(): void;
};

function seedCatalog(projects: readonly ProjectEntry[]): WorkspaceCatalog {
  return { version: 1, workspaces: projects.map((project) => {
    const separator = project.defaultModel?.indexOf('/') ?? -1;
    const model = project.defaultModel && separator > 0
      ? project.defaultVariant === undefined
        ? { providerID: project.defaultModel.slice(0, separator), id: project.defaultModel.slice(separator + 1) }
        : { providerID: project.defaultModel.slice(0, separator), id: project.defaultModel.slice(separator + 1), variant: project.defaultVariant }
      : undefined;
    const defaults = model
      ? project.defaultAgent ? { model, agent: project.defaultAgent } : { model }
      : project.defaultAgent ? { agent: project.defaultAgent } : {};
    return { id: `project:${project.id}`, name: project.label || project.path.split('/').filter(Boolean).at(-1) || project.path,
      description: '', folders: [{ id: `project:${project.id}`, path: project.path, role: '' }], defaults };
  }) };
}

const queues = new Map<string, Promise<void>>();
const enqueue = <T>(key: string, action: () => Promise<T>): Promise<T> => {
  const next = (queues.get(key) ?? Promise.resolve()).then(action);
  const tail = next.then(() => undefined, () => undefined);
  queues.set(key, tail);
  void tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return next;
};
const emptyCatalog: WorkspaceCatalog = { version: 1, workspaces: [] };
export const useWorkspacesStore = create<WorkspacesState>()((set, get) => {
  let revision = 0;
  let selectionRevision = 0;
  let acknowledgedRuntimeKey: string | null = null;
  const current = (key: string) => key === getRuntimeKey() && get().runtimeKey === key;
  const failure = (key: string, error: Error | null): CatalogResult => {
    const reason = error?.message ?? 'Workspace catalog operation failed';
    if (current(key)) set({ status: 'failed', error: reason });
    return { kind: 'retained', reason };
  };
  const edit = (transform: (catalog: WorkspaceCatalog) => WorkspaceCatalog, removedId?: string): Promise<CatalogResult> => {
    const key = getRuntimeKey();
    const api = getRegisteredRuntimeAPIs()?.settings;
    if (isTransientRuntimeKey(key) || !api || get().runtimeKey !== key || get().status !== 'ready' && get().status !== 'failed') return Promise.resolve({ kind: 'retained', reason: 'Workspace catalog is not ready' });
    return enqueue(key, async () => {
      if (!current(key)) return { kind: 'retained', reason: 'runtime-changed' };
      if (acknowledgedRuntimeKey !== key) return { kind: 'retained', reason: 'Workspace catalog has no acknowledged baseline' };
      try {
        const next = transform(get().catalog);
        if (next === get().catalog) return { kind: 'saved' };
        const { saveWorkspaceCatalog } = await import('../lib/persistence');
        if (!current(key)) return { kind: 'retained', reason: 'runtime-changed' };
        const acknowledged = await saveWorkspaceCatalog(next);
        if (!current(key)) return { kind: 'retained', reason: 'runtime-changed' };
        if (removedId !== undefined && acknowledged.workspaces.some((workspace) => workspace.id === removedId)) throw new Error('Workspace removal was not acknowledged');
        revision++;
        const clearSelection = removedId !== undefined && get().selectedWorkspaceId === removedId;
        if (clearSelection) selectionRevision++;
        const state = { catalog: acknowledged, status: 'ready' as const, hasBaseline: true, error: null };
        if (clearSelection) set({ ...state, selectedWorkspaceId: null });
        else set(state);
        if (clearSelection && current(key) && get().selectedWorkspaceId === null) {
          try { getDurableStorage().setItem(`openchamber.workspaceOverview.v1:${key}`, JSON.stringify(null)); }
          catch { return { kind: 'saved' }; }
        }
        return { kind: 'saved' };
      } catch (error) { return failure(key, error instanceof Error ? error : null); }
    });
  };
  return {
    runtimeKey: null, catalog: emptyCatalog, status: 'unloaded', hasBaseline: false, error: null, selectedWorkspaceId: null,
    selectWorkspace: (id) => {
      const key = getRuntimeKey();
      if (isTransientRuntimeKey(key)) throw new Error('Runtime is unavailable');
      getDurableStorage().setItem(`openchamber.workspaceOverview.v1:${key}`, JSON.stringify(id));
      selectionRevision++;
      set({ selectedWorkspaceId: id });
    },
    adopt: (catalog) => {
      const key = getRuntimeKey();
      const restoreSelection = acknowledgedRuntimeKey !== key;
      revision++;
      acknowledgedRuntimeKey = key;
      set({ runtimeKey: key, catalog, status: 'ready', hasBaseline: true, error: null });
      if (restoreSelection && selectionRevision === 0) {
        try {
          const raw = getDurableStorage().getItem(`openchamber.workspaceOverview.v1:${key}`);
          const selected = z.string().nullable().safeParse(raw === null ? null : JSON.parse(raw));
          if (selected.success && catalog.workspaces.some((workspace) => workspace.id === selected.data)) set({ selectedWorkspaceId: selected.data });
        } catch (error) { failure(key, error instanceof Error ? error : null); }
      }
    },
    load: () => {
      const key = getRuntimeKey();
      const api = getRegisteredRuntimeAPIs()?.settings;
      if (isTransientRuntimeKey(key) || !api) return Promise.resolve({ kind: 'retained', reason: 'runtime-unavailable' });
      if (get().runtimeKey !== key) {
        acknowledgedRuntimeKey = null;
        selectionRevision = 0;
        set({ runtimeKey: key, catalog: emptyCatalog, hasBaseline: false, selectedWorkspaceId: null });
      }
      const started = revision;
      const selectionStarted = selectionRevision;
      set({ status: 'loading', error: null });
      return enqueue(key, async () => {
        try {
          const { loadDesktopSettings, saveWorkspaceCatalog } = await import('../lib/persistence');
          const payload = await loadDesktopSettings();
          if (!payload) throw new Error('Workspace settings could not be loaded');
          if (!current(key)) return { kind: 'retained', reason: 'runtime-changed' };
          if (revision !== started) return { kind: 'saved' };
          const parsed = parseWorkspaceCatalog(payload.workspaceCatalog === undefined ? null : JSON.stringify(payload.workspaceCatalog));
          if (parsed.kind === 'invalid') throw new Error(parsed.reason);
          const catalog = parsed.kind === 'missing'
            ? await saveWorkspaceCatalog(seedCatalog(payload.projects ?? [])) : parsed.value;
          if (!current(key)) return { kind: 'retained', reason: 'runtime-changed' };
          if (revision === started) {
            acknowledgedRuntimeKey = key;
            set({ catalog, status: 'ready', hasBaseline: true, error: null });
            if (selectionRevision === selectionStarted) {
              const raw = getDurableStorage().getItem(`openchamber.workspaceOverview.v1:${key}`);
              const selected = z.string().nullable().safeParse(raw === null ? null : JSON.parse(raw));
              if (selected.success && catalog.workspaces.some((workspace) => workspace.id === selected.data)) {
                set({ selectedWorkspaceId: selected.data });
              }
            }
          }
          return { kind: 'saved' };
        } catch (error) { return failure(key, error instanceof Error ? error : null); }
      });
    },
    create: (input) => {
      const workspace = { ...input, id: crypto.randomUUID() };
      return edit((catalog) => putWorkspace(catalog, workspace));
    },
    update: (id, patch) => edit((catalog) => patchWorkspace(catalog, id, patch)),
    remove: (id) => edit((catalog) => removeWorkspace(catalog, id), id),
    unlinkFolder: (id, folderId) => edit((catalog) => unlinkWorkspaceFolder(catalog, id, folderId)),
    resetForRuntimeSwitch: () => {
      revision++;
      selectionRevision = 0;
      acknowledgedRuntimeKey = null;
      set({ runtimeKey: null, catalog: emptyCatalog, status: 'unloaded', hasBaseline: false, error: null, selectedWorkspaceId: null });
    },
  };
});
