import React from 'react';
import { useUIStore } from '@/stores/useUIStore';
import { isVSCodeRuntime } from '@/lib/desktop';
import { UpdateDialog } from '@/components/ui/UpdateDialog';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { useUpdateStore } from '@/stores/useUpdateStore';
import { useShallow } from 'zustand/react/shallow';
import { SidebarFooter } from './sidebar/shell/SidebarFooter';
import { SidebarPageButtons } from './sidebar/shell/SidebarHeader';
import { WorkspaceNavigation } from './workspaces/WorkspaceNavigation';
import { SessionClosePresenter } from './workspaces/SessionClosePresenter';
import { TooltipProvider } from '@/components/ui/tooltip';

interface SessionSidebarProps {
  mobileVariant?: boolean;
  hostOwnsChrome?: boolean;
  onSessionSelected?: (sessionId: string) => void;
}

function SidebarFooterController({ mobileVariant, isVSCode }: { mobileVariant: boolean; isVSCode: boolean }) {
  const { t } = useI18n();
  const [updateDialogOpen, setUpdateDialogOpen] = React.useState(false);
  const setSettingsDialogOpen = useUIStore((state) => state.setSettingsDialogOpen);
  const toggleHelpDialog = useUIStore((state) => state.toggleHelpDialog);
  const setAboutDialogOpen = useUIStore((state) => state.setAboutDialogOpen);
  const setSessionSwitcherOpen = useUIStore((state) => state.setSessionSwitcherOpen);
  const updateStore = useUpdateStore(useShallow((state) => ({
    checkForUpdates: state.checkForUpdates,
    available: state.available,
    runtimeType: state.runtimeType,
    info: state.info,
    downloading: state.downloading,
    downloaded: state.downloaded,
    installing: state.installing,
    progress: state.progress,
    error: state.error,
    downloadUpdate: state.downloadUpdate,
    restartToUpdate: state.restartToUpdate,
  })));

  const openUpdateDialog = React.useCallback(() => {
    const current = useUpdateStore.getState();
    if (current.available && current.info) {
      setUpdateDialogOpen(true);
      return;
    }
    void updateStore.checkForUpdates().then(() => {
      const { available, error } = useUpdateStore.getState();
      if (error) {
        toast.error(t('sessions.sidebar.updateCheck.errorTitle'), { description: error });
      } else if (!available) {
        toast.success(t('sessions.sidebar.updateCheck.latestVersion'));
      } else {
        setUpdateDialogOpen(true);
      }
    });
  }, [t, updateStore]);

  return <TooltipProvider delay={400} closeDelay={0} timeout={300}>
    <>
      <SidebarFooter
        onOpenSettings={() => {
          if (mobileVariant) setSessionSwitcherOpen(false);
          setSettingsDialogOpen(true);
        }}
        onOpenShortcuts={toggleHelpDialog}
        onOpenAbout={() => setAboutDialogOpen(true)}
        onOpenUpdate={openUpdateDialog}
        showRuntimeButtons={!isVSCode}
        showUpdateButton={updateStore.available && (updateStore.runtimeType === 'desktop' || updateStore.runtimeType === 'web')}
      />
      <UpdateDialog
        open={updateDialogOpen}
        onOpenChange={setUpdateDialogOpen}
        info={updateStore.info}
        downloading={updateStore.downloading}
        downloaded={updateStore.downloaded}
        installing={updateStore.installing}
        progress={updateStore.progress}
        error={updateStore.error}
        onDownload={updateStore.downloadUpdate}
        onRestart={updateStore.restartToUpdate}
        runtimeType={updateStore.runtimeType}
      />
    </>
  </TooltipProvider>;
}

const MOBILE_HEADER_ACTION_BUTTON_CLASS = 'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md leading-none text-muted-foreground hover:text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none disabled:cursor-not-allowed';
const HEADER_ACTION_ICON_CLASS = 'h-4 w-4';

export const SessionSidebar = React.memo(function SessionSidebar(props: SessionSidebarProps) {
  const isVSCode = isVSCodeRuntime();
  return <>
    <WorkspaceNavigation
      inlineOverview={Boolean(props.mobileVariant) || isVSCode}
      onSelected={props.onSessionSelected}
      footer={props.hostOwnsChrome ? undefined : <SidebarFooterController mobileVariant={Boolean(props.mobileVariant)} isVSCode={isVSCode} />}
      pageButtons={props.hostOwnsChrome || !props.mobileVariant ? undefined : <SidebarPageButtons
        showSourceBoard={false}
        buttonClassName={MOBILE_HEADER_ACTION_BUTTON_CLASS}
        iconClassName={HEADER_ACTION_ICON_CLASS}
      />}
    />
    <SessionClosePresenter />
  </>;
});
