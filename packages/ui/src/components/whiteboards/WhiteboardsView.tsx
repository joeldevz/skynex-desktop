import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { dropdownTriggerVariants } from '@/components/ui/dropdown-trigger';
import { useI18n } from '@/lib/i18n';
import { recordDesktopFeature } from '@/lib/desktop';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { getCurrentIntlLocale } from '@/lib/i18n/intl';
import { cn } from '@/lib/utils';
import { askAgentAboutBoard } from '@/lib/whiteboards/ask';
import { boardTitleFrom, type Whiteboard } from '@/lib/whiteboards/model';
import { workspacesForDirectory } from '@/lib/whiteboards/workspaces';
import type { Workspace } from '@/lib/workspaces/model';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { openBoardBesideChat } from '@/lib/whiteboards/panel';
import { useUIStore } from '@/stores/useUIStore';
import { useWhiteboardsStore } from '@/stores/useWhiteboardsStore';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';
import { WhiteboardCanvas } from './WhiteboardCanvas';
import { WhiteboardThumbnail } from './WhiteboardThumbnail';

/**
 * The Whiteboards page: every board of every workspace, or of one, and the
 * board the user opened, full size.
 */
export function WhiteboardsView() {
  const open = useUIStore((state) => state.isWhiteboardsPageOpen);
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-10 bg-background">
      <WhiteboardsPage />
    </div>
  );
}

/** On a phone the page is a fullscreen surface: it closes itself, and leaves when a request goes to a new chat. */
type MobileFrame = { onClose: () => void; onLeave: () => void };

/** The Whiteboards page inside the phone's fullscreen surface. */
export function MobileWhiteboards({ onClose, onLeave }: MobileFrame) {
  return <WhiteboardsPage mobile={{ onClose, onLeave }} />;
}

/** What the user asked to draw when creating a board, waiting for that board to open. */
type FirstAsk = { boardId: string; text: string };

function WhiteboardsPage({ mobile }: { mobile?: MobileFrame }) {
  const pageBoardId = useWhiteboardsStore((state) => state.pageBoardId);
  const board = useWhiteboardsStore((state) => (pageBoardId ? state.boards[pageBoardId] : undefined));
  const loadList = useWhiteboardsStore((state) => state.loadList);
  const [firstAsk, setFirstAsk] = React.useState<FirstAsk | null>(null);

  React.useEffect(() => {
    void loadList();
  }, [loadList]);

  if (pageBoardId) {
    return (
      <WhiteboardPage
        boardId={pageBoardId}
        board={board}
        mobile={mobile}
        firstAsk={firstAsk?.boardId === pageBoardId ? firstAsk.text : null}
        onFirstAskSent={() => setFirstAsk(null)}
      />
    );
  }
  return (
    <WhiteboardGallery
      mobile={mobile}
      onCreated={(boardId, request) => {
        setFirstAsk(request ? { boardId, text: request } : null);
        useWhiteboardsStore.getState().setPageBoard(boardId);
      }}
    />
  );
}

/** The title of a board, editable in place. */
export function BoardTitle({ board, className }: { board: Whiteboard; className?: string }) {
  const { t } = useI18n();
  const rename = useWhiteboardsStore((state) => state.rename);
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(board.title);

  const finish = async (save: boolean) => {
    setEditing(false);
    const title = value.trim();
    if (!save || !title || title === board.title) {
      setValue(board.title);
      return;
    }
    if (!(await rename(board.id, title))) toast.error(t('whiteboards.page.renameFailed'));
  };

  if (editing) {
    return (
      <input
        autoFocus
        value={value}
        maxLength={120}
        aria-label={t('whiteboards.page.rename')}
        onChange={(event) => setValue(event.target.value)}
        onBlur={() => void finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') void finish(true);
          if (event.key === 'Escape') void finish(false);
        }}
        className={cn('min-w-0 rounded-md bg-[var(--surface-elevated)] px-1.5 typography-ui-header font-semibold text-foreground outline-none', className)}
      />
    );
  }
  return (
    <button
      type="button"
      title={t('whiteboards.page.rename')}
      onClick={() => {
        setValue(board.title);
        setEditing(true);
      }}
      className={cn('min-w-0 truncate rounded-md px-1.5 text-start typography-ui-header font-semibold text-foreground hover:bg-interactive-hover', className)}
    >
      {board.title}
    </button>
  );
}

function WhiteboardPage({ boardId, board, mobile, firstAsk, onFirstAskSent }: {
  boardId: string;
  board: Whiteboard | undefined;
  mobile?: MobileFrame;
  firstAsk: string | null;
  onFirstAskSent: () => void;
}) {
  const { t } = useI18n();
  const loadBoard = useWhiteboardsStore((state) => state.loadBoard);
  const failed = useWhiteboardsStore((state) => Boolean(state.failedBoardIds[boardId]));
  const setPageBoard = useWhiteboardsStore((state) => state.setPageBoard);
  const workspaceName = useWorkspacesStore((state) => state.catalog.workspaces.find((entry) => entry.id === board?.workspaceId)?.name);

  React.useEffect(() => {
    void loadBoard(boardId);
  }, [boardId, loadBoard]);

  const onAsk = React.useCallback(async (text: string, selectedIds: string[], commentId?: string) => {
    if (!board) return { kind: 'failed' } as const;
    const outcome = await askAgentAboutBoard(board, text, selectedIds, commentId);
    if (outcome.kind === 'sent') {
      // The request and the agent's answer are in the chat, under this page: one tap shows them.
      toast.success(t('whiteboards.page.askSent'), {
        action: {
          label: t('whiteboards.page.viewChat'),
          onClick: () => {
            if (mobile) mobile.onLeave();
            else useUIStore.getState().setWhiteboardsPageOpen(false);
          },
        },
      });
    }
    // The request waits in a new chat's composer; on a phone that chat is under this page.
    if (outcome.kind === 'drafted') mobile?.onLeave();
    return outcome;
  }, [board, mobile, t]);
  const firstAskProp = React.useMemo(() => (firstAsk ? { text: firstAsk, onSent: onFirstAskSent } : undefined), [firstAsk, onFirstAskSent]);

  return (
    <div className="flex size-full min-h-0 flex-col bg-background">
      <div className={cn('flex shrink-0 items-center gap-1.5 px-3', mobile ? 'h-[var(--oc-header-height,56px)]' : 'h-12')}>
        <Button size="sm" variant="ghost" className={cn(mobile && 'size-10 rounded-full p-0')} aria-label={t('whiteboards.page.back')} title={t('whiteboards.page.back')} onClick={() => setPageBoard(null)}>
          <Icon name="arrow-left" className={cn('rtl:-scale-x-100', mobile ? 'size-5' : 'size-4')} />
        </Button>
        {board ? <BoardTitle board={board} /> : null}
        {workspaceName && !mobile ? <span className="oc-tile-inset truncate rounded-md px-1.5 py-0.5 typography-meta text-muted-foreground">{workspaceName}</span> : null}
        <div className="ms-auto flex items-center gap-1">
          {board && !mobile ? (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => {
                if (openBoardBesideChat(board)) useUIStore.getState().setWhiteboardsPageOpen(false);
              }}
            >
              <Icon name="layout-right" className="size-4" />
              {t('whiteboards.page.openBesideChat')}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {board ? (
          <WhiteboardCanvas board={board} onAsk={onAsk} firstAsk={firstAskProp} compact={Boolean(mobile)} />
        ) : (
          <div className="flex size-full items-center justify-center typography-ui-label text-muted-foreground">
            {failed ? t('whiteboards.page.loadFailed') : t('whiteboards.page.loading')}
          </div>
        )}
      </div>
    </div>
  );
}

function WhiteboardGallery({ mobile, onCreated }: { mobile?: MobileFrame; onCreated: (boardId: string, request: string | null) => void }) {
  const { t } = useI18n();
  const { confirm, dialog } = useConfirmDialog();
  const listIds = useWhiteboardsStore((state) => state.listIds);
  const boards = useWhiteboardsStore((state) => state.boards);
  const listStatus = useWhiteboardsStore((state) => state.listStatus);
  const pageWorkspaceId = useWhiteboardsStore((state) => state.pageWorkspaceId);
  const { setPageBoard, setPageWorkspace, createBoard, remove, loadList } = useWhiteboardsStore.getState();
  const workspaces = useWorkspacesStore((state) => state.catalog.workspaces);
  const selectedWorkspaceId = useWorkspacesStore((state) => state.selectedWorkspaceId);
  const directory = useEffectiveDirectory() ?? null;
  const [creating, setCreating] = React.useState(false);

  const workspaceById = React.useMemo(() => new Map(workspaces.map((workspace) => [workspace.id, workspace])), [workspaces]);
  const filterWorkspace = pageWorkspaceId ? workspaceById.get(pageWorkspaceId) : undefined;
  const shown = listIds
    .map((id) => boards[id])
    .filter((board): board is Whiteboard => Boolean(board) && (!filterWorkspace || board.workspaceId === filterWorkspace.id))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const dateFormat = React.useMemo(() => new Intl.DateTimeFormat(getCurrentIntlLocale(), { dateStyle: 'medium', timeStyle: 'short' }), []);

  // A new board goes to the workspace on screen: the filter, else the chat's, else the one picked last.
  const defaultWorkspace = filterWorkspace
    ?? workspacesForDirectory(workspaces, directory)[0]
    ?? (selectedWorkspaceId ? workspaceById.get(selectedWorkspaceId) : undefined)
    ?? workspaces[0];

  const create = async (workspaceId: string, request: string): Promise<boolean> => {
    const runtimeKey = getRuntimeKey();
    setCreating(true);
    try {
      const board = await createBoard(workspaceId, request ? boardTitleFrom(request) : t('whiteboards.page.untitled'));
      if (getRuntimeKey() === runtimeKey) recordDesktopFeature('whiteboards', 'used');
      // The agent is told plainly what to do; the title alone would read as a topic, not a request.
      onCreated(board.id, request ? t('whiteboards.page.drawRequest', { request }) : null);
      return true;
    } catch {
      toast.error(t('whiteboards.page.createFailed'));
      return false;
    } finally {
      setCreating(false);
    }
  };

  const confirmDelete = async (board: Whiteboard) => {
    const accepted = await confirm({
      title: t('whiteboards.page.deleteTitle'),
      message: t('whiteboards.page.deleteMessage', { title: board.title }),
      action: t('whiteboards.page.delete'),
      destructive: true,
    });
    if (accepted && !(await remove(board.id))) toast.error(t('whiteboards.page.deleteFailed'));
  };

  return (
    <div className="flex size-full min-h-0 flex-col overflow-y-auto bg-background">
      <div className={cn('mx-auto flex w-full max-w-6xl flex-col gap-2', mobile ? 'px-3 pb-6' : 'px-6 py-8')}>
        <div className={cn('flex items-center gap-2', mobile ? 'sticky top-0 z-10 h-[var(--oc-header-height,56px)] bg-background' : 'flex-wrap gap-3')}>
          {mobile ? (
            <button
              type="button"
              className="-ms-1 flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground"
              aria-label={t('mobile.surface.closeAria')}
              onClick={mobile.onClose}
              style={{ touchAction: 'manipulation' }}
            >
              <Icon name="close" className="size-5" />
            </button>
          ) : null}
          <h1 className={cn('font-semibold text-foreground', mobile ? 'typography-ui-label' : 'text-xl tracking-tight')}>{t('whiteboards.page.title')}</h1>
          {workspaces.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={t('whiteboards.page.workspaceFilter')} className={cn(dropdownTriggerVariants({ size: mobile ? 'mobile' : 'default' }), mobile ? 'max-w-[9rem]' : 'max-w-[16rem]')}>
                  <span className="truncate">{filterWorkspace?.name ?? t('whiteboards.page.allWorkspaces')}</span>
                  <Icon name="arrow-down-s" className="size-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-[16rem] max-w-[calc(100vw-2rem)]">
                <DropdownMenuItem onSelect={() => setPageWorkspace(null)}>{t('whiteboards.page.allWorkspaces')}</DropdownMenuItem>
                <DropdownMenuSeparator />
                {workspaces.map((workspace) => (
                  <DropdownMenuItem key={workspace.id} onSelect={() => setPageWorkspace(workspace.id)}>
                    <span className="truncate">{workspace.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
        <p className="typography-ui-label text-muted-foreground">{t('whiteboards.page.description')}</p>
        {defaultWorkspace ? (
          <NewBoardBox
            key={defaultWorkspace.id}
            workspaces={workspaces}
            defaultWorkspace={defaultWorkspace}
            creating={creating}
            onCreate={create}
            className={mobile ? 'mb-2 mt-1' : 'mb-5 mt-2'}
          />
        ) : null}

        {listStatus === 'failed' ? (
          <div className="flex items-center gap-2 typography-ui-label text-muted-foreground">
            {t('whiteboards.page.listFailed')}
            <Button size="sm" variant="outline" onClick={() => void loadList()}>{t('whiteboards.page.retry')}</Button>
          </div>
        ) : workspaces.length === 0 ? (
          <EmptyGallery text={t('whiteboards.page.noWorkspaces')} />
        ) : shown.length === 0 && listStatus === 'ready' ? (
          <EmptyGallery text={t('whiteboards.page.empty')} />
        ) : (
          <div className={cn('grid gap-4', mobile ? 'grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-3' : 'grid-cols-[repeat(auto-fill,minmax(15rem,1fr))]')}>
            {shown.map((board) => (
              <div key={board.id} className="oc-tile oc-tile-hover group relative flex flex-col overflow-hidden rounded-2xl transition-colors">
                {/* The thumbnail sits beside the button, not in it: the app repaints every SVG path inside a button. */}
                <WhiteboardThumbnail
                  board={board}
                  className={cn('w-full shrink-0', mobile ? 'h-28' : 'h-40')}
                  sheetClassName="transition-transform duration-300 group-hover:-translate-y-1"
                />
                <div className="flex flex-col gap-0.5 px-3.5 pb-3 pt-2.5">
                  <span className="truncate typography-ui-label font-medium text-foreground">{board.title}</span>
                  <span className="truncate typography-meta text-muted-foreground">
                    {[workspaceById.get(board.workspaceId)?.name, dateFormat.format(board.updatedAt)].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <button type="button" aria-label={board.title} className="absolute inset-0 rounded-2xl" onClick={() => setPageBoard(board.id)} />
                <div className={cn('oc-surface-floating oc-glass-floating absolute end-3.5 top-3.5 flex gap-0.5 rounded-lg p-0.5 transition-opacity', mobile ? 'opacity-100' : 'opacity-0 group-focus-within:opacity-100 group-hover:opacity-100')}>
                  {mobile ? null : (
                    <Button size="sm" variant="ghost" className="size-7 p-0" aria-label={t('whiteboards.page.openBesideChat')} title={t('whiteboards.page.openBesideChat')}
                      onClick={() => {
                        if (openBoardBesideChat(board)) useUIStore.getState().setWhiteboardsPageOpen(false);
                      }}>
                      <Icon name="layout-right" className="size-4" />
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="size-7 p-0" aria-label={t('whiteboards.page.delete')} title={t('whiteboards.page.delete')} onClick={() => void confirmDelete(board)}>
                    <Icon name="delete-bin" className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {dialog}
    </div>
  );
}

/**
 * Where boards are made: describe what to draw and the board is created with
 * that as its title and the request goes to the agent, as if typed in the
 * board's request box; with nothing written, a blank board.
 */
function NewBoardBox({ workspaces, defaultWorkspace, creating, onCreate, className }: {
  workspaces: readonly Workspace[];
  defaultWorkspace: Workspace;
  creating: boolean;
  onCreate: (workspaceId: string, request: string) => Promise<boolean>;
  className?: string;
}) {
  const { t } = useI18n();
  const [request, setRequest] = React.useState('');
  const [workspaceId, setWorkspaceId] = React.useState(defaultWorkspace.id);
  const workspace = workspaces.find((entry) => entry.id === workspaceId) ?? defaultWorkspace;
  const described = request.trim().length > 0;
  const submit = async () => {
    if (creating) return;
    if (await onCreate(workspace.id, request.trim())) setRequest('');
  };
  return (
    <form
      className={cn('oc-tile flex flex-wrap items-center gap-2 rounded-2xl p-1.5 ps-3 focus-within:ring-1 focus-within:ring-[var(--interactive-border-focus)]', className)}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Icon name="sparkling-2" className="size-4 shrink-0 text-muted-foreground" />
      <input
        value={request}
        maxLength={2000}
        onChange={(event) => setRequest(event.target.value)}
        placeholder={t('whiteboards.page.createPlaceholder')}
        aria-label={t('whiteboards.page.createPlaceholder')}
        className="h-9 min-w-[12rem] flex-1 bg-transparent typography-ui-label text-foreground outline-none placeholder:text-muted-foreground"
      />
      <div className="ms-auto flex items-center gap-1">
        {workspaces.length > 1 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={t('whiteboards.page.createIn')} title={t('whiteboards.page.createIn')} className={cn(dropdownTriggerVariants({ size: 'default' }), 'max-w-[11rem]')}>
                <span className="truncate">{workspace.name}</span>
                <Icon name="arrow-down-s" className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[16rem] max-w-[calc(100vw-2rem)]">
              {workspaces.map((entry) => (
                <DropdownMenuItem key={entry.id} onSelect={() => setWorkspaceId(entry.id)} className={cn(entry.id === workspace.id && 'bg-interactive-selection text-interactive-selection-foreground')}>
                  <span className="truncate">{entry.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <Button type="submit" size="sm" className="gap-1.5" disabled={creating}>
          <Icon name={described ? 'sparkling-2' : 'add'} className="size-4" />
          {described ? t('whiteboards.page.createDraw') : t('whiteboards.page.createBlank')}
        </Button>
      </div>
    </form>
  );
}

function EmptyGallery({ text }: { text: string }) {
  return (
    <div className="oc-tile flex flex-col items-center gap-3 rounded-2xl px-6 py-14 text-center">
      <div className="oc-tile-inset flex size-12 items-center justify-center rounded-2xl text-muted-foreground">
        <Icon name="artboard" className="size-6" />
      </div>
      <p className="max-w-sm typography-ui-label text-muted-foreground">{text}</p>
    </div>
  );
}
