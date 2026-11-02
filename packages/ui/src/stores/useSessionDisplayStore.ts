import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getSettingsSurface } from '@/lib/settings/surface';
import type { SettingsSurface } from '@/lib/settings/registry';

// Worktree groups inside a project. 'recent' floats worktrees with the latest
// session activity to the top, so the list moves as sessions run; 'manual'
// and 'a-z' keep positions stable.

// The Tree/List pair the one view replaced, read only until a grouping is
// chosen. 'projects' was Tree; 'timeline' was
// List, laid out by `listSessionGrouping`.
type SidebarViewMode = 'projects' | 'timeline';
// `sidebarGrouping`, and the old List's: 'project' puts each project's sessions under its header;
// 'time' lists every project's sessions together, newest activity first.
type ListSessionGrouping = 'project' | 'time';
type ProjectDisplayMode = 'all' | 'single';

type SessionDisplayStore = {
  projectDisplayMode: ProjectDisplayMode;
  singleProjectId: string | null;
  setProjectDisplayMode: (mode: ProjectDisplayMode) => void;
  setSingleProjectId: (projectId: string) => void;
  sidebarViewMode: SidebarViewMode;
  setSidebarViewMode: (mode: SidebarViewMode) => void;
  listSessionGrouping: ListSessionGrouping;
  setListSessionGrouping: (grouping: ListSessionGrouping) => void;
  /**
   * The sidebar's one view, on the desktop, the web and the phone: under each
   * project, or one list by time. Null until chosen, when it follows the
   * List/Tree pair it replaced.
   */
  sidebarGrouping: ListSessionGrouping | null;
  setSidebarGrouping: (grouping: ListSessionGrouping) => void;
  /** A work in the In work block also stays in its project or folder; off by default. */
  keepWorkInPlace: boolean;
  setKeepWorkInPlace: (keep: boolean) => void;
  /** Local display preference; motion remains opt-in. */
  animatedActivityIndicators: boolean;
  setAnimatedActivityIndicators: (enabled: boolean) => void;
  /** The In work block; hidden, its sessions stay in their projects. */
  showWorkSection: boolean;
  /** The Pinned block above In work; off by default. Hidden, pinned sessions stay in their projects. */
  showPinnedSection: boolean;
  /**
   * Works in two lines (branch, reference, project where projects mix) rather
   * than one. Off by default on a computer, on by default on a phone, whose
   * full-width rows have the room.
   */
  detailedZoneRows: boolean;
  setShowWorkSection: (show: boolean) => void;
  setShowPinnedSection: (show: boolean) => void;
  setDetailedZoneRows: (detailed: boolean) => void;
};

export const migrateSessionDisplayState = (
  persisted: unknown,
  version: number,
  surface: SettingsSurface = getSettingsSurface(),
): Partial<SessionDisplayStore> => {
  const state = (persisted ?? {}) as Partial<SessionDisplayStore> & {
    displayMode?: string;
    sessionGroupingMode?: string;
    stickyZoneHeaders?: boolean;
    showRecentSection?: boolean;
    worktreeSortOrder?: string;
    showArchivedSessions?: boolean;
    showChatsSection?: boolean;
    projectSortOrder?: string;
  };
  if (version < 4) {
    // v4 removes the default/minimal display mode: the sidebar now has a
    // single row layout. Drop the stale key from persisted state.
    delete state.displayMode;
  }
  if (version < 6) {
    // v6 removes the by-worktree/flat grouping choice: the projects view always
    // groups by worktree, and the flat recency list became the timeline view.
    delete state.sessionGroupingMode;
  }
  if (version < 7) {
    // v7 removes the sticky-headers toggle: zone headers are always pinned.
    delete state.stickyZoneHeaders;
  }
  if (version < 10) {
    // v10 removes Recent: In work holds the sessions being worked on, and the
    // timeline view answers "what was I doing" across projects.
    delete state.showRecentSection;
  }
  if (version < 11) {
    // v11 removes the worktree sort: a worktree is a work among the
    // project's works, listed by activity like the rest.
    delete state.worktreeSortOrder;
  }
  if (version < 12 && surface === 'mobile' && state.sidebarViewMode !== 'projects') {
    // v12 gives the phone the works view, two-line by default. Its List always
    // drew two lines, so a phone on List keeps them; Tree keeps its choice.
    state.detailedZoneRows = true;
  }
  if (version < 13) delete state.showArchivedSessions;
  if (version < 15) {
    delete state.showChatsSection;
    delete state.projectSortOrder;
  }
  return state;
};

/**
 * How the desktop and web sidebar groups works. Before the choice is made in
 * the one view, a List sorted by time keeps its list by time; Tree and List by
 * project both group under projects.
 */
export const useSessionDisplayStore = create<SessionDisplayStore>()(
  persist(
    (set) => ({
      animatedActivityIndicators: false,
      setAnimatedActivityIndicators: (enabled) => set({ animatedActivityIndicators: enabled }),
      projectDisplayMode: 'all',
      singleProjectId: null,
      setProjectDisplayMode: (mode) => set({ projectDisplayMode: mode }),
      setSingleProjectId: (projectId) => set({ singleProjectId: projectId }),
      // New installs start on the timeline. Stored state keeps an earlier
      // choice, and VS Code always renders the grouped view.
      sidebarViewMode: 'timeline',
      setSidebarViewMode: (mode) => set({ sidebarViewMode: mode }),
      listSessionGrouping: 'project',
      setListSessionGrouping: (grouping) => set({ listSessionGrouping: grouping }),
      sidebarGrouping: null,
      setSidebarGrouping: (grouping) => set({ sidebarGrouping: grouping }),
      keepWorkInPlace: false,
      setKeepWorkInPlace: (keep) => set({ keepWorkInPlace: keep }),
      showWorkSection: true,
      // On for new installs: pinned work gets its own block on top. Stored
      // state keeps an earlier choice.
      showPinnedSection: true,
      detailedZoneRows: getSettingsSurface() === 'mobile',
      setShowWorkSection: (show) => set({ showWorkSection: show }),
      setShowPinnedSection: (show) => set({ showPinnedSection: show }),
      setDetailedZoneRows: (detailed) => set({ detailedZoneRows: detailed }),
    }),
    {
      name: 'session-display-mode',
      version: 15,
      // v3→v4 removes displayMode (single sidebar row layout).
      // v4→v5 adds the independent all-projects/single-project view mode.
      // v5→v6 drops sessionGroupingMode in favour of sidebarViewMode.
      // v6→v7 drops stickyZoneHeaders (derived from the view mode now).
      // v7→v8 turned Recent off by default.
      // v8→v9 added worktreeSortOrder; v10→v11 drops it again.
      // v9→v10 drops showRecentSection (Recent is gone).
      // v11→v12 turns two-line rows on for a phone that was on List.
      // v12→v13 drops the unused inline archived-session toggle.
      // v13→v14 drops the managed Chats block setting.
      // v14→v15 drops the project sort preference.
      migrate: migrateSessionDisplayState,
    },
  ),
);
