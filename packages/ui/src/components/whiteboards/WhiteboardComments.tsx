import React from 'react';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import { getCurrentIntlLocale } from '@/lib/i18n/intl';
import { addSkynexMention, completeMention, mentionPieces, mentionQueryAt, mentionsSkynex, removeSkynexMention, SKYNEX_MENTION } from '@/lib/whiteboards/mentions';
import { cn } from '@/lib/utils';
import type { Point, WhiteboardComment } from '@/lib/whiteboards/model';

const FLOATING = 'oc-surface-floating oc-glass-floating';

/** The round face of who wrote an entry: the person, or the agent's spark. */
function Face({ author, size = 'md' }: { author: 'user' | 'agent'; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden
      className={cn('inline-flex shrink-0 items-center justify-center rounded-full', size === 'sm' ? 'size-5' : 'size-6')}
      style={author === 'agent'
        ? { background: 'var(--status-warning)', color: 'var(--status-warning-foreground)' }
        : { background: 'var(--primary)', color: 'var(--primary-foreground)' }}
    >
      <Icon name={author === 'agent' ? 'sparkling-2' : 'user-3'} className={size === 'sm' ? 'size-3' : 'size-3.5'} />
    </span>
  );
}

/**
 * The markers of a board's comments, in board coordinates but always the same
 * size on screen. A marker shows who took part: the person, and the agent's
 * spark once it answered.
 */
export function CommentMarkers({ comments, pointOf, zoom, openId, onOpen }: {
  comments: readonly WhiteboardComment[];
  pointOf: (comment: WhiteboardComment) => Point;
  zoom: number;
  openId: string | null;
  onOpen: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <>
      {comments.map((comment) => {
        const point = pointOf(comment);
        const answered = comment.entries.some((entry) => entry.author === 'agent');
        return (
          <button
            key={comment.id}
            type="button"
            data-board-chrome
            aria-label={t('whiteboards.comments.openThread')}
            aria-pressed={openId === comment.id}
            onClick={() => onOpen(comment.id)}
            // oxlint-disable-next-line openchamber/no-physical-sides -- the board layer is always LTR: the marker's tail points at its anchor in board coordinates
            className={cn('absolute flex origin-bottom-left items-center rounded-full rounded-bl-none p-0.5 shadow-md transition-transform hover:scale-110', openId === comment.id && 'ring-2 ring-[var(--interactive-border-focus)]', comment.resolved && 'opacity-60')}
            style={{ left: point.x, top: point.y, transform: `scale(${1 / zoom}) translate(10px, calc(-100% - 10px))`, background: 'var(--surface-elevated)' }}
          >
            <Face author="user" />
            {answered ? <span className="-ms-2"><Face author="agent" /></span> : null}
          </button>
        );
      })}
    </>
  );
}

/** A comment card floating by its marker, or a sheet over the bottom of a phone. */
function CommentCard({ style, compact, children, label }: { style: React.CSSProperties; compact: boolean; children: React.ReactNode; label: string }) {
  return (
    <div
      data-board-chrome
      role="dialog"
      aria-label={label}
      className={cn(FLOATING, 'absolute z-30 flex flex-col gap-2 rounded-2xl p-3', compact ? 'inset-x-2 bottom-20' : 'w-[19rem]')}
      style={compact ? undefined : style}
    >
      {children}
    </div>
  );
}

const useTimeFormat = () => React.useMemo(() => {
  const time = new Intl.DateTimeFormat(getCurrentIntlLocale(), { hour: '2-digit', minute: '2-digit' });
  const day = new Intl.DateTimeFormat(getCurrentIntlLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return (at: number) => (new Date(at).toDateString() === new Date().toDateString() ? time.format(at) : day.format(at));
}, []);

const MENTION_TAG = 'rounded-[4px] bg-[color-mix(in_oklab,var(--primary)_18%,transparent)] text-[var(--primary)] shadow-[0_0_0_2px_color-mix(in_oklab,var(--primary)_18%,transparent)]';

/** Text with its @Skynex mentions drawn as tags. */
function MentionText({ text }: { text: string }) {
  return (
    <>
      {mentionPieces(text).map((piece, index) => (piece.mention
        ? <span key={index} className={MENTION_TAG}>{piece.text}</span>
        : <React.Fragment key={index}>{piece.text}</React.Fragment>))}
    </>
  );
}

const FIELD_TEXT = 'px-3 py-2 typography-ui-label whitespace-pre-wrap break-words';

/**
 * Where a comment or a reply is written. Mentioning @Skynex sends it to
 * Skynex: typing @ offers the mention, and "Send to Skynex" adds or removes
 * it. The mention shows as a tag through a copy of the text drawn under a
 * transparent textarea, which keeps typing, the caret and IME input native.
 */
function CommentField({ placeholder, initialText = '', autoFocus, bare = false, onSubmit, onCancel }: {
  placeholder: string;
  /** No field box: the card itself is the field, as in a new comment. */
  bare?: boolean;
  initialText?: string;
  autoFocus?: boolean;
  onSubmit: (text: string, sent: boolean) => Promise<boolean>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = React.useState(initialText);
  const [caret, setCaret] = React.useState(initialText.length);
  const [menuClosed, setMenuClosed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const fieldRef = React.useRef<HTMLTextAreaElement | null>(null);
  const backdropRef = React.useRef<HTMLDivElement | null>(null);
  const sent = mentionsSkynex(text);
  const query = menuClosed ? null : mentionQueryAt(text, caret);

  React.useLayoutEffect(() => {
    const field = fieldRef.current;
    if (!autoFocus || !field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, [autoFocus]);

  const change = (next: string, nextCaret: number) => {
    setText(next);
    setCaret(nextCaret);
    setMenuClosed(false);
    // The caret goes where the edit put it once React has the new text.
    requestAnimationFrame(() => fieldRef.current?.setSelectionRange(nextCaret, nextCaret));
  };

  const choose = () => {
    if (!query) return;
    const done = completeMention(text, query.start, caret);
    change(done.text, done.caret);
  };

  const submit = async () => {
    const value = text.trim();
    if (!value || busy) return;
    setBusy(true);
    const done = await onSubmit(value, sent);
    setBusy(false);
    if (done) change('', 0);
  };

  return (
    <form
      className="relative flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      {query ? (
        <div role="listbox" aria-label={t('whiteboards.comments.mentions')} className={cn(FLOATING, 'absolute inset-x-0 bottom-full z-10 mb-2 flex flex-col rounded-xl p-1')}>
          <button
            type="button"
            role="option"
            aria-selected
            onMouseDown={(event) => event.preventDefault()}
            onClick={choose}
            className="flex items-baseline gap-2 rounded-lg bg-interactive-hover px-2 py-1.5 text-start"
          >
            <span className="typography-ui-label font-semibold text-foreground">@skynex</span>
            <span className="min-w-0 truncate typography-meta text-muted-foreground">{t('whiteboards.comments.mentionSkynex')}</span>
          </button>
          <div className="mt-1 border-t border-[color-mix(in_oklab,var(--foreground)_10%,transparent)] px-2 pb-0.5 pt-1.5 typography-meta text-muted-foreground">{t('whiteboards.comments.mentionKeys')}</div>
        </div>
      ) : null}
      <div className={cn('relative max-h-40 min-h-10 overflow-hidden rounded-xl', !bare && 'bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] focus-within:shadow-[inset_0_0_0_1px_var(--interactive-border-focus)]')}>
        <div ref={backdropRef} aria-hidden className={cn(FIELD_TEXT, 'pointer-events-none absolute inset-0 overflow-hidden text-foreground')}>
          <MentionText text={text} />
          {'\u200b'}
        </div>
        <textarea
          ref={fieldRef}
          rows={bare ? 1 : 2}
          value={text}
          maxLength={4000}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => change(event.target.value, event.target.selectionStart)}
          onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
          onScroll={(event) => {
            if (backdropRef.current) backdropRef.current.scrollTop = event.currentTarget.scrollTop;
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (query && (event.key === 'Enter' || event.key === 'Tab')) {
              event.preventDefault();
              choose();
            } else if (query && event.key === 'Escape') {
              event.preventDefault();
              setMenuClosed(true);
            } else if (query && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
              // One choice for now: the keys stay on it.
              event.preventDefault();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            } else if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          className={cn(FIELD_TEXT, 'relative block max-h-40 w-full resize-none bg-transparent text-transparent caret-[var(--foreground)] outline-none placeholder:text-muted-foreground')}
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="flex cursor-pointer items-center gap-2 typography-meta text-muted-foreground">
          <Checkbox
            checked={sent}
            onChange={(next) => {
              const value = next ? addSkynexMention(text) : removeSkynexMention(text);
              change(value, value.length);
            }}
            ariaLabel={t('whiteboards.comments.sendToAgent')}
          />
          {t('whiteboards.comments.sendToAgent')}
        </label>
        <Button type="submit" size="sm" className="ms-auto size-8 rounded-full p-0" disabled={busy || !text.trim()} aria-label={t('whiteboards.comments.send')} title={t('whiteboards.comments.send')}>
          <Icon name="arrow-up" className="size-4" />
        </Button>
      </div>
    </form>
  );
}

/** A new comment, by what it is about. */
export function CommentComposer({ target, style, compact, onSubmit, onClose }: {
  /** What the comment is about, when it is about something named; an area or a point needs no words. */
  target: string | null;
  style: React.CSSProperties;
  compact: boolean;
  onSubmit: (text: string, sent: boolean) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <CommentCard style={style} compact={compact} label={t('whiteboards.comments.add')}>
      {target ? <span className="min-w-0 truncate px-1 typography-meta text-muted-foreground">{target}</span> : null}
      <CommentField bare autoFocus initialText={`${SKYNEX_MENTION} `} placeholder={t('whiteboards.comments.placeholder')} onSubmit={onSubmit} onCancel={onClose} />
    </CommentCard>
  );
}

function IconButton({ label, icon, onClick, pressed }: { label: string; icon: 'check' | 'close' | 'more-2'; onClick?: () => void; pressed?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          onClick={onClick}
          className={cn('inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground', pressed && 'text-[var(--status-success)]')}
        >
          <Icon name={icon} className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={6}><p>{label}</p></TooltipContent>
    </Tooltip>
  );
}

/**
 * A comment's thread: who wrote what and when, whether the agent is working
 * on it, and the field to answer. Resolving hides the comment from the board;
 * it stays in the list of all comments.
 */
export function CommentThread({ comment, target, working, style, compact, onReply, onResolve, onDelete, onClose }: {
  comment: WhiteboardComment;
  target: string;
  working: boolean;
  style: React.CSSProperties;
  compact: boolean;
  onReply: (text: string, sent: boolean) => Promise<boolean>;
  onResolve: (resolved: boolean) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const format = useTimeFormat();
  const listRef = React.useRef<HTMLDivElement | null>(null);
  // New entries (an answer from the agent) scroll into view.
  React.useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [comment.entries.length, working]);
  return (
    <CommentCard style={style} compact={compact} label={t('whiteboards.comments.thread')}>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate typography-meta text-muted-foreground">{target}</span>
        <IconButton label={t(comment.resolved ? 'whiteboards.comments.reopen' : 'whiteboards.comments.resolve')} icon="check" pressed={comment.resolved} onClick={() => onResolve(!comment.resolved)} />
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={t('whiteboards.comments.more')} className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground">
                  <Icon name="more-2" className="size-4" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}><p>{t('whiteboards.comments.more')}</p></TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="min-w-40">
            <DropdownMenuItem onSelect={onDelete} className="text-[var(--status-error)]">
              <Icon name="delete-bin" className="size-4" />
              {t('whiteboards.comments.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <IconButton label={t('whiteboards.comments.close')} icon="close" onClick={onClose} />
      </div>
      <div ref={listRef} className="flex max-h-72 flex-col gap-3 overflow-y-auto pe-1">
        {comment.entries.map((entry) => (
          <div key={entry.id} className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <Face author={entry.author} />
              <span className="typography-ui-label font-medium text-foreground">{t(entry.author === 'agent' ? 'whiteboards.comments.agent' : 'whiteboards.comments.you')}</span>
              <span className="typography-meta text-muted-foreground">{format(entry.at)}</span>
              {entry.sent ? <span className="ms-auto typography-meta text-muted-foreground" title={t('whiteboards.comments.sent')}><Icon name="sparkling-2" className="size-3.5" /></span> : null}
            </div>
            <p className="whitespace-pre-wrap break-words ps-8 typography-ui-label text-foreground" dir="auto"><MentionText text={entry.text} /></p>
          </div>
        ))}
        {working ? (
          <div className="flex items-center gap-2">
            <Face author="agent" />
            <span className="typography-ui-label font-medium text-foreground">{t('whiteboards.comments.agent')}</span>
            <span className="animate-pulse typography-meta text-muted-foreground">{t('whiteboards.comments.working')}</span>
          </div>
        ) : null}
      </div>
      <CommentField
        initialText={comment.entries.some((entry) => entry.author === 'agent') ? `${SKYNEX_MENTION} ` : ''}
        placeholder={t('whiteboards.comments.replyPlaceholder')}
        onSubmit={onReply}
        onCancel={onClose}
      />
    </CommentCard>
  );
}

/** Every comment of the board, newest first; resolved ones on request. */
export function CommentsPanel({ comments, showResolved, onShowResolved, onPick, onClose }: {
  comments: readonly WhiteboardComment[];
  showResolved: boolean;
  onShowResolved: (show: boolean) => void;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const format = useTimeFormat();
  const shown = [...comments].filter((comment) => showResolved || !comment.resolved).sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div data-board-chrome role="dialog" aria-label={t('whiteboards.comments.all')} className={cn(FLOATING, 'absolute end-3 top-16 z-30 flex max-h-[min(28rem,calc(100%-6rem))] w-80 max-w-[calc(100%-1.5rem)] flex-col gap-2 rounded-2xl p-3')}>
      <div className="flex items-center gap-1">
        <span className="flex-1 typography-ui-label font-semibold text-foreground">{t('whiteboards.comments.all')}</span>
        <IconButton label={t('whiteboards.comments.close')} icon="close" onClick={onClose} />
      </div>
      <label className="flex cursor-pointer items-center gap-2 typography-meta text-muted-foreground">
        <Checkbox checked={showResolved} onChange={onShowResolved} ariaLabel={t('whiteboards.comments.showResolved')} />
        {t('whiteboards.comments.showResolved')}
      </label>
      <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
        {shown.length === 0 ? <p className="py-6 text-center typography-meta text-muted-foreground">{t('whiteboards.comments.empty')}</p> : null}
        {shown.map((comment) => {
          const [first] = comment.entries;
          const replies = comment.entries.length - 1;
          const answered = comment.entries.some((entry) => entry.author === 'agent');
          return (
            <button key={comment.id} type="button" onClick={() => onPick(comment.id)} className={cn('flex flex-col gap-1 rounded-xl p-2 text-start transition-colors hover:bg-interactive-hover', comment.resolved && 'opacity-60')}>
              <span className="flex items-center gap-2">
                <Face author="user" size="sm" />
                <span className="typography-meta text-muted-foreground">{first ? format(first.at) : ''}</span>
                {answered ? <Face author="agent" size="sm" /> : null}
                {comment.resolved ? <Icon name="check" className="ms-auto size-3.5 text-[var(--status-success)]" /> : null}
              </span>
              <span className="line-clamp-2 typography-ui-label text-foreground" dir="auto">{first ? <MentionText text={first.text} /> : null}</span>
              {replies > 0 ? <span className="typography-meta text-muted-foreground">{t(replies === 1 ? 'whiteboards.comments.oneReply' : 'whiteboards.comments.replies', { count: String(replies) })}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** The button by the zoom controls that lists every comment, with how many are open. */
export function CommentsButton({ count, open, onClick }: { count: number; open: boolean; onClick: () => void }) {
  const { t } = useI18n();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={t('whiteboards.comments.all')}
          aria-pressed={open}
          onClick={onClick}
          className={cn(FLOATING, 'inline-flex h-10 items-center gap-1.5 rounded-xl px-3 typography-ui-label text-muted-foreground transition-colors hover:text-foreground', open && 'text-foreground')}
        >
          <Icon name="chat-3" className="size-[18px]" />
          {count > 0 ? <span className="tabular-nums">{count}</span> : null}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={8}><p>{t('whiteboards.comments.all')}</p></TooltipContent>
    </Tooltip>
  );
}
