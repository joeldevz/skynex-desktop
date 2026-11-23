import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { ContextPanelHeaderToolbar } from '@/components/layout/contextPanelHeaderSlot';
import { useI18n } from '@/lib/i18n';
import { askAgentAboutBoard } from '@/lib/whiteboards/ask';
import type { Whiteboard } from '@/lib/whiteboards/model';
import { workspacesForDirectory } from '@/lib/whiteboards/workspaces';
import { useUIStore } from '@/stores/useUIStore';
import { useWhiteboardsStore } from '@/stores/useWhiteboardsStore';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';
import { WhiteboardCanvas } from './WhiteboardCanvas';
import { WhiteboardThumbnail } from './WhiteboardThumbnail';
import { BoardTitle } from './WhiteboardsView';

/**
 * A board beside the chat. A tab without a board lists the boards of the
 * workspaces this folder belongs to, and opening one turns the tab into it.
 */
export function WhiteboardPanel({ boardId, directory, tabId }: { boardId: string | null; directory: string | null; tabId: string }) {
  if (!boardId) return <WhiteboardPicker directory={directory} tabId={tabId} />;
  return <PanelBoard boardId={boardId} />;
}

function PanelBoard({ boardId }: { boardId: string }) {
  const { t } = useI18n();
  const board = useWhiteboardsStore((state) => state.boards[boardId]);
  const failed = useWhiteboardsStore((state) => Boolean(state.failedBoardIds[boardId]));
  const loadBoard = useWhiteboardsStore((state) => state.loadBoard);

  React.useEffect(() => {
    void loadBoard(boardId);
  }, [boardId, loadBoard]);

  const onAsk = React.useCallback(async (text: string, selectedIds: string[], commentId?: string) => (
    board ? askAgentAboutBoard(board, text, selectedIds, commentId) : { kind: 'failed' } as const
  ), [board]);

  if (!board) {
    return (
      <div className="flex size-full items-center justify-center p-4 text-center typography-ui-label text-muted-foreground">
        {failed ? t('whiteboards.page.loadFailed') : t('whiteboards.page.loading')}
      </div>
    );
  }
  return (
    <div className="flex size-full min-h-0 flex-col">
      <ContextPanelHeaderToolbar>
        <div className="flex min-w-0 flex-1 items-center gap-1">
        <BoardTitle board={board} className="typography-ui-label" />
        <Button
          size="sm"
          variant="ghost"
          className="ms-auto"
          aria-label={t('whiteboards.panel.openFullPage')}
          title={t('whiteboards.panel.openFullPage')}
          onClick={() => {
            useWhiteboardsStore.getState().setPageBoard(board.id);
            useUIStore.getState().setWhiteboardsPageOpen(true);
          }}
        >
          <Icon name="external-link" className="size-4" />
        </Button>
        </div>
      </ContextPanelHeaderToolbar>
      <div className="relative min-h-0 flex-1">
        <WhiteboardCanvas board={board} onAsk={onAsk} compact />
      </div>
    </div>
  );
}

function WhiteboardPicker({ directory, tabId }: { directory: string | null; tabId: string }) {
  const { t } = useI18n();
  const workspaces = useWorkspacesStore((state) => state.catalog.workspaces);
  const listIds = useWhiteboardsStore((state) => state.listIds);
  const boards = useWhiteboardsStore((state) => state.boards);
  const listStatus = useWhiteboardsStore((state) => state.listStatus);
  const loadList = useWhiteboardsStore((state) => state.loadList);
  const createBoard = useWhiteboardsStore((state) => state.createBoard);

  React.useEffect(() => {
    void loadList();
  }, [loadList]);

  const local = React.useMemo(() => workspacesForDirectory(workspaces, directory), [directory, workspaces]);
  const localIds = new Set(local.map((workspace) => workspace.id));
  // Outside any workspace every board is offered; inside one, its own boards.
  const shown = listIds
    .map((id) => boards[id])
    .filter((board): board is Whiteboard => Boolean(board) && (localIds.size === 0 || localIds.has(board.workspaceId)));
  const createIn = local[0] ?? (workspaces.length === 1 ? workspaces[0] : undefined);

  const open = (board: Whiteboard) => {
    if (!directory) return;
    const ui = useUIStore.getState();
    ui.openContextPanelTab(directory, { mode: 'whiteboard', targetPath: board.id, dedupeKey: board.id, label: board.title });
    ui.closeContextPanelTab(directory, tabId);
  };

  const create = async () => {
    if (!createIn) return;
    try {
      open(await createBoard(createIn.id, t('whiteboards.page.untitled')));
    } catch {
      toast.error(t('whiteboards.page.createFailed'));
    }
  };

  return (
    <div className="flex size-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      <div className="flex items-center gap-2">
        <span className="typography-ui-label font-medium text-foreground">{t('whiteboards.panel.pick')}</span>
        {createIn ? (
          <Button size="sm" variant="outline" className="ms-auto gap-1.5" onClick={() => void create()}>
            <Icon name="add" className="size-4" />
            {t('whiteboards.page.new')}
          </Button>
        ) : null}
      </div>
      {listStatus === 'failed' ? (
        <div className="typography-ui-label text-muted-foreground">{t('whiteboards.page.listFailed')}</div>
      ) : shown.length === 0 && listStatus === 'ready' ? (
        <div className="typography-ui-label text-muted-foreground">{createIn ? t('whiteboards.page.empty') : t('whiteboards.page.noWorkspaces')}</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-2">
          {shown.map((board) => (
            <div key={board.id} className="oc-tile oc-tile-hover relative flex flex-col overflow-hidden rounded-xl transition-colors">
              <WhiteboardThumbnail board={board} className="h-24 w-full shrink-0" />
              <span className="truncate px-2.5 pb-2 pt-1.5 typography-meta font-medium text-foreground">{board.title}</span>
              <button type="button" aria-label={board.title} className="absolute inset-0 rounded-xl" onClick={() => open(board)} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
