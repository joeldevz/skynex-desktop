import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';

import { I18nProvider } from '@/lib/i18n';
import { createContextPart } from '@/lib/messages/contextParts';
import { useInputStore } from '@/sync/input-store';
import { PendingWhiteboardChips } from './PendingWhiteboardChips';

let browser: Window;
let root: Root;
const descriptors = new Map<string, PropertyDescriptor | undefined>();

beforeEach(() => {
  browser = new Window({ url: 'http://localhost' });
  for (const [key, value] of Object.entries({
    window: browser,
    document: browser.document,
    navigator: browser.navigator,
    Element: browser.Element,
    HTMLElement: browser.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  useInputStore.getState().setPendingSyntheticParts(null);
  await browser.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  descriptors.clear();
});

describe('PendingWhiteboardChips', () => {
  test('a request waiting in the composer shows its board, and removing it drops only the board', async () => {
    const board = createContextPart({ kind: 'whiteboard', boardId: 'wb_1', workspaceId: 'ws', title: 'Checkout', selected: [{ id: 'a', kind: 'block', text: 'Cart' }] }, 'agent text');
    const other = { text: 'other context', synthetic: true };
    useInputStore.getState().setPendingSyntheticParts([{ ...board, synthetic: true }, other]);
    await act(async () => root.render(<I18nProvider><PendingWhiteboardChips target={null} /></I18nProvider>));

    expect(document.body.textContent).toContain('Checkout');
    const remove = document.querySelector<HTMLButtonElement>('[aria-label="Remove whiteboard context"]');
    expect(remove).not.toBeNull();
    await act(async () => remove?.click());

    expect(useInputStore.getState().getPendingSyntheticParts(null)).toEqual([other]);
    expect(document.body.textContent).not.toContain('Checkout');
  });

  test('without a board among the pending context it shows nothing', async () => {
    useInputStore.getState().setPendingSyntheticParts([{ text: 'other', synthetic: true }]);
    await act(async () => root.render(<I18nProvider><PendingWhiteboardChips target={null} /></I18nProvider>));
    expect(document.body.textContent).toBe('');
  });
});
