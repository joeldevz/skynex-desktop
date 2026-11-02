import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import type { OpenSessionReference, SessionCloseResult } from '@/stores/useOpenSessionsStore';
import { useSessionTurnActivity } from '@/sync/global-session-status';
import { SessionActivityIndicator } from '../../SessionActivityIndicator';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { Icon } from '@/components/icon/Icon';
import { useReducedMotion } from 'motion/react';
import { useSpinnerPhase } from '@/hooks/useDurationTicker';
import { formatWorkspaceLabel } from '@/lib/workspaces/display-name';

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

export interface OpenSessionCollectionProps {
  sessions: readonly OpenSessionReference[];
  selectedId: string | null;
  onSelect(sessionId: string): void;
  onClose(sessionId: string, confirmation: 'unconfirmed' | 'stop-confirmed'): Promise<SessionCloseResult>;
}

function OpenSessionRow({ session, selected, pending, onSelect, onClose }: {
  session: OpenSessionReference;
  selected: boolean;
  pending: boolean;
  onSelect(sessionId: string): void;
  onClose(session: OpenSessionReference): void;
}) {
  const { t } = useI18n();
  const liveTitle = useGlobalSessionsStore((state) => state.entityById.get(session.sessionId)?.title);
  const title = liveTitle || session.title || t('sessions.sidebar.session.untitled');
  const workspaceName = session.scope?.workspaceName ?? session.workspaceAssignment?.workspaceName;
  return <li className="min-w-0">
    <div className={`relative rounded-md ${selected ? 'bg-interactive-selection/70 text-interactive-selection-foreground' : 'has-[button:hover]:bg-interactive-hover'}`}>
      <Button variant="ghost" aria-label={title} aria-pressed={selected} className="h-auto w-full min-w-0 flex-col items-stretch gap-0.5 py-2 pe-10 text-start whitespace-normal hover:bg-transparent [@media(pointer:coarse)]:min-h-12 [@media(pointer:coarse)]:pe-14" onClick={() => onSelect(session.sessionId)}>
        <span className="flex min-w-0 items-center gap-2">
          <span dir="auto" className="oc-ui-start-align min-w-0 flex-1 truncate font-normal" title={title}>{title}</span>
          <span className="inline-flex size-3.5 shrink-0 items-center justify-center"><OpenSessionActivity id={session.sessionId} /></span>
        </span>
        {workspaceName && <span dir="auto" className="oc-ui-start-align truncate typography-meta font-normal text-muted-foreground" title={workspaceName}>{formatWorkspaceLabel(workspaceName)}</span>}
      </Button>
      <Button variant="ghost" size="xs" disabled={pending} className="absolute end-1 top-1.5 px-1 text-muted-foreground hover:bg-transparent hover:text-foreground [@media(pointer:coarse)]:size-11 [@media(pointer:coarse)]:top-0.5" aria-label={t('workspaces.closeSession', { name: title })} title={t('dialog.common.actions.close')} onClick={() => onClose(session)}>
        <Icon name="close" className="size-3.5" />
      </Button>
    </div>
  </li>;
}

export function OpenSessionCollection({ sessions, selectedId, onSelect, onClose }: OpenSessionCollectionProps) {
  const { t } = useI18n();
  const [confirmation, setConfirmation] = useState<OpenSessionReference | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ title: string; message: string } | null>(null);
  const target = confirmation && sessions.find((session) => session.sessionId === confirmation.sessionId);
  async function close(session: OpenSessionReference, mode: 'unconfirmed' | 'stop-confirmed') {
    setPending(session.sessionId);
    setFailure(null);
    try {
      const result = await onClose(session.sessionId, mode);
      if (result.kind === 'confirmation-required') setConfirmation(session);
      else {
        setConfirmation(null);
        if (result.kind === 'retained') setFailure({ title: session.title, message: result.reason === 'stop-failed' ? t('workspaces.stopFailed') : result.reason === 'persistence-failed' && mode === 'stop-confirmed' ? t('workspaces.stoppedButOpen') : t('workspaces.closeFailed') });
      }
    } catch {
      setConfirmation(null);
      setFailure({ title: session.title, message: t('workspaces.closeFailed') });
    } finally { setPending(null); }
  }
  return <>
    <ul className="space-y-1">
      {sessions.map((session) => <OpenSessionRow key={session.sessionId} session={session} selected={selectedId === session.sessionId} pending={pending !== null} onSelect={onSelect} onClose={(reference) => void close(reference, 'unconfirmed')} />)}
    </ul>
    <div role="alert" className="min-h-6 typography-meta text-[var(--status-error-text)]">{failure && <><span dir="auto">{failure.title}</span>{' · '}{failure.message}</>}</div>
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
