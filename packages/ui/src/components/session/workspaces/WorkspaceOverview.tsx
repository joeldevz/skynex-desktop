import React, { useState } from 'react';
import { Tabs } from '@base-ui/react/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PauseClock } from '@/components/ui/pause-clock';
import { Icon } from '@/components/icon/Icon';
import { dropdownTriggerVariants } from '@/components/ui/dropdown-trigger';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SettingsSection, SettingsStackedField } from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import type { Workspace, WorkspaceDefaults, WorkspacePatch } from '@/lib/workspaces/model';
import type { FolderSelection } from '@/lib/workspaces/session-scope';
import { normalizePath } from '@/lib/pathNormalization';

export interface WorkspaceOverviewProps {
  workspace: Workspace;
  models: readonly { label: string; value: NonNullable<WorkspaceDefaults['model']> }[];
  agents: readonly { label: string; value: string }[];
  onUpdate(patch: WorkspacePatch): Promise<void>;
  onCreateSession(selection: FolderSelection, defaults: WorkspaceDefaults): Promise<void>;
  onOpenScheduledTasks?(): void;
  scheduledTasksOpen?: boolean;
  onAddFolders(): Promise<void>;
  onUnlinkFolder?(folderId: string): Promise<void>;
  onDelete?(): Promise<void>;
  renderWorkspaceHistory?(): React.ReactNode;
}

export function WorkspaceOverview(props: WorkspaceOverviewProps) {
  return <WorkspaceEditor key={props.workspace.id} {...props} />;
}

function WorkspaceEditor({ workspace, models, agents, onUpdate, onCreateSession, onOpenScheduledTasks, scheduledTasksOpen = false, onAddFolders, onUnlinkFolder, onDelete, renderWorkspaceHistory }: WorkspaceOverviewProps) {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState('home');
  const [draft, setDraft] = useState(workspace);
  const [basis, setBasis] = useState(workspace);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (basis !== workspace) {
    const priorFolders = new Map(basis.folders.map((folder) => [folder.id, folder]));
    const draftFolders = new Map(draft.folders.map((folder) => [folder.id, folder]));
    setBasis(workspace);
    setDraft({
      ...workspace,
      name: draft.name === basis.name ? workspace.name : draft.name,
      description: draft.description === basis.description ? workspace.description : draft.description,
      defaults: JSON.stringify(draft.defaults) === JSON.stringify(basis.defaults) ? workspace.defaults : draft.defaults,
      folders: workspace.folders.map((folder) => {
        const previous = priorFolders.get(folder.id);
        const edited = draftFolders.get(folder.id);
        return previous && edited && previous.role !== edited.role ? { ...folder, role: edited.role } : folder;
      }),
    });
  }
  async function perform(action: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError(null);
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : t('workspaces.actionFailed')); } finally { setPending(false); }
  }
  const modelIndex = models.findIndex(({ value }) => value.providerID === draft.defaults.model?.providerID && value.id === draft.defaults.model?.id);
  React.useEffect(() => {
    if (!scheduledTasksOpen && activeTab === 'scheduledTasks') setActiveTab('home');
  }, [activeTab, scheduledTasksOpen]);
  return (
    <div className="@container mx-auto w-full max-w-3xl space-y-6 px-5 py-8 sm:px-8 sm:py-12">
      <div className="flex items-center justify-between gap-4">
        <h1 dir="auto" className="oc-ui-start-align min-w-0 truncate typography-settings-page-title text-foreground" title={workspace.name}>{workspace.name}</h1>
        <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" aria-label={t('sessions.sidebar.header.actions.newSession')} disabled={pending || workspace.folders.length === 0} onClick={() => void perform(() => onCreateSession({ kind: 'workspace' }, workspace.defaults))}><Icon name="add" className="size-4 @md:hidden" /><span className="sr-only @md:not-sr-only">{t('sessions.sidebar.header.actions.newSession')}</span></Button>
        <Button disabled={pending || !draft.name.trim()} onClick={() => void perform(() => onUpdate({ name: draft.name, description: draft.description, folders: draft.folders, defaults: draft.defaults }))}>{t('projectEditDialog.actions.save')}</Button>
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
      }} className="space-y-4">
        <Tabs.List activateOnFocus aria-label={t('sortableTabsStrip.aria.tabs')} className="pill-tabs__track oc-recessed flex w-fit max-w-full gap-0.5 overflow-x-auto rounded-lg bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] p-0.5">
          {[
            { value: 'home', label: t('workspaces.home') },
            { value: 'folders', label: t('workspaces.folders') },
            { value: 'sessions', label: t('workspaces.sessions') },
          ].map(({ value, label }) => <Tabs.Tab key={value} value={value} className="pill-tabs__button h-7 shrink-0 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground hover:text-foreground data-[active]:oc-raised data-[active]:bg-[var(--surface-background)] data-[active]:text-foreground dark:data-[active]:bg-[var(--surface-elevated)] [@media(pointer:coarse)]:min-h-11">{label}</Tabs.Tab>)}
          <Tabs.Tab value="scheduledTasks" className="pill-tabs__button h-7 shrink-0 whitespace-nowrap rounded-md px-3 text-sm font-medium text-muted-foreground hover:text-foreground data-[active]:oc-raised data-[active]:bg-[var(--surface-background)] data-[active]:text-foreground dark:data-[active]:bg-[var(--surface-elevated)] [@media(pointer:coarse)]:min-h-11">{t('sessions.scheduledTasks.dialog.title')}</Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="home" keepMounted className="data-[hidden]:hidden">
      <SettingsSection divider={false} contentClassName="space-y-4">
        <SettingsStackedField label={t('workspaces.name')} controlClassName="max-w-none">
          <Input aria-label={t('workspaces.name')} dir="auto" value={draft.name} disabled={pending} onInput={(event) => setDraft({ ...draft, name: event.currentTarget.value })} />
        </SettingsStackedField>
        <SettingsStackedField label={t('settings.common.field.description')} controlClassName="max-w-none">
          <textarea aria-label={t('settings.common.field.description')} dir="auto" rows={4} className="oc-raised oc-field w-full resize-y rounded-md p-3 typography-ui-label" value={draft.description} disabled={pending} onInput={(event) => setDraft({ ...draft, description: event.currentTarget.value })} />
        </SettingsStackedField>
        <div className="grid min-w-0 grid-cols-1 gap-6 @md:grid-cols-2">
        <SettingsStackedField label={t('settings.openchamber.defaults.field.defaultModel')}>
          <select aria-label={t('settings.openchamber.defaults.field.defaultModel')} className={dropdownTriggerVariants()} value={modelIndex < 0 ? '' : String(modelIndex)} disabled={pending} onChange={(event) => setDraft({ ...draft, defaults: { ...draft.defaults, model: event.currentTarget.value === '' ? undefined : models[Number(event.currentTarget.value)]?.value } })}>
            <option value="">{t('workspaces.inherit')}</option>
            {models.map((model, index) => <option key={index} value={String(index)}>{model.label}</option>)}
          </select>
        </SettingsStackedField>
        <SettingsStackedField label={t('settings.openchamber.defaults.field.defaultAgent')}>
          <select aria-label={t('settings.openchamber.defaults.field.defaultAgent')} className={dropdownTriggerVariants()} value={draft.defaults.agent ?? ''} disabled={pending} onChange={(event) => setDraft({ ...draft, defaults: { ...draft.defaults, agent: event.currentTarget.value || undefined } })}>
            <option value="">{t('workspaces.inherit')}</option>
            {agents.map((agent) => <option key={agent.value} value={agent.value}>{agent.label}</option>)}
          </select>
        </SettingsStackedField>
        </div>
      </SettingsSection>
        </Tabs.Panel>
        <Tabs.Panel value="folders" keepMounted className="data-[hidden]:hidden">
      <SettingsSection divider={false} title={t('workspaces.folders')} headerAction={<Button variant="outline" size="sm" disabled={pending} onClick={() => void perform(onAddFolders)}><Icon name="add" className="size-4" />{t('workspaces.addFolders')}</Button>} contentClassName="space-y-5">
        {draft.folders.length === 0 && <div className="oc-tile rounded-lg p-6">
          <p className="flex items-center gap-2 typography-ui-label text-muted-foreground"><Icon name="folder" className="size-4" />{t('workspaces.existingFolders')}</p>
        </div>}
        {draft.folders.map((folder) => <div key={folder.id} className="oc-tile min-w-0 space-y-3 rounded-lg p-3">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <h3 dir="auto" className="oc-ui-start-align min-w-0 truncate typography-ui-label"><Icon name="folder" className="me-2 inline size-4" />{normalizePath(folder.path)?.split('/').filter(Boolean).at(-1) || folder.path}</h3>
            <div className="flex shrink-0 gap-1">
              <Button variant="ghost" size="sm" className="[@media(pointer:coarse)]:min-h-11" disabled={pending || !onUnlinkFolder} aria-label={t('workspaces.unlinkFolder')} title={t('workspaces.unlinkKeepsFiles')} onClick={() => { if (onUnlinkFolder) void perform(() => onUnlinkFolder(folder.id)); }}>{t('workspaces.unlinkFolder')}</Button>
              <Button variant="outline" size="sm" className="[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11" disabled={pending || !workspace.folders.some((entry) => entry.id === folder.id)} aria-label={t('sessions.sidebar.header.actions.newSession')} title={t('sessions.sidebar.header.actions.newSession')} onClick={() => void perform(() => onCreateSession({ kind: 'folder', folderId: folder.id }, workspace.defaults))}><Icon name="add" className="size-4" /></Button>
            </div>
          </div>
          <p dir="ltr" className="truncate typography-meta text-muted-foreground" title={folder.path}>{folder.path}</p>
          <SettingsStackedField label={t('workspaces.folderDescription')} controlClassName="max-w-none">
            <Input aria-label={t('workspaces.folderDescription')} dir="auto" value={folder.role} disabled={pending} onInput={(event) => { const role = event.currentTarget.value; setDraft({ ...draft, folders: draft.folders.map((entry) => entry.id === folder.id ? { ...entry, role } : entry) }); }} />
          </SettingsStackedField>
          <p className="typography-meta text-muted-foreground">{t('workspaces.unlinkKeepsFiles')}</p>
        </div>)}
      </SettingsSection>
        </Tabs.Panel>
        <Tabs.Panel value="sessions" keepMounted className="data-[hidden]:hidden" render={(panelProps, { hidden }) => <div {...panelProps}><PauseClock paused={hidden}>{panelProps.children}</PauseClock></div>}>
          {renderWorkspaceHistory?.()}
        </Tabs.Panel>
        <Tabs.Panel value="scheduledTasks" keepMounted className="data-[hidden]:hidden" />
      </Tabs.Root>
      <div className="min-h-6 typography-meta text-[var(--status-error-text)]" role="alert">{error}</div>
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
