import React from 'react';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';
import { useUIStore } from '@/stores/useUIStore';
import { ProjectSettingsPanel } from '@/components/sections/projects/ProjectSettingsPanel';
import { useProjectSettingsTabStore } from '@/components/sections/projects/projectSettingsTabs';
import type { ProjectIdentitySaveData } from '@/components/sections/projects/useProjectIdentityForm';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useDeviceInfo } from '@/lib/device';
import { useI18n } from '@/lib/i18n';
import { isVSCodeRuntime } from '@/lib/desktop';
import { normalizePath } from '@/lib/pathNormalization';
import { resolveInitialWorkspaceTarget, useVisibleWorkspaceCatalog } from './workspaceSettingsTargets';
import { WorkspaceSettingsView } from './WorkspaceSettingsView';
import { DefaultsSettings } from '@/components/sections/openchamber/DefaultsSettings';
import { Button } from '@/components/ui/button';

const VSCodeProjectsPage: React.FC = () => {
  const { t } = useI18n();
  const { isMobile } = useDeviceInfo();
  const projects = useProjectsStore((state) => state.projects);
  const updateProjectMeta = useProjectsStore((state) => state.updateProjectMeta);
  const removeProject = useProjectsStore((state) => state.removeProject);
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const selectedId = useUIStore((state) => state.settingsProjectsSelectedId);
  const setSelectedId = useUIStore((state) => state.setSettingsProjectsSelectedId);
  const setSettingsDialogOpen = useUIStore((state) => state.setSettingsDialogOpen);
  const setWorktreesPageProjectId = useUIStore((state) => state.setWorktreesPageProjectId);
  const tab = useProjectSettingsTabStore((state) => state.tab);
  const setTab = useProjectSettingsTabStore((state) => state.setTab);
  const selectedProject = projects.find((p) => p.id === selectedId) ?? null;
  React.useEffect(() => {
    if (!selectedProject && projects.length > 0) setSelectedId(projects[0].id);
  }, [projects, selectedProject, setSelectedId]);
  const handleIdentitySave = React.useCallback(async (data: ProjectIdentitySaveData) => {
    if (!selectedProject) return;
    updateProjectMeta(selectedProject.id, { label: data.label, icon: data.icon, color: data.color, iconBackground: data.iconBackground, defaultAgent: data.defaultAgent ?? null, defaultModel: data.defaultModel ?? null, defaultVariant: data.defaultVariant ?? null });
  }, [selectedProject, updateProjectMeta]);
  const handleOpenWorktrees = React.useMemo(() => {
    if (isMobile || !selectedProject) return undefined;
    return () => { setSettingsDialogOpen(false); setWorktreesPageProjectId(selectedProject.id); };
  }, [isMobile, selectedProject, setSettingsDialogOpen, setWorktreesPageProjectId]);
  const handleCloseProject = React.useMemo(() => {
    if (!selectedProject) return undefined;
    const { id, label, path } = selectedProject;
    const name = label?.trim() || path.split(/[\\/]/).pop() || path;
    return () => { void confirm({ title: t('settings.projects.page.closeDialog.title', { name }), message: t('settings.projects.page.closeDialog.message'), action: t('settings.projects.page.actions.closeProject'), destructive: true }).then((confirmed) => { if (confirmed) removeProject(id); }); };
  }, [confirm, removeProject, selectedProject, t]);
  if (!selectedProject) return <SettingsPageLayout title={t('settings.page.projects.vscodeTitle')} showSaveStatus><p className="typography-meta text-muted-foreground">{t('settings.projects.page.empty.noProjects')}</p></SettingsPageLayout>;
  return <><ProjectSettingsPanel frame="page" project={selectedProject} onIdentitySave={handleIdentitySave} tab={tab} onTabChange={setTab} onOpenWorktrees={handleOpenWorktrees} onCloseProject={handleCloseProject} />{confirmDialog}</>;
};

const WorkspaceProjectsPage: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const { t } = useI18n();
  const { isMobile } = useDeviceInfo();
  const projects = useProjectsStore((state) => state.projects);
  const addProject = useProjectsStore((state) => state.addProject);
  const updateProjectMeta = useProjectsStore((state) => state.updateProjectMeta);
  const catalog = useWorkspacesStore((state) => state.catalog);
  const visibleCatalog = useVisibleWorkspaceCatalog();
  const status = useWorkspacesStore((state) => state.status);
  const hasBaseline = useWorkspacesStore((state) => state.hasBaseline);
  const target = useUIStore((state) => state.settingsWorkspaceTarget);
  const setTarget = useUIStore((state) => state.setSettingsWorkspaceTarget);
  const legacyId = useUIStore((state) => state.settingsProjectsSelectedId);
  const setLegacyId = useUIStore((state) => state.setSettingsProjectsSelectedId);
  const setSettingsDialogOpen = useUIStore((state) => state.setSettingsDialogOpen);
  const setWorktreesPageProjectId = useUIStore((state) => state.setWorktreesPageProjectId);
  const tab = useProjectSettingsTabStore((state) => state.tab);
  const setTab = useProjectSettingsTabStore((state) => state.setTab);
  const [resolveState, setResolveState] = React.useState<{ key: string; state: 'loading' | 'failed' } | null>(null);
  const [unlinkError, setUnlinkError] = React.useState<string | null>(null);
  const targetKey = target?.kind === 'folder' ? `${target.kind}:${target.workspaceId}:${target.folderId}` : target?.kind === 'workspace' ? `${target.kind}:${target.workspaceId}` : target?.kind ?? '';

  React.useEffect(() => {
    if (status === 'unloaded') void useWorkspacesStore.getState().load();
  }, [status]);
  React.useEffect(() => {
    if (status !== 'ready' || target) return;
    setTarget(resolveInitialWorkspaceTarget(catalog, projects.find((project) => project.id === legacyId)?.path ?? null));
  }, [catalog, legacyId, projects, setTarget, status, target]);

  React.useEffect(() => {
    if (status !== 'ready' || !target) return;
    const resolved = target.kind === 'chats'
      || target.kind === 'workspace' && visibleCatalog.workspaces.some((workspace) => workspace.id === target.workspaceId)
      || target.kind === 'folder' && visibleCatalog.workspaces.some((workspace) => workspace.id === target.workspaceId && workspace.folders.some((folder) => folder.id === target.folderId));
    if (!resolved) setTarget(resolveInitialWorkspaceTarget(catalog, projects.find((project) => project.id === legacyId)?.path ?? null));
  }, [catalog, legacyId, projects, setTarget, status, target, visibleCatalog]);
  const previousTargetKey = React.useRef(targetKey);
  React.useEffect(() => {
    if (previousTargetKey.current !== targetKey) setUnlinkError(null);
    previousTargetKey.current = targetKey;
  }, [targetKey]);

  const selectedFolder = target?.kind === 'folder'
    ? visibleCatalog.workspaces.find((workspace) => workspace.id === target.workspaceId)?.folders.find((folder) => folder.id === target.folderId) ?? null
    : null;
  const selectedProject = selectedFolder
    ? projects.find((project) => normalizePath(project.path) === normalizePath(selectedFolder.path)) ?? null
    : null;
  React.useEffect(() => {
    if (selectedProject && legacyId !== selectedProject.id) setLegacyId(selectedProject.id);
  }, [legacyId, selectedProject, setLegacyId]);
  const resolutionKey = target?.kind === 'folder' && selectedFolder ? `${target.workspaceId}:${target.folderId}` : '';
  const registerFolder = React.useCallback(async (folderPath: string, key: string) => {
    setResolveState({ key, state: 'loading' });
    try {
      const entry = await addProject(folderPath, { activate: false });
      if (entry) { setLegacyId(entry.id); setResolveState(null); }
      else setResolveState({ key, state: 'failed' });
    } catch { setResolveState({ key, state: 'failed' }); }
  }, [addProject, setLegacyId]);
  React.useEffect(() => {
    if (!selectedFolder || selectedProject || !resolutionKey || resolveState?.key === resolutionKey) return;
    void registerFolder(selectedFolder.path, resolutionKey);
  }, [registerFolder, resolveState, resolutionKey, selectedFolder, selectedProject]);

  const handleIdentitySave = React.useCallback(async (data: ProjectIdentitySaveData) => {
    if (!selectedProject) return;
    updateProjectMeta(selectedProject.id, { label: data.label, icon: data.icon, color: data.color, iconBackground: data.iconBackground, defaultAgent: data.defaultAgent ?? null, defaultModel: data.defaultModel ?? null, defaultVariant: data.defaultVariant ?? null });
  }, [selectedProject, updateProjectMeta]);
  const handleOpenWorktrees = React.useMemo(() => {
    if (isMobile || !selectedProject) return undefined;
    return () => { setSettingsDialogOpen(false); setWorktreesPageProjectId(selectedProject.id); };
  }, [isMobile, selectedProject, setSettingsDialogOpen, setWorktreesPageProjectId]);
  const handleUnlink = React.useCallback(async () => {
    const currentTarget = target;
    if (currentTarget?.kind !== 'folder') return;
    const result = await useWorkspacesStore.getState().unlinkFolder(currentTarget.workspaceId, currentTarget.folderId);
    if (result.kind === 'retained') { setUnlinkError(t('workspaces.actionFailed')); return; }
    setUnlinkError(null);
    setTarget({ kind: 'workspace', workspaceId: currentTarget.workspaceId });
  }, [setTarget, t, target]);

  if (!hasBaseline && (status === 'loading' || status === 'unloaded')) return <SettingsPageLayout title={t('settings.page.projects.title')} showSaveStatus><p className="typography-meta text-muted-foreground">{t('directoryExplorerDialog.browse.loading')}</p></SettingsPageLayout>;
  if (!hasBaseline && status === 'failed') return <SettingsPageLayout title={t('settings.page.projects.title')} showSaveStatus><p className="typography-meta text-muted-foreground">{t('workspaces.actionFailed')}</p><button type="button" className="mt-3 typography-ui-label text-foreground underline" onClick={() => void useWorkspacesStore.getState().load()}>{t('directoryExplorerDialog.browse.retry')}</button></SettingsPageLayout>;
  if (target?.kind === 'folder') {
    if (!selectedFolder) return <div data-settings-item="projects.folder"><SettingsPageLayout title={t('settings.page.projects.title')} showSaveStatus><p className="typography-meta text-muted-foreground">{t('workspaces.actionFailed')}</p></SettingsPageLayout></div>;
    if (!selectedProject) {
      const failed = resolveState?.key === resolutionKey && resolveState.state === 'failed';
      return <div data-settings-item="projects.folder"><SettingsPageLayout title={selectedFolder.path} showSaveStatus><p className="typography-meta text-muted-foreground">{failed ? t('workspaces.actionFailed') : t('directoryExplorerDialog.browse.loading')}</p>{failed && <button type="button" className="mt-3 typography-ui-label text-foreground underline" onClick={() => { setResolveState(null); void registerFolder(selectedFolder.path, resolutionKey); }}>{t('directoryExplorerDialog.browse.retry')}</button>}</SettingsPageLayout></div>;
    }
    return <div data-settings-item="projects.folder"><ProjectSettingsPanel frame="page" project={selectedProject} onIdentitySave={handleIdentitySave} tab={tab} onTabChange={setTab} onOpenWorktrees={handleOpenWorktrees} onCloseProject={() => void handleUnlink()} closeActionLabel={t('settings.projects.page.actions.unlinkWorkspace')} />{unlinkError && <div role="alert" className="flex items-center gap-2 typography-meta text-destructive"><span>{unlinkError}</span><Button variant="link" size="sm" onClick={() => void handleUnlink()}>{t('directoryExplorerDialog.browse.retry')}</Button></div>}</div>;
  }
  const workspace = target?.kind === 'workspace' ? visibleCatalog.workspaces.find((entry) => entry.id === target.workspaceId) : null;
  if (workspace) return <WorkspaceSettingsView workspaceId={workspace.id} onTargetChange={setTarget} onClose={onClose} />;
  return <SettingsPageLayout title={t('sessions.scheduledTasks.editor.destination.chats')} showSaveStatus>
    <div data-settings-item="projects.chats">
      <p className="mb-6 typography-meta text-muted-foreground">{t('settings.projects.page.chats.description')}</p>
      <DefaultsSettings onlyNewSessionDefaults />
    </div>
  </SettingsPageLayout>;
};

export const ProjectsPage: React.FC<{ onClose?: () => void }> = ({ onClose }) => isVSCodeRuntime() ? <VSCodeProjectsPage /> : <WorkspaceProjectsPage onClose={onClose} />;
