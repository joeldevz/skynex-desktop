import React from 'react';
import { Button } from '@/components/ui/button';
import { dropdownTriggerVariants } from '@/components/ui/dropdown-trigger';
import { Input } from '@/components/ui/input';
import { Icon } from '@/components/icon/Icon';
import { WorkStatusCollapsibleSection, WorkStatusMeter, WorkStatusRow } from '@/components/chat/work-status/WorkStatusPrimitives';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { skynexTasksApi, type SkynexTask } from '@/lib/skynexTasksApi';

type Step = SkynexTask['steps'][number];

const validTitle = (title: string) => title.trim().length > 0 && title.trim().length <= 200
  && !title.trim().startsWith('-') && !/[\p{Cc}\p{Cf}]/u.test(title);

const selectClass = dropdownTriggerVariants();
// The same row box as WorkStatusRow (h-7, rounded-md, px-1); a step wraps instead of truncating.
const STEP_ROW_CLASS = 'flex min-h-8 items-start gap-2.5 rounded-md px-2 py-1.5 text-[0.8125rem]';
const ICON_BUTTON_CLASS = 'w-7 shrink-0 px-0';

// A step is a subtask only when its parent is a top-level step of the same task. Anything else stays
// top level, so a step whose parent is missing is still shown instead of disappearing.
const isSubtask = (step: Step, steps: Step[]) => Boolean(step.parent)
  && steps.some((entry) => entry.id === step.parent && !entry.parent);
const topLevelSteps = (steps: Step[]) => steps.filter((step) => !isSubtask(step, steps));
const subtasksOf = (parent: Step, steps: Step[]) => steps.filter((step) => step.parent === parent.id && isSubtask(step, steps));

/** The shared notebook content rendered in the chat's Work Status Tasks section. */
export const SkynexTasksContent: React.FC<{ directory: string; collapsible?: boolean }> = ({ directory }) => {
  const { t } = useI18n();
  const [tasks, setTasks] = React.useState<SkynexTask[]>([]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [title, setTitle] = React.useState('');
  const [stepTitle, setStepTitle] = React.useState('');
  const [parentStep, setParentStep] = React.useState('');
  const [stepFormOpen, setStepFormOpen] = React.useState(false);
  const [taskFormOpen, setTaskFormOpen] = React.useState(false);
  const [pending, setPending] = React.useState(true);
  const [failed, setFailed] = React.useState(false);
  const busy = React.useRef(false);
  const load = React.useCallback(async () => {
    if (!directory || busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const next = await skynexTasksApi.list(directory);
      setTasks(next);
      setSelected((id) => next.some((task) => task.id === id) ? id : next[0]?.id ?? null);
      setFailed(false);
    } catch { setFailed(true); }
    finally { busy.current = false; setPending(false); }
  }, [directory]);
  React.useEffect(() => {
    setTasks([]);
    setSelected(null);
    setParentStep('');
    void load();
  }, [load]);
  const mutate = async (action: () => Promise<SkynexTask>, clear?: () => void) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const task = await action();
      setTasks((current) => current.some((entry) => entry.id === task.id)
        ? current.map((entry) => entry.id === task.id ? task : entry) : [...current, task]);
      setSelected(task.id);
      clear?.();
      setFailed(false);
    } catch { setFailed(true); }
    finally { busy.current = false; setPending(false); }
  };
  const activeTasks = tasks.filter((entry) => entry.progress.total === 0 || entry.progress.done < entry.progress.total);
  const task = activeTasks.find((entry) => entry.id === selected) ?? activeTasks[0];
  const topLevel = task ? topLevelSteps(task.steps) : [];
  const parentChoice = topLevel.some((step) => step.id === parentStep) ? parentStep : '';
  const stepRow = (dir: string, owner: SkynexTask, step: Step) => (
    <label className={STEP_ROW_CLASS}>
      <input type="checkbox" className="mt-1 shrink-0" checked={step.done} disabled={pending || failed || step.done} onChange={() => void mutate(() => skynexTasksApi.completeStep(dir, owner.id, step.id))} />
      <span className={cn('min-w-0 break-words', step.done && 'text-muted-foreground line-through')}>{step.title}</span>
    </label>
  );
  const progressPercent = task && task.progress.total > 0 ? (task.progress.done / task.progress.total) * 100 : 0;
  const refresh = (
    <Button variant="ghost" size="sm" className={ICON_BUTTON_CLASS} disabled={pending} aria-label={t('skynex.tasks.refresh')} title={t('skynex.tasks.refresh')} onClick={() => void load()}>
      <Icon name="refresh" className="size-3.5" />
    </Button>
  );
  const body = (
    <div aria-busy={pending} className="flex flex-col" title={t('skynex.tasks.notebook')}>
        {pending && <p role="status" className="px-2 py-1 text-xs text-muted-foreground">{t('skynex.tasks.loading')}</p>}
        {failed && <div role="alert" className="flex flex-col items-center gap-2 px-2 py-4 text-center"><p className="text-xs text-muted-foreground">{t('skynex.tasks.error')}</p><Button size="xs" variant="ghost" disabled={pending} onClick={() => void load()}>{t('skynex.tasks.retry')}</Button></div>}
        {!pending && !failed && activeTasks.length === 0 && <p className="px-2 py-4 text-center text-xs text-muted-foreground">{t('skynex.tasks.empty')}</p>}
        {task && <WorkStatusRow
          label={t('skynex.tasks.selectTask')}
          value={(
            <select aria-label={t('skynex.tasks.selectTask')} value={task.id} disabled={pending} onChange={(event) => { setSelected(event.target.value); setParentStep(''); }} className={cn(selectClass, 'max-w-[11rem]')}>
              {activeTasks.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
            </select>
          )}
        />}
        {task && <>
          <WorkStatusRow
            label={t('skynex.tasks.steps')}
            value={<span className="flex items-center gap-1">
              <span title={t('skynex.tasks.progress', { done: task.progress.done, total: task.progress.total })}>{t('skynex.tasks.progressShort', { done: task.progress.done, total: task.progress.total })}</span>
              <Button variant="ghost" size="xs" aria-expanded={stepFormOpen} aria-label={t('skynex.tasks.addStepAction')} title={t('skynex.tasks.addStepAction')} className={ICON_BUTTON_CLASS} disabled={pending || failed} onClick={() => setStepFormOpen((open) => !open)}>
                <Icon name="add" className="size-3.5" />
              </Button>
            </span>}
          />
          <WorkStatusMeter percent={progressPercent} color="var(--primary-base)" />
          <ul className="mt-2 flex flex-col gap-0.5">{topLevel.map((step) => <li key={step.id} className="flex flex-col">
            {stepRow(directory, task, step)}
            {subtasksOf(step, task.steps).length > 0 && <ul className="ms-3.5 flex flex-col gap-0.5 border-s border-border ps-2.5">{subtasksOf(step, task.steps).map((child) => <li key={child.id}>{stepRow(directory, task, child)}</li>)}</ul>}
          </li>)}</ul>
          {stepFormOpen && <form className="flex items-center gap-2 px-2 pb-1 pt-2.5" onSubmit={(event) => { event.preventDefault(); if (validTitle(stepTitle)) void mutate(() => skynexTasksApi.addStep(directory, task.id, stepTitle.trim(), parentChoice || undefined), () => { setStepTitle(''); setStepFormOpen(false); }); }}>
            <Input inputSize="compact" className="min-w-0 flex-1" aria-label={t('skynex.tasks.newStep')} placeholder={t('skynex.tasks.newStep')} maxLength={200} value={stepTitle} disabled={pending} onChange={(event) => setStepTitle(event.target.value)} />
            {topLevel.length > 0 && <select aria-label={t('skynex.tasks.parentStep')} value={parentChoice} disabled={pending} onChange={(event) => setParentStep(event.target.value)} className={cn(selectClass, 'max-w-[7rem]')}>
              <option value="">{t('skynex.tasks.topLevel')}</option>
              {topLevel.map((step) => <option key={step.id} value={step.id}>{step.title}</option>)}
            </select>}
            <Button variant="outline" size="sm" type="submit" aria-label={t('skynex.tasks.add')} title={t('skynex.tasks.add')} className={ICON_BUTTON_CLASS} disabled={pending || failed || !validTitle(stepTitle)}>
              <Icon name="add" className="size-3.5" />
            </Button>
          </form>}
        </>}
        {!taskFormOpen && <div className="mt-2.5 border-t border-border px-2 pt-2.5">
          <Button variant="ghost" size="xs" aria-expanded={false} className="h-7 w-full justify-start gap-1.5 px-1 text-xs" disabled={pending} onClick={() => setTaskFormOpen(true)}>
            <Icon name="add" className="size-3.5" />{t('skynex.tasks.addTaskAction')}
          </Button>
        </div>}
        {taskFormOpen && <form className="mt-2.5 flex items-center gap-2 border-t border-border px-2 pb-1 pt-2.5" onSubmit={(event) => { event.preventDefault(); if (validTitle(title)) void mutate(() => skynexTasksApi.create(directory, title.trim()), () => { setTitle(''); setTaskFormOpen(false); }); }}>
          <Input inputSize="compact" className="min-w-0 flex-1" aria-label={t('skynex.tasks.newTask')} placeholder={t('skynex.tasks.newTask')} maxLength={200} value={title} disabled={pending} onChange={(event) => setTitle(event.target.value)} />
          <Button variant="outline" size="sm" type="submit" aria-label={t('skynex.tasks.create')} title={t('skynex.tasks.create')} className={ICON_BUTTON_CLASS} disabled={pending || failed || !validTitle(title)}>
            <Icon name="add" className="size-3.5" />
          </Button>
        </form>}
    </div>
  );
  return (
    <WorkStatusCollapsibleSection id="tasks" title={t('skynex.tasks.title')} icon="list-check-2" defaultExpanded action={refresh}>
      {body}
    </WorkStatusCollapsibleSection>
  );
};
