import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { z } from 'zod';
import type { RepositoryReferenceKind } from '@/lib/api/types';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { createDeferredSafeJSONStorage } from './utils/safeStorage';
import { useWorkspacesStore } from './useWorkspacesStore';
import type { Workspace } from '@/lib/workspaces/model';
import { normalizePath } from '@/lib/pathNormalization';

const SOURCE_BOARD_STORAGE_KEY = 'openchamber.source-board';

/** The repository's own host (on whichever source-control provider), or one tracker's items (`tracker:linear`). */
export type SourceBoardTab = 'repository' | `tracker:${string}`;

const TRACKER_TAB = /^tracker:[a-z][a-z0-9-]{0,31}$/;
const isSourceBoardTab = (value: string): value is SourceBoardTab => value === 'repository' || TRACKER_TAB.test(value);

type SourceBoardChoice = {
  /** The workspace whose folders the board offers; independent of the workspace the sidebar shows. */
  workspaceId: string | null;
  /**
   * The workspace folder whose repository the board lists. The per-project maps
   * below are keyed by this folder id.
   */
  projectId: string | null;
  tab: SourceBoardTab;
  /** Per tracker id, the container (Linear team) its tab lists; absent or null lists every one. */
  trackerContainerByProvider: Record<string, string | null>;
  /**
   * Per project id, the nested repository the board lists while that project's
   * root is not a repository itself; the board's own, never the Git screen's
   * selection. Ignored once the repository is no longer among the discovered ones.
   */
  repositoryByProject: Record<string, string>;
  /**
   * Per project id, whether the board lists every repository under the folder
   * together (true) or just the one in `repositoryByProject` (false). Absent:
   * the board's default, all of them unless a single repository was remembered.
   */
  allRepositoriesByProject: Record<string, boolean>;
};

const EMPTY_CHOICE: SourceBoardChoice = { workspaceId: null, projectId: null, tab: 'repository', trackerContainerByProvider: {}, repositoryByProject: {}, allRepositoriesByProject: {} };

type SourceBoardState = {
  /** Keyed by runtime: project and team ids belong to one server. */
  choices: Record<string, SourceBoardChoice>;
  /** A tracker item another surface asked the board to show; taken once. */
  trackerFocus: { provider: string; identifier: string } | null;
  /** Merges `patch` into the choice; the per-project and per-tracker maps merge into the existing ones. */
  update: (patch: Partial<SourceBoardChoice>) => void;
  /** Switches to the tracker's tab, every container, and previews the item `identifier` names; the caller opens the board. */
  focusTrackerItem: (provider: string, identifier: string) => void;
  /** Switches to the repository tab of `workspaceId`, keeping its folder if the board was already there; the caller opens the board. */
  focusWorkspace: (workspaceId: string) => void;
  clearTrackerFocus: () => void;
  /** An issue or PR another surface asked the board to show: its tab and its link; taken once. */
  repositoryFocus: { kind: RepositoryReferenceKind; query: string } | null;
  /**
   * Switches to the repository tab of the workspace folder holding `directory`
   * and previews the item the link `query` names; the caller opens the board.
   * A directory no workspace folder holds leaves the board on its current folder.
   */
  focusRepositoryItem: (directory: string, kind: RepositoryReferenceKind, query: string) => void;
  clearRepositoryFocus: () => void;
  /** The list column's width in pixels; null until the user drags it. Not per runtime: it is about the screen. */
  listWidth: number | null;
  setListWidth: (width: number) => void;
};

// Before trackers had their own tabs, Linear's was `linear` and its team `linearTeamId`.
const LEGACY_LINEAR_TAB = 'linear';

const persistedChoice = z.object({
  // Absent from data stored while the board listed projects.
  workspaceId: z.string().nullable().catch(null),
  projectId: z.string().nullable().catch(null),
  tab: z.string().catch('repository').transform((tab): SourceBoardTab => {
    if (tab === LEGACY_LINEAR_TAB) return 'tracker:linear';
    return isSourceBoardTab(tab) ? tab : 'repository';
  }),
  linearTeamId: z.string().nullable().catch(null).optional(),
  trackerContainerByProvider: z.record(z.string(), z.string().nullable()).catch({}),
  // Absent from data stored before nested repositories were supported.
  repositoryByProject: z.record(z.string(), z.string()).catch({}),
  allRepositoriesByProject: z.record(z.string(), z.boolean()).catch({}),
}).transform(({ linearTeamId, trackerContainerByProvider, ...choice }): SourceBoardChoice => ({
  ...choice,
  trackerContainerByProvider: linearTeamId && !Object.hasOwn(trackerContainerByProvider, 'linear')
    ? { ...trackerContainerByProvider, linear: linearTeamId }
    : trackerContainerByProvider,
}));

const persistedChoices = z.object({
  choices: z.record(z.string(), persistedChoice).catch({}),
  listWidth: z.number().positive().nullable().catch(null).optional(),
});

/** The workspace folder that holds `directory`: the same folder, else the deepest folder above it. */
export const findWorkspaceFolder = (workspaces: readonly Workspace[], directory: string): { workspaceId: string; folderId: string } | null => {
  const target = normalizePath(directory);
  if (!target) return null;
  let best: { workspaceId: string; folderId: string; length: number } | null = null;
  for (const workspace of workspaces) {
    for (const folder of workspace.folders) {
      const root = normalizePath(folder.path);
      if (!root) continue;
      const holds = target === root || target.startsWith(root.endsWith('/') ? root : `${root}/`);
      if (holds && (!best || root.length > best.length)) best = { workspaceId: workspace.id, folderId: folder.id, length: root.length };
    }
  }
  return best ? { workspaceId: best.workspaceId, folderId: best.folderId } : null;
};

/**
 * What the board was last left on, so it reopens there. Changing it never
 * touches the project the rest of the app has selected.
 */
export const useSourceBoardStore = create<SourceBoardState>()(
  persist(
    (set, get) => ({
      choices: {},
      trackerFocus: null,
      update: (patch) => set((state) => {
        const runtimeKey = getRuntimeKey();
        const current = state.choices[runtimeKey] ?? EMPTY_CHOICE;
        const repositoryByProject = { ...current.repositoryByProject, ...patch.repositoryByProject };
        const allRepositoriesByProject = { ...current.allRepositoriesByProject, ...patch.allRepositoriesByProject };
        const trackerContainerByProvider = { ...current.trackerContainerByProvider, ...patch.trackerContainerByProvider };
        return {
          choices: {
            ...state.choices,
            [runtimeKey]: { ...current, ...patch, repositoryByProject, allRepositoriesByProject, trackerContainerByProvider },
          },
        };
      }),
      focusWorkspace: (workspaceId) => {
        const current = get().choices[getRuntimeKey()];
        get().update(current?.workspaceId === workspaceId ? { tab: 'repository' } : { workspaceId, projectId: null, tab: 'repository' });
      },
      focusTrackerItem: (provider, identifier) => {
        get().update({ tab: `tracker:${provider}`, trackerContainerByProvider: { [provider]: null } });
        set({ trackerFocus: { provider, identifier } });
      },
      clearTrackerFocus: () => set({ trackerFocus: null }),
      repositoryFocus: null,
      focusRepositoryItem: (directory, kind, query) => {
        const owner = findWorkspaceFolder(useWorkspacesStore.getState().catalog.workspaces, directory);
        get().update(owner ? { workspaceId: owner.workspaceId, projectId: owner.folderId, tab: 'repository' } : { tab: 'repository' });
        set({ repositoryFocus: { kind, query } });
      },
      clearRepositoryFocus: () => set({ repositoryFocus: null }),
      listWidth: null,
      setListWidth: (width) => set({ listWidth: Math.round(width) }),
    }),
    {
      name: SOURCE_BOARD_STORAGE_KEY,
      storage: createDeferredSafeJSONStorage(),
      partialize: (state) => ({ choices: state.choices, listWidth: state.listWidth }),
      merge: (persisted, current) => {
        const parsed = persistedChoices.safeParse(persisted);
        return parsed.success
          ? { ...current, choices: parsed.data.choices, listWidth: parsed.data.listWidth ?? null }
          : { ...current, choices: {}, listWidth: null };
      },
    },
  ),
);

export const useSourceBoardChoice = (): SourceBoardChoice => {
  const runtimeKey = getRuntimeKey();
  return useSourceBoardStore((state) => state.choices[runtimeKey] ?? EMPTY_CHOICE);
};
