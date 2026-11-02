/**
 * Turns the agent's key chords and pointer moves into input events for a
 * browser panel page. Keys are described as a US-layout keyboard produces
 * them, so a page sees the same `key`, `code` and key code as from a person.
 */

// key, code, Windows virtual key code, and the text the key types (if any).
const NAMED_KEYS = new Map([
  ['Enter', ['Enter', 'Enter', 13, '\r']], ['Escape', ['Escape', 'Escape', 27, '']],
  ['Tab', ['Tab', 'Tab', 9, '']], ['Backspace', ['Backspace', 'Backspace', 8, '']],
  ['Delete', ['Delete', 'Delete', 46, '']], ['Space', [' ', 'Space', 32, ' ']],
  ['ArrowUp', ['ArrowUp', 'ArrowUp', 38, '']], ['ArrowDown', ['ArrowDown', 'ArrowDown', 40, '']],
  ['ArrowLeft', ['ArrowLeft', 'ArrowLeft', 37, '']], ['ArrowRight', ['ArrowRight', 'ArrowRight', 39, '']],
  ['Home', ['Home', 'Home', 36, '']], ['End', ['End', 'End', 35, '']],
  ['PageUp', ['PageUp', 'PageUp', 33, '']], ['PageDown', ['PageDown', 'PageDown', 34, '']],
  ...Array.from({ length: 12 }, (_, index) => [`F${index + 1}`, [`F${index + 1}`, `F${index + 1}`, 112 + index, '']]),
]);

// Electron's `sendInputEvent` names keys the way accelerators do.
const ACCELERATOR_NAMES = new Map([
  ['Enter', 'Enter'], ['Escape', 'Escape'], ['Tab', 'Tab'], ['Backspace', 'Backspace'], ['Delete', 'Delete'],
  [' ', 'Space'], ['ArrowUp', 'Up'], ['ArrowDown', 'Down'], ['ArrowLeft', 'Left'], ['ArrowRight', 'Right'],
  ['Home', 'Home'], ['End', 'End'], ['PageUp', 'PageUp'], ['PageDown', 'PageDown'], ['+', 'Plus'],
]);

// Punctuation keys of a US keyboard: [unshifted, shifted, code, Windows virtual key code].
const PUNCTUATION_KEYS = [
  ['-', '_', 'Minus', 189], ['=', '+', 'Equal', 187], ['[', '{', 'BracketLeft', 219], [']', '}', 'BracketRight', 221],
  ['\\', '|', 'Backslash', 220], [';', ':', 'Semicolon', 186], ["'", '"', 'Quote', 222], [',', '<', 'Comma', 188],
  ['.', '>', 'Period', 190], ['/', '?', 'Slash', 191], ['`', '~', 'Backquote', 192],
];
const SHIFTED_DIGITS = ')!@#$%^&*(';

/** code, virtual key code and whether Shift produces it, for one printable ASCII character. */
const describeCharacter = (character) => {
  if (/^[a-z]$/.test(character)) return { code: `Key${character.toUpperCase()}`, keyCode: character.toUpperCase().charCodeAt(0), shifted: false };
  if (/^[A-Z]$/.test(character)) return { code: `Key${character}`, keyCode: character.charCodeAt(0), shifted: true };
  if (/^[0-9]$/.test(character)) return { code: `Digit${character}`, keyCode: character.charCodeAt(0), shifted: false };
  const digit = SHIFTED_DIGITS.indexOf(character);
  if (digit !== -1) return { code: `Digit${digit}`, keyCode: 48 + digit, shifted: true };
  for (const [plain, shifted, code, keyCode] of PUNCTUATION_KEYS) {
    if (character === plain) return { code, keyCode, shifted: false };
    if (character === shifted) return { code, keyCode, shifted: true };
  }
  return null;
};

const MODIFIER_BITS = new Map([['Alt', 1], ['Control', 2], ['Meta', 4], ['Shift', 8]]);
const MODIFIER_NAMES = new Map([['Alt', 'alt'], ['Control', 'control'], ['Meta', 'meta'], ['Shift', 'shift']]);
// Held with these, a character key is a shortcut and types nothing.
const SHORTCUT_BITS = MODIFIER_BITS.get('Alt') | MODIFIER_BITS.get('Control') | MODIFIER_BITS.get('Meta');

export function parseKeyChord(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > 32) {
    throw new Error('Key must be a chord of at most 32 characters');
  }
  // `+` joins modifiers, so the plus key itself is written last: `+` or `Control++`.
  const plusKey = text === '+' || text.endsWith('++');
  const parts = plusKey ? [...(text === '+' ? [] : text.slice(0, -2).split('+')), '+'] : text.split('+');
  const keyName = parts.pop();
  const modifiers = parts;
  if (modifiers.some((modifier, index) => !MODIFIER_BITS.has(modifier) || modifiers.indexOf(modifier) !== index)) {
    throw new Error('Key contains an unknown or duplicate modifier');
  }
  let modifierMask = modifiers.reduce((mask, modifier) => mask | MODIFIER_BITS.get(modifier), 0);
  const modifierNames = modifiers.map((modifier) => MODIFIER_NAMES.get(modifier));

  const named = NAMED_KEYS.get(keyName);
  if (named) {
    const [key, code, windowsVirtualKeyCode, typed] = named;
    const keyText = modifierMask & SHORTCUT_BITS ? '' : typed;
    return { key, code, windowsVirtualKeyCode, text: keyText, modifiers: modifierMask, modifierNames, accelerator: ACCELERATOR_NAMES.get(key) ?? key };
  }

  const character = keyName.length === 1 ? describeCharacter(keyName) : null;
  if (!character) throw new Error('Key must end with a supported named key or a printable ASCII character');
  // A character Shift produces arrives with Shift held, as from a keyboard.
  if (character.shifted && !(modifierMask & MODIFIER_BITS.get('Shift'))) {
    modifierMask |= MODIFIER_BITS.get('Shift');
    modifierNames.push('shift');
  }
  return {
    key: keyName,
    code: character.code,
    windowsVirtualKeyCode: character.keyCode,
    text: modifierMask & SHORTCUT_BITS ? '' : keyName,
    modifiers: modifierMask,
    modifierNames,
    accelerator: ACCELERATOR_NAMES.get(keyName) ?? keyName,
  };
}

export function buildCdpKeyEvents(chord) {
  const base = { key: chord.key, code: chord.code, windowsVirtualKeyCode: chord.windowsVirtualKeyCode, modifiers: chord.modifiers };
  const down = chord.text
    ? { type: 'keyDown', ...base, text: chord.text, unmodifiedText: chord.text }
    : { type: 'rawKeyDown', ...base };
  return [down, { type: 'keyUp', ...base }];
}

export function buildInputEventSequence(chord) {
  const events = [{ type: 'keyDown', keyCode: chord.accelerator, modifiers: chord.modifierNames }];
  // Electron types a character only through its own `char` event.
  if (chord.text) events.push({ type: 'char', keyCode: chord.text, modifiers: chord.modifierNames });
  events.push({ type: 'keyUp', keyCode: chord.accelerator, modifiers: chord.modifierNames });
  return events;
}

export function validateViewportPoint(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > 100_000 || y > 100_000) {
    throw new Error('Viewport point must contain finite, non-negative coordinates within bounds');
  }
  return { x, y };
}

export function validateCaptureClip(clip) {
  const { x, y, width, height } = clip ?? {};
  if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > 100_000 || y + height > 100_000 || width * height > 32_000_000) {
    throw new Error('Capture clip must have finite, bounded coordinates and positive dimensions');
  }
  return { x, y, width, height };
}
