import React from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { useSessionCloseDialogStore } from '@/stores/useSessionCloseDialogStore';
import { useOpenSessionsStore } from '@/stores/useOpenSessionsStore';
import { closeSessionTabAndActivateNeighbour } from '@/lib/sessionTabs';
import { useI18n } from '@/lib/i18n';

export function SessionClosePresenter() {
  const { t } = useI18n();
  const request = useSessionCloseDialogStore((state) => state.requests[0]);
  const failure = useSessionCloseDialogStore((state) => state.failure);
  const runtimeKey = useOpenSessionsStore((state) => state.runtimeKey);
  const present = useOpenSessionsStore((state) => request ? state.sessions.some((row) => row.sessionId === request.reference.sessionId) : false);
  const [pending, setPending] = React.useState(false);
  const valid = request && request.runtimeKey === runtimeKey && present;
  React.useEffect(() => {
    if (request && !valid) useSessionCloseDialogStore.getState().dismiss();
  }, [request, valid]);
  return <>
    {failure && <Dialog open onOpenChange={() => useSessionCloseDialogStore.getState().fail(null)}>
      <DialogContent><DialogTitle>{t('workspaces.closeFailed')}</DialogTitle><DialogDescription>{t(failure === 'stop-failed' ? 'workspaces.stopFailed' : failure === 'stopped-but-open' ? 'workspaces.stoppedButOpen' : 'workspaces.closeFailed')}</DialogDescription></DialogContent>
    </Dialog>}
    <Dialog open={Boolean(valid)} onOpenChange={(open) => { if (!open && !pending) useSessionCloseDialogStore.getState().dismiss(); }}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>{t('workspaces.stopAndClose')}</DialogTitle>
        <DialogDescription>{t('workspaces.stopPrompt', { name: request?.reference.title ?? '' })}</DialogDescription>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => useSessionCloseDialogStore.getState().dismiss()}>{t('dialog.common.actions.cancel')}</Button>
          <Button variant="destructive" disabled={pending} onClick={() => {
            if (!valid) return;
            setPending(true);
            void closeSessionTabAndActivateNeighbour(request.reference.sessionId, 'stop-confirmed').finally(() => { useSessionCloseDialogStore.getState().dismiss(); setPending(false); });
          }}>{t('workspaces.stopAndClose')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
