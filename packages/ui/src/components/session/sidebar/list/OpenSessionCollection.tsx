import React, { useState } from 'react';
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useI18n, type I18nKey } from '@/lib/i18n';
import type { MembershipResult, OpenSessionReference, SessionCloseResult } from '@/stores/useOpenSessionsStore';
import { hasActiveSubagent, useGlobalSessionStatusStore, useSessionTurnActivity } from '@/sync/global-session-status';
import { useBackgroundShellsStore } from '@/sync/background-shells';
import { useWorkflowActivityStore } from '@/sync/workflow-activity';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu';
import { useUIStore } from '@/stores/useUIStore';
import { getDurableStorage } from '@/stores/utils/safeStorage';
import { z } from 'zod';
import { SessionActivityIndicator } from '../../SessionActivityIndicator';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { Icon } from '@/components/icon/Icon';
import type { IconName } from '@/components/icon/icons';
import { useReducedMotion } from 'motion/react';
import { useSpinnerPhase } from '@/hooks/useDurationTicker';
import { formatWorkspaceLabel } from '@/lib/workspaces/display-name';
import { isSessionUnread, useSessionUnread } from '@/sync/session-unread';
import { useGlobalBlockingRequestsStore } from '@/sync/global-blocking-requests';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { toast } from '@/components/ui';
import { SessionActivityDuration } from '@/components/session/SessionActivityDuration';

const HELIX_DOTS = Array.from({ length: 25 }, (_, index) => {
  const column = index % 5;
  const row = Math.floor(index / 5);
  const angle = column === 2 && row === 2 ? 0.25 : (Math.atan2(column - 2, 2 - row) / (2 * Math.PI) + 1) % 1;
  return { x: 2 + column * 7, y: 2 + row * 7, angle };
});
const HELIX_STOPS = [
  { phase: 0, opacity: 0.1 },
  { phase: 0.3, opacity: 0.95 },
  { phase: 0.5, opacity: 0.3 },
  { phase: 0.8, opacity: 0.95 },
  { phase: 1, opacity: 0.1 },
];

function helixOpacity(phase: number): number {
  for (let index = 1; index < HELIX_STOPS.length; index++) {
    const start = HELIX_STOPS[index - 1];
    const end = HELIX_STOPS[index];
    if (phase > end.phase) continue;
    const progress = (phase - start.phase) / (end.phase - start.phase);
    const eased = progress * progress * (3 - 2 * progress);
    return start.opacity + (end.opacity - start.opacity) * eased;
  }
  return 0.1;
}

function SessionHelixActivity() {
  const { t } = useI18n();
  const reducedMotion = useReducedMotion();
  const phase = useSpinnerPhase(!reducedMotion, 9);
  const label = t('sessions.sidebar.session.status.active');
  return <span className="inline-flex size-3.5 shrink-0 text-status-info" role="img" aria-label={label} title={label}>
    <svg viewBox="0 0 32 32" className="size-full" aria-hidden="true">
      {HELIX_DOTS.map((dot, index) => <path key={index} d={`M ${dot.x - 2} ${dot.y} a 2 2 0 1 0 4 0 a 2 2 0 1 0 -4 0`} style={{ fill: 'currentColor', opacity: helixOpacity((phase / 9 + dot.angle) % 1) }} />)}
    </svg>
  </span>;
}

function OpenSessionActivity({ id }: { id: string }) {
  const activity = useSessionTurnActivity(id);
  if (activity === 'running') return <SessionHelixActivity />;
  return activity ? <SessionActivityIndicator state={activity} /> : null;
}

type SessionGroup = 'pinned' | 'waiting' | 'working' | 'paused';
const GROUP_ORDER: readonly SessionGroup[] = ['pinned', 'waiting', 'working', 'paused'];
// Groups that ask for attention carry a status fill; the rest stay flat on the sidebar.
const GROUP_STYLE = {
  pinned: { label: 'workspaces.openSessions.group.pinned', icon: 'pushpin-2-fill', block: 'bg-[var(--surface-elevated)]', heading: 'text-foreground' },
  waiting: { label: 'workspaces.openSessions.group.waiting', icon: 'notification-3', block: 'bg-[var(--status-warning-background)]', heading: 'text-[var(--status-warning-text)]' },
  working: { label: 'workspaces.openSessions.group.working', icon: 'loader-4', block: 'bg-[var(--status-info-background)]', heading: 'text-[var(--status-info-text)]' },
  paused: { label: 'workspaces.openSessions.group.paused', icon: 'pause', block: '', heading: 'text-muted-foreground' },
} satisfies Record<SessionGroup, { label: I18nKey; icon: IconName; block: string; heading: string }>;

// Folded groups are a view preference of this device, so they stay out of the shared membership.
const COLLAPSED_GROUPS_KEY = 'openchamber.openSessions.collapsedGroups.v1';
const collapsedGroupsSchema = z.array(z.enum(['pinned', 'waiting', 'working', 'paused']));
function readCollapsedGroups(): ReadonlySet<SessionGroup> {
  try {
    const parsed = collapsedGroupsSchema.safeParse(JSON.parse(getDurableStorage().getItem(COLLAPSED_GROUPS_KEY) ?? '[]'));
    return new Set(parsed.success ? parsed.data : []);
  } catch {
    return new Set();
  }
}

// Each selector answers a joined list of IDs, so a store change re-renders the
// list only when the set of sessions in that state changes.
const joinIds = (ids: readonly string[]) => ids.join('\n');
const splitIds = (joined: string) => new Set(joined ? joined.split('\n') : []);

/**
 * Which group each open session belongs in. A pinned session stays pinned
 * whatever it does; the others follow the same state the row's indicator
 * shows: a permission request or an unread reply waits for the user, an open
 * turn is working, anything else is paused.
 */
function useSessionGroups(sessions: readonly OpenSessionReference[]): (session: OpenSessionReference) => SessionGroup {
  const ids = React.useMemo(() => sessions.filter((session) => !session.pinned).map((session) => session.sessionId), [sessions]);
  const permissionIds = splitIds(useGlobalBlockingRequestsStore((state) => joinIds(ids.filter((id) => (state.bySession.get(id)?.permissions.length ?? 0) > 0))));
  const unreadIds = splitIds(useGlobalSessionsStore((state) => joinIds(ids.filter((id) => isSessionUnread(state.entityById.get(id))))));
  const activeIds = splitIds(useGlobalSessionStatusStore((state) => joinIds(ids.filter((id) => state.activeSessionIds.has(id) || hasActiveSubagent(id, state.activeSessionIds)))));
  const workflowIds = splitIds(useWorkflowActivityStore((state) => joinIds(ids.filter((id) => state.runningSessionIds.has(id)))));
  const shellIds = splitIds(useBackgroundShellsStore((state) => joinIds(ids.filter((id) => state.sessionIds.has(id)))));
  return (session) => {
    if (session.pinned) return 'pinned';
    const id = session.sessionId;
    const working = activeIds.has(id) || workflowIds.has(id) || shellIds.has(id);
    if (permissionIds.has(id) || (unreadIds.has(id) && !working)) return 'waiting';
    return working ? 'working' : 'paused';
  };
}

export interface OpenSessionCollectionProps {
  sessions: readonly OpenSessionReference[];
  selectedId: string | null;
  onSelect(sessionId: string): void;
  onClose(sessionId: string, confirmation: 'unconfirmed' | 'stop-confirmed'): Promise<SessionCloseResult>;
  onReorder?(sessionId: string, overId: string): Promise<{ kind: 'saved' } | { kind: 'retained'; reason: string }>;
  onReopen?(reference: OpenSessionReference): Promise<MembershipResult>;
  onPin?(sessionId: string, pinned: boolean): Promise<MembershipResult>;
}

function OpenSessionRow({ session, selected, pending, onSelect, onClose, onPin }: {
  session: OpenSessionReference;
  selected: boolean;
  pending: boolean;
  onSelect(sessionId: string): void;
  onClose(session: OpenSessionReference): void;
  onPin?(session: OpenSessionReference): void;
}) {
  const { t } = useI18n();
  const isMobile = useUIStore((state) => state.isMobile);
  const [menuOpen, setMenuOpen] = useState(false);
  const unread = useSessionUnread(session.sessionId);
  const permissionRequired = useGlobalBlockingRequestsStore((state) => (state.bySession.get(session.sessionId)?.permissions.length ?? 0) > 0);
  const turnActivity = useSessionTurnActivity(session.sessionId);
  const sortable = useSortable({ id: session.sessionId });
  const liveTitle = useGlobalSessionsStore((state) => state.entityById.get(session.sessionId)?.title);
  const title = liveTitle || session.title || t('sessions.sidebar.session.untitled');
  const workspaceName = session.scope?.workspaceName ?? session.workspaceAssignment?.workspaceName;
  return <li ref={sortable.setNodeRef} style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition }} className={`min-w-0 ${sortable.isDragging ? 'opacity-60' : ''}`}>
    <ContextMenu open={menuOpen} onOpenChange={(open) => setMenuOpen(open && !isMobile)}>
    <ContextMenuTrigger render={<div className={`group relative rounded-md ${selected ? 'bg-interactive-selection/70 text-interactive-selection-foreground' : 'has-[button:hover]:bg-interactive-hover'}`} />}>
      <Button ref={sortable.setActivatorNodeRef} {...sortable.attributes} {...sortable.listeners} variant="ghost" aria-label={title} aria-pressed={selected} className={`h-auto w-full min-w-0 flex-col items-stretch gap-0.5 py-2 text-start whitespace-normal touch-pan-y hover:bg-transparent [@media(pointer:coarse)]:min-h-12 pe-2 ${onPin ? 'group-hover:pe-16 group-focus-within:pe-16 [@media(pointer:coarse)]:pe-24' : 'group-hover:pe-9 group-focus-within:pe-9 [@media(pointer:coarse)]:pe-14'}`} onClick={() => onSelect(session.sessionId)}>
        <span className="flex min-w-0 items-center gap-2">
          <span dir="auto" className="oc-ui-start-align min-w-0 flex-1 truncate font-normal" title={title}>{title}</span>
          <span className="inline-flex shrink-0 items-center gap-1.5">{permissionRequired ? <span className="inline-flex size-3.5 items-center justify-center" role="img" aria-label={t('sessions.sidebar.session.status.permissionRequired')} title={t('sessions.sidebar.session.status.permissionRequired')}><Icon name="shield-keyhole" className="size-3.5 text-[var(--status-warning-text)]" /></span> : unread && !turnActivity ? <span role="img" aria-label={t('sessions.sidebar.session.status.unread')} title={t('sessions.sidebar.session.status.unread')} className="size-2 rounded-full bg-status-info" /> : <OpenSessionActivity id={session.sessionId} />}{turnActivity === 'running' && <SessionActivityDuration sessionId={session.sessionId} running className="typography-meta" />}</span>
        </span>
        {workspaceName && <span dir="auto" className="oc-ui-start-align truncate typography-meta font-normal text-muted-foreground" title={workspaceName}>{formatWorkspaceLabel(workspaceName)}</span>}
      </Button>
      {onPin && <Button variant="ghost" size="xs" disabled={pending} className="absolute end-7 top-1.5 px-1 text-muted-foreground opacity-0 hover:bg-transparent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:end-12 [@media(pointer:coarse)]:top-0.5 [@media(pointer:coarse)]:opacity-100" aria-label={t(session.pinned ? 'workspaces.unpinSession' : 'workspaces.pinSession', { name: title })} aria-pressed={Boolean(session.pinned)} title={t(session.pinned ? 'workspaces.unpin' : 'workspaces.pin')} onClick={() => onPin(session)}>
        <Icon name={session.pinned ? 'pushpin-2-fill' : 'pushpin-2'} className="size-3.5" />
      </Button>}
      <Button variant="ghost" size="xs" disabled={pending} className="absolute end-1 top-1.5 px-1 text-muted-foreground opacity-0 hover:bg-transparent hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 focus-within:opacity-100 [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:top-0.5 [@media(pointer:coarse)]:opacity-100" aria-label={t('workspaces.closeSession', { name: title })} title={t('dialog.common.actions.close')} onClick={() => onClose(session)}>
        <Icon name="close" className="size-3.5" />
      </Button>
    </ContextMenuTrigger>
    <ContextMenuContent className="w-fit min-w-28">
      {onPin && <ContextMenuItem onClick={() => onPin(session)}><Icon name={session.pinned ? 'pushpin-2-fill' : 'pushpin-2'} className="size-4" />{t(session.pinned ? 'workspaces.unpin' : 'workspaces.pin')}</ContextMenuItem>}
      <ContextMenuItem disabled={pending} onClick={() => onClose(session)}><Icon name="close" className="size-4" />{t('dialog.common.actions.close')}</ContextMenuItem>
    </ContextMenuContent>
    </ContextMenu>
  </li>;
}

export function OpenSessionCollection({ sessions, selectedId, onSelect, onClose, onReorder, onReopen, onPin }: OpenSessionCollectionProps) {
  const { t } = useI18n();
  const groupOf = useSessionGroups(sessions);
  const groups = GROUP_ORDER
    .map((group) => ({ group, sessions: sessions.filter((session) => groupOf(session) === group) }))
    .filter((entry) => entry.sessions.length > 0);
  // A lone group needs no heading: the section title already names the list.
  const showHeadings = groups.length > 1;
  const [collapsed, setCollapsed] = useState(readCollapsedGroups);
  function toggleGroup(group: SessionGroup) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      try { getDurableStorage().setItem(COLLAPSED_GROUPS_KEY, JSON.stringify([...next])); } catch { /* the fold still applies for this visit */ }
      return next;
    });
  }
  const [confirmation, setConfirmation] = useState<OpenSessionReference | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ title: string; message: string } | null>(null);
  const target = confirmation && sessions.find((session) => session.sessionId === confirmation.sessionId);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!onReorder || !over || active.id === over.id) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    const activeSession = sessions.find((session) => session.sessionId === activeId);
    const overSession = sessions.find((session) => session.sessionId === overId);
    // A session moves to another group by its state or its pin, never by dragging.
    if (!activeSession || !overSession || groupOf(activeSession) !== groupOf(overSession)) return;
    const result = await onReorder(activeId, overId);
    if (result.kind === 'retained') setFailure({ title: t('workspaces.openSessions'), message: t('workspaces.actionFailed') });
    else setFailure(null);
  }
  async function togglePin(session: OpenSessionReference) {
    if (!onPin) return;
    const runtimeKey = getRuntimeKey();
    setFailure(null);
    try {
      const result = await onPin(session.sessionId, !session.pinned);
      if (runtimeKey === getRuntimeKey() && result.kind === 'retained') setFailure({ title: session.title, message: t('workspaces.actionFailed') });
    } catch {
      if (runtimeKey === getRuntimeKey()) setFailure({ title: session.title, message: t('workspaces.actionFailed') });
    }
  }
  async function close(session: OpenSessionReference, mode: 'unconfirmed' | 'stop-confirmed') {
    const runtimeKey = getRuntimeKey();
    setPending(session.sessionId);
    setFailure(null);
    try {
      const result = await onClose(session.sessionId, mode);
      if (runtimeKey !== getRuntimeKey()) return;
      if (result.kind === 'closed' && onReopen) {
        let restoring = false;
        const reopen = onReopen;
        toast.info(t('workspaces.sessionClosed', { name: session.title }), {
          duration: 8000,
          action: {
            label: t('workspaces.undoClose'),
            onClick: () => {
              if (restoring || runtimeKey !== getRuntimeKey()) return;
              restoring = true;
              void reopen(session).then((restored) => {
                if (runtimeKey === getRuntimeKey() && restored.kind !== 'saved') toast.error(t('workspaces.openFailed'));
              }).catch(() => {
                if (runtimeKey === getRuntimeKey()) toast.error(t('workspaces.openFailed'));
              });
            },
          },
        });
      }
      if (result.kind === 'confirmation-required') setConfirmation(session);
      else {
        setConfirmation(null);
        if (result.kind === 'retained') setFailure({ title: session.title, message: result.reason === 'stop-failed' ? t('workspaces.stopFailed') : result.reason === 'persistence-failed' && mode === 'stop-confirmed' ? t('workspaces.stoppedButOpen') : t('workspaces.closeFailed') });
      }
    } catch {
      if (runtimeKey === getRuntimeKey()) {
        setConfirmation(null);
        setFailure({ title: session.title, message: t('workspaces.closeFailed') });
      }
    } finally { setPending(null); }
  }
  return <>
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => { void handleDragEnd(event); }}>
      <div className="space-y-2">
      {groups.map(({ group, sessions: grouped }) => {
        const style = GROUP_STYLE[group];
        const label = t(style.label);
        const folded = showHeadings && collapsed.has(group);
        return <section key={group} aria-label={showHeadings ? label : undefined} className={showHeadings ? `rounded-lg p-0.5 ${style.block}` : undefined}>
          {showHeadings && <h3>
            <button type="button" aria-expanded={!folded} className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-start typography-meta font-medium hover:opacity-80 ${style.heading}`} onClick={() => toggleGroup(group)}>
              <Icon name="arrow-down-s" className={`size-3.5 shrink-0 opacity-70 transition-transform ${folded ? '-rotate-90 rtl:rotate-90' : ''}`} />
              <Icon name={style.icon} className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{label}</span>
              <span className="shrink-0 tabular-nums opacity-70">{grouped.length}</span>
            </button>
          </h3>}
          {!folded && <SortableContext items={grouped.map((session) => session.sessionId)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1">
              {grouped.map((session) => <OpenSessionRow key={session.sessionId} session={session} selected={selectedId === session.sessionId} pending={pending !== null} onSelect={onSelect} onClose={(reference) => void close(reference, 'unconfirmed')} onPin={onPin ? (reference) => void togglePin(reference) : undefined} />)}
            </ul>
          </SortableContext>}
        </section>;
      })}
      </div>
    </DndContext>
    <div role="alert" className={failure ? 'min-h-6 pt-1 typography-meta text-[var(--status-error-text)]' : 'sr-only'}>{failure && <><span dir="auto">{failure.title}</span>{' · '}{failure.message}</>}</div>
    <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open && pending === null) setConfirmation(null); }}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>{t('workspaces.stopAndClose')}</DialogTitle>
        <DialogDescription>{t('workspaces.stopPrompt', { name: target?.title ?? '' })}</DialogDescription>
        <DialogFooter>
          <Button variant="outline" disabled={pending !== null} onClick={() => setConfirmation(null)}>{t('dialog.common.actions.cancel')}</Button>
          <Button variant="destructive" disabled={pending !== null} onClick={() => { if (target) void close(target, 'stop-confirmed'); }}>{t('workspaces.stopAndClose')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
