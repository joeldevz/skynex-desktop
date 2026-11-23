/**
 * The text of a block, note or text element: a small Markdown subset, the
 * same one Claude's whiteboards store, so the agent writes it as plain text
 * and people edit it as formatted text (docs/specs/workspace-whiteboards/contract.md).
 *
 * - `**bold**`, `*italic*`, `***bold italic***`
 * - `[label](https://…)` links; only http, https and mailto addresses link
 * - lines starting with `- ` (bulleted) or `1. ` (numbered)
 */

export type RichRun = { text: string; bold: boolean; italic: boolean; href: string | null };
type RichList = 'bullet' | 'number';
type RichLine = { list: RichList | null; number: number; runs: RichRun[] };
type Marks = Pick<RichRun, 'bold' | 'italic' | 'href'>;

const PLAIN: Marks = { bold: false, italic: false, href: null };

// Markers only count when they hug the words: "2 * 3 * 4" stays arithmetic.
const INLINE = /\*\*\*([^*\s](?:[^*]*[^*\s])?)\*\*\*|\*\*([^*\s](?:[^*]*[^*\s])?)\*\*|\*([^*\s](?:[^*]*[^*\s])?)\*|\[([^\][]+)\]\(([^()\s]+)\)/g;
const BULLET = /^[-*] (.*)$/;
const NUMBERED = /^(\d{1,3})\. (.*)$/;
const LINK_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/** The address a link may open, or null: only http, https and mailto, never script or data URLs. */
export const safeHref = (raw: string): string | null => {
  try {
    return LINK_PROTOCOLS.has(new URL(raw).protocol) ? raw : null;
  } catch {
    return null;
  }
};

const parseInline = (source: string): RichRun[] => {
  const runs: RichRun[] = [];
  let at = 0;
  for (const match of source.matchAll(INLINE)) {
    const index = match.index ?? 0;
    if (index > at) runs.push({ text: source.slice(at, index), ...PLAIN });
    const [, both, bold, italic, label, href] = match;
    if (both !== undefined) runs.push({ text: both, bold: true, italic: true, href: null });
    else if (bold !== undefined) runs.push({ text: bold, bold: true, italic: false, href: null });
    else if (italic !== undefined) runs.push({ text: italic, bold: false, italic: true, href: null });
    // A link to an address that may not open shows as its label.
    else runs.push({ text: label ?? '', bold: false, italic: false, href: safeHref(href ?? '') });
    at = index + match[0].length;
  }
  if (at < source.length) runs.push({ text: source.slice(at), ...PLAIN });
  return runs;
};

/**
 * The lines of a stored text, with their list markers and formatted runs.
 * A numbered line on its own is not a list: "1. Rojo" over a description is
 * a card's title, the way diagrams number their steps.
 */
export const parseRichText = (text: string): RichLine[] => {
  const raw = text.split('\n');
  const numbered = raw.map((line) => NUMBERED.exec(line));
  return raw.map((line, index) => {
    const bullet = BULLET.exec(line);
    if (bullet) return { list: 'bullet', number: 0, runs: parseInline(bullet[1] ?? '') };
    const number = numbered[index];
    if (number && (numbered[index - 1] || numbered[index + 1])) return { list: 'number', number: Number(number[1]), runs: parseInline(number[2] ?? '') };
    return { list: null, number: 0, runs: parseInline(line) };
  });
};

const sameMarks = (a: RichRun, b: RichRun): boolean => a.bold === b.bold && a.italic === b.italic && a.href === b.href;

const serializeRun = (run: RichRun): string => {
  if (run.href) return `[${run.text}](${run.href})`;
  const marker = run.bold && run.italic ? '***' : run.bold ? '**' : run.italic ? '*' : '';
  if (!marker || !run.text.trim()) return run.text;
  // Markers hug the words; spaces at either end stay outside them.
  const [, lead = '', words = '', trail = ''] = /^(\s*)(.*?)(\s*)$/s.exec(run.text) ?? [];
  return `${lead}${marker}${words}${marker}${trail}`;
};

/** Lines back to the stored text: the inverse of `parseRichText`. */
export const serializeRichText = (lines: readonly RichLine[]): string => lines.map((line) => {
  const merged: RichRun[] = [];
  for (const run of line.runs) {
    if (!run.text) continue;
    const last = merged[merged.length - 1];
    if (last && sameMarks(last, run)) merged[merged.length - 1] = { ...last, text: last.text + run.text };
    else merged.push(run);
  }
  const prefix = line.list === 'bullet' ? '- ' : line.list === 'number' ? `${line.number || 1}. ` : '';
  return prefix + merged.map(serializeRun).join('');
}).join('\n');

/** The text without its formatting, as a thumbnail or a plain label shows it. */
export const plainText = (text: string): string => parseRichText(text).map((line) => {
  const prefix = line.list === 'bullet' ? '• ' : line.list === 'number' ? `${line.number}. ` : '';
  return prefix + line.runs.map((run) => run.text).join('');
}).join('\n');

/**
 * Lines as a card shows them: when nothing in a text of several lines is
 * bold, its first line reads as the title, in bold, the way people write
 * diagram cards ("1. Rojo" over "Escribe un test que falla").
 */
export const withTitleLine = (lines: readonly RichLine[]): RichLine[] => {
  const written = lines.filter((line) => line.runs.some((run) => run.text.trim()));
  if (written.length < 2 || lines.some((line) => line.runs.some((run) => run.bold))) return [...lines];
  const first = lines.findIndex((line) => line.runs.some((run) => run.text.trim()));
  return lines.map((line, index) => (index === first ? { ...line, runs: line.runs.map((run) => ({ ...run, bold: true })) } : line));
};

const written = (lines: readonly RichLine[]): RichRun[] => lines.flatMap((line) => line.runs.filter((run) => run.text.trim()));

/** Whether every word of the text carries the mark. */
export const hasMark = (text: string, mark: 'bold' | 'italic'): boolean => {
  const runs = written(parseRichText(text));
  return runs.length > 0 && runs.every((run) => run[mark]);
};

/** Bold or italic on the whole text, or off when all of it already has it. */
export const toggleMark = (text: string, mark: 'bold' | 'italic'): string => {
  const on = !hasMark(text, mark);
  return serializeRichText(parseRichText(text).map((line) => ({ ...line, runs: line.runs.map((run) => ({ ...run, [mark]: on })) })));
};

/** Whether every written line is a bulleted list item. */
export const isBulleted = (text: string): boolean => {
  const lines = parseRichText(text).filter((line) => line.runs.some((run) => run.text.trim()));
  return lines.length > 0 && lines.every((line) => line.list === 'bullet');
};

/** Every written line a bullet, or none when all already are. */
export const toggleBullets = (text: string): string => {
  const on = !isBulleted(text);
  return serializeRichText(parseRichText(text).map((line) => (
    line.runs.some((run) => run.text.trim()) ? { ...line, list: on ? 'bullet' : null } : line
  )));
};

const isElement = (node: Node): node is Element => node.nodeType === 1;

const appendRuns = (doc: Document, parent: ParentNode, runs: readonly RichRun[]) => {
  for (const run of runs) {
    let node: Node = doc.createTextNode(run.text);
    if (run.italic) {
      const italic = doc.createElement('i');
      italic.append(node);
      node = italic;
    }
    if (run.bold) {
      const bold = doc.createElement('b');
      bold.append(node);
      node = bold;
    }
    if (run.href) {
      const link = doc.createElement('a');
      link.setAttribute('href', run.href);
      link.append(node);
      node = link;
    }
    parent.append(node);
  }
};

/**
 * The text as editable DOM: a line per `div`, list lines as `li` in their
 * `ul` or `ol`. Built from nodes, never from markup, so stored text cannot
 * inject anything into the editor.
 */
export const richTextToDom = (doc: Document, lines: readonly RichLine[]): DocumentFragment => {
  const fragment = doc.createDocumentFragment();
  let list: Element | null = null;
  for (const line of lines) {
    const content = line.runs.some((run) => run.text) ? null : doc.createElement('br');
    if (line.list) {
      const tag = line.list === 'bullet' ? 'ul' : 'ol';
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = doc.createElement(tag);
        if (line.list === 'number' && line.number > 1) list.setAttribute('start', String(line.number));
        fragment.append(list);
      }
      const item = doc.createElement('li');
      appendRuns(doc, item, line.runs);
      if (content) item.append(content);
      list.append(item);
      continue;
    }
    list = null;
    const div = doc.createElement('div');
    appendRuns(doc, div, line.runs);
    if (content) div.append(content);
    fragment.append(div);
  }
  return fragment;
};

const BLOCK_TAGS = /^(DIV|P|LI|H[1-6]|BLOCKQUOTE|PRE|SECTION|ARTICLE)$/;

const markedBy = (element: Element, marks: Marks): Marks => {
  const tag = element.tagName.toUpperCase();
  const style = element.getAttribute('style') ?? '';
  const weight = /font-weight:\s*(\d+|bold)/i.exec(style)?.[1];
  const bold = marks.bold || tag === 'B' || tag === 'STRONG' || weight === 'bold' || Number(weight) >= 600;
  const italic = marks.italic || tag === 'I' || tag === 'EM' || /font-style:\s*italic/i.test(style);
  const href = tag === 'A' ? safeHref(element.getAttribute('href') ?? '') ?? marks.href : marks.href;
  return { bold, italic, href };
};

/**
 * What an editor holds, back to lines: each block element or line break
 * starts a line, list items keep their list, and bold, italic and links
 * written by the browser's editing commands become marks.
 */
export const domToRichText = (root: Element): RichLine[] => {
  const lines: RichLine[] = [];
  let line: RichLine | null = null;
  const open = (list: { kind: RichList; number: number } | null): RichLine => {
    if (!line) {
      line = { list: list?.kind ?? null, number: list?.number ?? 0, runs: [] };
      lines.push(line);
    }
    return line;
  };
  const close = () => {
    line = null;
  };
  const visit = (node: Node, marks: Marks, list: { kind: RichList; number: number } | null) => {
    if (node.nodeType === 3) {
      const text = (node.nodeValue ?? '').replace(/\u00a0/g, ' ').replace(/[\r\n]/g, '');
      if (text) open(list).runs.push({ text, ...marks });
      return;
    }
    if (!isElement(node)) return;
    const tag = node.tagName.toUpperCase();
    if (tag === 'BR') {
      open(list);
      close();
      return;
    }
    if (tag === 'UL' || tag === 'OL') {
      close();
      let number = Number(node.getAttribute('start')) || 1;
      for (const child of [...node.childNodes]) {
        if (isElement(child) && child.tagName.toUpperCase() === 'LI') {
          close();
          const kind: RichList = tag === 'UL' ? 'bullet' : 'number';
          const item = { kind, number };
          open(item);
          for (const inner of [...child.childNodes]) visit(inner, marks, item);
          close();
          number += 1;
        } else {
          visit(child, marks, list);
        }
      }
      close();
      return;
    }
    const block = BLOCK_TAGS.test(tag);
    if (block) close();
    const inner = markedBy(node, marks);
    for (const child of [...node.childNodes]) visit(child, inner, list);
    if (block) close();
  };
  for (const child of [...root.childNodes]) visit(child, PLAIN, null);
  return lines;
};
