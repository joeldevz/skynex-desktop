import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useI18n } from '@/lib/i18n';
import { useWorkspacesStore } from '@/stores/useWorkspacesStore';
import { getRuntimeKey } from '@/lib/runtime-switch';

export function WorkspaceCreateDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange(open: boolean): void;
  onCreated?(workspaceId: string): void;
}) {
  const { t } = useI18n();
  const [name, setName] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => { if (open) { setName(''); setFailed(false); } }, [open]);
  return <Dialog open={open} onOpenChange={(next) => { if (!pending) onOpenChange(next); }}>
    <DialogContent>
      <DialogTitle>{t('workspaces.newWorkspace')}</DialogTitle>
      <Input aria-label={t('workspaces.name')} dir="auto" value={name} disabled={pending} onChange={(event) => setName(event.currentTarget.value)} />
      <DialogFooter>
        <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>{t('dialog.common.actions.cancel')}</Button>
        <Button disabled={pending || !name.trim()} onClick={() => {
          setPending(true);
          setFailed(false);
          const capturedRuntimeKey = getRuntimeKey();
          void useWorkspacesStore.getState().create({ name: name.trim(), description: '', folders: [], defaults: {} }).then((result) => {
            if (capturedRuntimeKey !== getRuntimeKey()) return;
            if (result.kind !== 'saved') { setFailed(true); return; }
            const created = useWorkspacesStore.getState().catalog.workspaces.at(-1);
            if (created) onCreated?.(created.id);
            onOpenChange(false);
          }).catch(() => { if (capturedRuntimeKey === getRuntimeKey()) setFailed(true); }).finally(() => setPending(false));
        }}>{t('projectEditDialog.actions.save')}</Button>
      </DialogFooter>
      <div role="alert" className="min-h-6 typography-meta text-[var(--status-error-text)]">{failed ? t('workspaces.actionFailed') : ''}</div>
    </DialogContent>
  </Dialog>;
}
