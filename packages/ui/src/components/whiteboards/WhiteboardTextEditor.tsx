import React from 'react';

import { domToRichText, parseRichText, richTextToDom, safeHref, serializeRichText, withTitleLine } from '@/lib/whiteboards/richText';
import { FORMAT_BAR_ATTRIBUTE, NO_FORMAT, type RichTextElement, type TextFormatState } from './textEditing';

/** The formatting commands the quick-edit bar sends to the editor. */
export type TextEditorHandle = {
  toggle: (command: 'bold' | 'italic' | 'insertUnorderedList') => void;
  /** Remembers the selection before focus leaves for the link field. */
  keepSelection: () => void;
  /** Links the remembered selection, or inserts the address as a link where the caret was. */
  link: (href: string) => boolean;
  /** Puts focus back in the editor, on the remembered selection. */
  focus: () => void;
};


// The browser's editing commands are the editor: they keep undo, selection and IME input working.
const run = (command: string, value?: string) => document.execCommand(command, false, value);

const formatAt = (root: HTMLElement): TextFormatState => {
  const selection = document.getSelection();
  const anchor = selection?.anchorNode ?? null;
  if (!anchor || !root.contains(anchor)) return NO_FORMAT;
  const element = anchor instanceof Element ? anchor : anchor.parentElement;
  return {
    bold: document.queryCommandState('bold'),
    italic: document.queryCommandState('italic'),
    bulleted: document.queryCommandState('insertUnorderedList'),
    link: Boolean(element?.closest('a[href]')),
  };
};

/**
 * Puts the caret after the last word. A caret between the editor's line
 * elements, where collapsing a select-all leaves it, has no line to stand on
 * and is not drawn, so people cannot see where they will type.
 */
const placeCaretAtEnd = (root: HTMLElement) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let last: Node | null = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) last = node;
  const range = document.createRange();
  if (last) {
    range.setStart(last, last.nodeValue?.length ?? 0);
  } else {
    // No words yet: the caret goes into the last (empty) line.
    let line: Node = root;
    while (line.lastChild && line.lastChild.nodeType === 1 && line.lastChild.nodeName !== 'BR') line = line.lastChild;
    range.setStart(line, 0);
  }
  range.collapse(true);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

/**
 * Edits the text of a block, note or text in place, formatted as it shows on
 * the board. The text is stored as Markdown (lib/whiteboards/richText.ts);
 * the editor turns it into nodes on open and back into Markdown on close.
 * Enter finishes, Shift+Enter starts a new line, Escape cancels, and focus
 * leaving for anything but the quick-edit bar finishes.
 */
export const WhiteboardTextEditor = React.forwardRef<TextEditorHandle, {
  element: RichTextElement;
  label: string;
  style: React.CSSProperties;
  onFormat: (state: TextFormatState) => void;
  onDone: (save: boolean, text: string) => void;
}>(function WhiteboardTextEditor({ element, label, style, onFormat, onDone }, ref) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const initialRef = React.useRef('');
  const doneRef = React.useRef(false);
  const savedRangeRef = React.useRef<Range | null>(null);
  // The element's text is read once, when editing starts; later board updates do not reset what is being typed.
  const [startText] = React.useState(element.text);
  const [startKind] = React.useState(element.kind);

  const report = React.useCallback(() => {
    if (rootRef.current) onFormat(formatAt(rootRef.current));
  }, [onFormat]);

  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const parsed = parseRichText(startText);
    // What the card showed is what is edited: a title line shown in bold opens in bold.
    root.replaceChildren(richTextToDom(document, startKind === 'text' ? parsed : withTitleLine(parsed)));
    initialRef.current = serializeRichText(domToRichText(root));
    root.focus({ preventScroll: true });
    run('styleWithCSS', 'false');
    placeCaretAtEnd(root);
  }, [startKind, startText]);

  React.useEffect(() => {
    document.addEventListener('selectionchange', report);
    return () => document.removeEventListener('selectionchange', report);
  }, [report]);

  const finish = (save: boolean) => {
    const root = rootRef.current;
    if (doneRef.current || !root) return;
    doneRef.current = true;
    const text = serializeRichText(domToRichText(root));
    // Opening and closing without a change saves nothing, even where the editor spelled out a title line.
    onDone(save && text !== initialRef.current, text);
  };

  const restoreSelection = () => {
    const root = rootRef.current;
    const range = savedRangeRef.current;
    if (!root) return;
    root.focus({ preventScroll: true });
    if (range && root.contains(range.commonAncestorContainer)) {
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  };

  React.useImperativeHandle(ref, () => ({
    toggle: (command) => {
      restoreSelection();
      run(command);
      report();
    },
    keepSelection: () => {
      const selection = document.getSelection();
      const range = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
      savedRangeRef.current = range && rootRef.current?.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
    },
    link: (href) => {
      if (!safeHref(href)) return false;
      restoreSelection();
      const selection = document.getSelection();
      if (selection && !selection.isCollapsed) {
        run('createLink', href);
      } else if (selection && selection.rangeCount > 0) {
        // No words selected: the address itself becomes the link.
        const link = document.createElement('a');
        link.setAttribute('href', href);
        link.textContent = href;
        const range = selection.getRangeAt(0);
        range.insertNode(link);
        range.setStartAfter(link);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
      savedRangeRef.current = null;
      report();
      return true;
    },
    focus: restoreSelection,
  }));

  return (
    <div
      ref={rootRef}
      data-board-chrome
      role="textbox"
      aria-multiline
      aria-label={label}
      contentEditable
      suppressContentEditableWarning
      className="absolute z-10 overflow-hidden whitespace-pre-wrap break-words bg-transparent outline-none [&_a]:underline [&_ol]:list-decimal [&_ol]:ps-[1.3em] [&_ul]:list-disc [&_ul]:ps-[1.1em]"
      style={style}
      onBlur={(event) => {
        // Focus going to the quick-edit bar (its link field) keeps the editor open.
        const next = event.relatedTarget instanceof Element ? event.relatedTarget : null;
        if (next?.closest(`[${FORMAT_BAR_ATTRIBUTE}]`)) return;
        finish(true);
      }}
      onKeyDown={(event) => {
        // Keys typed here are the text's, never the board's shortcuts.
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          finish(false);
        } else if (event.key === 'Enter' && !event.shiftKey) {
          event.preventDefault();
          finish(true);
        } else if (event.key === 'Enter') {
          // A new line, or a new item inside a list.
          event.preventDefault();
          run('insertParagraph');
        }
      }}
      onPaste={(event) => {
        // Only words come in: formatting from other pages is not the board's to keep.
        event.preventDefault();
        run('insertText', event.clipboardData.getData('text/plain'));
      }}
      onDrop={(event) => event.preventDefault()}
    />
  );
});
