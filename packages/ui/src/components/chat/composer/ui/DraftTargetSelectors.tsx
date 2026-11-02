/**
 * Where a new session will run: the project and the directory within it.
 *
 * Desktop uses a searchable project popup and an inline branch/worktree
 * select; mobile uses bottom sheets, because a native select over a
 * keyboard-resized viewport is unusable. Both render the same options from
 * the same hook, and both offer creating a worktree inline so the user does
 * not have to leave the draft to make one.
 */

import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Input } from '@/components/ui/input';
import { MobileOverlayPanel } from '@/components/ui/MobileOverlayPanel';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover } from '@base-ui/react/popover';
import { cn } from '@/lib/utils';
import { dropdownMenuPopupClass } from '@/components/ui/dropdown-menu.styles';
import { commandSearchAtBottomClass, usePopupSideOnOpen } from '@/components/ui/popup-side';
import {
    Command,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/components/ui/command';
import { handleDropdownNavigationKey, shouldDismissDropdown } from '@/components/ui/dropdown-navigation';
import { isIMECompositionEvent } from '@/lib/ime';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/lib/i18n';
import { matchesRankQuery, rankByQuery } from '@/lib/search/fuzzySearch';
import { PROJECT_ICON_MAP, resolveProjectColor, ProjectIconImage } from '@/lib/projectMeta';
import { createWorktreeDraft } from '@/lib/worktreeSessionCreator';
import { shortcutRegistry } from '@/lib/shortcuts';
import { useKeybind } from '@/hooks/useKeybind';
import type { Theme } from '@/types/theme';
import { normalizePath } from '../attachments/filePaths';
import { getProjectDisplayLabel, type DraftTargetProject } from '../state/useDraftTarget';
import { useProjectsInSidebarOrder } from '@/components/session/sidebar/list/useProjectsInSidebarOrder';
import type { Workspace, WorkspaceFolder } from '@/lib/workspaces/model';
import { formatWorkspaceLabel } from '@/lib/workspaces/display-name';
import type { FolderSelection } from '@/lib/workspaces/session-scope';

interface BranchOption {
    value: string;
    label: string;
    pending?: boolean;
}

export interface DraftTargetProps {
    projects: readonly DraftTargetProject[];
    selectedProject: DraftTargetProject;
    selectedDirectory: string | null;
    selectedBranchLabel: string | null;
    selectedBranchIsKnown: boolean;
    /** Shows the warning icon; its explanation opens on hover only. */
    hasUncommittedChanges: boolean;
    projectRootBranchOption: BranchOption | null;
    worktreeBranchOptions: readonly BranchOption[];
    branchItems: readonly BranchOption[];
    showBranchSelector: boolean;
    onProjectChange: (projectId: string) => void;
    onDirectoryChange: (directory: string) => void;
    /** Re-reads the branch and worktree data behind the picker, throttled by the owner. */
    onRefreshTarget?: () => void;
    /**
     * Opens the create dialog of an isolated space; absent where the entry is not offered: while
     * the feature's switch is off, and always in VS Code (decision 16 of the design).
     */
    onCreateSpace?: () => void;
    /** Opens the New Worktree dialog (name, branch, PR or issue) for the draft's project. */
    onCreateCustomWorktree?: () => void;
    showProjectPicker?: boolean;
    theme: Theme;
}

export function DraftWorkspaceTargetSelector({
    workspaces,
    status,
    selectedWorkspaceId,
    onSelect,
    onRetry,
    mobile = false,
    disabled = false,
    isChatSelected = false,
}: {
    workspaces: readonly Workspace[];
    status: 'unloaded' | 'loading' | 'ready' | 'failed';
    selectedWorkspaceId: string | null;
    onSelect: (workspaceId: string | null) => void;
    onRetry: () => void;
    mobile?: boolean;
    disabled?: boolean;
    isChatSelected?: boolean;
}) {
    const { t } = useI18n();
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const searchRef = React.useRef<HTMLInputElement>(null);
    const [portalContainer, setPortalContainer] = React.useState<HTMLElement | null>(null);
    const [collisionBoundary, setCollisionBoundary] = React.useState<Element | null>(null);
    const syncPopupContainers = React.useCallback((target: EventTarget | null) => {
        const element = target instanceof HTMLElement ? target : null;
        const dialog = element?.closest('[data-slot="dialog-content"], [role="dialog"]');
        setPortalContainer(dialog instanceof HTMLElement ? dialog : null);
        setCollisionBoundary(element?.closest('main') ?? null);
    }, []);
    const popupSide = usePopupSideOnOpen(open, triggerRef);
    React.useEffect(() => {
        if (!open) setQuery('');
    }, [open]);
    useKeybind('open_draft_project_picker', () => {
        if (disabled) return false;
        setOpen(true);
    });
    const selected = workspaces.find((workspace) => workspace.id === selectedWorkspaceId);
    const filtered = React.useMemo(() => rankByQuery(workspaces, query, (workspace) => [workspace.name, ...workspace.folders.map((folder) => folder.path)]), [query, workspaces]);
    const content = (desktop: boolean) => (
        <div className="flex flex-col gap-2 p-2">
            {!desktop ? <Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('chat.chatInput.draftPicker.searchWorkspaces')} placeholder={t('chat.chatInput.draftPicker.searchWorkspaces')} className="h-9" /> : null}
            <div className="flex flex-col">
                {matchesRankQuery([t('layout.mainTab.chat')], query) ? (desktop ? <CommandItem value="chat" onSelect={() => { onSelect(null); setOpen(false); }} aria-current={isChatSelected || undefined} className={isChatSelected ? 'bg-interactive-selection text-interactive-selection-foreground' : undefined}><Icon name="chat-4" className="size-3.5 shrink-0" />{t('layout.mainTab.chat')}{isChatSelected ? <Icon name="check" className="ms-auto size-4 shrink-0 text-current" /> : null}</CommandItem> : <button type="button" className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-start typography-ui-label hover:bg-[var(--interactive-hover)]', isChatSelected && 'bg-interactive-selection text-interactive-selection-foreground')} onClick={() => { onSelect(null); setOpen(false); }}><Icon name="chat-4" className="size-3.5 shrink-0" />{t('layout.mainTab.chat')}{isChatSelected ? <Icon name="check" className="ms-auto size-4 shrink-0 text-current" /> : null}</button>) : null}
                {status === 'loading' ? <div role="status" className="px-2 py-3 typography-meta text-muted-foreground">{t('chat.chatInput.draftPicker.loadingWorkspaces')}</div> : null}
                {status === 'failed' ? <div className="flex items-center justify-between gap-2 px-2 py-3 typography-meta text-muted-foreground"><span>{t('chat.chatInput.draftPicker.workspaceLoadFailed')}</span><button type="button" className="text-foreground" onClick={onRetry}>{t('chat.container.sessionLoadError.retry')}</button></div> : null}
                {status === 'ready' && filtered.length === 0 ? <div role="status" className="px-2 py-3 typography-meta text-muted-foreground">{t('chat.chatInput.draftPicker.noWorkspacesFound')}</div> : null}
                {status === 'ready' ? filtered.map((workspace) => (
                    desktop ? <CommandItem key={workspace.id} value={workspace.id} onSelect={() => { onSelect(workspace.id); setOpen(false); }} aria-current={workspace.id === selectedWorkspaceId || undefined} className={workspace.id === selectedWorkspaceId ? 'bg-interactive-selection text-interactive-selection-foreground' : undefined}><Icon name="stack" className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{formatWorkspaceLabel(workspace.name)}</span>{workspace.id === selectedWorkspaceId ? <Icon name="check" className="size-4 shrink-0 text-current" /> : null}</CommandItem> : <button key={workspace.id} type="button" className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-start typography-ui-label hover:bg-[var(--interactive-hover)]', workspace.id === selectedWorkspaceId && 'bg-interactive-selection text-interactive-selection-foreground')} onClick={() => { onSelect(workspace.id); setOpen(false); }}><Icon name="stack" className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate">{formatWorkspaceLabel(workspace.name)}</span>{workspace.id === selectedWorkspaceId ? <Icon name="check" className="size-4 shrink-0 text-current" /> : null}</button>
                )) : null}
            </div>
        </div>
    );
    const label = formatWorkspaceLabel(selected?.name ?? t('workspaces.title'));
    const triggerClassName = cn(
        'inline-flex min-h-11 min-w-0 max-w-[70vw] items-center gap-1.5 rounded-lg px-2 typography-ui-label font-medium transition-colors',
        selectedWorkspaceId
            ? 'bg-interactive-selection text-interactive-selection-foreground'
            : 'bg-[var(--surface-background)] text-foreground/80 oc-raised dark:bg-surface-elevated',
        'hover:bg-interactive-hover disabled:opacity-50',
    );
    if (mobile) return <>
        <button type="button" disabled={disabled} className={triggerClassName} onClick={() => setOpen(true)}>
            <Icon name="stack" className="size-4 shrink-0" /><span className="truncate">{label}</span><Icon name="arrow-down-s" className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
        <MobileOverlayPanel open={open} title={t('chat.chatInput.draftPicker.workspaceTitle')} onClose={() => setOpen(false)}>{content(false)}</MobileOverlayPanel>
    </>;
    return <Popover.Root open={open} onOpenChange={setOpen} onOpenChangeComplete={(isOpen) => { if (isOpen) searchRef.current?.focus(); }}>
        <Popover.Trigger disabled={disabled} render={<Button ref={triggerRef} variant="ghost" size="sm" aria-haspopup="dialog" onPointerDownCapture={(event) => syncPopupContainers(event.currentTarget)} onFocusCapture={(event) => syncPopupContainers(event.currentTarget)} className={cn(triggerClassName, 'h-8 min-h-8 w-fit max-w-[42vw] justify-start normal-case sm:max-w-[18rem]')} />}>
            <Icon name="stack" className="size-4 shrink-0" /><span className="truncate">{label}</span><Icon name="arrow-down-s" className="size-4 shrink-0 opacity-70" />
        </Popover.Trigger>
        <Popover.Portal container={portalContainer ?? undefined}><Popover.Positioner side={popupSide} align="start" sideOffset={4} collisionAvoidance={{ side: 'none' }} collisionBoundary={collisionBoundary ?? undefined} className="app-region-no-drag z-50"><Popover.Popup role="dialog" aria-label={t('chat.chatInput.draftPicker.workspaceTitle')} className={cn(dropdownMenuPopupClass, 'flex w-72 max-w-[calc(100vw-2rem)] flex-col p-0')}>
            <Command shouldFilter={false}><CommandInput ref={searchRef} value={query} onValueChange={setQuery} aria-label={t('chat.chatInput.draftPicker.searchWorkspaces')} placeholder={t('chat.chatInput.draftPicker.searchWorkspaces')} onKeyDown={(event) => {
                if (isIMECompositionEvent(event)) { event.stopPropagation(); return; }
                handleDropdownNavigationKey(event, (key) => event.currentTarget.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
            }} /><CommandList label={t('chat.chatInput.draftPicker.workspaceTitle')}>{content(true)}</CommandList></Command>
        </Popover.Popup></Popover.Positioner></Popover.Portal>
    </Popover.Root>;
}

export function DraftWorkspaceFolderTargetSelector({
    workspace,
    selectedFolderId,
    onSelect,
    mobile = false,
    disabled = false,
}: {
    workspace: Workspace | undefined;
    selectedFolderId: string | null;
    onSelect: (workspaceId: string, selection: FolderSelection) => void;
    mobile?: boolean;
    disabled?: boolean;
}) {
    const { t } = useI18n();
    const [open, setOpen] = React.useState(false);
    const [query, setQuery] = React.useState('');
    const triggerRef = React.useRef<HTMLButtonElement>(null);
    const searchRef = React.useRef<HTMLInputElement>(null);
    const popupSide = usePopupSideOnOpen(open, triggerRef);
    React.useEffect(() => { if (!open) setQuery(''); }, [open]);
    if (!workspace) return null;
    const selectedFolder = workspace.folders.find((folder) => folder.id === selectedFolderId);
    const label = formatWorkspaceLabel(selectedFolder ? folderLabel(selectedFolder, workspace.folders) : t('chat.chatInput.draftPicker.allFolders'));
    const triggerClassName = cn(
        'inline-flex min-h-11 min-w-0 max-w-[70vw] items-center gap-1.5 rounded-lg px-2 typography-ui-label font-medium transition-colors',
        selectedFolder
            ? 'bg-interactive-selection text-interactive-selection-foreground'
            : 'bg-[var(--surface-background)] text-foreground/80 oc-raised dark:bg-surface-elevated',
        'hover:bg-interactive-hover disabled:opacity-50',
    );
    const folders = rankByQuery(workspace.folders, query, (folder) => [folderLabel(folder, workspace.folders), folder.path]);
    const select = (selection: FolderSelection) => {
        onSelect(workspace.id, selection);
        setOpen(false);
    };
    const rows = (desktop: boolean) => <div className="flex flex-col gap-1 p-1">
        {matchesRankQuery([t('chat.chatInput.draftPicker.allFolders')], query) ? desktop
            ? <CommandItem value="all-folders" onSelect={() => select({ kind: 'workspace' })} aria-current={!selectedFolderId || undefined} className={!selectedFolderId ? 'bg-interactive-selection text-interactive-selection-foreground' : undefined}>{formatWorkspaceLabel(t('chat.chatInput.draftPicker.allFolders'))}{!selectedFolderId ? <Icon name="check" className="ms-auto size-4 text-current" /> : null}</CommandItem>
            : <button type="button" className={cn('flex items-center gap-2 rounded-md px-2 py-2 text-start typography-ui-label hover:bg-[var(--interactive-hover)]', !selectedFolderId && 'bg-interactive-selection text-interactive-selection-foreground')} onClick={() => select({ kind: 'workspace' })}>{formatWorkspaceLabel(t('chat.chatInput.draftPicker.allFolders'))}{!selectedFolderId ? <Icon name="check" className="ms-auto size-4 text-current" /> : null}</button>
            : null}
        {folders.map((folder) => desktop
            ? <CommandItem key={folder.id} value={folder.id} onSelect={() => select({ kind: 'folder', folderId: folder.id })} aria-current={folder.id === selectedFolderId || undefined} className={folder.id === selectedFolderId ? 'bg-interactive-selection text-interactive-selection-foreground' : undefined}><span className="min-w-0 flex-1 truncate" title={folder.path}>{formatWorkspaceLabel(folderLabel(folder, workspace.folders))}</span>{folder.id === selectedFolderId ? <Icon name="check" className="size-4 shrink-0 text-current" /> : null}</CommandItem>
            : <button key={folder.id} type="button" title={folder.path} className={cn('flex items-center gap-2 rounded-md px-2 py-2 text-start typography-ui-label hover:bg-[var(--interactive-hover)]', folder.id === selectedFolderId && 'bg-interactive-selection text-interactive-selection-foreground')} onClick={() => select({ kind: 'folder', folderId: folder.id })}><span className="min-w-0 flex-1 truncate">{formatWorkspaceLabel(folderLabel(folder, workspace.folders))}</span>{folder.id === selectedFolderId ? <Icon name="check" className="size-4 shrink-0 text-current" /> : null}</button>)}
    </div>;
    if (mobile) return <>
        <button type="button" disabled={disabled} title={selectedFolder?.path} aria-label={selectedFolder ? `${label}: ${selectedFolder.path}` : label} className={triggerClassName} onClick={() => setOpen(true)}><Icon name="folder" className="size-4 shrink-0" /><span className="truncate">{label}</span><Icon name="arrow-down-s" className="size-3.5 shrink-0 text-muted-foreground" /></button>
        <MobileOverlayPanel open={open} title={t('chat.chatInput.draftPicker.folderTitle')} onClose={() => setOpen(false)}><Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t('chat.chatInput.draftPicker.searchFolders')} placeholder={t('chat.chatInput.draftPicker.searchFolders')} className="h-9" />{rows(false)}</MobileOverlayPanel>
    </>;
    return <Popover.Root open={open} onOpenChange={setOpen} onOpenChangeComplete={(isOpen) => { if (isOpen) searchRef.current?.focus(); }}>
        <Popover.Trigger disabled={disabled} render={<Button ref={triggerRef} variant="ghost" size="sm" aria-haspopup="dialog" aria-label={selectedFolder ? `${label}: ${selectedFolder.path}` : label} title={selectedFolder?.path} className={cn(triggerClassName, 'h-8 min-h-8 w-fit max-w-[42vw] justify-start normal-case sm:max-w-[18rem]')} />}><Icon name="folder" className="size-4 shrink-0" /><span className="truncate">{label}</span><Icon name="arrow-down-s" className="size-4 shrink-0 opacity-70" /></Popover.Trigger>
        <Popover.Portal><Popover.Positioner side={popupSide} align="start" sideOffset={4} className="app-region-no-drag z-50"><Popover.Popup role="dialog" aria-label={t('chat.chatInput.draftPicker.folderTitle')} className={cn(dropdownMenuPopupClass, 'flex w-72 max-w-[calc(100vw-2rem)] flex-col p-0')}><Command shouldFilter={false}><CommandInput ref={searchRef} value={query} onValueChange={setQuery} aria-label={t('chat.chatInput.draftPicker.searchFolders')} placeholder={t('chat.chatInput.draftPicker.searchFolders')} onKeyDown={(event) => { if (isIMECompositionEvent(event)) { event.stopPropagation(); return; } handleDropdownNavigationKey(event, (key) => event.currentTarget.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))); }} /><CommandList label={t('chat.chatInput.draftPicker.folderTitle')}>{rows(true)}</CommandList></Command></Popover.Popup></Popover.Positioner></Popover.Portal>
    </Popover.Root>;
}

function folderLabel(folder: WorkspaceFolder, folders: readonly WorkspaceFolder[]): string {
    const basename = folder.path.replace(/\\+$/, '').split(/[\\/]/).at(-1) || folder.path;
    return folders.some((candidate) => candidate.id !== folder.id && (candidate.path.replace(/\\+$/, '').split(/[\\/]/).at(-1) || candidate.path) === basename)
        ? `${basename} · ${folder.path}`
        : basename;
}

/** The two ways to make a worktree from the draft: at once, or through the dialog. */
function WorktreeCreateActions({ onQuick, onCustom, className }: {
    onQuick: () => void;
    onCustom?: () => void;
    className: string;
}) {
    const { t } = useI18n();
    return (
        <>
            <button type="button" className={className} onPointerDown={(e) => { e.stopPropagation(); }} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onQuick(); }}>
                <Icon name="flashlight" className="size-4 shrink-0 text-muted-foreground" />
                {t('chat.chatInput.worktreeQuick')}
            </button>
            {onCustom ? (
                <button type="button" className={className} onPointerDown={(e) => { e.stopPropagation(); }} onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCustom(); }}>
                    <Icon name="git-branch" className="size-4 shrink-0 text-muted-foreground" />
                    {t('chat.chatInput.worktreeCustom')}
                </button>
            ) : null}
        </>
    );
}

const getProjectIconColor = (projectColor?: string | null): string | undefined =>
    resolveProjectColor(projectColor) ?? undefined;

/** A project's icon (custom image, configured icon, or a folder) plus its name. */
export function ProjectLabel({ project, theme }: { project: DraftTargetProject; theme: Theme }) {
    const projectIconName = project.icon ? PROJECT_ICON_MAP[project.icon] : null;
    const iconColor = getProjectIconColor(project.color);
    const fallbackIcon = project.kind === 'chat' ? (
        <Icon name="chat-4" className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
    ) : projectIconName ? (
        <Icon name={projectIconName} className="h-3.5 w-3.5 shrink-0" style={iconColor ? { color: iconColor } : undefined} />
    ) : (
        <Icon name="folder" className="h-3.5 w-3.5 shrink-0 text-muted-foreground/80" style={iconColor ? { color: iconColor } : undefined} />
    );

    return (
        <span className="inline-flex min-w-0 items-center gap-1.5">
            {project.iconImage ? (
                <span
                    className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center overflow-hidden rounded-[3px]"
                    style={project.iconBackground ? { backgroundColor: project.iconBackground } : undefined}
                >
                    <ProjectIconImage
                        project={{ id: project.id, iconImage: project.iconImage ?? null }}
                        options={{
                            themeVariant: theme.metadata.variant,
                            iconColor: theme.colors.surface.foreground,
                        }}
                        className="h-full w-full object-contain"
                        fallback={fallbackIcon}
                    />
                </span>
            ) : fallbackIcon}
            <span className="truncate">{getProjectDisplayLabel(project)}</span>
        </span>
    );
}

/** Desktop: inline project and branch selects. */
function DraftTargetSelectorsView(props: DraftTargetProps) {
    const { t } = useI18n();
    const {
        projects,
        selectedProject,
        selectedDirectory,
        selectedBranchLabel,
        selectedBranchIsKnown,
        hasUncommittedChanges,
        projectRootBranchOption,
        worktreeBranchOptions,
        branchItems,
        showBranchSelector,
        onProjectChange,
        onDirectoryChange,
        onRefreshTarget,
        onCreateSpace,
        onCreateCustomWorktree,
        showProjectPicker = true,
        theme,
    } = props;
    const [openPicker, setOpenPicker] = React.useState<'project' | 'worktree' | null>(null);
    const [projectQuery, setProjectQuery] = React.useState('');
    const [projectActiveId, setProjectActiveId] = React.useState<string | null>(null);
    const [projectFocusReturn, setProjectFocusReturn] = React.useState(false);
    const projectTriggerRef = React.useRef<HTMLButtonElement>(null);
    const worktreeTriggerRef = React.useRef<HTMLButtonElement>(null);
    // Controlled Select closes can omit finalFocus's interaction type.
    const keyboardCloseRef = React.useRef(false);
    const getComposerInput = () => projectTriggerRef.current?.closest('form')?.querySelector<HTMLElement>('[data-chat-input="true"] .cm-content');
    const getFinalFocus = () => keyboardCloseRef.current ? getComposerInput() : true;
    const projectSearchRef = React.useRef<HTMLInputElement>(null);
    // Preserve Select's dialog portal and main-area containment.
    const [projectPortalContainer, setProjectPortalContainer] = React.useState<HTMLElement | null>(null);
    const [projectCollisionBoundary, setProjectCollisionBoundary] = React.useState<Element | null>(null);
    const syncProjectPopupContainers = React.useCallback((target: EventTarget | null) => {
        const element = target instanceof HTMLElement ? target : null;
        const dialog = element?.closest('[data-slot="dialog-content"], [role="dialog"]');
        setProjectPortalContainer(dialog instanceof HTMLElement ? dialog : null);
        setProjectCollisionBoundary(element?.closest('main') ?? null);
    }, []);
    // Each picker picks its side when it opens and keeps it while open.
    const projectPopupSide = usePopupSideOnOpen(openPicker === 'project', projectTriggerRef);
    const worktreePopupSide = usePopupSideOnOpen(openPicker === 'worktree', worktreeTriggerRef);
    // The popover owns no shortcut suspension (unlike Select/DropdownMenu
    // wrappers), so suspend global shortcuts while the project popup is
    // open and restore them on close/unmount.
    const projectSuspendRef = React.useRef<(() => void) | null>(null);
    React.useEffect(() => {
        if (openPicker !== 'project') return;
        projectSuspendRef.current?.();
        projectSuspendRef.current = shortcutRegistry.suspend();
        return () => {
            projectSuspendRef.current?.();
            projectSuspendRef.current = null;
        };
    }, [openPicker]);
    const handlePickerKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
        if (openPicker === null || !shouldDismissDropdown(event)) return;
        event.preventDefault();
        event.stopPropagation();
        keyboardCloseRef.current = true;
        setOpenPicker(null);
    };

    useKeybind('open_draft_project_picker', () => {
        if (!showProjectPicker) return false;
        projectTriggerRef.current?.focus();
        setProjectFocusReturn(false);
        setProjectQuery('');
        setProjectActiveId(
            projects.some((project) => project.id === selectedProject.id) ? selectedProject.id : null,
        );
        setOpenPicker('project');
    });
    useKeybind('open_draft_worktree_picker', () => {
        if (!showBranchSelector) return false;
        worktreeTriggerRef.current?.focus();
        onRefreshTarget?.();
        setOpenPicker('worktree');
    });

    const orderedProjects = useProjectsInSidebarOrder(projects, openPicker === 'project');
    const filteredProjects = React.useMemo(
        () => openPicker === 'project'
            ? rankByQuery(orderedProjects, projectQuery, (project) => [getProjectDisplayLabel(project), project.path])
            : orderedProjects,
        [openPicker, orderedProjects, projectQuery],
    );

    // Transient search must never survive to the next opening, including
    // picker switches and draft unmounts.
    React.useEffect(() => {
        if (openPicker !== 'project') {
            setProjectQuery('');
            setProjectActiveId(null);
        }
    }, [openPicker]);
    // After a query or project-list change, retain the active ID only
    // while it stays visible; otherwise fall to the first result (or none
    // when the list is empty) so Enter cannot commit a hidden row.
    React.useEffect(() => {
        if (openPicker !== 'project') return;
        setProjectActiveId((current) => {
            if (current && filteredProjects.some((project) => project.id === current)) return current;
            return filteredProjects[0]?.id ?? null;
        });
    }, [filteredProjects, openPicker]);

    const handleProjectChange = (projectId: string) => {
        onProjectChange(projectId);
        setProjectFocusReturn(true);
        setOpenPicker(null);
    };

    const handleProjectSelect = (projectId: string) => {
        if (!filteredProjects.some((project) => project.id === projectId)) return;
        handleProjectChange(projectId);
    };

    const handleDirectoryChange = (directory: string) => {
        onDirectoryChange(directory);
        setOpenPicker(null);
    };

    return (
        <div className="mb-1.5 flex min-w-0 items-center gap-1.5 px-0.5">
            {/* Plain popover (not a menu): the popup owns a combobox +
                listbox, so menu/menuitem semantics would be wrong here. */}
            {showProjectPicker ? <Popover.Root
                open={openPicker === 'project'}
                onOpenChange={(open, eventDetails) => {
                    if (open) {
                        setProjectFocusReturn(false);
                        // Seed the active row from the committed project so
                        // Enter without typing repeats the current choice.
                        // The clamp below keeps it when still visible and
                        // falls to the first result otherwise.
                        setProjectQuery('');
                        setProjectActiveId(
                            projects.some((project) => project.id === selectedProject.id)
                                ? selectedProject.id
                                : null,
                        );
                        setOpenPicker('project');
                        return;
                    }
                    setProjectQuery('');
                    setProjectActiveId(null);
                    const reason = eventDetails?.reason;
                    setProjectFocusReturn(reason === 'escape-key');
                    setOpenPicker(null);
                }}
                onOpenChangeComplete={(open) => {
                    // Return focus after Base UI finishes closing so typing
                    // continues in this form's composer, including reselection.
                    if (!open && projectFocusReturn) {
                        (getComposerInput() ?? projectTriggerRef.current)?.focus();
                        setProjectFocusReturn(false);
                    }
                    // Focus the search once the popup mounts; the opening
                    // shortcut focuses the trigger first.
                    if (open && openPicker === 'project') projectSearchRef.current?.focus();
                }}
            >
                <Popover.Trigger
                    render={
                        <Button
                            ref={projectTriggerRef}
                            variant="ghost"
                            size="sm"
                            aria-haspopup="dialog"
                            className="h-7 min-w-0 w-fit max-w-[42vw] justify-start gap-1 px-1.5 normal-case hover:bg-transparent data-[popup-open]:bg-transparent sm:max-w-[18rem]"
                            onPointerDownCapture={(event) => syncProjectPopupContainers(event.currentTarget)}
                            onFocusCapture={(event) => syncProjectPopupContainers(event.currentTarget)}
                        />
                    }
                >
                    <span className="flex min-w-0 items-center gap-1.5">
                        {selectedProject.kind === 'chat'
                            ? <span className="truncate typography-ui-label">{t('chat.chatInput.chooseProject')}</span>
                            : <ProjectLabel project={selectedProject} theme={theme} />}
                        <Icon name="arrow-down-s" className="size-4 shrink-0 opacity-50" />
                    </span>
                </Popover.Trigger>
                <Popover.Portal container={projectPortalContainer ?? undefined}>
                    {/* The search field sits on the trigger's edge of the
                        popup and stays fixed while filtering; only the
                        results area beyond it changes height. Opening
                        downward anchors the popup's top edge under the
                        trigger. A low trigger (Mini Chat) opens it upward
                        instead, anchored by its bottom edge, with the search
                        field moved to the bottom. The side is chosen once per
                        open and never flips while open, which would move the
                        input. Horizontal shifting keeps the popup inside
                        main. The --available-height cap comes free from the
                        shared popup class, so the list scrolls within the
                        space on the chosen side. */}
                    <Popover.Positioner
                        side={projectPopupSide}
                        align="start"
                        sideOffset={4}
                        collisionAvoidance={{ side: 'none' }}
                        collisionBoundary={projectCollisionBoundary ?? undefined}
                        className="app-region-no-drag z-50"
                    >
                        <Popover.Popup
                            role="dialog"
                            aria-label={t('chat.chatInput.draftPicker.projectTitle')}
                            className={cn(dropdownMenuPopupClass, 'flex w-72 max-w-[calc(100vw-2rem)] flex-col p-0')}
                            initialFocus={false}
                            finalFocus={false}
                        >
                            {/* Filtering and ordering are owned by rankByQuery above;
                                cmdk's own filter would re-filter and reorder the
                                already-ranked rows. */}
                            <Command
                                className={cn(
                                    'min-h-0 flex-1',
                                    // Upward: the search field goes to the bottom, next to
                                    // the trigger, with its divider above it.
                                    projectPopupSide === 'top' && commandSearchAtBottomClass,
                                )}
                                shouldFilter={false}
                                value={projectActiveId ?? undefined}
                                onValueChange={setProjectActiveId}
                            >
                                <CommandInput
                                    ref={projectSearchRef}
                                    aria-label={t('chat.chatInput.draftPicker.searchProjects')}
                                    placeholder={t('chat.chatInput.draftPicker.searchProjects')}
                                    value={projectQuery}
                                    onValueChange={setProjectQuery}
                                    onKeyDown={(event) => {
                                        // Command owns active-item navigation, so only
                                        // translate the repository's Ctrl+N/P
                                        // convention into arrows at the input.
                                        // IME-composing keys must never move the
                                        // active row or dismiss the popup.
                                        if (isIMECompositionEvent(event)) {
                                            event.stopPropagation();
                                            return;
                                        }
                                        handleDropdownNavigationKey(event, (navigationKey) => {
                                            event.currentTarget.dispatchEvent(new KeyboardEvent('keydown', {
                                                key: navigationKey,
                                                bubbles: true,
                                                cancelable: true,
                                            }));
                                        });
                                    }}
                                />
                                <CommandList label={t('chat.chatInput.draftPicker.projectTitle')}>
                                    {filteredProjects.length === 0 ? (
                                        <div role="status" className="px-3 py-6 text-center typography-ui-label text-muted-foreground">
                                            {t('chat.chatInput.draftPicker.noProjectsFound')}
                                        </div>
                                    ) : (
                                        filteredProjects.map((project) => (
                                            <CommandItem
                                                key={project.id}
                                                value={project.id}
                                                onSelect={handleProjectSelect}
                                                aria-current={project.id === selectedProject.id ? true : undefined}
                                                className="max-w-full"
                                            >
                                                <span className="min-w-0 flex-1 truncate">
                                                    <ProjectLabel project={project} theme={theme} />
                                                </span>
                                                {project.id === selectedProject.id ? (
                                                    <Icon name="check" className="size-4 shrink-0 text-muted-foreground" />
                                                ) : null}
                                            </CommandItem>
                                        ))
                                    )}
                                </CommandList>
                            </Command>
                        </Popover.Popup>
                    </Popover.Positioner>
                </Popover.Portal>
            </Popover.Root> : null}

            {showBranchSelector ? (
                <Select
                    value={selectedDirectory ?? branchItems[0]?.value ?? normalizePath(selectedProject.path) ?? ''}
                    open={openPicker === 'worktree'}
                    onOpenChange={(open, details) => {
                        keyboardCloseRef.current = !open && details.event.type === 'keydown';
                        if (open) {
                            onRefreshTarget?.();
                        }
                        setOpenPicker(open ? 'worktree' : null);
                    }}
                    onValueChange={handleDirectoryChange}
                    disableGlobalShortcuts
                >
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <SelectTrigger
                                ref={worktreeTriggerRef}
                                onKeyDown={handlePickerKeyDown}
                                className="h-7 min-w-0 w-fit max-w-[48vw] sm:max-w-[20rem] bg-transparent dark:bg-transparent shadow-none px-1.5 hover:[background-image:none] data-[popup-open]:[background-image:none]"
                            >
                                {hasUncommittedChanges ? (
                                    <Icon
                                        name="alert"
                                        className="size-3.5 shrink-0 text-[var(--status-warning)]"
                                        aria-label={t('chat.draftDirtyNotice.indicatorAria')}
                                    />
                                ) : null}
                                <SelectValue>
                                    {selectedBranchLabel ?? t('chat.chatInput.branch')}
                                </SelectValue>
                            </SelectTrigger>
                        </TooltipTrigger>
                        {hasUncommittedChanges ? (
                            <TooltipContent showArrow side="top" sideOffset={8} className="max-w-72">
                                <span className="block whitespace-pre-line">{t('chat.draftDirtyNotice.tooltip')}</span>
                            </TooltipContent>
                        ) : null}
                    </Tooltip>
                    <SelectContent side={worktreePopupSide} align="start" sideOffset={4} collisionAvoidance={{ side: 'none' }} constrainToMain className="w-max min-w-48" onKeyDown={handlePickerKeyDown} finalFocus={getFinalFocus}>
                        {projectRootBranchOption ? (
                            <SelectGroup>
                                <SelectLabel>{t('chat.chatInput.projectRoot')}</SelectLabel>
                                <SelectItem key={projectRootBranchOption.value} value={projectRootBranchOption.value} className="max-w-[24rem] truncate">
                                    {projectRootBranchOption.label}
                                </SelectItem>
                            </SelectGroup>
                        ) : null}
                        {projectRootBranchOption ? <SelectSeparator /> : null}
                        {/* Creating comes before the list, so a long list never hides it. */}
                        <WorktreeCreateActions
                            className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-start typography-ui-label hover:bg-[var(--interactive-hover)]"
                            onQuick={() => { setOpenPicker(null); void createWorktreeDraft(); }}
                            onCustom={onCreateCustomWorktree ? () => { setOpenPicker(null); onCreateCustomWorktree(); } : undefined}
                        />
                        <SelectSeparator />
                        <SelectGroup>
                            <SelectLabel>{t('chat.chatInput.worktrees')}</SelectLabel>
                            {worktreeBranchOptions.map((option) => (
                                <SelectItem key={option.value} value={option.value} className="max-w-[24rem] truncate">
                                    {option.pending ? '⏳ ' : ''}{option.label}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                        {selectedDirectory && !selectedBranchIsKnown ? (
                            <SelectItem value={selectedDirectory} className="max-w-[24rem] truncate">
                                {selectedBranchLabel}
                            </SelectItem>
                        ) : null}
                        {onCreateSpace ? (
                            <>
                                <SelectSeparator />
                                <div className="px-2 py-1.5">
                                    <button
                                        type="button"
                                        className="text-muted-foreground typography-meta hover:text-foreground cursor-pointer"
                                        onPointerDown={(e) => { e.stopPropagation(); }}
                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenPicker(null); onCreateSpace(); }}
                                    >
                                        {t('spaces.picker.new')}
                                    </button>
                                </div>
                            </>
                        ) : null}
                    </SelectContent>
                </Select>
            ) : null}
        </div>
    );
}

/** Mobile: buttons that open the bottom sheets below. */
export function MobileDraftTargetTriggers(
    props: Pick<DraftTargetProps, 'selectedProject' | 'selectedBranchLabel' | 'showBranchSelector' | 'theme' | 'showProjectPicker'>
        & { onOpenPicker: (picker: 'project' | 'branch') => void },
) {
    const { t } = useI18n();
    const { selectedProject, selectedBranchLabel, showBranchSelector, theme, onOpenPicker, showProjectPicker = true } = props;

    return (
        <div className="mb-1.5 flex min-w-0 items-center gap-x-2 px-0.5">
            {showProjectPicker ? <button
                type="button"
                className="inline-flex h-7 min-w-0 max-w-[42vw] flex-shrink cursor-pointer items-center gap-1 rounded-lg px-1.5 typography-micro font-medium text-foreground/80 hover:bg-[var(--interactive-hover)]"
                onClick={() => onOpenPicker('project')}
            >
                {selectedProject.kind === 'chat'
                    ? <span className="truncate typography-ui-label">{t('chat.chatInput.chooseProject')}</span>
                    : <ProjectLabel project={selectedProject} theme={theme} />}
                <Icon name="arrow-down-s" className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
            </button> : null}
            {showBranchSelector ? (
                <button
                    type="button"
                    className="inline-flex h-7 min-w-0 max-w-[48vw] flex-shrink cursor-pointer items-center gap-1 rounded-lg px-1.5 typography-micro font-medium text-foreground/80 hover:bg-[var(--interactive-hover)]"
                    onClick={() => onOpenPicker('branch')}
                >
                    <span className="truncate">{selectedBranchLabel ?? t('chat.chatInput.branch')}</span>
                    <Icon name="arrow-down-s" className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                </button>
            ) : null}
        </div>
    );
}

/**
 * Mobile: bottom-sheet project picker shared by the composer draft target and
 * the settings sections' project selector. A bottom sheet rather than a select
 * because a native select over a keyboard-resized viewport is unusable.
 */
interface ProjectPickerSheetProps {
    open: boolean;
    onClose: () => void;
    projects: readonly DraftTargetProject[];
    selectedProjectId: string;
    onSelectProject: (projectId: string) => void;
    theme: Theme;
    title: string;
    searchPlaceholder: string;
}

export function ProjectPickerSheet({
    open,
    onClose,
    projects,
    selectedProjectId,
    onSelectProject,
    theme,
    title,
    searchPlaceholder,
}: ProjectPickerSheetProps) {
    const [query, setQuery] = React.useState('');

    // Reset the search whenever the sheet opens or closes.
    React.useEffect(() => {
        setQuery('');
    }, [open]);

    return (
        <MobileOverlayPanel open={open} title={title} onClose={onClose}>
            <div className="flex flex-col gap-2 px-3 pb-4 pt-1">
                <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    aria-label={searchPlaceholder}
                    placeholder={searchPlaceholder}
                    className="h-9"
                />
                <div className="flex flex-col">
                    {rankByQuery(projects, query, (project) => [getProjectDisplayLabel(project), project.path])
                        .map((project) => (
                            <button
                                key={project.id}
                                type="button"
                                className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2.5 text-start typography-ui-label hover:bg-[var(--interactive-hover)]"
                                onClick={() => {
                                    onSelectProject(project.id);
                                    onClose();
                                }}
                            >
                                <span className="min-w-0 flex-1"><ProjectLabel project={project} theme={theme} /></span>
                                {project.id === selectedProjectId ? (
                                    <Icon name="check" className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                                ) : null}
                            </button>
                        ))}
                </div>
            </div>
        </MobileOverlayPanel>
    );
}

/**
 * Mobile: the project and branch sheets. Bottom sheets rather than selects
 * because a native select over a keyboard-resized viewport is unusable.
 */
export function MobileDraftTargetSheets(
    props: DraftTargetProps & {
        openPicker: 'project' | 'branch' | null;
        onOpenPickerChange: (picker: 'project' | 'branch' | null) => void;
    },
) {
    const { t } = useI18n();
    const {
        projects,
        selectedProject,
        selectedDirectory,
        selectedBranchLabel,
        selectedBranchIsKnown,
        projectRootBranchOption,
        worktreeBranchOptions,
        branchItems,
        onProjectChange,
        onDirectoryChange,
        onCreateSpace,
        onCreateCustomWorktree,
        openPicker,
        onOpenPickerChange,
        showProjectPicker = true,
        theme,
    } = props;

    const [branchQuery, setBranchQuery] = React.useState('');
    const orderedProjects = useProjectsInSidebarOrder(projects, openPicker === 'project');

    // Reset the branch search whenever the branch sheet opens or closes.
    React.useEffect(() => {
        setBranchQuery('');
    }, [openPicker]);

    return (
        <>
            {showProjectPicker ? <ProjectPickerSheet
                open={openPicker === 'project'}
                onClose={() => onOpenPickerChange(null)}
                projects={orderedProjects}
                selectedProjectId={selectedProject.id}
                onSelectProject={onProjectChange}
                theme={theme}
                title={t('chat.chatInput.draftPicker.projectTitle')}
                searchPlaceholder={t('chat.chatInput.draftPicker.searchProjects')}
            /> : null}
            <MobileOverlayPanel
                open={openPicker === 'branch'}
                title={t('chat.chatInput.branch')}
                onClose={() => onOpenPickerChange(null)}
            >
                <div className="flex flex-col gap-2 px-3 pb-4 pt-1">
                    <Input
                        value={branchQuery}
                        onChange={(event) => setBranchQuery(event.target.value)}
                        placeholder={t('chat.chatInput.draftPicker.searchBranches')}
                        className="h-9"
                    />
                    <div className="flex flex-col">
                        {(() => {
                            const matches = (label: string) => matchesRankQuery([label], branchQuery);
                            const selectedValue = selectedDirectory
                                ?? branchItems[0]?.value
                                ?? normalizePath(selectedProject.path)
                                ?? '';
                            const renderRow = (value: string, label: React.ReactNode, key?: string) => (
                                <button
                                    key={key ?? value}
                                    type="button"
                                    className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2.5 text-start typography-ui-label hover:bg-[var(--interactive-hover)]"
                                    onClick={() => {
                                        onDirectoryChange(value);
                                        onOpenPickerChange(null);
                                    }}
                                >
                                    <span className="min-w-0 flex-1 truncate">{label}</span>
                                    {value === selectedValue ? (
                                        <Icon name="check" className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                                    ) : null}
                                </button>
                            );
                            return (
                                <>
                                    {projectRootBranchOption && matches(projectRootBranchOption.label) ? (
                                        <>
                                            <div className="px-2 pb-1 pt-1.5 text-muted-foreground typography-meta">
                                                {t('chat.chatInput.projectRoot')}
                                            </div>
                                            {renderRow(projectRootBranchOption.value, projectRootBranchOption.label)}
                                        </>
                                    ) : null}
                                    <div className="my-1 h-px bg-border" />
                                    <WorktreeCreateActions
                                        className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2.5 text-start typography-ui-label hover:bg-[var(--interactive-hover)]"
                                        onQuick={() => { onOpenPickerChange(null); void createWorktreeDraft(); }}
                                        onCustom={onCreateCustomWorktree ? () => { onOpenPickerChange(null); onCreateCustomWorktree(); } : undefined}
                                    />
                                    <div className="my-1 h-px bg-border" />
                                    <div className="px-2 pb-1 pt-2 text-muted-foreground typography-meta">
                                        {t('chat.chatInput.worktrees')}
                                    </div>
                                    {rankByQuery(worktreeBranchOptions, branchQuery, (option) => [option.label])
                                        .map((option) => renderRow(option.value, `${option.pending ? '⏳ ' : ''}${option.label}`))}
                                    {selectedDirectory && !selectedBranchIsKnown && matches(selectedBranchLabel ?? '')
                                        ? renderRow(selectedDirectory, selectedBranchLabel, 'unknown-current')
                                        : null}
                                    {onCreateSpace ? (
                                        <div className="px-2 pb-1 pt-2">
                                            <button
                                                type="button"
                                                className="cursor-pointer text-muted-foreground typography-meta hover:text-foreground"
                                                onClick={() => {
                                                    onOpenPickerChange(null);
                                                    onCreateSpace();
                                                }}
                                            >
                                                {t('spaces.picker.new')}
                                            </button>
                                        </div>
                                    ) : null}
                                </>
                            );
                        })()}
                    </div>
                </div>
            </MobileOverlayPanel>
        </>
    );
}

/** Memoized: the composer re-renders on every keystroke, and nothing here depends on the draft text. */
export const DraftTargetSelectors = React.memo(DraftTargetSelectorsView);
