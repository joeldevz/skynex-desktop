import React from 'react';
import { useOptionalMobileSidebarActions } from '@/apps/mobileSidebar/mobileSidebarState';
import { Button } from '@/components/ui/button';
import { dropdownTriggerVariants } from '@/components/ui/dropdown-trigger';
import { SettingsSection } from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import type { Session } from '@/lib/opencode/model';
import { normalizePath } from '@/lib/pathNormalization';
import { getRuntimeKey, isTransientRuntimeKey } from '@/lib/runtime-switch';
import type { Workspace } from '@/lib/workspaces/model';
import { readWorkspaceScope } from '@/lib/workspaces/session-scope';
import { bindWorkspaceAssignment, readWorkspaceAssignment } from '@/lib/workspaces/session-assignment';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { openSessionReference, openSessionsStore, useOpenSessionsStore } from '@/stores/useOpenSessionsStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { useUIStore } from '@/stores/useUIStore';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { patchSessionMetadata } from '@/sync/session-actions';
import { FolderSessionActivity } from './FolderSessionActivity';

export function useWorkspaceFolderHistory(workspace: Workspace | undefined) {
  const { t } = useI18n();
  const mobileSidebarActions = useOptionalMobileSidebarActions();
  const entities = useGlobalSessionsStore((state) => state.entityById);
  const status = useGlobalSessionsStore((state) => state.status);
  const hasLoaded = useGlobalSessionsStore((state) => state.hasLoaded);
  const runtimeKey = useOpenSessionsStore((state) => state.runtimeKey);
  const connected = useConfigStore((state) => state.isConnected);
  const workspaceId = workspace?.id;
  const [opening, setOpening] = React.useState<string | null>(null);
  const [openFailed, setOpenFailed] = React.useState(false);
  const [filter, setFilter] = React.useState({ workspaceId, runtimeKey, path: '', page: 1 });
  const selectedPath = filter.workspaceId === workspaceId && filter.runtimeKey === runtimeKey
    && workspace?.folders.some((folder) => normalizePath(folder.path) === filter.path) ? filter.path : '';
  const filterChanged = filter.workspaceId !== workspaceId || filter.runtimeKey !== runtimeKey || filter.path !== selectedPath;
  if (filterChanged) {
    setFilter({ workspaceId, runtimeKey, path: selectedPath, page: 1 });
  }
  const openingRef = React.useRef(false);
  React.useEffect(() => {
    const state = useGlobalSessionsStore.getState();
    if (workspaceId && connected && !isTransientRuntimeKey(getRuntimeKey()) && state.status === 'idle') void state.loadSessions();
  }, [workspaceId, connected, runtimeKey]);
  React.useEffect(() => { setOpenFailed(false); }, [workspaceId, runtimeKey]);
  const history = React.useMemo(() => {
    const folders = new Map<string, { path: string; name: string; label: string }>();
    const rows = new Map<string, { session: Session; paths: string[] }>();
    if (!workspace) return { folders, rows: [] };
    const nameCounts = new Map<string, number>();
    for (const folder of workspace.folders) {
      const path = normalizePath(folder.path);
      if (!path || folders.has(path)) continue;
      const name = path.split('/').filter(Boolean).at(-1) || path;
      folders.set(path, { path, name, label: name });
      nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    }
    for (const folder of folders.values()) {
      if ((nameCounts.get(folder.name) ?? 0) > 1) folder.label = folder.path;
    }
    for (const session of entities.values()) {
      if (session.parentID) continue;
      const scope = readWorkspaceScope(session.metadata);
      const assignment = readWorkspaceAssignment(session.metadata);
      const paths = new Set<string>();
      if (!scope && (!assignment || assignment.workspaceId === workspace.id)) {
        const directory = normalizePath(session.directory);
        if (directory && folders.has(directory)) paths.add(directory);
      } else if (scope?.workspaceId === workspace.id) {
        for (const folder of scope.folders) {
          const path = normalizePath(folder.path);
          if (path && folders.has(path)) paths.add(path);
        }
      }
      if (paths.size > 0) rows.set(session.id, { session, paths: [...paths] });
    }
    return { folders, rows: [...rows.values()] };
  }, [workspace, entities]);
  const sessions = React.useMemo(() => selectedPath ? history.rows.filter((row) => row.paths.includes(selectedPath)) : history.rows, [history, selectedPath]);
  const pageCount = Math.max(1, Math.ceil(sessions.length / 10));
  const page = Math.max(1, Math.min(filterChanged ? 1 : filter.page, pageCount));
  if (!filterChanged && filter.page !== page) setFilter({ ...filter, page });
  const pageSessions = sessions.slice((page - 1) * 10, page * 10);
  async function open(session: Session) {
    if (openingRef.current || !workspace) return;
    const captured = getRuntimeKey();
    const capturedWorkspaceId = workspace.id;
    const currentWorkspace = () => {
      const state = useWorkspacesStore.getState();
      if (captured !== getRuntimeKey() || isTransientRuntimeKey(captured) || state.runtimeKey !== captured
        || state.selectedWorkspaceId !== capturedWorkspaceId) throw new Error('Workspace selection changed');
      const saved = state.catalog.workspaces.find((entry) => entry.id === capturedWorkspaceId);
      if (!saved) throw new Error('Workspace no longer exists');
      return saved;
    };
    openingRef.current = true;
    setOpening(session.id);
    setOpenFailed(false);
    try {
      currentWorkspace();
      const scope = readWorkspaceScope(session.metadata);
      if (scope && scope.workspaceId !== capturedWorkspaceId) throw new Error('Session belongs to another workspace');
      const saved = scope ? session : await patchSessionMetadata(session.id, session.directory,
        (metadata) => bindWorkspaceAssignment(metadata, session, currentWorkspace()), captured);
      currentWorkspace();
      const reference = openSessionReference(saved);
      const result = await openSessionsStore.getState().openSession(reference);
      currentWorkspace();
      if (result.kind !== 'saved') { setOpenFailed(true); return; }
      useSessionUIStore.getState().setCurrentSession(saved.id, saved.directory, undefined, 'restore');
      useWorkspacesStore.getState().selectWorkspace(null);
      useUIStore.getState().closeMainSurfaces();
      useUIStore.getState().setSessionSwitcherOpen(false);
      window.dispatchEvent(new CustomEvent('openchamber:navigate', { detail: { view: 'chat' } }));
      mobileSidebarActions?.close();
    } catch {
      if (captured === getRuntimeKey() && useWorkspacesStore.getState().selectedWorkspaceId === capturedWorkspaceId) setOpenFailed(true);
    } finally {
      openingRef.current = false;
      setOpening(null);
    }
  }
  return function renderWorkspaceHistory() {
    return <SettingsSection title={t('workspaces.sessions')} contentClassName="space-y-1" headerAction={
      <select aria-label={t('workspaces.sessionsFolderFilter')} className={`${dropdownTriggerVariants()} max-w-[16rem] truncate [@media(pointer:coarse)]:min-h-11`} value={selectedPath} onChange={(event) => setFilter({ workspaceId, runtimeKey, path: event.currentTarget.value, page: 1 })}>
        <option value="">{t('workspaces.allFolders')}</option>
        {[...history.folders.values()].map((folder) => <option key={folder.path} value={folder.path}>{folder.label}</option>)}
      </select>
    }>
      {pageSessions.map(({ session, paths }) => <Button key={session.id} variant="ghost" className="h-auto w-full min-w-0 justify-start gap-2 [@media(pointer:coarse)]:min-h-11" disabled={opening !== null} onClick={() => void open(session)}>
        <span className="min-w-0 flex-1 space-y-1 text-start">
          <span dir="auto" className="oc-ui-start-align block truncate" title={session.title}>{session.title || t('sessions.sidebar.session.untitled')}</span>
          <span dir="auto" className="oc-ui-start-align block truncate typography-meta text-muted-foreground" title={paths.join('\n')}>{paths.map((path) => history.folders.get(path)?.name).join(' · ')}</span>
        </span>
        <FolderSessionActivity sessionId={session.id} />
        {!!session.time.archived && <span className="shrink-0 typography-meta text-muted-foreground">{t('mobile.sessions.search.section.archived')}</span>}
      </Button>)}
      {pageCount > 1 && <div className="flex items-center justify-between gap-2">
        <Button variant="outline" size="sm" className="[@media(pointer:coarse)]:min-h-11" disabled={page === 1} onClick={() => setFilter({ ...filter, page: Math.max(1, page - 1) })}>{t('workspaces.sessionsPreviousPage')}</Button>
        <span className="typography-meta text-muted-foreground" aria-live="polite">{t('workspaces.sessionsPage', { page, total: pageCount })}</span>
        <Button variant="outline" size="sm" className="[@media(pointer:coarse)]:min-h-11" disabled={page === pageCount} onClick={() => setFilter({ ...filter, page: Math.min(pageCount, page + 1) })}>{t('workspaces.sessionsNextPage')}</Button>
      </div>}
      <div className="flex min-h-6 items-center gap-2 typography-meta" aria-live="polite">
        {status === 'error' ? <><span className="text-[var(--status-error-text)]">{t('workspaces.folderSessionsError')}</span><Button variant="outline" size="sm" onClick={() => void useGlobalSessionsStore.getState().loadSessions()}>{t('directoryExplorerDialog.browse.retry')}</Button></>
          : status === 'loading' || !hasLoaded ? <span className="text-muted-foreground">{t('common.loading')}</span>
            : sessions.length === 0 ? <span className="text-muted-foreground">{t('workspaces.sessionsEmpty')}</span> : null}
      </div>
      <div className="min-h-6 typography-meta text-[var(--status-error-text)]" role="alert">{openFailed ? t('workspaces.openFailed') : ''}</div>
    </SettingsSection>;
  };
}
