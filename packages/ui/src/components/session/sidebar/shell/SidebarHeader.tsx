import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useEnterpriseMode } from '@/stores/useEnterprisePolicyStore';
import { useUIStore } from '@/stores/useUIStore';

const PRESSED_PAGE_BUTTON_CLASS = 'bg-interactive-selection text-interactive-selection-foreground hover:bg-interactive-selection hover:text-interactive-selection-foreground';
const IDLE_PAGE_BUTTON_CLASS = 'text-muted-foreground hover:text-foreground hover:bg-transparent';

function SidebarPageButton({ label, pressed, onClick, className, children }: {
  label: string;
  pressed: boolean;
  onClick: () => void;
  className: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(className, pressed ? PRESSED_PAGE_BUTTON_CLASS : IDLE_PAGE_BUTTON_CLASS)}
          aria-label={label}
          aria-pressed={pressed}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}><p>{label}</p></TooltipContent>
    </Tooltip>
  );
}

/** Page actions shown in the workspace navigation row. */
export function SidebarPageButtons({ showSourceBoard, buttonClassName, iconClassName }: {
  showSourceBoard: boolean;
  buttonClassName: string;
  iconClassName: string;
}): React.ReactNode {
  const { t } = useI18n();
  const isSourceBoardOpen = useUIStore((state) => state.isSourceBoardOpen);
  const isOverviewOpen = useUIStore((state) => state.isOverviewOpen);
  const overviewAvailable = useUIStore((state) => state.overviewFeatureAvailable);
  const isArchiveOpen = useUIStore((state) => state.isArchivePageOpen);
  const isIntegrationsCatalogOpen = useUIStore((state) => state.isIntegrationsCatalogOpen);
  const isScheduledTasksOpen = useUIStore((state) => state.isScheduledTasksDialogOpen);
  const enterpriseMode = useEnterpriseMode();
  return (
    <div className="flex items-center gap-1">
      {showSourceBoard && overviewAvailable ? (
        <SidebarPageButton label={t('overview.title')} pressed={isOverviewOpen} onClick={() => useUIStore.getState().setOverviewOpen(!isOverviewOpen)} className={buttonClassName}>
          <Icon name="compass-3" className={iconClassName} />
        </SidebarPageButton>
      ) : null}
      {showSourceBoard ? (
        <SidebarPageButton label={t('sourceBoard.title')} pressed={isSourceBoardOpen} onClick={() => useUIStore.getState().setSourceBoardOpen(!isSourceBoardOpen)} className={buttonClassName}>
          <Icon name="git-pull-request" className={iconClassName} />
        </SidebarPageButton>
      ) : null}
      <SidebarPageButton label={t('sessions.sidebar.nav.archive')} pressed={isArchiveOpen} onClick={() => useUIStore.getState().setArchivePageOpen(!isArchiveOpen)} className={buttonClassName}>
        <Icon name="archive" className={iconClassName} />
      </SidebarPageButton>
      {enterpriseMode ? null : (
        <SidebarPageButton label={t('integrationsCatalog.sidebar.open')} pressed={isIntegrationsCatalogOpen} onClick={() => useUIStore.getState().setIntegrationsCatalogOpen(!isIntegrationsCatalogOpen)} className={buttonClassName}>
          <Icon name="store-2" className={iconClassName} />
        </SidebarPageButton>
      )}
      <SidebarPageButton label={t('sessions.sidebar.header.actions.scheduledTasks')} pressed={isScheduledTasksOpen} onClick={() => useUIStore.getState().setScheduledTasksDialogOpen(!isScheduledTasksOpen)} className={buttonClassName}>
        <Icon name="calendar-schedule" className={iconClassName} />
      </SidebarPageButton>
    </div>
  );
}
