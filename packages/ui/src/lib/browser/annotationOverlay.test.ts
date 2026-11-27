import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { describe, expect, test } from 'bun:test';

import {
  ANNOTATION_ANCHOR_SCRIPT,
  ANNOTATION_ATTACH_SCRIPT,
  ANNOTATION_TEARDOWN_SCRIPT,
  buildAnnotationOverlayScript,
  type BrowserAnnotationOverlayLabels,
  type BrowserAnnotationOverlayTheme,
} from './annotationOverlay';
import { annotationAnchorSchema, positionAnnotationBubble } from './annotationAnchor';

const theme: BrowserAnnotationOverlayTheme = {
  colorScheme: 'dark',
  primary: 'rgb(214, 93, 42)',
  primarySoft: 'rgba(214, 93, 42, 0.16)',
  primaryFaint: 'rgba(214, 93, 42, 0.1)',
  primaryContrast: 'rgb(255, 255, 255)',
  surface: 'rgb(10, 10, 10)',
  surfaceElevated: 'rgb(20, 20, 20)',
  glassSurface: 'rgba(20, 20, 20, 0.64)',
  glassFilter: 'blur(26px) saturate(1.16)',
  border: 'rgb(40, 40, 40)',
  text: 'rgb(240, 240, 240)',
  mutedText: 'rgb(160, 160, 160)',
};

const labels: BrowserAnnotationOverlayLabels = {
  select: 'Element',
  marquee: 'Region',
  draw: 'Draw',
  commentPlaceholder: 'Describe the change...',
  submit: 'Attach',
};

/**
 * The overlay ships as source text evaluated inside another page, so ordinary
 * type-checking never sees it. These are the failures that produced: a stray
 * backtick silently truncated the whole script, and a value interpolated
 * without escaping would end it early or run as code.
 */
const parses = (source: string): boolean => {
  try {
    new Function(source);
    return true;
  } catch {
    return false;
  }
};

describe('annotation overlay script', () => {
  const script = buildAnnotationOverlayScript(theme, labels);

  test('reports the desktop selection geometry through scroll, deselection and teardown', async () => {
    const win = new Window({ url: 'http://annotation.test' });
    const evaluate = (code: string) => new Function('window', 'document', 'requestAnimationFrame', 'Event', 'CustomEvent', `return ${code}`)(
      win, win.document, (callback: FrameRequestCallback) => callback(0), win.Event, win.CustomEvent,
    );
    try {
      const button = win.document.createElement('button');
      win.document.body.appendChild(button);
      let y = 200;
      button.getBoundingClientRect = () => new win.DOMRect(80, y, 120, 40);
      win.document.elementFromPoint = () => button;
      const completion = evaluate(buildAnnotationOverlayScript(theme, labels, true));
      const select = () => button.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, button: 0 }));

      expect(evaluate(ANNOTATION_ANCHOR_SCRIPT)).toBeNull();
      select();
      expect(evaluate(ANNOTATION_ANCHOR_SCRIPT)).toEqual([80, 200, 120, 40, win.innerWidth, win.innerHeight]);
      y = 100;
      win.dispatchEvent(new win.Event('scroll'));
      expect(evaluate(ANNOTATION_ANCHOR_SCRIPT)).toEqual([80, 100, 120, 40, win.innerWidth, win.innerHeight]);
      select();
      expect(evaluate(ANNOTATION_ANCHOR_SCRIPT)).toBeNull();
      select();
      evaluate(ANNOTATION_TEARDOWN_SCRIPT);
      expect(await completion).toBeNull();
      expect(evaluate(ANNOTATION_ANCHOR_SCRIPT)).toBeNull();
    } finally {
      await win.happyDOM.close();
    }
  });

  test('centers the bubble below the mark and flips and clamps it near viewport edges', () => {
    expect(positionAnnotationBubble([300, 80, 100, 40, 800, 600], 46)).toEqual({ left: 140, top: 130 });
    expect(positionAnnotationBubble([745, 550, 40, 20, 800, 600], 46)).toEqual({ left: 372, top: 494 });
    expect(positionAnnotationBubble([-80, 10, 40, 20, 270, 300], 46)).toEqual({ left: 8, top: 40 });
    expect(positionAnnotationBubble([40, 400, 40, 20, 270, 300], 46)).toEqual({ left: 8, top: 246 });
  });

  test('accepts only finite, bounded selection geometry and a positive viewport', () => {
    expect(annotationAnchorSchema.safeParse([-10, 40, 100, 20, 800, 600]).success).toBe(true);
    expect(annotationAnchorSchema.safeParse([0, NaN, 100, 20, 800, 600]).success).toBe(false);
    expect(annotationAnchorSchema.safeParse([0, 0, 100, 20, 0, 600]).success).toBe(false);
    expect(annotationAnchorSchema.safeParse([0, 0, 100, 20, 800, 600, 'text']).success).toBe(false);
  });

  test('a host editor keeps annotation open when asked to attach without a target', async () => {
    const win = new Window({ url: 'http://annotation.test' });
    const evaluate = (code: string) => new Function('window', 'document', 'requestAnimationFrame', 'Event', `return ${code}`)(
      win, win.document, (callback: FrameRequestCallback) => callback(0), win.Event,
    );
    try {
      const completion = evaluate(buildAnnotationOverlayScript(theme, labels, true));
      expect(evaluate(ANNOTATION_ATTACH_SCRIPT)).toBe(false);
      expect(win.document.querySelector('[data-openchamber-annotation]')).not.toBeNull();
      evaluate(ANNOTATION_TEARDOWN_SCRIPT);
      expect(await completion).toBeNull();
      expect(win.document.querySelector('[data-openchamber-annotation]')).toBeNull();
    } finally {
      await win.happyDOM.close();
    }
  });

  test('parses as JavaScript', () => {
    expect(parses(`return ${script}`)).toBe(true);
  });

  test('contains no backtick, which would terminate the template it lives in', () => {
    expect(script).not.toContain('`');
  });

  test('carries the theme and labels through as data, not as concatenated code', () => {
    expect(script).toContain(JSON.stringify(theme.primarySoft));
    expect(script).toContain(JSON.stringify(labels.commentPlaceholder));
  });

  test('keeps comment keystrokes away from shortcuts on the annotated page', () => {
    expect(script).toContain("comment.addEventListener('keydown', onCommentKeyDown)");
    expect(script).toContain('var onCommentKeyDown = function (event) {');
    expect(script).toContain('event.stopPropagation();');
  });

  test('does not attach a comment while IME composition is active', () => {
    const handlerStart = script.indexOf('var onCommentKeyDown = function (event) {');
    const handlerEnd = script.indexOf('};', handlerStart);
    expect(handlerStart).toBeGreaterThan(-1);
    expect(handlerEnd).toBeGreaterThan(handlerStart);

    const handler = script.slice(handlerStart, handlerEnd);
    const imeGuard = handler.indexOf('event.isComposing || event.keyCode === 229');
    const attachCall = handler.indexOf('attach();');
    expect(imeGuard).toBeGreaterThan(-1);
    expect(attachCall).toBeGreaterThan(imeGuard);
  });

  test('preserves the overlay for composition Escape and cancels on ordinary Escape', async () => {
    const win = new Window({ url: 'http://annotation.test' });
    const run = new Function('window', 'document', 'requestAnimationFrame', `return ${script}`);
    try {
      const completion = run(win, win.document, (callback: FrameRequestCallback) => callback(0));
      const hostCount = win.document.body.children.length;
      expect(hostCount).toBeGreaterThan(0);
      for (const options of [{ isComposing: true }, { keyCode: 229 }]) {
        const event = new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true, ...options });
        win.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(false);
        expect(win.document.body.children.length).toBe(hostCount);
      }
      const escape = new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      win.dispatchEvent(escape);
      expect(escape.defaultPrevented).toBe(true);
      expect(await completion).toBeNull();
      expect(win.document.body.children.length).toBe(0);
    } finally {
      await win.happyDOM.close();
    }
  });

  /**
   * happy-dom has no top layer, no `:modal` and no popovers, so these cover
   * what it can: the host is a popover, clicks on the chrome stay out of the
   * page's handlers, and an overlay someone removed is not brought back.
   * Staying above a real modal dialog was verified in Chrome.
   */
  test('keeps clicks on its chrome away from the page it sits in', async () => {
    const win = new Window({ url: 'http://annotation.test' });
    const run = new Function('window', 'document', 'requestAnimationFrame', `return ${script}`);
    try {
      const completion = run(win, win.document, (callback: FrameRequestCallback) => callback(0));
      const host = win.document.querySelector('[data-openchamber-annotation]');
      expect(host?.getAttribute('popover')).toBe('manual');

      let reachedPage = 0;
      win.document.body.addEventListener('click', () => { reachedPage += 1; });
      win.document.body.addEventListener('pointerdown', () => { reachedPage += 1; });
      host?.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));
      host?.dispatchEvent(new win.PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
      expect(reachedPage).toBe(0);

      win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      expect(await completion).toBeNull();
    } finally {
      await win.happyDOM.close();
    }
  });

  test('ends the session when the app cancels it, giving the page its clicks back', async () => {
    const win = new Window({ url: 'http://annotation.test' });
    const run = new Function('window', 'document', 'requestAnimationFrame', `return ${script}`);
    const teardown = new Function('window', 'document', ANNOTATION_TEARDOWN_SCRIPT);
    try {
      const completion = run(win, win.document, (callback: FrameRequestCallback) => callback(0));
      const button = win.document.createElement('button');
      win.document.body.appendChild(button);
      let pageClicks = 0;
      button.addEventListener('click', () => { pageClicks += 1; });

      button.click();
      expect(pageClicks).toBe(0);

      teardown(win, win.document);
      expect(await completion).toBeNull();

      // A page popover or dialog opening later must not bring the chrome back.
      const toggle = new win.Event('toggle');
      Object.defineProperty(toggle, 'newState', { value: 'open' });
      button.dispatchEvent(toggle);
      expect(win.document.querySelector('[data-openchamber-annotation]')).toBeNull();

      button.click();
      expect(pageClicks).toBe(1);
    } finally {
      await win.happyDOM.close();
    }
  });

  test('guards app-side annotation Escape before cancelling the session', () => {
    const source = readFileSync(new URL('../../components/browser/BrowserPane.tsx', import.meta.url), 'utf8');
    const start = source.indexOf('const handler = (event: KeyboardEvent)');
    const end = source.indexOf("window.addEventListener('keydown', handler, true)", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const handler = source.slice(start, end);
    const guard = handler.indexOf("if (isIMECompositionEvent(event) || event.key !== 'Escape') return;");
    expect(guard).toBeGreaterThan(-1);
    expect(handler.indexOf('cancelAnnotation()')).toBeGreaterThan(guard);
  });

  test('escapes a label that would otherwise close the script', () => {
    const hostile = buildAnnotationOverlayScript(theme, {
      ...labels,
      submit: '"); alert(1); ("',
    });
    expect(parses(`return ${hostile}`)).toBe(true);
    expect(hostile).not.toContain('alert(1); ("');
  });

  test('the teardown script parses on its own', () => {
    expect(parses(ANNOTATION_TEARDOWN_SCRIPT)).toBe(true);
  });
});
