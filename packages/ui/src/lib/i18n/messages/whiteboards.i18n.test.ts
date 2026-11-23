import { describe, expect, test } from 'bun:test';

import { whiteboardsI18n } from './whiteboards.i18n';

const locales = ['en', 'de', 'fr', 'nl', 'es', 'ja', 'pt-BR', 'uk', 'ko', 'pl', 'zh-CN', 'zh-TW', 'tr', 'ar', 'he'] as const;

const placeholders = (value: string): string[] => value.match(/\{\w+\}/g) ?? [];

// The product's name reads the same in every language.
const UNTRANSLATED = new Set(['Skynex']);

describe('whiteboards translations', () => {
  test('provides every key in every supported locale, translated, with the same placeholders', () => {
    const english = new Map<string, string>(Object.entries(whiteboardsI18n.en));
    expect(english.size).toBeGreaterThan(0);
    for (const locale of locales) {
      const translated = new Map<string, string>(Object.entries(whiteboardsI18n[locale]));
      expect([...translated.keys()].sort()).toEqual([...english.keys()].sort());
      for (const [key, source] of english) {
        const value = translated.get(key) ?? '';
        expect(value).toBeTruthy();
        if (locale !== 'en' && !UNTRANSLATED.has(source)) expect(value).not.toBe(source);
        expect(placeholders(value)).toEqual(placeholders(source));
      }
    }
  });
});
