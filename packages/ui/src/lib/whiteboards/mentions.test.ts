import { describe, expect, test } from 'bun:test';

import { addSkynexMention, completeMention, mentionPieces, mentionQueryAt, mentionsSkynex, removeSkynexMention } from './mentions';

describe('@Skynex mentions in comments', () => {
  test('a comment that mentions Skynex anywhere is sent to it; an email or a longer name is not a mention', () => {
    expect(mentionsSkynex('@Skynex hazlo un flujo')).toBe(true);
    expect(mentionsSkynex('hazlo, @skynex, por favor')).toBe(true);
    expect(mentionsSkynex('yo@skynex.dev')).toBe(false);
    expect(mentionsSkynex('@skynexbot')).toBe(false);
    expect(mentionsSkynex('sin mención')).toBe(false);
  });

  test('checking "Send to Skynex" adds the mention once; unchecking removes every one', () => {
    expect(addSkynexMention('hazlo')).toBe('@Skynex hazlo');
    expect(addSkynexMention('@Skynex hazlo')).toBe('@Skynex hazlo');
    expect(removeSkynexMention('@Skynex hazlo y @skynex mira')).toBe('hazlo y mira');
  });

  test('typing @ opens the mention while the letters can still spell skynex, and choosing it completes the word', () => {
    expect(mentionQueryAt('hola @sk', 8)).toEqual({ start: 5, query: 'sk' });
    expect(mentionQueryAt('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQueryAt('hola @x', 7)).toBeNull();
    expect(mentionQueryAt('correo@sk', 9)).toBeNull();
    expect(completeMention('hola @sk mira', 5, 8)).toEqual({ text: 'hola @Skynex mira', caret: 13 });
  });

  test('the text is cut into plain pieces and mentions for drawing the tags', () => {
    expect(mentionPieces('@Skynex haz esto, @skynex')).toEqual([
      { text: '@Skynex', mention: true },
      { text: ' haz esto, ', mention: false },
      { text: '@skynex', mention: true },
    ]);
    expect(mentionPieces('nada')).toEqual([{ text: 'nada', mention: false }]);
  });
});
