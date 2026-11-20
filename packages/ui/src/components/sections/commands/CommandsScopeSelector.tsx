import React from 'react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MobileOverlayPanel } from '@/components/ui/MobileOverlayPanel';
import { dropdownTriggerVariants } from '@/components/ui/dropdown-trigger';
import { toast } from '@/components/ui';
import { Icon } from '@/components/icon/Icon';
import { useProjectsInSidebarOrder } from '@/components/session/sidebar/list/useProjectsInSidebarOrder';
import { useVisibleWorkspaceCatalog } from '@/components/sections/projects/workspaceSettingsTargets';
import { useSettingsDirectory } from '@/hooks/useSettingsDirectory';
import { isChatDirectoryPath } from '@/lib/chatDirectories';
import { isVSCodeRuntime } from '@/lib/desktop';
import { useI18n } from '@/lib/i18n';
import { normalizePath } from '@/lib/pathNormalization';
import { cn } from '@/lib/utils';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';
import { useCommandSettingsScope } from './commandSettingsScope';

// Registered folders outside every workspace form one extra group. Workspace
// IDs are UUIDs or `project:<id>`, so neither value can collide with one.
const OTHER_FOLDERS = '__other-folders__';
const SHARED_COMMANDS = '__shared-commands__';

type PickerOption = { value: string; label: string; icon: 'stack' | 'folder'; title?: string };

const folderName = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) || path;
const samePath = (left: string | null | undefined, right: string | null | undefined) =>
  Boolean(left && right) && normalizePath(left) === normalizePath(right);

const OptionLabel: React.FC<{ option: PickerOption }> = ({ option }) => (
  <span className="flex min-w-0 items-center gap-2">
    <Icon name={option.icon} className="size-4 shrink-0 text-muted-foreground" />
    <span className="truncate">{option.label}</span>
  </span>
);

const ScopePicker: React.FC<{
  label: string;
  value: string | null;
  options: readonly PickerOption[];
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => {
  const isMobile = useUIStore((state) => state.isMobile);
  const [open, setOpen] = React.useState(false);
  const selected = options.find((option) => option.value === value) ?? null;

  if (isMobile) {
    return (
      <>
        <button
          type="button"
          aria-label={label}
          title={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
          className={cn(dropdownTriggerVariants({ size: 'touch' }), 'w-full min-w-0')}
        >
          <span className="min-w-0 flex-1 typography-ui-label font-medium">{selected ? <OptionLabel option={selected} /> : null}</span>
          <Icon name="arrow-down-s" className="size-4 opacity-50" />
        </button>
        <MobileOverlayPanel open={open} title={label} onClose={() => setOpen(false)}>
          <div className="flex flex-col px-3 pb-4 pt-1">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                title={option.title ?? option.label}
                className={cn(
                  'flex min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2.5 text-start typography-ui-label hover:bg-[var(--interactive-hover)]',
                  option.value === value && 'bg-interactive-selection',
                )}
                onClick={() => { onChange(option.value); setOpen(false); }}
              >
                <span className="min-w-0 flex-1"><OptionLabel option={option} /></span>
                {option.value === value ? <Icon name="check" className="size-4 shrink-0 text-muted-foreground" /> : null}
              </button>
            ))}
          </div>
        </MobileOverlayPanel>
      </>
    );
  }

  return (
    <Select value={value ?? ''} onValueChange={(next) => { if (next) onChange(next); }}>
      <SelectTrigger className="w-full" aria-label={label} title={label}>
        <SelectValue>{selected ? <OptionLabel option={selected} /> : null}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value} title={option.title} className="max-w-[24rem]">
            <OptionLabel option={option} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
};

/**
 * Two selectors for Settings → Commands: the workspace first, then either its
 * shared commands or one of its folders. Choosing never moves the active chat
 * or project; a folder changes only the Settings directory.
 */
export const CommandsScopeSelector: React.FC<{ className?: string }> = ({ className }) => {
  const { t } = useI18n();
  const workspaces = useVisibleWorkspaceCatalog().workspaces;
  const workspaceStatus = useWorkspacesStore((state) => state.status);
  const projects = useProjectsInSidebarOrder(useProjectsStore((state) => state.projects));
  const addProject = useProjectsStore((state) => state.addProject);
  const settingsDirectory = useSettingsDirectory();
  const setSettingsProjectPath = useUIStore((state) => state.setSettingsProjectPath);
  const sharedWorkspaceId = useCommandSettingsScope((state) => state.workspaceId);
  const browsedWorkspaceId = useCommandSettingsScope((state) => state.browsedWorkspaceId);
  const selectWorkspace = useCommandSettingsScope((state) => state.selectWorkspace);
  const browseWorkspace = useCommandSettingsScope((state) => state.browseWorkspace);
  const selectionSequence = React.useRef(0);
  const isVSCode = React.useMemo(() => isVSCodeRuntime(), []);

  React.useEffect(() => {
    if (workspaceStatus === 'unloaded') void useWorkspacesStore.getState().load();
  }, [workspaceStatus]);

  // Managed chat folders are registered projects, but there is nothing to configure in them here.
  const otherProjects = projects.filter((project) => !isChatDirectoryPath(project.path)
    && !workspaces.some((workspace) => workspace.folders.some((folder) => samePath(folder.path, project.path))));
  const groupHoldsDirectory = (groupId: string) => groupId === OTHER_FOLDERS
    ? otherProjects.some((project) => samePath(project.path, settingsDirectory))
    : Boolean(workspaces.find((workspace) => workspace.id === groupId)?.folders.some((folder) => samePath(folder.path, settingsDirectory)));
  const groupId = sharedWorkspaceId
    ?? (browsedWorkspaceId && groupHoldsDirectory(browsedWorkspaceId) ? browsedWorkspaceId : null)
    ?? workspaces.find((workspace) => groupHoldsDirectory(workspace.id))?.id
    ?? (groupHoldsDirectory(OTHER_FOLDERS) ? OTHER_FOLDERS : null)
    ?? workspaces[0]?.id
    ?? null;

  if (isVSCode || groupId === null) return null;

  const groupOptions: PickerOption[] = [
    ...workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name, icon: 'stack' as const })),
    ...(otherProjects.length > 0 ? [{ value: OTHER_FOLDERS, label: t('settings.commands.sidebar.scope.otherFolders'), icon: 'folder' as const }] : []),
  ];
  const folderPaths = groupId === OTHER_FOLDERS
    ? otherProjects.map((project) => ({ path: project.path, label: project.label || folderName(project.path) }))
    : (workspaces.find((workspace) => workspace.id === groupId)?.folders ?? []).map((folder) => ({ path: folder.path, label: folderName(folder.path) }));
  const targetOptions: PickerOption[] = [
    ...(groupId === OTHER_FOLDERS ? [] : [{ value: SHARED_COMMANDS, label: t('settings.commands.sidebar.scope.shared'), icon: 'stack' as const }]),
    ...folderPaths.map((folder) => ({ value: folder.path, label: folder.label, icon: 'folder' as const, title: folder.path })),
  ];
  const targetValue = sharedWorkspaceId ? SHARED_COMMANDS : folderPaths.find((folder) => samePath(folder.path, settingsDirectory))?.path ?? null;

  const selectFolder = (path: string, group: string) => {
    const sequence = ++selectionSequence.current;
    selectWorkspace(null);
    browseWorkspace(group);
    const project = projects.find((entry) => samePath(entry.path, path));
    if (project) {
      setSettingsProjectPath(project.path);
      return;
    }
    // A catalog folder not yet registered as a project is registered without becoming active.
    void addProject(path, { activate: false }).then((entry) => {
      if (sequence !== selectionSequence.current) return;
      if (entry) setSettingsProjectPath(entry.path);
      else toast.error(t('workspaces.actionFailed'));
    }).catch(() => {
      if (sequence === selectionSequence.current) toast.error(t('workspaces.actionFailed'));
    });
  };

  const handleGroupChange = (value: string) => {
    if (value === OTHER_FOLDERS) {
      const first = otherProjects[0];
      if (first) selectFolder(first.path, OTHER_FOLDERS);
      return;
    }
    selectionSequence.current++;
    selectWorkspace(value);
  };

  const handleTargetChange = (value: string) => {
    if (value === SHARED_COMMANDS) {
      selectionSequence.current++;
      selectWorkspace(groupId);
      return;
    }
    selectFolder(value, groupId);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <ScopePicker label={t('settings.commands.sidebar.scope.workspace')} value={groupId} options={groupOptions} onChange={handleGroupChange} />
      <ScopePicker label={t('settings.commands.sidebar.scope.target')} value={targetValue} options={targetOptions} onChange={handleTargetChange} />
    </div>
  );
};
