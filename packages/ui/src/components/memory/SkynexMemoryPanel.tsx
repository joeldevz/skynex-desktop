import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Icon } from '@/components/icon/Icon';
import { WorkStatusSection } from '@/components/chat/work-status/WorkStatusPrimitives';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { skynexMemoryApi, type SkynexMemory, type SkynexMemoryNote } from '@/lib/skynexMemoryApi';

const MEMORIES_PER_PAGE = 5;
const EMPTY_NOTE: SkynexMemoryNote = { what: '', why: '', where: '', learned: '' };
const NOTE_FIELDS: readonly (keyof SkynexMemoryNote)[] = ['what', 'why', 'where', 'learned'];
// The row box shared with WorkStatusRow (h-7, rounded-md, px-1), used for the add-note row action.
const ROW_ACTION_CLASS = 'flex h-7 w-full items-center gap-2 rounded-md px-1 text-start text-[0.8125rem] text-muted-foreground transition-colors hover:text-foreground';

const filled = (value: string) => value.trim().length > 0 && !/[\p{Cc}\p{Cf}]/u.test(value);

type PanelError = 'load' | 'search' | 'save' | null;

const MemoryItem: React.FC<{ memory: SkynexMemory }> = ({ memory }) => {
  const { t } = useI18n();
  const [expanded, setExpanded] = React.useState(false);
  return (
    <li className="flex flex-col gap-0.5 px-1 py-2">
      <span className="block truncate text-[0.8125rem] font-medium" title={memory.title ?? undefined}>{memory.title ?? t('skynex.memory.untitled')}</span>
      <p className={cn('whitespace-pre-wrap break-words text-xs text-muted-foreground', !expanded && 'line-clamp-2')}>{memory.content}</p>
      <div className="flex items-center justify-between gap-2 text-xs">
        <button type="button" aria-expanded={expanded} onClick={() => setExpanded((value) => !value)} className="text-primary hover:underline">
          {expanded ? t('skynex.memory.showLess') : t('skynex.memory.showMore')}
        </button>
        {memory.createdAt && <span className="min-w-0 truncate text-muted-foreground">{memory.createdAt}</span>}
      </div>
    </li>
  );
};

export const SkynexMemoryPanel: React.FC<{ directory: string | null }> = ({ directory }) => {
  const { t } = useI18n();
  const [memories, setMemories] = React.useState<SkynexMemory[]>([]);
  // Null while the recent list is shown; the recall results once a search ran.
  const [results, setResults] = React.useState<SkynexMemory[] | null>(null);
  const [page, setPage] = React.useState(0);
  React.useEffect(() => setPage(0), [results]);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<PanelError>(null);
  const [query, setQuery] = React.useState('');
  const [note, setNote] = React.useState<SkynexMemoryNote>(EMPTY_NOTE);
  const [noteOpen, setNoteOpen] = React.useState(false);

  const load = React.useCallback(async (): Promise<void> => {
    if (!directory) return;
    setLoading(true);
    try {
      setMemories(await skynexMemoryApi.list(directory));
      setError(null);
    } catch {
      setError('load');
    } finally {
      setLoading(false);
    }
  }, [directory]);

  React.useEffect(() => {
    setMemories([]);
    setResults(null);
    void load();
  }, [load]);

  if (!directory) return null;

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!filled(query) || busy) return;
    setBusy(true);
    try {
      setResults(await skynexMemoryApi.recall(directory, query.trim()));
      setError(null);
    } catch {
      setError('search');
    } finally {
      setBusy(false);
    }
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!NOTE_FIELDS.every((field) => filled(note[field])) || busy) return;
    setBusy(true);
    try {
      await skynexMemoryApi.save(directory, {
        what: note.what.trim(), why: note.why.trim(), where: note.where.trim(), learned: note.learned.trim(),
      });
      setNote(EMPTY_NOTE);
      await load();
    } catch {
      setError('save');
    } finally {
      setBusy(false);
    }
  };

  const shown = results ?? memories;
  const pageCount = Math.max(1, Math.ceil(shown.length / MEMORIES_PER_PAGE));
  const currentPage = Math.min(page, pageCount - 1);
  const visible = shown.slice(currentPage * MEMORIES_PER_PAGE, (currentPage + 1) * MEMORIES_PER_PAGE);

  return (
    <section aria-label={t('skynex.memory.title')} aria-busy={loading || busy} className="h-full overflow-auto p-2 text-[0.8125rem] text-foreground">
      <div className="oc-panel-edge flex flex-col rounded-xl bg-background py-1.5">
        <WorkStatusSection title={t('skynex.memory.title')}>
          {error === 'load' && <div role="alert" className="flex items-center justify-between gap-2 px-1 text-xs"><p>{t('skynex.memory.loadFailed')}</p><Button size="xs" variant="outline" disabled={loading} onClick={() => void load()}>{t('skynex.memory.retry')}</Button></div>}
          {error === 'search' && <p role="alert" className="px-1 text-xs">{t('skynex.memory.searchFailed')}</p>}
          {error === 'save' && <p role="alert" className="px-1 text-xs">{t('skynex.memory.saveFailed')}</p>}

          <form className="flex items-center gap-1.5 px-1" onSubmit={(event) => void search(event)}>
            <Input inputSize="compact" className="min-w-0 flex-1" aria-label={t('skynex.memory.search')} placeholder={t('skynex.memory.search')} maxLength={200} value={query} disabled={busy} onChange={(event) => setQuery(event.target.value)} />
            <Button size="sm" type="submit" disabled={busy || !filled(query)}>{t('skynex.memory.searchButton')}</Button>
            {results !== null && <Button size="sm" variant="outline" disabled={busy} onClick={() => { setResults(null); setQuery(''); }}>{t('skynex.memory.clearSearch')}</Button>}
          </form>

          <h4 className="px-1 pt-1 text-xs font-medium text-muted-foreground">{results === null ? t('skynex.memory.recent') : t('skynex.memory.results')}</h4>
          {!loading && error !== 'load' && shown.length === 0 && <p className="px-1 text-xs text-muted-foreground">{results === null ? t('skynex.memory.empty') : t('skynex.memory.searchEmpty')}</p>}
          <ul className="flex flex-col divide-y divide-border">{visible.map((memory) => <MemoryItem key={memory.id} memory={memory} />)}</ul>
          {shown.length > MEMORIES_PER_PAGE && (
            <nav aria-label={t('skynex.memory.title')} className="flex items-center justify-between gap-2 px-1 text-xs">
              <Button size="xs" variant="outline" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t('skynex.memory.prev')}</Button>
              <span className="tabular-nums text-muted-foreground">{t('skynex.memory.pageOf', { page: currentPage + 1, pages: pageCount })}</span>
              <Button size="xs" variant="outline" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>{t('skynex.memory.next')}</Button>
            </nav>
          )}

          <div className="mt-1 border-t border-border pt-1">
            <button type="button" aria-expanded={noteOpen} onClick={() => setNoteOpen((open) => !open)} className={ROW_ACTION_CLASS}>
              <Icon name={noteOpen ? 'arrow-down-s' : 'arrow-right-s'} className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t('skynex.memory.addNote')}</span>
            </button>
            {noteOpen && <form className="flex flex-col gap-1.5 px-1 pt-1" onSubmit={(event) => void save(event)}>
              <Input inputSize="compact" aria-label={t('skynex.memory.what')} placeholder={t('skynex.memory.what')} maxLength={1000} value={note.what} disabled={busy} onChange={(event) => setNote({ ...note, what: event.target.value })} />
              <Input inputSize="compact" aria-label={t('skynex.memory.why')} placeholder={t('skynex.memory.why')} maxLength={1000} value={note.why} disabled={busy} onChange={(event) => setNote({ ...note, why: event.target.value })} />
              <Input inputSize="compact" aria-label={t('skynex.memory.where')} placeholder={t('skynex.memory.where')} maxLength={1000} value={note.where} disabled={busy} onChange={(event) => setNote({ ...note, where: event.target.value })} />
              <Input inputSize="compact" aria-label={t('skynex.memory.learned')} placeholder={t('skynex.memory.learned')} maxLength={1000} value={note.learned} disabled={busy} onChange={(event) => setNote({ ...note, learned: event.target.value })} />
              <div className="flex justify-end">
                <Button size="sm" type="submit" disabled={busy || !NOTE_FIELDS.every((field) => filled(note[field]))}>{t('skynex.memory.save')}</Button>
              </div>
            </form>}
          </div>
        </WorkStatusSection>
      </div>
    </section>
  );
};
