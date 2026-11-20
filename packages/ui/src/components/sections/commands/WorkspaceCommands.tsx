import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Icon } from '@/components/icon/Icon';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { CommandsScopeSelector } from './CommandsScopeSelector';
import { SettingsSection, SettingsFieldRow, SettingsStackedField, SETTINGS_SECTION_TITLE_CLASS } from '@/components/sections/shared/SettingsSection';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { toast } from '@/components/ui';
import { SettingsSidebarSearch, SettingsSidebarNoMatches } from '@/components/sections/shared/SettingsSidebarSearch';
import { matchesRankQuery } from '@/lib/search/fuzzySearch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { workspaceCommandSchema } from '@/lib/workspaces/schema';
import type { Workspace, WorkspaceCommand } from '@/lib/workspaces/model';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';
import { useCommandSettingsScope } from './commandSettingsScope';
import { useAutosave, AUTOSAVE_SAVED, AUTOSAVE_UNCHANGED, autosaveFailed, type AutosaveResult } from '../shared/SettingsAutosave';

const workspaceCommandQueues = new Map<string, Promise<void>>();

function serializeWorkspaceCommandWrite(workspaceId: string, update: (commands: readonly WorkspaceCommand[]) => readonly WorkspaceCommand[] | null): Promise<boolean> {
  const runtimeKey = getRuntimeKey();
  const queueKey = JSON.stringify([runtimeKey, workspaceId]);
  const previous = workspaceCommandQueues.get(queueKey) ?? Promise.resolve();
  const next = previous.then(async () => {
    const state = useWorkspacesStore.getState();
    if (runtimeKey !== getRuntimeKey() || state.runtimeKey !== runtimeKey) return false;
    const workspace = state.catalog.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace) return false;
    const nextCommands = update(workspace.commands ?? []);
    if (nextCommands === null) return false;
    const commands = nextCommands.map((command) => workspaceCommandSchema.parse(command));
    return (await state.update(workspaceId, { commands })).kind === 'saved' && runtimeKey === getRuntimeKey();
  });
  const tail = next.then(() => undefined, () => undefined);
  workspaceCommandQueues.set(queueKey, tail);
  void tail.then(() => { if (workspaceCommandQueues.get(queueKey) === tail) workspaceCommandQueues.delete(queueKey); });
  return next;
}

interface WorkspaceCommandsSidebarProps {
  workspace: Workspace;
  onItemSelect?: () => void;
}

export const WorkspaceCommandsSidebar: React.FC<WorkspaceCommandsSidebarProps> = ({ workspace, onItemSelect }) => {
  const { t } = useI18n();
  const selectedCommandName = useCommandSettingsScope((state) => state.commandName);
  const setCommandName = useCommandSettingsScope((state) => state.selectCommand);
  const commands = workspace.commands ?? [];
  const [deleteTarget, setDeleteTarget] = React.useState<{ workspaceId: string; command: WorkspaceCommand } | null>(null);
  const [query, setQuery] = React.useState('');

  const createCommand = () => {
    let name = 'new-command';
    let index = 1;
    while (commands.some((command) => command.name === name)) name = `new-command-${index++}`;
    setCommandName(name);
    onItemSelect?.();
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { workspaceId, command } = deleteTarget;
    const success = await serializeWorkspaceCommandWrite(workspaceId, (current) => current.some((entry) => entry.name === command.name) ? current.filter((entry) => entry.name !== command.name) : null);
    if (success && useCommandSettingsScope.getState().workspaceId === workspaceId && useCommandSettingsScope.getState().commandName === command.name) setCommandName(null);
    if (success) {
      setDeleteTarget(null);
      toast.success(t('settings.commands.sidebar.toast.commandDeleted', { name: command.name }));
    } else toast.error(t('settings.commands.sidebar.toast.deleteFailed'));
  };

  return <div className="flex h-full flex-col bg-background">
    <div className="border-b px-3 pb-3 pt-4">
      <h2 className={`${SETTINGS_SECTION_TITLE_CLASS} mb-3`}>{t('settings.commands.sidebar.title')}</h2>
      <CommandsScopeSelector className="mb-3" />
      <div className="flex items-center justify-between gap-2">
        <span className="typography-meta text-muted-foreground">{t('settings.commands.sidebar.total', { count: commands.length })}</span>
        <Button size="sm" variant="ghost" className="h-7 w-7 px-0 text-muted-foreground" aria-label={t('settings.common.actions.create')} onClick={createCommand}>
          <Icon name="add" className="size-4" />
        </Button>
      </div>
      {commands.length > 0 ? <SettingsSidebarSearch value={query} onChange={setQuery} /> : null}
    </div>
    <ScrollableOverlay outerClassName="min-h-0 flex-1" className="space-y-1 px-3 py-2">
      {commands.length === 0 ? <div className="py-12 px-4 text-center text-muted-foreground">
        <p className="typography-ui-label font-medium">{t('settings.commands.sidebar.empty.title')}</p>
        <p className="mt-1 typography-meta">{t('settings.commands.sidebar.empty.description')}</p>
      </div> : commands.filter((command) => matchesRankQuery([command.name, command.description], query)).map((command) => <div key={command.name} className="flex items-center gap-2 rounded-md px-2 py-1.5">
        <button type="button" className={`min-w-0 flex-1 truncate text-start typography-ui-label ${selectedCommandName === command.name ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`} onClick={() => { setCommandName(command.name); onItemSelect?.(); }}>{command.name}</button>
        <Button size="icon" variant="ghost" aria-label={t('settings.common.actions.delete')} onClick={() => setDeleteTarget({ workspaceId: workspace.id, command })}><Icon name="delete-bin" className="size-4" /></Button>
      </div>)}
      {commands.length > 0 && commands.filter((command) => matchesRankQuery([command.name, command.description], query)).length === 0 ? <SettingsSidebarNoMatches query={query} /> : null}
    </ScrollableOverlay>
    <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('settings.commands.sidebar.dialog.deleteTitle')}</DialogTitle>
          <DialogDescription>{t('settings.commands.sidebar.dialog.deleteDescription', { name: deleteTarget?.command.name ?? '' })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => setDeleteTarget(null)}>{t('settings.common.actions.cancel')}</Button>
          <Button size="sm" variant="destructive" onClick={() => void confirmDelete()}>{t('settings.common.actions.delete')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
};

interface WorkspaceCommandsPageProps {
  workspace: Workspace;
}

export const WorkspaceCommandsPage: React.FC<WorkspaceCommandsPageProps> = ({ workspace }) => {
  const { t } = useI18n();
  const commandName = useCommandSettingsScope((state) => state.commandName);
  const setCommandName = useCommandSettingsScope((state) => state.selectCommand);
  const commands = workspace.commands ?? [];
  const command = commands.find((entry) => entry.name === commandName) ?? null;
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [template, setTemplate] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const identity = JSON.stringify([workspace.id, commandName]);
  const identityRef = React.useRef(identity);
  const baseline = React.useRef<{ name: string; description: string; template: string } | null>(null);
  const pendingRef = React.useRef<{ identity: string; form: { name: string; description: string; template: string } } | null>(null);

  React.useEffect(() => {
    const sameIdentity = identityRef.current === identity;
    identityRef.current = identity;
    const next = command ? { name: command.name, description: command.description ?? '', template: command.template } : { name: commandName ?? '', description: '', template: '' };
    const pending = pendingRef.current;
    if (sameIdentity && [baseline.current, pending?.identity === identity ? pending.form : null].some((saved) => saved && saved.name === next.name && saved.description === next.description && saved.template === next.template)) return;
    setName(next.name);
    setDescription(next.description);
    setTemplate(next.template);
    baseline.current = next;
  }, [command, commandName, identity]);

  const save = React.useCallback(async (): Promise<AutosaveResult> => {
    const saved = baseline.current;
    if (!command || !saved || identityRef.current !== identity) return AUTOSAVE_UNCHANGED;
    if (name === saved.name && description === saved.description && template === saved.template) return AUTOSAVE_UNCHANGED;
    const currentWorkspace = useWorkspacesStore.getState().catalog.workspaces.find((entry) => entry.id === workspace.id);
    if (name !== command.name && currentWorkspace?.commands?.some((entry) => entry.name === name)) return autosaveFailed(t('settings.commands.sidebar.toast.commandExists'));
    const parsed = workspaceCommandSchema.safeParse({ name: name.trim(), description: description || undefined, template });
    if (!parsed.success) return autosaveFailed(parsed.error.issues[0]?.message ?? t('settings.commands.page.toast.updateFailed'));
    const capturedIdentity = identity;
    const pending = { identity: capturedIdentity, form: { name: parsed.data.name, description: parsed.data.description ?? '', template: parsed.data.template } };
    pendingRef.current = pending;
    try {
      const success = await serializeWorkspaceCommandWrite(workspace.id, (current) => current.some((entry) => entry.name === command.name) && !current.some((entry) => entry.name === parsed.data.name && entry.name !== command.name) ? current.map((entry) => entry.name === command.name ? parsed.data : entry) : null);
      if (!success) return autosaveFailed(t('settings.commands.page.toast.updateFailed'));
      if (identityRef.current === capturedIdentity) {
        baseline.current = pending.form;
        if (command.name !== parsed.data.name && useCommandSettingsScope.getState().workspaceId === workspace.id) setCommandName(parsed.data.name);
      }
      return AUTOSAVE_SAVED;
    } finally {
      if (pendingRef.current === pending) pendingRef.current = null;
    }
  }, [command, description, identity, name, setCommandName, t, template, workspace.id]);
  const autosave = useAutosave(save);

  if (!commandName) return <div className="flex h-full items-center justify-center typography-ui-label text-muted-foreground">{t('settings.commands.page.empty.title')}</div>;
  const isNew = !command;
  const handleCreate = async () => {
    const commandName = name.trim().replace(/\s+/gu, '-').toLowerCase();
    const parsed = workspaceCommandSchema.safeParse({ name: commandName, description: description.trim() || undefined, template });
    if (!parsed.success) {
      toast.error(!template.trim() ? t('settings.commands.page.toast.templateRequired') : t('settings.commands.page.toast.createFailed'));
      return;
    }
    if (commands.some((entry) => entry.name === parsed.data.name)) {
      toast.error(t('settings.commands.sidebar.toast.commandExists'));
      return;
    }
    setCreating(true);
    try {
      const success = await serializeWorkspaceCommandWrite(workspace.id, (current) => current.some((entry) => entry.name === parsed.data.name) ? null : [...current, parsed.data]);
      if (success && identityRef.current === identity && useCommandSettingsScope.getState().workspaceId === workspace.id) {
        baseline.current = { name: parsed.data.name, description: parsed.data.description ?? '', template: parsed.data.template };
        setCommandName(parsed.data.name);
      }
      if (success) toast.success(t('settings.commands.page.toast.created'));
      else toast.error(t('settings.commands.page.toast.createFailed'));
    } catch {
      toast.error(t('settings.commands.page.toast.createFailed'));
    } finally { setCreating(false); }
  };
  const handleCancel = () => setCommandName(null);

  return <SettingsPageLayout title={isNew ? t('settings.commands.page.title.new') : `/${name}`} description={t('settings.commands.page.subtitle.edit')} onBlurCapture={autosave.onBlurCapture}>
    <SettingsSection title={t('settings.commands.page.section.identity')} divider={false} contentClassName="space-y-0">
      <SettingsFieldRow label={t('settings.commands.page.field.commandName')}><Input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('settings.commands.page.field.commandNamePlaceholder')} className="h-8 w-48 px-3" /></SettingsFieldRow>
      <SettingsStackedField label={t('settings.common.field.description')} controlClassName="max-w-none">
        <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t('settings.commands.page.field.descriptionPlaceholder')} rows={2} className="w-full resize-none" />
      </SettingsStackedField>
    </SettingsSection>
    <SettingsSection title={t('settings.commands.page.section.template')}>
      <Textarea value={template} onChange={(event) => setTemplate(event.target.value)} rows={12} className="w-full font-mono typography-meta min-h-[160px] max-h-[60vh]" />
      <p className="mt-2 typography-meta text-muted-foreground"><code className="text-foreground">$ARGUMENTS</code> {t('settings.commands.page.templateHint.userInput')}</p>
      {isNew && <div className="flex items-center gap-2 pt-3">
        <Button size="sm" disabled={creating || !name.trim() || !template.trim()} onClick={() => void handleCreate()}>{t('settings.common.actions.create')}</Button>
        <Button size="sm" variant="ghost" disabled={creating} onClick={handleCancel}>{t('settings.common.actions.cancel')}</Button>
      </div>}
    </SettingsSection>
  </SettingsPageLayout>;
};
