import React from 'react';

import { DictationWaveform } from '@/components/dictation/DictationWaveform';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useI18n } from '@/lib/i18n';
import { isIMECompositionEvent } from '@/lib/ime';

type BrowserAnnotationVoice = {
  status: 'idle' | 'recording' | 'uploading' | 'failed';
  error: string | null;
  subscribeLevel: (listener: (level: number) => void) => () => void;
  onStart: () => void;
  onTranscribe: () => void;
  onCancel: () => void;
  onRetry: () => void;
};

export function BrowserAnnotationComposer({ textareaRef, comment, onCommentChange, onAttach, submitting, voice }: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  comment: string;
  onCommentChange: (value: string) => void;
  onAttach: () => void;
  submitting: boolean;
  voice?: BrowserAnnotationVoice;
}) {
  const { t } = useI18n();
  const recording = voice?.status === 'recording';
  const processing = voice?.status === 'uploading';
  const failed = voice?.status === 'failed';
  const error = voice?.error ?? (failed ? t('chat.dictation.failed') : null);
  const placeholder = t('contextPanel.browser.annotate.commentPlaceholder');
  const canAttach = !submitting && (!voice || voice.status === 'idle');

  React.useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const resize = () => {
      if (!textarea.clientWidth) return;
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.max(32, Math.min(textarea.scrollHeight, 104))}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    if (textarea.parentElement) observer.observe(textarea.parentElement);
    return () => observer.disconnect();
  }, [comment, textareaRef]);

  return (
    <div className="oc-glass-tooltip flex w-full min-w-0 flex-col gap-0.5 rounded-[22px] border border-border p-1.5 ps-4 font-sans shadow-[0_8px_28px_rgb(0_0_0/.3)]">
      {error ? <span role="status" className="truncate typography-meta text-muted-foreground" title={error}>{error}</span> : null}
      <div className="flex min-w-0 items-center gap-2">
        <textarea
          ref={textareaRef}
          rows={1}
          dir="auto"
          aria-label={placeholder}
          placeholder={placeholder}
          value={comment}
          onChange={(event) => onCommentChange(event.target.value)}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter' && !event.shiftKey && !isIMECompositionEvent(event)) {
              event.preventDefault();
              if (canAttach) onAttach();
            }
          }}
          disabled={submitting}
          className="oc-ui-start-align block min-h-8 max-h-[104px] min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[13px]/5 text-foreground outline-none placeholder:text-muted-foreground"
        />
        {recording && voice ? <>
          <span role="status" className="sr-only">{t('chat.dictation.listening')}</span>
          <DictationWaveform subscribeLevel={voice.subscribeLevel} className="block h-4 w-14 shrink-0" />
        </> : null}
        {processing ? <span role="status" className="flex size-8 shrink-0 items-center justify-center text-muted-foreground">
          <Spinner className="size-4" />
          <span className="sr-only">{t('chat.dictation.processing')}</span>
        </span> : null}
        {failed && voice ? <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0 rounded-full text-muted-foreground" onClick={voice.onRetry} aria-label={t('chat.dictation.retry')} title={t('chat.dictation.retry')}>
          <Icon name="refresh" className="size-4" />
        </Button> : null}
        {voice && voice.status !== 'idle' ? <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0 rounded-full text-muted-foreground" onClick={voice.onCancel} aria-label={t('chat.dictation.cancel')} title={t('chat.dictation.cancel')}>
          <Icon name="close" className="size-4" />
        </Button> : null}
        {voice?.status === 'idle' ? <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0 rounded-full text-muted-foreground" disabled={submitting} onClick={voice.onStart} aria-label={t('chat.dictation.start')} title={t('chat.dictation.start')}>
          <Icon name="mic" className="size-4" />
        </Button> : null}
        {recording && voice ? <Button type="button" size="icon" className="size-8 shrink-0 rounded-full" onClick={voice.onTranscribe} aria-label={t('contextPanel.browser.annotate.transcribe')} title={t('contextPanel.browser.annotate.transcribe')}>
          <Icon name="check" className="size-4" />
        </Button> : <Button type="button" size="icon" className="size-8 shrink-0 rounded-full" disabled={!canAttach} onClick={onAttach} aria-label={t('contextPanel.browser.annotate.submit')} title={t('contextPanel.browser.annotate.submit')}>
          {submitting ? <Spinner className="size-4" /> : <Icon name="attachment-2" className="size-4" />}
        </Button>}
      </div>
    </div>
  );
}
