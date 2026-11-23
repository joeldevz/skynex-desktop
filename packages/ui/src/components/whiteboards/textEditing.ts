import type { BoxElement } from '@/lib/whiteboards/model';

/** The kinds whose text carries formatting. */
export type RichTextElement = Extract<BoxElement, { kind: 'block' | 'note' | 'text' }>;

export const isRichTextElement = (element: { kind: string } | undefined): element is RichTextElement => (
  element?.kind === 'block' || element?.kind === 'note' || element?.kind === 'text'
);

/** What the formatting buttons show as on while the caret or selection sits in the editor. */
export type TextFormatState = { bold: boolean; italic: boolean; bulleted: boolean; link: boolean };

export const NO_FORMAT: TextFormatState = { bold: false, italic: false, bulleted: false, link: false };

/** Marks the quick-edit bar: focus moving there keeps the editor open. */
export const FORMAT_BAR_ATTRIBUTE = 'data-wb-format-bar';
