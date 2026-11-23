import React from 'react';

import { Icon } from '@/components/icon/Icon';
import type { IconName } from '@/components/icon/icons';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n, type I18nKey } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { BLOCK_FORMS, TEXT_ALIGNS, TEXT_SIZES, WHITEBOARD_COLORS, type BlockForm, type TextAlign, type TextSize, type WhiteboardColor } from '@/lib/whiteboards/model';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { blockPaint } from './whiteboardColors';
import { FORMAT_BAR_ATTRIBUTE } from './textEditing';

/** Floating chrome over the board: opaque, raised, the same light as the composer. */
const FLOATING = 'oc-surface-floating oc-glass-floating';

function ChromeButton({ label, icon, pressed, disabled, onClick, side = 'top', className, keepFocus, children }: {
  label: string;
  /** Leaves focus where it is, so a text being edited keeps its selection. */
  keepFocus?: boolean;
  icon?: IconName;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  side?: 'top' | 'bottom';
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onMouseDown={keepFocus ? (event) => event.preventDefault() : undefined}
          onClick={onClick}
          className={cn(
            'inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg px-1.5 text-muted-foreground transition-colors',
            'hover:bg-interactive-hover hover:text-foreground disabled:pointer-events-none disabled:opacity-40',
            pressed && 'bg-interactive-selection text-interactive-selection-foreground hover:bg-interactive-selection hover:text-interactive-selection-foreground',
            className,
          )}
        >
          {icon ? <Icon name={icon} className="size-[18px]" /> : null}
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} sideOffset={8}><p>{label}</p></TooltipContent>
    </Tooltip>
  );
}

const Divider = () => <span className="mx-0.5 h-5 w-px shrink-0 bg-[color-mix(in_oklab,var(--foreground)_12%,transparent)]" aria-hidden />;

export type CanvasTool = 'select' | 'hand' | 'block' | 'note' | 'text' | 'section' | 'arrow' | 'comment';

const TOOLS: ReadonlyArray<{ tool: CanvasTool; icon: IconName; label: I18nKey }> = [
  { tool: 'select', icon: 'cursor', label: 'whiteboards.canvas.tool.select' },
  { tool: 'hand', icon: 'hand', label: 'whiteboards.canvas.tool.hand' },
  { tool: 'block', icon: 'rectangle', label: 'whiteboards.canvas.tool.block' },
  { tool: 'note', icon: 'sticky-note', label: 'whiteboards.canvas.tool.note' },
  { tool: 'text', icon: 'text', label: 'whiteboards.canvas.tool.text' },
  { tool: 'section', icon: 'shape', label: 'whiteboards.canvas.tool.section' },
  { tool: 'arrow', icon: 'arrow-right-up', label: 'whiteboards.canvas.tool.arrow' },
];

/** The tools along the bottom of the board, with undo and the request to the agent. */
export function ToolDock({ tool, onTool, canUndo, onUndo, askOpen, onAsk, onImage, compact }: {
  tool: CanvasTool;
  onTool: (tool: CanvasTool) => void;
  canUndo: boolean;
  onUndo: () => void;
  askOpen: boolean;
  onAsk?: () => void;
  onImage: () => void;
  compact: boolean;
}) {
  const { t } = useI18n();
  return (
    <div className={cn(FLOATING, 'flex max-w-full items-center gap-0.5 overflow-x-auto rounded-2xl p-1')}>
      {TOOLS.map((entry) => (
        <ChromeButton key={entry.tool} label={t(entry.label)} icon={entry.icon} pressed={tool === entry.tool} onClick={() => onTool(entry.tool)} />
      ))}
      <ChromeButton label={t('whiteboards.canvas.tool.image')} icon="image-add" onClick={onImage} />
      <Divider />
      <ChromeButton label={t('whiteboards.canvas.undo')} icon="arrow-go-back" disabled={!canUndo} onClick={onUndo} />
      {onAsk ? (
        <>
          <Divider />
          <Button size="sm" variant={askOpen ? 'secondary' : 'default'} aria-pressed={askOpen} className="ms-0.5 h-8 gap-1.5 rounded-xl px-3" onClick={onAsk}>
            <Icon name="sparkling-2" className="size-4" />
            {compact ? null : t('whiteboards.canvas.ask')}
          </Button>
        </>
      ) : null}
      <Divider />
      {/* Comments have their own tool at the end, set apart in the accent like Claude's: mark any part of the board and write about it. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={t('whiteboards.canvas.tool.comment')}
            aria-pressed={tool === 'comment'}
            onClick={() => onTool(tool === 'comment' ? 'select' : 'comment')}
            className={cn(
              'inline-flex size-8 shrink-0 items-center justify-center rounded-xl transition-colors',
              tool === 'comment'
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                // At rest it is a plain tool with an accent glyph; only when on does it fill, like the others when pressed.
                : 'text-[var(--primary)] hover:bg-interactive-hover',
            )}
          >
            {tool === 'comment' ? <Icon name="chat-3-fill" className="size-[18px]" /> : <Icon name="chat-3" className="size-[18px]" />}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={8}><p>{t('whiteboards.canvas.tool.comment')}</p></TooltipContent>
      </Tooltip>
    </div>
  );
}

/** The request box above the dock, shaped like the chat composer. */
export function AskBox({ selectionCount, onSubmit, onClose }: {
  selectionCount: number;
  onSubmit: (text: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [text, setText] = React.useState('');
  const [sending, setSending] = React.useState(false);
  const submit = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    const done = await onSubmit(value);
    setSending(false);
    if (done) setText('');
  };
  return (
    <form
      className={cn(FLOATING, 'oc-composer-sheen flex w-full max-w-xl flex-col gap-2 rounded-2xl p-2.5')}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-center gap-1.5 px-1 typography-meta text-muted-foreground">
        <Icon name="sparkling-2" className="size-3.5 text-[var(--primary)]" />
        {selectionCount > 0 ? t('whiteboards.canvas.askScopeSelection', { count: String(selectionCount) }) : t('whiteboards.canvas.askScopeBoard')}
      </div>
      <div className="flex items-end gap-2">
        <textarea
          autoFocus
          rows={1}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') onClose();
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          placeholder={selectionCount > 0 ? t('whiteboards.canvas.askPlaceholderSelection') : t('whiteboards.canvas.askPlaceholder')}
          aria-label={t('whiteboards.canvas.ask')}
          className="max-h-32 min-h-8 min-w-0 flex-1 resize-none bg-transparent px-1 py-1.5 typography-ui-label text-foreground outline-none [field-sizing:content] placeholder:text-muted-foreground"
        />
        <Button type="submit" size="sm" className="size-8 shrink-0 rounded-xl p-0" disabled={!text.trim() || sending} aria-label={t('whiteboards.canvas.askSend')}>
          <Icon name="arrow-up" className="size-4" />
        </Button>
      </div>
    </form>
  );
}

export function WorkingPill({ onStop }: { onStop: () => void }) {
  const { t } = useI18n();
  return (
    <div className={cn(FLOATING, 'flex items-center gap-2 rounded-full py-1 ps-3 pe-1 typography-meta text-foreground')} role="status">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--status-warning)] opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-[var(--status-warning)]" />
      </span>
      {t('whiteboards.canvas.askWorking')}
      <button type="button" onClick={onStop}
        className="rounded-full px-2.5 py-1 text-muted-foreground transition-colors hover:bg-interactive-hover hover:text-foreground">
        {t('whiteboards.canvas.askStop')}
      </button>
    </div>
  );
}

export function ZoomControls({ zoom, onZoomIn, onZoomOut, onFit, onLastChange }: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onLastChange?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className={cn(FLOATING, 'flex items-center gap-0.5 rounded-xl p-1')}>
      {onLastChange ? <ChromeButton side="bottom" label={t('whiteboards.canvas.lastChange')} icon="focus-3" onClick={onLastChange} /> : null}
      <ChromeButton side="bottom" label={t('whiteboards.canvas.zoomOut')} icon="zoom-out" onClick={onZoomOut} />
      <ChromeButton side="bottom" label={t('whiteboards.canvas.fit')} onClick={onFit} className="min-w-12 typography-meta tabular-nums">
        {Math.round(zoom * 100)}%
      </ChromeButton>
      <ChromeButton side="bottom" label={t('whiteboards.canvas.zoomIn')} icon="zoom-in" onClick={onZoomIn} />
    </div>
  );
}

const COLOR_LABEL = {
  gray: 'whiteboards.canvas.color.gray',
  red: 'whiteboards.canvas.color.red',
  orange: 'whiteboards.canvas.color.orange',
  yellow: 'whiteboards.canvas.color.yellow',
  green: 'whiteboards.canvas.color.green',
  blue: 'whiteboards.canvas.color.blue',
  purple: 'whiteboards.canvas.color.purple',
  pink: 'whiteboards.canvas.color.pink',
} satisfies Record<WhiteboardColor, I18nKey>;

const FORM_LABEL = {
  rect: 'whiteboards.canvas.form.rect',
  rounded: 'whiteboards.canvas.form.rounded',
  pill: 'whiteboards.canvas.form.pill',
  diamond: 'whiteboards.canvas.form.diamond',
  database: 'whiteboards.canvas.form.database',
} satisfies Record<BlockForm, I18nKey>;

function FormGlyph({ form }: { form: BlockForm }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.6 };
  return (
    <svg viewBox="0 0 20 20" className="size-[18px]" aria-hidden>
      {form === 'rect' ? <rect x={3} y={5} width={14} height={10} rx={1} {...common} /> : null}
      {form === 'rounded' ? <rect x={3} y={5} width={14} height={10} rx={3.5} {...common} /> : null}
      {form === 'pill' ? <rect x={2.5} y={6} width={15} height={8} rx={4} {...common} /> : null}
      {form === 'diamond' ? <polygon points="10,3 17,10 10,17 3,10" strokeLinejoin="round" {...common} /> : null}
      {form === 'database' ? (
        <>
          <ellipse cx={10} cy={5.5} rx={6} ry={2.2} {...common} />
          {/* A polyline, not a path: the app paints every path inside a button with the text colour. */}
          <polyline points="4.00,5.50 4.00,14.50 4.20,15.07 4.80,15.60 5.76,16.06 7.00,16.41 8.45,16.63 10.00,16.70 11.55,16.63 13.00,16.41 14.24,16.06 15.20,15.60 15.80,15.07 16.00,14.50 16.00,5.50" {...common} />
        </>
      ) : null}
    </svg>
  );
}

const SIZE_LABEL = {
  title: 'whiteboards.canvas.size.title',
  heading: 'whiteboards.canvas.size.heading',
  body: 'whiteboards.canvas.size.body',
  small: 'whiteboards.canvas.size.small',
} satisfies Record<TextSize, I18nKey>;

/** A trigger in the quick-edit bar: what is set now, and a chevron that opens the choices. */
const BarTrigger = React.forwardRef<HTMLButtonElement, React.ComponentProps<'button'> & { label: string }>(({ label, children, className, ...props }, ref) => (
  <button
    ref={ref}
    type="button"
    aria-label={label}
    title={label}
    className={cn('inline-flex h-8 items-center gap-1 rounded-lg px-2 typography-ui-label text-foreground transition-colors hover:bg-interactive-hover data-[popup-open]:bg-interactive-hover', className)}
    {...props}
  >
    {children}
    <Icon name="arrow-down-s" className="size-3.5 text-muted-foreground" />
  </button>
));
BarTrigger.displayName = 'BarTrigger';

function alignIcon(align: TextAlign): IconName {
  if (align === 'start') return 'align-left';
  if (align === 'end') return 'align-right';
  return 'align-center';
}
const ALIGN_LABEL = {
  start: 'whiteboards.canvas.align.start',
  center: 'whiteboards.canvas.align.center',
  end: 'whiteboards.canvas.align.end',
} satisfies Record<TextAlign, I18nKey>;

/** The formatting controls of the bar, for the text being edited or the selected boxes as a whole. */
export type TextFormatControls = {
  bold: boolean;
  italic: boolean;
  bulleted: boolean;
  align: TextAlign;
  onBold: () => void;
  onItalic: () => void;
  onBullets: () => void;
  onAlign: (align: TextAlign) => void;
  /** Links exist only while editing, where words can be picked. */
  link?: { active: boolean; onStart: () => void; onApply: (href: string) => boolean; onEnd: () => void };
};

/** Where to type a link's address, in place of the bar's buttons. */
function LinkField({ onApply, onClose }: { onApply: (href: string) => boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [value, setValue] = React.useState('');
  const [invalid, setInvalid] = React.useState(false);
  const apply = () => {
    if (onApply(value.trim())) onClose();
    else setInvalid(true);
  };
  return (
    <form
      className="flex items-center gap-1 ps-1"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <input
        autoFocus
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder={t('whiteboards.canvas.linkPlaceholder')}
        aria-label={t('whiteboards.canvas.link')}
        aria-invalid={invalid}
        title={invalid ? t('whiteboards.canvas.linkInvalid') : undefined}
        className={cn('h-8 w-56 max-w-[60vw] rounded-lg bg-transparent px-2 typography-ui-label text-foreground outline-none placeholder:text-muted-foreground', invalid && 'shadow-[inset_0_0_0_1px_var(--status-error)]')}
      />
      <ChromeButton label={t('whiteboards.canvas.linkApply')} icon="check" onClick={apply} />
      <ChromeButton label={t('whiteboards.canvas.linkCancel')} icon="close" onClick={onClose} />
    </form>
  );
}

/**
 * Quick edits for what is selected, in one compact row, in the order diagram
 * tools use: the form of a block, the text size, bold, italic, link, list and
 * alignment, the color, a comment (which can ask the agent), delete. While a text is
 * being edited only the formatting stays, and it applies to the words picked
 * in it; otherwise it applies to the whole text of every selected box.
 */
export function SelectionBar({ colors, showColors, form, onColor, onForm, size, onSize, format, editing = false, onComment, onDelete, style }: {
  colors: ReadonlySet<WhiteboardColor>;
  /** Pictures alone have no color to pick. */
  showColors: boolean;
  form: BlockForm | null;
  onColor: (color: WhiteboardColor) => void;
  onForm: ((form: BlockForm) => void) | null;
  size: TextSize | null;
  onSize: ((size: TextSize) => void) | null;
  format: TextFormatControls | null;
  editing?: boolean;
  /** Opens a comment on the selection, which can go to the agent too. */
  onComment: () => void;
  onDelete: () => void;
  style: React.CSSProperties;
}) {
  const { t } = useI18n();
  const [linking, setLinking] = React.useState(false);
  const current = colors.size === 1 ? [...colors][0] : null;
  const nextAlign = format ? TEXT_ALIGNS[(TEXT_ALIGNS.indexOf(format.align) + 1) % TEXT_ALIGNS.length] : 'start';
  const keepFocus = editing;
  const bar = cn(FLOATING, 'absolute z-20 flex w-max max-w-[calc(100%-16px)] -translate-x-1/2 flex-wrap items-center justify-center gap-0.5 rounded-xl p-1 rtl:translate-x-1/2');
  const barProps = { 'data-board-chrome': '', [FORMAT_BAR_ATTRIBUTE]: '' };
  if (linking && format?.link) {
    return (
      <div {...barProps} className={bar} style={style}>
        <LinkField
          onApply={format.link.onApply}
          onClose={() => {
            setLinking(false);
            format.link?.onEnd();
          }}
        />
      </div>
    );
  }
  return (
    <div {...barProps} className={bar} style={style}>
      {!editing && form && onForm ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <BarTrigger label={t('whiteboards.canvas.form')} className="px-1.5"><FormGlyph form={form} /></BarTrigger>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="min-w-40">
            {BLOCK_FORMS.map((entry) => (
              <DropdownMenuItem key={entry} onSelect={() => onForm(entry)} className={cn('gap-2', entry === form && 'bg-interactive-selection text-interactive-selection-foreground')}>
                <FormGlyph form={entry} />
                {t(FORM_LABEL[entry])}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {!editing && size && onSize ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <BarTrigger label={t('whiteboards.canvas.style')}>{t(SIZE_LABEL[size])}</BarTrigger>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="min-w-36">
            {TEXT_SIZES.map((entry) => (
              <DropdownMenuItem key={entry} onSelect={() => onSize(entry)} className={cn(entry === size && 'bg-interactive-selection text-interactive-selection-foreground')}>
                {t(SIZE_LABEL[entry])}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {format ? (
        <>
          <ChromeButton keepFocus={keepFocus} label={t('whiteboards.canvas.bold')} icon="bold" pressed={format.bold} onClick={format.onBold} />
          <ChromeButton keepFocus={keepFocus} label={t('whiteboards.canvas.italic')} icon="italic" pressed={format.italic} onClick={format.onItalic} />
          {format.link ? (
            <ChromeButton
              keepFocus={keepFocus}
              label={t('whiteboards.canvas.link')}
              icon="link"
              pressed={format.link.active}
              onClick={() => {
                format.link?.onStart();
                setLinking(true);
              }}
            />
          ) : null}
          <ChromeButton keepFocus={keepFocus} label={t('whiteboards.canvas.bullets')} icon="list-unordered" pressed={format.bulleted} onClick={format.onBullets} />
          <ChromeButton
            keepFocus={keepFocus}
            label={t(ALIGN_LABEL[nextAlign])}
            icon={alignIcon(format.align)}
            onClick={() => format.onAlign(nextAlign)}
            className="rtl:[&_svg]:-scale-x-100"
          />
        </>
      ) : null}
      {editing ? null : (
        <>
          {(size && onSize) || (form && onForm) || format ? <Divider /> : null}
          {showColors ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <BarTrigger label={t('whiteboards.canvas.color')} className="px-1.5">
                  <span
                    className="size-[18px] rounded-md"
                    style={{
                      background: current ? blockPaint(current).fill : 'conic-gradient(from 0deg, var(--status-error), var(--status-warning), var(--status-success), var(--status-info), var(--pr-merged), var(--status-error))',
                      boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--foreground) 18%, transparent)',
                    }}
                  />
                </BarTrigger>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="center" className="w-auto p-2">
                <div className="grid grid-cols-4 gap-1.5">
                  {WHITEBOARD_COLORS.map((color) => (
                    <DropdownMenuItem key={color} onSelect={() => onColor(color)} aria-label={t(COLOR_LABEL[color])} title={t(COLOR_LABEL[color])} className="size-8 justify-center p-0">
                      <span
                        className="size-6 rounded-md"
                        style={{
                          background: blockPaint(color).fill,
                          boxShadow: colors.has(color)
                            ? '0 0 0 2px var(--surface-elevated), 0 0 0 3.5px var(--interactive-border-focus)'
                            : 'inset 0 0 0 1px color-mix(in oklab, var(--foreground) 15%, transparent)',
                        }}
                      />
                    </DropdownMenuItem>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {showColors ? <Divider /> : null}
          <ChromeButton label={t('whiteboards.comments.add')} icon="chat-3" onClick={onComment} className="h-8 min-w-8" />
          <ChromeButton label={t('whiteboards.canvas.delete')} icon="delete-bin" onClick={onDelete} className="h-8 min-w-8 hover:text-[var(--status-error)]" />
        </>
      )}
    </div>
  );
}
