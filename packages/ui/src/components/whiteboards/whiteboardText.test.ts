import { describe, expect, test } from 'bun:test';

import { withSoftBreaks } from './whiteboardText';

describe('board text breaks', () => {
  test('long names and paths may wrap after their separators', () => {
    expect(withSoftBreaks('/api/openchamber/whiteboards')).toBe('/\u200Bapi/\u200Bopenchamber/\u200Bwhiteboards');
    expect(withSoftBreaks('skynex_whiteboard')).toBe('skynex_\u200Bwhiteboard');
  });

  test('plain words and trailing separators stay as written', () => {
    expect(withSoftBreaks('Store por pizarra')).toBe('Store por pizarra');
    expect(withSoftBreaks('Fin.')).toBe('Fin.');
    expect(withSoftBreaks('a / b')).toBe('a / b');
  });
});
