import React from 'react';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useProjectsInSidebarOrder } from '@/components/session/sidebar/list/useProjectsInSidebarOrder';
import { useUIStore } from '@/stores/useUIStore';
import { Button } from '@/components/ui/button';
import { SettingsSidebarLayout } from '@/components/sections/shared/SettingsSidebarLayout';
import { SettingsSidebarItem } from '@/components/sections/shared/SettingsSidebarItem';
import { Icon } from "@/components/icon/Icon";
import { PROJECT_ICON_MAP, resolveProjectColor, ProjectIconImage } from '@/lib/projectMeta';
import { cn } from '@/lib/utils';
import { isVSCodeRuntime } from '@/lib/desktop';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { useI18n } from '@/lib/i18n';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';
import { normalizePath } from '@/lib/pathNormalization';
import { resolveInitialWorkspaceTarget, useVisibleWorkspaceCatalog } from './workspaceSettingsTargets';
import { WorkspaceCreateDialog } from '@/components/session/workspaces/WorkspaceCreateDialog';
import { SETTINGS_SECTION_TITLE_CLASS } from '@/components/sections/shared/SettingsSection';

export const ProjectsSidebar: React.FC<{ onItemSelect?: () => void }> = ({ onItemSelect }) => {
  const { t } = useI18n();
  const projects = useProjectsInSidebarOrder(useProjectsStore((state) => state.projects));
  const selectedId = useUIStore((state) => state.settingsProjectsSelectedId);
  const setSelectedId = useUIStore((state) => state.setSettingsProjectsSelectedId);
  const target = useUIStore((state) => state.settingsWorkspaceTarget);
  const setTarget = useUIStore((state) => state.setSettingsWorkspaceTarget);
  const workspaces = useWorkspacesStore((state) => state.catalog.workspaces);
  const visibleWorkspaces = useVisibleWorkspaceCatalog().workspaces;
  const catalogStatus = useWorkspacesStore((state) => state.status);
  const { currentTheme } = useThemeSystem();
  const [creatingWorkspace, setCreatingWorkspace] = React.useState(false);

  const isVSCode = React.useMemo(() => isVSCodeRuntime(), []);

  const handleAddProject = React.useCallback(() => {
    setCreatingWorkspace(true);
  }, []);

  React.useEffect(() => {
    if (projects.length === 0) {
      if (selectedId !== null) {
        setSelectedId(null);
      }
      return;
    }
    if (selectedId && projects.some((p) => p.id === selectedId)) {
      return;
    }
    setSelectedId(projects[0].id);
  }, [projects, selectedId, setSelectedId]);

  React.useEffect(() => {
    if (isVSCode) return;
    if (catalogStatus === 'unloaded') void useWorkspacesStore.getState().load();
    if (catalogStatus !== 'ready' || target) return;
    setTarget(resolveInitialWorkspaceTarget(useWorkspacesStore.getState().catalog, projects.find((project) => project.id === selectedId)?.path ?? null));
  }, [catalogStatus, isVSCode, projects, selectedId, setTarget, target, workspaces]);


  return (
    <SettingsSidebarLayout
      variant="background"
      header={
        <div className={cn('border-b px-3', 'pt-4 pb-3')}>
          <h2 className={`${SETTINGS_SECTION_TITLE_CLASS} mb-1`}>{t(isVSCode ? 'settings.page.projects.vscodeTitle' : 'settings.page.projects.title')}</h2>
          {!isVSCode && <p className="mb-3 typography-meta text-muted-foreground">{t('settings.page.projects.description')}</p>}
          <div className="flex items-center justify-between gap-2">
            <span className="typography-meta text-muted-foreground">{t('settings.projects.sidebar.total', { count: isVSCode ? projects.length : visibleWorkspaces.reduce((n, workspace) => n + workspace.folders.length, 0) + visibleWorkspaces.length + 1 })}</span>
            {!isVSCode && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 -my-1 text-muted-foreground"
                onClick={handleAddProject}
                aria-label={t(isVSCode ? 'settings.projects.sidebar.actions.addProject' : 'workspaces.newWorkspace')}
                title={t(isVSCode ? 'settings.projects.sidebar.actions.addProject' : 'workspaces.newWorkspace')}
              >
                <Icon name="add" className="size-4" />
              </Button>
            )}
          </div>
        </div>
      }
    >
      {!isVSCode && catalogStatus === 'failed' && <button className="px-2 py-1 text-start typography-meta text-muted-foreground" onClick={() => void useWorkspacesStore.getState().load()}>{t('workspaces.actionFailed')} {t('directoryExplorerDialog.browse.retry')}</button>}
      {!isVSCode && visibleWorkspaces.map((workspace) => (
        <React.Fragment key={workspace.id}>
          <SettingsSidebarItem title={workspace.name} icon={<Icon name="folder" className="h-4 w-4 text-muted-foreground" />} selected={target?.kind === 'workspace' && target.workspaceId === workspace.id} onSelect={() => { setTarget({ kind: 'workspace', workspaceId: workspace.id }); onItemSelect?.(); }} />
          {workspace.folders.map((folder) => <SettingsSidebarItem key={folder.id} title={folder.path.split(/[\\/]/).filter(Boolean).at(-1) || folder.path} icon={<Icon name="folder" className="h-4 w-4 text-muted-foreground" />} selected={target?.kind === 'folder' && target.workspaceId === workspace.id && target.folderId === folder.id} className="ms-4" onSelect={() => { setTarget({ kind: 'folder', workspaceId: workspace.id, folderId: folder.id }); const entry = projects.find((project) => normalizePath(project.path) === normalizePath(folder.path)); if (entry) setSelectedId(entry.id); onItemSelect?.(); }} />)}
        </React.Fragment>
      ))}
      {!isVSCode && <SettingsSidebarItem title={t('sessions.scheduledTasks.editor.destination.chats')} icon={<Icon name="chat-1" className="h-4 w-4 text-muted-foreground" />} selected={target?.kind === 'chats'} onSelect={() => { setTarget({ kind: 'chats' }); onItemSelect?.(); }} />}
      {isVSCode && projects.map((project) => {
        const selected = project.id === selectedId;
        const iconName = project.icon ? PROJECT_ICON_MAP[project.icon] : null;
        const color = resolveProjectColor(project.color);
        const fallbackIcon = iconName
          ? (
            <Icon name={iconName} className={cn('h-4 w-4', selected ? 'text-foreground' : 'text-muted-foreground/70')} style={color ? { color } : undefined} />
          )
          : (
            <Icon name="folder" className={cn('h-4 w-4', selected ? 'text-foreground' : 'text-muted-foreground/70')} style={color ? { color } : undefined} />
          );
        const icon = project.iconImage
          ? (
            <span
              className="inline-flex h-4 w-4 items-center justify-center overflow-hidden rounded-[2px]"
              style={project.iconBackground ? { backgroundColor: project.iconBackground } : undefined}
            >
              <ProjectIconImage
                project={project}
                options={{
                  themeVariant: currentTheme.metadata.variant,
                  iconColor: currentTheme.colors.surface.foreground,
                }}
                className="h-full w-full object-contain"
                fallback={fallbackIcon}
              />
            </span>
          )
          : fallbackIcon;

        return (
          <SettingsSidebarItem
            key={project.id}
            title={project.label || project.path}
            icon={icon}
            selected={selected}
            onSelect={() => {
              setSelectedId(project.id);
              onItemSelect?.();
            }}
          />
        );
      })}
      {!isVSCode && <WorkspaceCreateDialog open={creatingWorkspace} onOpenChange={setCreatingWorkspace} onCreated={(workspaceId) => { setTarget({ kind: 'workspace', workspaceId }); onItemSelect?.(); }} />}
    </SettingsSidebarLayout>
  );
};
