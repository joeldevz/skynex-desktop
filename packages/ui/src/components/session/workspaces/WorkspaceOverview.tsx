import React, { useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PauseClock } from '@/components/ui/pause-clock';
import { Icon } from '@/components/icon/Icon';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SettingsSection, SettingsStackedField } from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import type { Workspace, WorkspaceDefaults, WorkspacePatch } from '@/lib/workspaces/model';
import type { FolderSelection } from '@/lib/workspaces/session-scope';
import { normalizePath } from '@/lib/pathNormalization';
import { GeneralWorkspaceUnavailableError } from '@/lib/workspaces/general-chat-preparation';

export interface WorkspaceOverviewProps {
  workspace: Workspace;
  onUpdate(patch: WorkspacePatch): Promise<void>;
  onCreateSession(selection: FolderSelection, defaults: WorkspaceDefaults): Promise<void>;
  onOpenScheduledTasks?(): void;
  scheduledTasksOpen?: boolean;
  /** Opens the Issues and PRs board on this workspace; without it the tab is not offered. */
  onOpenSourceBoard?(): void;
  sourceBoardOpen?: boolean;
  onAddFolders(): Promise<void>;
  onUnlinkFolder?(folderId: string): Promise<void>;
  onDelete?(): Promise<void>;
  renderWorkspaceHistory?(): React.ReactNode;
}

export function WorkspaceOverview(props: WorkspaceOverviewProps) {
  return <WorkspaceEditor key={props.workspace.id} {...props} />;
}

function WorkspaceEditor({ workspace, onUpdate, onCreateSession, onOpenScheduledTasks, scheduledTasksOpen = false, onOpenSourceBoard, sourceBoardOpen = false, onAddFolders, onUnlinkFolder, onDelete, renderWorkspaceHistory }: WorkspaceOverviewProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState('home');
  const [draft, setDraft] = useState(workspace);
  const [basis, setBasis] = useState(workspace);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => Promise<void>) | null>(null);
  const [folderFallbackNeeded, setFolderFallbackNeeded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (basis !== workspace) {
    const priorFolders = new Map(basis.folders.map((folder) => [folder.id, folder]));
    const draftFolders = new Map(draft.folders.map((folder) => [folder.id, folder]));
    setBasis(workspace);
    setDraft({
      ...workspace,
      name: draft.name === basis.name ? workspace.name : draft.name,
      description: draft.description === basis.description ? workspace.description : draft.description,
      folders: workspace.folders.map((folder) => {
        const previous = priorFolders.get(folder.id);
        const edited = draftFolders.get(folder.id);
        return previous && edited && previous.role !== edited.role ? { ...folder, role: edited.role } : folder;
      }),
    });
  }
  async function perform(action: () => Promise<void>, retryable = true) {
    if (pending) return;
    setPending(true);
    setError(null);
    try { await action(); setRetryAction(null); } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('workspaces.actionFailed'));
      setRetryAction(retryable ? () => action : null);
    } finally { setPending(false); }
  }
  const saveDraft = () => perform(() => onUpdate({ name: draft.name, description: draft.description, folders: draft.folders }), false);
  const retry = () => retryAction ? perform(retryAction) : saveDraft();
  const createSession = (selection: FolderSelection) => perform(async () => {
    setFolderFallbackNeeded(false);
    try {
      await onCreateSession(selection, workspace.defaults);
    } catch (failure) {
      setFolderFallbackNeeded(selection.kind === 'workspace' && failure instanceof GeneralWorkspaceUnavailableError);
      throw failure;
    }
  });
  React.useEffect(() => {
    if (!scheduledTasksOpen && activeTab === 'scheduledTasks') setActiveTab('home');
    if (!sourceBoardOpen && activeTab === 'sourceBoard') setActiveTab('home');
  }, [activeTab, scheduledTasksOpen, sourceBoardOpen]);
  return (
    <div className="@container mx-auto w-full max-w-3xl space-y-6 px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex items-center justify-between gap-4">
        <h1 dir="auto" className="oc-ui-start-align min-w-0 truncate typography-settings-page-title text-foreground" title={workspace.name}>{workspace.name}</h1>
        <div className="flex shrink-0 items-center gap-2">
         <Button variant="outline" aria-label={t('sessions.sidebar.header.actions.newSession')} disabled={pending || workspace.folders.length === 0} onClick={() => void createSession({ kind: 'workspace' })}><Icon name="add" className="size-4 @md:hidden" /><span className="sr-only @md:not-sr-only">{t('sessions.sidebar.header.actions.newSession')}</span></Button>
        <Button disabled={pending || !draft.name.trim()} onClick={() => void saveDraft()}>{t('projectEditDialog.actions.save')}</Button>
        {onDelete && <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" disabled={pending} aria-label={t('workspaces.moreActions')}><Icon name="more" className="size-4" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" disabled={pending} onSelect={() => { setError(null); setConfirmDelete(true); }}><Icon name="delete-bin" className="size-4" />{t('workspaces.delete')}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>}
        </div>
      </div>
      <Tabs.Root value={activeTab} onValueChange={(value) => {
        const nextTab = value ?? 'home';
        setActiveTab(nextTab);
        if (nextTab === 'scheduledTasks') onOpenScheduledTasks?.();
        if (nextTab === 'sourceBoard') onOpenSourceBoard?.();
      }} className="space-y-4">
        <Tabs.List activateOnFocus aria-label={t('sortableTabsStrip.aria.tabs')} className="pill-tabs__track oc-recessed flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] p-0.5">
            {[
              { value: 'home', label: t('workspaces.home') },
              { value: 'folders', label: t('workspaces.folders') },
              ...(renderWorkspaceHistory ? [{ value: 'sessions', label: t('workspaces.sessions') }] : []),
            ].map(({ value, label }) => <Tabs.Tab key={value} value={value} className="pill-tabs__button h-7 shrink-0 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground hover:text-foreground data-[active]:oc-raised data-[active]:bg-[var(--surface-background)] data-[active]:text-foreground dark:data-[active]:bg-[var(--surface-elevated)] [@media(pointer:coarse)]:min-h-11">{label}</Tabs.Tab>)}
          {onOpenScheduledTasks && <Tabs.Tab value="scheduledTasks" className="pill-tabs__button h-7 shrink-0 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground hover:text-foreground data-[active]:oc-raised data-[active]:bg-[var(--surface-background)] data-[active]:text-foreground dark:data-[active]:bg-[var(--surface-elevated)] [@media(pointer:coarse)]:min-h-11">{t('sessions.scheduledTasks.dialog.title')}</Tabs.Tab>}
          {onOpenSourceBoard && <Tabs.Tab value="sourceBoard" className="pill-tabs__button h-7 shrink-0 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground hover:text-foreground data-[active]:oc-raised data-[active]:bg-[var(--surface-background)] data-[active]:text-foreground dark:data-[active]:bg-[var(--surface-elevated)] [@media(pointer:coarse)]:min-h-11">{t('sourceBoard.title')}</Tabs.Tab>}
        </Tabs.List>
        <Tabs.Panel value="home" keepMounted className="data-[hidden]:hidden">
      <SettingsSection divider={false} contentClassName="space-y-4">
        <SettingsStackedField label={t('workspaces.name')} controlClassName="max-w-none">
          <Input aria-label={t('workspaces.name')} dir="auto" value={draft.name} disabled={pending} onInput={(event) => setDraft({ ...draft, name: event.currentTarget.value })} />
        </SettingsStackedField>
        <SettingsStackedField label={t('settings.common.field.description')} controlClassName="max-w-none">
          <textarea aria-label={t('settings.common.field.description')} dir="auto" rows={4} className="oc-raised oc-field w-full resize-y rounded-md p-3 typography-ui-label" value={draft.description} disabled={pending} onInput={(event) => setDraft({ ...draft, description: event.currentTarget.value })} />
        </SettingsStackedField>
      </SettingsSection>
        </Tabs.Panel>
        {renderWorkspaceHistory && <Tabs.Panel value="sessions" keepMounted className="data-[hidden]:hidden" render={(panelProps, { hidden }) => <div {...panelProps}><PauseClock paused={hidden}>{panelProps.children}</PauseClock></div>}>
          {renderWorkspaceHistory()}
        </Tabs.Panel>}
        <Tabs.Panel value="folders" keepMounted className="data-[hidden]:hidden">
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
            {draft.folders.map((folder) => {
              const name = normalizePath(folder.path)?.split('/').filter(Boolean).at(-1) || folder.path;
              return <div key={folder.id} className="oc-tile flex min-w-0 flex-col gap-2 rounded-xl p-3">
                <div className="flex min-w-0 items-start gap-2.5" title={folder.path}>
                  <span className="oc-tile-inset flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground"><Icon name="folder" className="size-4" /></span>
                  <div className="min-w-0 flex-1">
                    <div dir="auto" className="oc-ui-start-align truncate typography-ui-label text-foreground">{name}</div>
                    <div dir="ltr" className="truncate typography-meta text-muted-foreground">{folder.path}</div>
                  </div>
                </div>
                <Input aria-label={t('workspaces.folderDescription')} placeholder={t('workspaces.folderDescription')} dir="auto" value={folder.role} disabled={pending} onInput={(event) => { const role = event.currentTarget.value; setDraft({ ...draft, folders: draft.folders.map((entry) => entry.id === folder.id ? { ...entry, role } : entry) }); }} />
                <div className="flex items-center justify-between gap-1">
                  <Button variant="ghost" size="sm" className="-ms-2 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:min-h-11" disabled={pending || !workspace.folders.some((entry) => entry.id === folder.id)} aria-label={t('sessions.sidebar.header.actions.newSession')} onClick={() => void createSession({ kind: 'folder', folderId: folder.id })}><Icon name="add" className="size-4" />{t('sessions.sidebar.header.actions.newSession')}</Button>
                  <Button variant="ghost" size="sm" className="-me-2 text-muted-foreground hover:text-foreground [@media(pointer:coarse)]:min-h-11" disabled={pending || !onUnlinkFolder} aria-label={t('workspaces.unlinkFolder')} title={t('workspaces.unlinkKeepsFiles')} onClick={() => { if (onUnlinkFolder) void perform(() => onUnlinkFolder(folder.id)); }}>{t('workspaces.unlinkFolder')}</Button>
                </div>
              </div>;
            })}
            <button type="button" disabled={pending} onClick={() => void perform(onAddFolders)} className="flex min-h-32 items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--interactive-border)] typography-ui-label text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50 [@media(pointer:coarse)]:min-h-11">
              <Icon name="folder-add" className="size-4" />{t('workspaces.addFolders')}
            </button>
          </div>
        </Tabs.Panel>
        <Tabs.Panel value="scheduledTasks" keepMounted className="data-[hidden]:hidden" />
        {onOpenSourceBoard && <Tabs.Panel value="sourceBoard" keepMounted className="data-[hidden]:hidden" />}
      </Tabs.Root>
      <div className="min-h-6 typography-meta text-[var(--status-error-text)]" role="alert">{error}</div>
      {folderFallbackNeeded ? <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t('workspaces.folderFallback')}>
        <span className="typography-meta text-muted-foreground">{t('workspaces.folderFallback')}</span>
        {workspace.folders.map((folder) => {
          const name = normalizePath(folder.path)?.split('/').filter(Boolean).at(-1) || folder.path;
          return <Button key={folder.id} variant="outline" size="sm" disabled={pending} onClick={() => void createSession({ kind: 'folder', folderId: folder.id })}>{t('workspaces.startChatInFolder', { folder: name })}</Button>;
        })}
      </div> : null}
      {error && <Button variant="link" size="sm" disabled={pending} onClick={() => void retry()}>{t('directoryExplorerDialog.browse.retry')}</Button>}
      {onDelete && <Dialog open={confirmDelete} onOpenChange={(open) => { if (!pending) { setConfirmDelete(open); setError(null); } }}>
        <DialogContent showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle>{t('workspaces.delete')}</DialogTitle>
            <DialogDescription className="break-words">{t('workspaces.deleteDescription', { name: workspace.name })}</DialogDescription>
          </DialogHeader>
          <div className="min-h-6 typography-meta text-[var(--status-error-text)]" role="alert">{error}</div>
          <DialogFooter>
            <Button variant="outline" disabled={pending} autoFocus onClick={() => { setConfirmDelete(false); setError(null); }}>{t('dialog.common.actions.cancel')}</Button>
            <Button variant="destructive" disabled={pending} onClick={() => void perform(async () => { await onDelete(); setConfirmDelete(false); })}>{t('settings.common.actions.delete')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
    </div>
  );
}
