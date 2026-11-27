import React from 'react';

import { useDictation } from '@/hooks/useDictation';
import { annotationAnchorSchema, annotationBubbleWidth, positionAnnotationBubble, type AnnotationAnchor } from '@/lib/browser/annotationAnchor';
import { ANNOTATION_ANCHOR_SCRIPT } from '@/lib/browser/annotationOverlay';
import type { AnnotationHost } from '@/lib/browser/annotationSession';
import { isDictationCaptureSupported } from '@/lib/dictation/use-dictation-audio-source';
import { useConfigStore } from '@/stores/useConfigStore';
import { BrowserAnnotationComposer } from './BrowserAnnotationComposer';

export function BrowserAnnotationEditor({ host, webview, onAttach }: {
  host: AnnotationHost;
  webview: HTMLElement;
  onAttach: (comment: string) => Promise<boolean>;
}) {
  const [anchor, setAnchor] = React.useState<AnnotationAnchor | null>(null);
  const bubbleRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [comment, setComment] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const dictationEnabled = useConfigStore((state) => state.dictationEnabled);
  const dictation = useDictation({
    onTranscript: (text) => setComment((current) => [current, text].filter(Boolean).join('\n')),
  });
  const { status, cancelDictation, discardFailedDictation } = dictation;
  const hasAnchor = anchor !== null;

  React.useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const readAnchor = async () => {
      const raw = await host.executeJavaScript(ANNOTATION_ANCHOR_SCRIPT, false).catch(() => null);
      if (stopped) return;
      const parsed = annotationAnchorSchema.safeParse(raw);
      const next = parsed.success ? parsed.data : null;
      setAnchor((previous) => next && previous && next.every((value, index) => value === previous[index]) ? previous : next);
      timer = setTimeout(() => void readAnchor(), 100);
    };
    void readAnchor();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [host, webview]);

  React.useLayoutEffect(() => {
    const bubble = bubbleRef.current;
    const stage = bubble?.parentElement;
    if (!bubble || !stage || !anchor) return;
    const place = () => {
      const view = webview.getBoundingClientRect();
      const origin = stage.getBoundingClientRect();
      const scaleX = view.width / anchor[4];
      const scaleY = view.height / anchor[5];
      bubble.style.width = `${annotationBubbleWidth(view.width)}px`;
      const { left, top } = positionAnnotationBubble([
        anchor[0] * scaleX, anchor[1] * scaleY, anchor[2] * scaleX, anchor[3] * scaleY, view.width, view.height,
      ], bubble.offsetHeight);
      bubble.style.left = `${view.left - origin.left + left}px`;
      bubble.style.top = `${view.top - origin.top + top}px`;
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(bubble);
    observer.observe(stage);
    observer.observe(webview);
    return () => observer.disconnect();
  }, [anchor, webview]);

  React.useLayoutEffect(() => {
    if (hasAnchor && document.activeElement === webview) {
      const textarea = textareaRef.current;
      textarea?.focus({ preventScroll: true });
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }, [hasAnchor, webview]);

  React.useEffect(() => {
    if ((dictationEnabled && hasAnchor) || status === 'idle') return;
    if (status === 'failed') discardFailedDictation();
    else void cancelDictation();
  }, [dictationEnabled, hasAnchor, status, cancelDictation, discardFailedDictation]);

  return <div ref={bubbleRef} hidden={!hasAnchor} className="absolute z-10">
    <BrowserAnnotationComposer
      textareaRef={textareaRef}
      comment={comment}
      onCommentChange={setComment}
      submitting={submitting}
      onAttach={() => {
        if (!hasAnchor || submitting || dictation.status !== 'idle') return;
        setSubmitting(true);
        void onAttach(comment).then((accepted) => { if (!accepted) setSubmitting(false); });
      }}
      voice={dictationEnabled && isDictationCaptureSupported() ? {
        status: dictation.status,
        error: dictation.error,
        subscribeLevel: dictation.subscribeLevel,
        onStart: () => { void dictation.startDictation(); },
        onTranscribe: () => { void dictation.confirmDictation(); },
        onCancel: () => {
          if (dictation.status === 'failed') dictation.discardFailedDictation();
          else void dictation.cancelDictation();
        },
        onRetry: () => { void dictation.retryFailedDictation(); },
      } : undefined}
    />
  </div>;
}
