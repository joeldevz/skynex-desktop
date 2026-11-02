import React from 'react';
import { createPortal } from 'react-dom';
import { isIMECompositionEvent } from '@/lib/ime';
import { DirectoryExplorerDialog } from '@/components/session/DirectoryExplorerDialog';
import { Icon } from '@/components/icon/Icon';
import { SessionSidebar } from '@/components/session/SessionSidebar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useI18n } from '@/lib/i18n';
import { refreshGlobalSessions } from '@/stores/useGlobalSessionsStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { seedGlobalSessionStatusFromHost } from '@/sync/host-session-status-seed';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useAllLiveSessions } from '@/sync/sync-context';

import { MobileSidebarActionsProvider } from './mobileSidebar/mobileSidebarState';
import { useEdgeSwipe } from './useEdgeSwipe';

type MobileSessionsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 'drawer' (default) renders a full-width left drawer over the app;
      'sidebar' renders the same content inline for the iPad persistent
      sidebar, kept mounted while it is hidden, with `open` saying whether
      it is shown. */
  variant?: 'drawer' | 'sidebar';
  /** App-level footer bar (desktop-sidebar-style): current instance on the
      left, settings (and, on hosted web, a pending update) on the right. */
  footer?: {
    /** Connected instance label — Capacitor only; null hides the left slot. */
    instanceLabel: string | null;
    onOpenInstances?: () => void;
    onOpenSettings: () => void;
    onOpenScheduled: () => void;
    onOpenArchive: () => void;
    onOpenUsage: () => void;
    /** The overview of what waits, runs and looks done; absent while the feature is not in this build. */
    onOpenOverview?: () => void;
    /** The issues and PRs board. */
    onOpenSourceBoard: () => void;
    /** Present only while a server update is available (hosted web). */
    onOpenUpdate?: () => void;
  };
};

/** Menu rows tall enough for a thumb. */
const MOBILE_MENU_ITEM_CLASS = 'min-h-10 items-center justify-between';

/**
 * The phone's sessions drawer, and the iPad's sidebar. It holds the workspace
 * overview, New chat and Add project actions, plus the app-level footer.
 */
export const MobileSessionsSheet: React.FC<MobileSessionsSheetProps> = ({ open, onOpenChange, variant = 'drawer', footer }) => {
  const { t } = useI18n();
  const liveSessions = useAllLiveSessions();
  const projects = useProjectsStore((state) => state.projects);
  const openNewSessionDraft = useSessionUIStore((state) => state.openNewSessionDraft);
  const [directoryDialogOpen, setDirectoryDialogOpen] = React.useState(false);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    // The mobile shell has no global poller, so this load is also where the
    // host seed runs, as the poller runs it after each load elsewhere: a
    // question or permission already waiting at startup is otherwise missing
    // from the cross-directory index the rows read. The seed resolves
    // directories from the list just loaded, so it runs after it.
    void refreshGlobalSessions(liveSessions).then(() => seedGlobalSessionStatusFromHost());
    // intentionally only on open transition — session events keep the list current after that
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const close = React.useCallback(() => onOpenChange(false), [onOpenChange]);
  const newChatButton = projects.length > 0 ? (
    <Button
      type="button"
      variant="default"
      size="sm"
      aria-label={t('mobile.sessions.newChat')}
      onClick={() => {
        openNewSessionDraft();
        close();
      }}
      style={{ touchAction: 'manipulation' }}
    >
      <Icon name="add" className="size-4" />
      {t('mobile.sessions.newChat')}
    </Button>
  ) : null;

  const addProjectButton = (
    <Button
      type="button"
      variant="chip"
      size="sm"
      aria-label={t('sessions.sidebar.header.actions.addProject')}
      title={t('sessions.sidebar.header.actions.addProject')}
      onClick={() => setDirectoryDialogOpen(true)}
      style={{ touchAction: 'manipulation' }}
    >
      <Icon name="folder-add" className="size-4" />
    </Button>
  );

  const trailingActions = (
    <>
      {addProjectButton}
      {newChatButton}
    </>
  );

  // flex-1 + min-h-0 rather than h-full: both hosts put a fixed-height header
  // above this, so a 100% height overflows by exactly that header — and the
  // clipped overflow swallowed the footer.
  const surfaceContent = (
      <div className="flex min-h-0 flex-1 flex-col">
        <MobileSidebarActionsProvider value={{ close }}>
          <SessionSidebar mobileVariant />
        </MobileSidebarActionsProvider>

        {/* App-level footer: the connected instance (Capacitor) on the left;
            on the right the pages opened less often behind "More", then a
            pending web update, the overview, the issues board and Settings.
            Settings is the one filled button; the rest are flat, as the
            header's. Bottom placement keeps the header for list actions and
            stays thumb-reachable. */}
        {footer ? (
          <div
            className="flex shrink-0 items-center justify-between gap-2 border-t border-border/70 px-3 pt-1.5"
            style={{ paddingBottom: 'calc(0.375rem + var(--oc-safe-area-bottom, 0px))' }}
          >
            <div className="flex min-w-0 items-center">
              {footer.instanceLabel && footer.onOpenInstances ? (
                <Button
                  type="button"
                  variant="info"
                  size="lg"
                  className="min-w-0 shrink justify-start"
                  onClick={footer.onOpenInstances}
                  aria-label={t('mobile.menu.instances')}
                  style={{ touchAction: 'manipulation' }}
                >
                  <Icon name="server" className="size-[18px]" />
                  <span className="block min-w-0 truncate">{footer.instanceLabel}</span>
                </Button>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="chip"
                    size="lg"
                    className="w-10 shrink-0 px-0"
                    aria-label={t('mobile.sessions.footer.more')}
                    title={t('mobile.sessions.footer.more')}
                    style={{ touchAction: 'manipulation' }}
                  >
                    <Icon name="more" className="size-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end" className="w-56">
                  <DropdownMenuItem onClick={footer.onOpenScheduled} className={MOBILE_MENU_ITEM_CLASS}>
                    <span className="flex items-center gap-2">
                      <Icon name="calendar-schedule" className="size-4" />
                      {t('sessions.sidebar.header.actions.scheduledTasks')}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={footer.onOpenArchive} className={MOBILE_MENU_ITEM_CLASS}>
                    <span className="flex items-center gap-2">
                      <Icon name="archive" className="size-4" />
                      {t('sessions.sidebar.nav.archive')}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={footer.onOpenUsage} className={MOBILE_MENU_ITEM_CLASS}>
                    <span className="flex items-center gap-2">
                      <Icon name="bar-chart" className="size-4" />
                      {t('usageStats.openAction')}
                    </span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {footer.onOpenUpdate ? (
                <Button
                  type="button"
                  variant="chip"
                  size="lg"
                  className="w-10 px-0"
                  onClick={footer.onOpenUpdate}
                  aria-label={t('mobile.menu.update')}
                  title={t('mobile.menu.update')}
                  style={{ touchAction: 'manipulation' }}
                >
                  <Icon name="download" className="size-5" />
                  <span className="absolute inset-e-2 top-2 inline-flex size-2 rounded-full bg-primary" aria-hidden />
                </Button>
              ) : null}
              {footer.onOpenOverview ? (
                <Button
                  type="button"
                  variant="chip"
                  size="lg"
                  className="w-10 px-0"
                  onClick={footer.onOpenOverview}
                  aria-label={t('overview.title')}
                  title={t('overview.title')}
                  style={{ touchAction: 'manipulation' }}
                >
                  <Icon name="compass-3" className="size-5" />
                </Button>
              ) : null}
              <Button
                type="button"
                variant="chip"
                size="lg"
                className="w-10 px-0"
                onClick={footer.onOpenSourceBoard}
                aria-label={t('sourceBoard.title')}
                title={t('sourceBoard.title')}
                style={{ touchAction: 'manipulation' }}
              >
                <Icon name="git-pull-request" className="size-5" />
              </Button>
              <Button
                type="button"
                variant="default"
                size="lg"
                className="w-10 px-0"
                onClick={footer.onOpenSettings}
                aria-label={t('mobile.menu.settings')}
                title={t('mobile.menu.settings')}
                style={{ touchAction: 'manipulation' }}
              >
                <Icon name="settings-3" className="size-5" />
              </Button>
            </div>
          </div>
        ) : null}

        <DirectoryExplorerDialog open={directoryDialogOpen} onOpenChange={setDirectoryDialogOpen} />
      </div>
  );

  if (variant === 'sidebar') {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-[var(--oc-header-height,56px)] shrink-0 items-center gap-2 border-b border-border/70 px-3">
          <div className="ms-auto flex shrink-0 items-center gap-2">{trailingActions}</div>
        </div>
        {surfaceContent}
      </div>
    );
  }

  return (
    <MobileSessionsDrawerContainer
      open={open}
      onClose={close}
      onSwipeClose={close}
      ariaLabel={t('mobile.sessions.sheet.title')}
    >
      <div className="flex h-[var(--oc-header-height,56px)] shrink-0 items-center gap-2 px-3">
        <button
          type="button"
          className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={t('mobile.surface.closeAria')}
          onClick={close}
          style={{ touchAction: 'manipulation' }}
        >
          <Icon name="close" className="size-5" />
        </button>
        <div className="ms-auto flex shrink-0 items-center gap-2">{trailingActions}</div>
      </div>
      {surfaceContent}
    </MobileSessionsDrawerContainer>
  );
};

const DRAWER_ROOT_ID = 'mobile-surface-root';
const DRAWER_ENTER_DELAY_MS = 16;
// Slightly long, decelerating slide — matches the workspace drawer so both
// sides feel like the same piece of chrome.
const DRAWER_ENTER_DURATION_MS = 320;
const DRAWER_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

/** Full-width left drawer for the workspace overview: covers the whole app
    and slides in from the left edge. Closes via the header X, a right-edge
    swipe back toward the left (the mirror of the gesture that opened it),
    Escape, or the Android back button (handled by MobileShell).

    Stays MOUNTED while closed (parked off-screen, hidden), so the close slide can
    actually play instead of the drawer vanishing on unmount. */
const MobileSessionsDrawerContainer: React.FC<{
  open: boolean;
  onClose: () => void;
  /** What the closing edge swipe does; the drawer's owner may want it to undo
      a lighter state first. Falls back to `onClose`. */
  onSwipeClose?: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}> = ({ open, onClose, onSwipeClose, ariaLabel, children }) => {
  const { direction } = useI18n();
  const rootRef = React.useRef<HTMLElement | null>(null);
  const drawerRef = React.useRef<HTMLElement>(null);
  const [entered, setEntered] = React.useState(false);
  // Kept visible through the exit slide; flipped to hidden once it finishes.
  const [visible, setVisible] = React.useState(open);
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const onSwipeCloseRef = React.useRef(onSwipeClose);
  React.useEffect(() => {
    onSwipeCloseRef.current = onSwipeClose;
  }, [onSwipeClose]);

  // Swipe from the drawer's end edge back toward its start = close, the
  // reverse of the start-edge swipe that opened it from the chat.
  const closeFromEdge = () => (onSwipeCloseRef.current ?? onCloseRef.current)();
  useEdgeSwipe(drawerRef, {
    enabled: open,
    ...(direction === 'rtl' ? { onLeftEdgeSwipe: closeFromEdge } : { onRightEdgeSwipe: closeFromEdge }),
  });

  if (typeof document !== 'undefined' && !rootRef.current) {
    let root = document.getElementById(DRAWER_ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = DRAWER_ROOT_ID;
      document.body.appendChild(root);
    }
    rootRef.current = root;
  }

  React.useEffect(() => {
    if (open) {
      setVisible(true);
      const id = window.setTimeout(() => setEntered(true), DRAWER_ENTER_DELAY_MS);
      return () => window.clearTimeout(id);
    }
    setEntered(false);
    const id = window.setTimeout(() => setVisible(false), DRAWER_ENTER_DURATION_MS + 40);
    return () => window.clearTimeout(id);
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isIMECompositionEvent(event)) onCloseRef.current();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!rootRef.current) return null;

  return createPortal(
    <section
      ref={drawerRef}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      aria-hidden={!open}
      className="oc-keyboard-inset-surface fixed inset-0 z-50 flex flex-col bg-background text-foreground"
      style={{
        paddingTop: 'var(--oc-safe-area-top, 0px)',
        // Settled state drops the transform entirely so the drawer isn't kept
        // on a compositing layer (iOS clips those to the safe-area viewport).
        transform: entered ? 'none' : direction === 'rtl' ? 'translateX(100%)' : 'translateX(-100%)',
        transition: `transform ${DRAWER_ENTER_DURATION_MS}ms ${DRAWER_EASING}`,
        visibility: visible ? 'visible' : 'hidden',
        pointerEvents: open ? 'auto' : 'none',
      }}
    >
      <div className="flex h-full min-h-0 flex-col">
        {children}
      </div>
    </section>,
    rootRef.current,
  );
};
