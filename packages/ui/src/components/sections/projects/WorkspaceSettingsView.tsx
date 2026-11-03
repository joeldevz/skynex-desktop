import React from 'react';
import { WorkspaceOverview } from '@/components/session/workspaces/WorkspaceOverview';
import { DirectoryExplorerDialog } from '@/components/session/DirectoryExplorerDialog';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';
import { useConfigStore, selectProvidersForDirectory, selectConfigAgentsForDirectory } from '@/stores/useConfigStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useUIStore } from '@/stores/useUIStore';
import { snapshotWorkspaceScope } from '@/lib/workspaces/session-scope';
import { checkWorkspaceScopeAccess } from '@/lib/workspaces/runtime-policy';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { useI18n } from '@/lib/i18n';
import type { WorkspaceSettingsTarget } from './workspaceSettingsTargets';

export const WorkspaceSettingsView: React.FC<{
  workspaceId: string;
  onTargetChange(target: WorkspaceSettingsTarget): void;
  onClose?: () => void;
}> = ({ workspaceId, onTargetChange, onClose }) => {
  const { t } = useI18n();
  const workspace = useWorkspacesStore((state) => state.catalog.workspaces.find((entry) => entry.id === workspaceId));
  const primary = workspace?.folders[0]?.path;
  const providers = useConfigStore((state) => selectProvidersForDirectory(state, primary));
  const agents = useConfigStore((state) => selectConfigAgentsForDirectory(state, primary));
  const [pickerOpen, setPickerOpen] = React.useState(false);
  React.useEffect(() => {
    if (!primary) return;
    const config = useConfigStore.getState();
    void config.loadProviders({ directory: primary, source: 'workspace-overview' });
    void config.loadAgents({ directory: primary, source: 'workspace-overview' });
  }, [primary]);
  if (!workspace) return null;
  const models = providers.flatMap((provider) => provider.models.map((model) => ({ label: `${provider.name} / ${model.name}`, value: { providerID: provider.id, id: model.id } })));
  return <div data-settings-item="projects.workspace" className="h-full overflow-y-auto bg-background">
    <WorkspaceOverview workspace={workspace} models={models} agents={agents.map((agent) => ({ label: agent.displayName, value: agent.name }))}
      onCreateSession={async (selection, defaults) => {
        const scope = snapshotWorkspaceScope(workspace, selection);
        if (scope.kind === 'invalid') throw new Error(t('workspaces.scopeUnavailable'));
        const runtimeKey = getRuntimeKey();
        const access = await checkWorkspaceScopeAccess(scope.value, useProjectsStore.getState().projects.map((project) => project.path));
        if (access.kind === 'unavailable') throw new Error(t(access.reason === 'outside-editor-roots' ? 'workspaces.editorRoots' : access.reason === 'isolated-space-unsupported' ? 'workspaces.spaceUnsupported' : 'workspaces.scopeUnavailable'));
        if (getRuntimeKey() !== runtimeKey) throw new Error(t('workspaces.scopeUnavailable'));
        const config = useConfigStore.getState();
        await config.loadProviders({ directory: scope.value.primaryDirectory, source: 'workspace-create' });
        await config.loadAgents({ directory: scope.value.primaryDirectory, source: 'workspace-create' });
        if (getRuntimeKey() !== runtimeKey) throw new Error(t('workspaces.scopeUnavailable'));
        const loaded = useConfigStore.getState();
        if (defaults.model && !selectProvidersForDirectory(loaded, scope.value.primaryDirectory).some((provider) => provider.id === defaults.model?.providerID && provider.models.some((model) => model.id === defaults.model?.id))) throw new Error(t('workspaces.invalidDefault'));
        if (defaults.agent && !selectConfigAgentsForDirectory(loaded, scope.value.primaryDirectory).some((agent) => agent.name === defaults.agent)) throw new Error(t('workspaces.invalidDefault'));
        useSessionUIStore.getState().openWorkspaceDraft(workspace.id, selection, defaults);
        if (onClose) onClose();
        else useUIStore.getState().setSettingsDialogOpen(false);
        useUIStore.getState().closeMainSurfaces();
        useUIStore.getState().setSessionSwitcherOpen(false);
        window.dispatchEvent(new CustomEvent('openchamber:navigate', { detail: { view: 'chat' } }));
      }}
      onUpdate={async (patch) => {
        if (patch.defaults?.model && !models.some(({ value }) => value.providerID === patch.defaults?.model?.providerID && value.id === patch.defaults.model.id)) throw new Error(t('workspaces.invalidDefault'));
        if (patch.defaults?.agent && !agents.some((agent) => agent.name === patch.defaults?.agent)) throw new Error(t('workspaces.invalidDefault'));
        const result = await useWorkspacesStore.getState().update(workspace.id, patch);
        if (result.kind !== 'saved') throw new Error(t('workspaces.actionFailed'));
      }}
      onAddFolders={async () => setPickerOpen(true)}
      onUnlinkFolder={async (folderId) => {
        const result = await useWorkspacesStore.getState().unlinkFolder(workspace.id, folderId);
        if (result.kind !== 'saved') throw new Error(t('workspaces.actionFailed'));
        onTargetChange({ kind: 'workspace', workspaceId });
      }}
      onDelete={async () => {
        const result = await useWorkspacesStore.getState().remove(workspace.id);
        if (result.kind !== 'saved') throw new Error(t('workspaces.deleteFailed'));
        const next = useWorkspacesStore.getState().catalog.workspaces[0];
        onTargetChange(next ? { kind: 'workspace', workspaceId: next.id } : { kind: 'chats' });
      }} />
    {pickerOpen && <DirectoryExplorerDialog open={pickerOpen} onOpenChange={setPickerOpen} addedFolders={workspace.folders.map((folder) => folder.path)} onSelectFolders={async (paths) => {
      const latest = useWorkspacesStore.getState().catalog.workspaces.find((entry) => entry.id === workspace.id);
      if (!latest) throw new Error(t('workspaces.actionFailed'));
      const folders = [...latest.folders];
      for (const path of paths) if (!folders.some((folder) => folder.path === path)) folders.push({ id: crypto.randomUUID(), path, role: '' });
      const result = await useWorkspacesStore.getState().update(latest.id, { folders });
      if (result.kind !== 'saved') throw new Error(t('workspaces.actionFailed'));
    }} />}
  </div>;
};
