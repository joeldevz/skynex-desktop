import React from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/lib/i18n';
import { fixSharedConfigIgnore, getSharedConfigIgnoreStatus, type SharedConfigIgnoreFixResult, type SharedConfigIgnoreStatus } from '@/lib/openchamberConfig';
import { useProjectsStore } from '@/stores/useProjectsStore';

export const SharedConfigIgnoreNotice: React.FC<{ projectId: string }> = ({ projectId }) => {
  const { t } = useI18n();
  const project = useProjectsStore((state) => state.projects.find((entry) => entry.id === projectId));
  const [status, setStatus] = React.useState<SharedConfigIgnoreStatus | null>(null);
  const [requestFailed, setRequestFailed] = React.useState(false);
  const [refusal, setRefusal] = React.useState<Extract<SharedConfigIgnoreFixResult, { kind: 'refused' }>['reason'] | null>(null);
  const [pending, setPending] = React.useState(false);

  React.useEffect(() => {
    let current = true;
    setStatus(null);
    setRequestFailed(false);
    if (project) void getSharedConfigIgnoreStatus({ id: project.id, path: project.path }).then((result) => {
      if (current) setStatus(result);
    }).catch(() => {
      if (current) setRequestFailed(true);
    });
    return () => { current = false; };
  }, [project?.id, project?.path]);

  const fix = async () => {
    if (!project || pending) return;
    setPending(true);
    setRefusal(null);
    try {
      const result = await fixSharedConfigIgnore({ id: project.id, path: project.path });
      if (result.kind === 'updated') setStatus(result.status);
      else setRefusal(result.reason);
    } catch {
      setRefusal('write-failed');
    } finally {
      setPending(false);
    }
  };

  if (requestFailed || (status?.kind === 'unknown' && status.reason !== 'not-a-repository')) {
    return <p className="typography-meta text-muted-foreground">{t('settings.projects.sharedIgnore.checkFailed')}</p>;
  }
  if (status?.kind !== 'ignored') return null;
  const manualOnly = !status.fixable;
  const manualMessage = manualOnly
    ? t('settings.projects.sharedIgnore.manual', { pattern: status.pattern, source: status.source, line: status.line })
    : null;
  const manualValues = manualOnly ? [status.pattern, `${status.source}:${status.line}`, '.skynex/project.json'] : [];
  // Longest first: a pattern such as `.skynex/` must not split the path `.skynex/project.json`.
  const manualParts = manualMessage?.split(new RegExp(`(${[...manualValues].sort((a, b) => b.length - a.length).map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g'));
  const warningClass = 'flex flex-wrap items-center gap-2 rounded-md bg-[var(--status-warning)]/10 px-3 py-2 text-[var(--status-warning)] typography-meta';
  return (
    <div className={warningClass}>
      <span className="min-w-0 flex-1">
        {manualOnly
          ? manualParts?.map((part, index) => (manualValues.includes(part)
            ? <span dir="ltr" key={index}>{part}</span>
            : part))
          : t('settings.projects.sharedIgnore.warning')}
      </span>
      {manualOnly ? null : <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void fix()}>{t('settings.projects.sharedIgnore.addException')}</Button>}
      {refusal ? <span role="alert">{t(`settings.projects.sharedIgnore.error.${refusal}`)}</span> : null}
    </div>
  );
};
