import React from 'react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';
import { openSessionsStore, useOpenSessionsStore } from '@/stores/useOpenSessionsStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useUIStore } from '@/stores/useUIStore';
import { closeSessionTabAndActivateNeighbour } from '@/lib/sessionTabs';
import { OpenSessionCollection } from '../sidebar/list/OpenSessionCollection';
import { WorkspaceSurface } from './WorkspaceSurface';
import { getRuntimeKey, isTransientRuntimeKey } from '@/lib/runtime-switch';
import { formatWorkspaceLabel } from '@/lib/workspaces/display-name';
import { startSubagentMembershipCleanup } from '@/sync/subagent-membership';
import { WorkspaceCreateDialog } from './WorkspaceCreateDialog';

const INITIAL_COLORS = ['bg-primary', 'bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5'] as const;

// The first character of the name, whole even when it is an emoji or another surrogate pair.
// Colors follow list order, so neighbouring workspaces never share one until the palette runs out.
function WorkspaceInitial({ index, name }: { index: number; name: string }) {
  const initial = Array.from(name.trim())[0]?.toLocaleUpperCase() ?? '?';
  return (
    <span aria-hidden="true" className={`flex size-5 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-primary-foreground ${INITIAL_COLORS[index % INITIAL_COLORS.length]}`}>
      {initial}
    </span>
  );
}

export function WorkspaceNavigation({ onSelected, footer, pageButtons, inlineOverview = false }: {
  onSelected?: (id: string) => void;
  footer?: React.ReactNode;
  /** Sidebar page toggles shown in the navigation row. */
  pageButtons?: React.ReactNode;
  inlineOverview?: boolean;
}) {
  const { t } = useI18n();
  const catalog = useWorkspacesStore((state) => state.catalog);
  const status = useWorkspacesStore((state) => state.status);
  const selected = useWorkspacesStore((state) => state.selectedWorkspaceId);
  const sessions = useOpenSessionsStore((state) => state.sessions);
  const hydration = useOpenSessionsStore((state) => state.hydration);
  const runtimeKey = useOpenSessionsStore((state) => state.runtimeKey);
  const connected = useConfigStore((state) => state.isConnected);
  const currentId = useSessionUIStore((state) => state.currentSessionId);
  const openFailure = useSessionUIStore((state) => state.openSessionFailure);
  const [creating, setCreating] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => {
    if (connected && !isTransientRuntimeKey(getRuntimeKey())) void useWorkspacesStore.getState().load();
  }, [connected, runtimeKey]);
  React.useEffect(() => { setCreating(false); setFailed(false); }, [runtimeKey]);
  React.useEffect(() => startSubagentMembershipCleanup(), []);
  function selectSession(id: string) {
    const row = openSessionsStore.getState().sessions.find((entry) => entry.sessionId === id);
    if (!row) return;
    try {
      useWorkspacesStore.getState().selectWorkspace(null);
      useUIStore.getState().closeMainSurfaces();
      useSessionUIStore.getState().setCurrentSession(id, row.primaryDirectory, undefined, 'restore');
      window.dispatchEvent(new CustomEvent('openchamber:navigate', { detail: { view: 'chat' } }));
      onSelected?.(id);
    } catch { setFailed(true); }
  }
  return <div className="flex h-full min-h-0 flex-col text-foreground">
    {pageButtons ? <div className="flex shrink-0 items-center justify-end gap-2 p-2">{pageButtons}</div> : null}
    <div className="min-h-0 flex-1 overflow-hidden">
    <div className="h-full min-h-0 overflow-y-auto p-2">
      <section className="space-y-1 pb-5" aria-label={t('workspaces.title')}>
        <div className="flex items-center justify-between gap-2 ps-2">
          <h2 className="min-w-0 truncate typography-ui-label text-muted-foreground">{t('workspaces.title')}</h2>
          <Button variant="ghost" size="icon" className="text-muted-foreground" aria-label={t('workspaces.newWorkspace')} title={t('workspaces.newWorkspace')} disabled={status !== 'ready' && status !== 'failed'} onClick={() => { setFailed(false); setCreating(true); }}>
            <Icon name="add" className="size-4" />
          </Button>
        </div>
        {catalog.workspaces.map((workspace, index) => <Button key={workspace.id} variant="ghost" aria-label={formatWorkspaceLabel(workspace.name)} aria-pressed={selected === workspace.id} className={`w-full min-w-0 justify-start gap-2 ${selected === workspace.id ? 'bg-interactive-selection text-interactive-selection-foreground' : ''}`} onClick={() => {
          try { useUIStore.getState().closeMainSurfaces(); useWorkspacesStore.getState().selectWorkspace(workspace.id); }
          catch { setFailed(true); }
        }}><WorkspaceInitial index={index} name={formatWorkspaceLabel(workspace.name)} /><span dir="auto" className="truncate oc-ui-start-align" title={workspace.name}>{formatWorkspaceLabel(workspace.name)}</span></Button>)}
        {status === 'failed' && <Button variant="outline" onClick={() => void useWorkspacesStore.getState().load()}>{t('workspaces.actionFailed')} {t('directoryExplorerDialog.browse.retry')}</Button>}
      </section>
      <section className="space-y-1" aria-label={t('workspaces.openSessions')}>
        <h2 className="px-2 py-1 typography-ui-label text-muted-foreground">{t('workspaces.openSessions')}</h2>
        <OpenSessionCollection sessions={sessions} selectedId={selected ? null : currentId} onSelect={selectSession} onClose={(id, confirmation) => closeSessionTabAndActivateNeighbour(id, confirmation, false)} onReorder={(id, overId) => openSessionsStore.getState().reorderSession(id, overId)} onReopen={(reference) => openSessionsStore.getState().openSession(reference)} />
        {hydration === 'failed' && <Button variant="outline" onClick={() => void openSessionsStore.getState().hydrate(null)}>{t('workspaces.closeFailed')} {t('directoryExplorerDialog.browse.retry')}</Button>}
      </section>
      {openFailure && <div role="alert" className="space-y-2 typography-meta text-[var(--status-error-text)]">
        <span dir="auto">{openFailure.reference.title}</span>
        <p>{t('workspaces.openFailed')}</p>
        <Button variant="outline" disabled={pending} onClick={() => {
          setPending(true);
          const captured = getRuntimeKey();
          void openSessionsStore.getState().openSession(openFailure.reference).then((result) => {
            if (getRuntimeKey() !== captured) return;
            if (result.kind === 'saved') {
              useSessionUIStore.setState({ openSessionFailure: null });
              selectSession(openFailure.reference.sessionId);
            }
          }).finally(() => setPending(false));
        }}>{t('directoryExplorerDialog.browse.retry')}</Button>
      </div>}
    </div>
    </div>
    {footer}
    <div role="alert" className="min-h-6 px-2 typography-meta text-[var(--status-error-text)]">{failed ? t('workspaces.actionFailed') : ''}</div>
    <WorkspaceCreateDialog open={creating} onOpenChange={setCreating} onCreated={(workspaceId) => useWorkspacesStore.getState().selectWorkspace(workspaceId)} />
    {inlineOverview && <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) useWorkspacesStore.getState().selectWorkspace(null); }}>
      <DialogContent className="max-w-3xl"><DialogTitle>{catalog.workspaces.find((workspace) => workspace.id === selected)?.name}</DialogTitle><WorkspaceSurface /></DialogContent>
    </Dialog>}
  </div>;
}
