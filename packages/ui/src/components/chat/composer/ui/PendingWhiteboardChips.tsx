import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { useI18n } from '@/lib/i18n';
import { readContextPart, type WhiteboardContext } from '@/lib/messages/contextParts';
import { openWhiteboard } from '@/lib/whiteboards/opener';
import { useInputStore, type SyntheticContextPart } from '@/sync/input-store';

const EMPTY: readonly SyntheticContextPart[] = [];

const whiteboardOf = (part: SyntheticContextPart): WhiteboardContext | null => {
    const payload = part.metadata ? readContextPart({ metadata: part.metadata }) : null;
    return payload?.kind === 'whiteboard' ? payload : null;
};

/**
 * A request written on a whiteboard while no chat was open waits in a new
 * chat's composer. Its board travels as pending context; this chip shows it
 * there before sending, the same way the sent message shows it, opens the
 * board, and drops it when the user does not want it.
 */
export function PendingWhiteboardChips({ target }: { target: string | null }) {
    const { t } = useI18n();
    const parts = useInputStore((state) => (target === null ? state.pendingSyntheticParts : state.pinnedSyntheticParts.get(target)) ?? EMPTY);
    const boards = parts.flatMap((part) => {
        const board = whiteboardOf(part);
        return board ? [{ part, board }] : [];
    });
    if (boards.length === 0) return null;

    const remove = (removed: SyntheticContextPart) => {
        const store = useInputStore.getState();
        const rest = (store.getPendingSyntheticParts(target) ?? []).filter((part) => part !== removed);
        store.setPendingSyntheticParts(rest.length > 0 ? rest : null, target);
    };

    return (
        <>
            {boards.map(({ part, board }) => {
                const label = board.commentId
                    ? t('whiteboards.message.comment', { title: board.title })
                    : board.selected.length > 0
                        ? t('whiteboards.message.contextSelection', { title: board.title, count: String(board.selected.length) })
                        : t('whiteboards.message.context', { title: board.title });
                return (
                    <div
                        key={board.boardId}
                        className="inline-flex h-7 max-w-full min-w-0 items-center gap-1.5 rounded-lg border border-border/80 bg-background ps-2 pe-1 text-xs"
                        title={board.selected.map((element) => element.text || element.id).join(', ') || label}
                    >
                        <Icon name="artboard" className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 max-w-[360px] truncate text-foreground">{label}</span>
                        <span className="flex shrink-0 items-center">
                            <button
                                type="button"
                                onClick={() => openWhiteboard({ id: board.boardId, title: board.title, workspaceId: board.workspaceId })}
                                className="flex h-5 w-5 items-center justify-center rounded-md transition-colors hover:bg-[var(--interactive-hover)]"
                                aria-label={t('whiteboards.message.open')}
                                title={t('whiteboards.message.open')}
                            >
                                <Icon name="external-link" className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                            <button
                                type="button"
                                onClick={() => remove(part)}
                                className="flex h-5 w-5 items-center justify-center rounded-md transition-colors hover:bg-[var(--interactive-hover)]"
                                aria-label={t('whiteboards.composer.remove')}
                                title={t('whiteboards.composer.remove')}
                            >
                                <Icon name="close" className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                        </span>
                    </div>
                );
            })}
        </>
    );
}
