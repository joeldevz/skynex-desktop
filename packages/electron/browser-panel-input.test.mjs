import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCdpKeyEvents, buildInputEventSequence, parseKeyChord, validateCaptureClip, validateViewportPoint } from './browser-panel-input.mjs';

test('parses supported keys and modifier chords', () => {
  assert.deepEqual(parseKeyChord('Escape'), { key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, text: '', modifiers: 0, modifierNames: [], accelerator: 'Escape' });
  assert.equal(parseKeyChord('Shift+Tab').modifiers, 8);
  assert.equal(parseKeyChord('ArrowDown').accelerator, 'Down');
  assert.equal(parseKeyChord('F12').windowsVirtualKeyCode, 123);
  assert.equal(parseKeyChord('Enter').text, '\r');
  assert.equal(parseKeyChord('Space').text, ' ');
});

test('describes printable characters as a US keyboard types them', () => {
  assert.deepEqual(
    [parseKeyChord('a'), parseKeyChord('A'), parseKeyChord('7'), parseKeyChord('!'), parseKeyChord('/'), parseKeyChord('?')]
      .map(({ key, code, windowsVirtualKeyCode, text, modifiers }) => [key, code, windowsVirtualKeyCode, text, modifiers]),
    [['a', 'KeyA', 65, 'a', 0], ['A', 'KeyA', 65, 'A', 8], ['7', 'Digit7', 55, '7', 0], ['!', 'Digit1', 49, '!', 8], ['/', 'Slash', 191, '/', 0], ['?', 'Slash', 191, '?', 8]],
  );
  assert.deepEqual(parseKeyChord('+'), { key: '+', code: 'Equal', windowsVirtualKeyCode: 187, text: '+', modifiers: 8, modifierNames: ['shift'], accelerator: 'Plus' });
  assert.equal(parseKeyChord('Control++').modifiers, 2 | 8);
});

test('a shortcut types nothing', () => {
  assert.equal(parseKeyChord('Control+a').text, '');
  assert.equal(parseKeyChord('Meta+Enter').text, '');
  assert.equal(parseKeyChord('Shift+a').text, 'a');
});

test('rejects malformed and overlong key chords', () => {
  for (const key of ['', 'MadeUp', 'Control+Control+a', 'Shift++Tab', 'Control+not-a-key', 'x'.repeat(33), 'é', 'Control+']) {
    assert.throws(() => parseKeyChord(key), Error, key);
  }
});

test('builds CDP and Electron input event sequences', () => {
  const shortcut = parseKeyChord('Control+a');
  assert.deepEqual(buildCdpKeyEvents(shortcut), [
    { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 },
    { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 },
  ]);
  assert.deepEqual(buildInputEventSequence(shortcut), [
    { type: 'keyDown', keyCode: 'a', modifiers: ['control'] },
    { type: 'keyUp', keyCode: 'a', modifiers: ['control'] },
  ]);
  const typed = parseKeyChord('x');
  assert.deepEqual(buildCdpKeyEvents(typed)[0], { type: 'keyDown', key: 'x', code: 'KeyX', windowsVirtualKeyCode: 88, modifiers: 0, text: 'x', unmodifiedText: 'x' });
  assert.deepEqual(buildInputEventSequence(typed).map((event) => event.type), ['keyDown', 'char', 'keyUp']);
});

test('validates bounded viewport points and clips', () => {
  assert.deepEqual(validateViewportPoint(4, 7), { x: 4, y: 7 });
  assert.throws(() => validateViewportPoint(-1, 0));
  assert.deepEqual(validateCaptureClip({ x: 0, y: 0, width: 100, height: 200 }), { x: 0, y: 0, width: 100, height: 200 });
  for (const clip of [{ x: -1, y: 0, width: 10, height: 10 }, { x: 0, y: 0, width: 0, height: 2 }, { x: 0, y: 0, width: 6000, height: 6000 }, { x: NaN, y: 0, width: 1, height: 1 }]) {
    assert.throws(() => validateCaptureClip(clip));
  }
});
