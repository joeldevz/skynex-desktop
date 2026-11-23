import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import {
  domToRichText,
  hasMark,
  parseRichText,
  plainText,
  richTextToDom,
  safeHref,
  serializeRichText,
  toggleBullets,
  toggleMark,
  withTitleLine,
} from './richText';

// The editor helpers run on the page's document; happy-dom stands in for it here.
const browser = new Window();
const saved = Object.getOwnPropertyDescriptor(globalThis, 'document');
beforeAll(() => {
  Object.defineProperty(globalThis, 'document', { value: browser.document, configurable: true, writable: true });
});
afterAll(async () => {
  if (saved) Object.defineProperty(globalThis, 'document', saved);
  else Reflect.deleteProperty(globalThis, 'document');
  await browser.happyDOM.close();
});

describe('whiteboard rich text', () => {
  test('reads bold, italic, both, links and list lines, and writes them back unchanged', () => {
    const text = '**1. Rojo** y *algo*\n- uno con ***todo***\n1. uno\n2. dos [web](https://example.com)\nplano';
    const lines = parseRichText(text);
    expect(lines[0]).toMatchObject({ list: null, runs: [{ text: '1. Rojo', bold: true }, { text: ' y ' }, { text: 'algo', italic: true }] });
    expect(lines[1]).toMatchObject({ list: 'bullet', runs: [{ text: 'uno con ' }, { text: 'todo', bold: true, italic: true }] });
    expect(lines[3]).toMatchObject({ list: 'number', number: 2, runs: [{ text: 'dos ' }, { text: 'web', href: 'https://example.com' }] });
    expect(serializeRichText(lines)).toBe(text);
  });

  test('a numbered line on its own is a title, not a list', () => {
    const lines = parseRichText('1. Rojo\nEscribe un test que falla');
    expect(lines[0]).toMatchObject({ list: null, runs: [{ text: '1. Rojo' }] });
    expect(serializeRichText(withTitleLine(lines))).toBe('**1. Rojo**\nEscribe un test que falla');
  });

  test('a link to a script or data address shows as its label and never links', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('data:text/html,hi')).toBeNull();
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(parseRichText('[clic](javascript:alert(1))')[0]?.runs.every((run) => run.href === null)).toBe(true);
  });

  test('asterisks with spaces around them are arithmetic, not italics', () => {
    expect(parseRichText('2 * 3 * 4')[0]?.runs).toEqual([{ text: '2 * 3 * 4', bold: false, italic: false, href: null }]);
  });

  test('plain text drops the formatting and shows list markers', () => {
    expect(plainText('**Hola** *mundo*\n- a\n3. b\n4. c')).toBe('Hola mundo\n• a\n3. b\n4. c');
  });

  test('a card of several lines with nothing bold reads its first line as the title', () => {
    expect(withTitleLine(parseRichText('Rojo\nEscribe un test'))[0]?.runs[0]?.bold).toBe(true);
    expect(withTitleLine(parseRichText('Rojo\n**ya** tiene'))[0]?.runs[0]?.bold).toBe(false);
    expect(withTitleLine(parseRichText('una sola'))[0]?.runs[0]?.bold).toBe(false);
  });

  test('bold, italic and bullets toggle on the whole text', () => {
    expect(toggleMark('Hola mundo\nadiós', 'bold')).toBe('**Hola mundo**\n**adiós**');
    expect(toggleMark('**Hola mundo**\n**adiós**', 'bold')).toBe('Hola mundo\nadiós');
    expect(toggleMark('Hola **mundo**', 'bold')).toBe('**Hola mundo**');
    expect(hasMark('*a* *b*', 'italic')).toBe(true);
    expect(toggleBullets('uno\n\ndos')).toBe('- uno\n\n- dos');
    expect(toggleBullets('- uno\n- dos')).toBe('uno\ndos');
  });

  test('the editor DOM round-trips the text, including what the browser writes when editing', () => {
    const text = '**Título**\nCuerpo con *énfasis* y [enlace](https://example.com)\n\n- uno\n- dos\n1. primero\n2. segundo';
    const root = document.createElement('div');
    root.append(richTextToDom(document, parseRichText(text)));
    expect(serializeRichText(domToRichText(root))).toBe(text);

    // What contenteditable makes: a first bare line, divs, a line break, a placeholder br, a styled span.
    const edited = document.createElement('div');
    edited.innerHTML = 'Hola <strong>fuerte</strong><div>dos<br>tres</div><div><br></div><div><span style="font-weight: 700">peso</span> <em>it</em> <a href="javascript:alert(1)">mal</a></div>';
    expect(serializeRichText(domToRichText(edited))).toBe('Hola **fuerte**\ndos\ntres\n\n**peso** *it* mal');
  });
});
