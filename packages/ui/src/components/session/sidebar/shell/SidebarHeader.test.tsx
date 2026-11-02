import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { I18nProvider } from '@/lib/i18n';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUIStore } from '@/stores/useUIStore';
import { SidebarPageButtons } from './SidebarHeader';

let browser: Window;
let root: Root;
const descriptors = new Map<string, PropertyDescriptor | undefined>();
const buttonClassName = 'inline-flex h-6 w-6';
const iconClassName = 'size-4';

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
  await browser.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
  descriptors.clear();
});

describe('SidebarPageButtons', () => {
  test('page buttons open and close their pages', async () => {
    const initial = useUIStore.getState();
    try {
      useUIStore.getState().setOverviewFeatureAvailable(true);
      await act(async () => root.render(
        <I18nProvider><TooltipProvider><SidebarPageButtons showSourceBoard buttonClassName={buttonClassName} iconClassName={iconClassName} /></TooltipProvider></I18nProvider>,
      ));
      const button = (label: string) => document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
      for (const [label, isOpen] of [
        ['Archive', () => useUIStore.getState().isArchivePageOpen],
        ['Scheduled tasks', () => useUIStore.getState().isScheduledTasksDialogOpen],
        ['Issues and PRs', () => useUIStore.getState().isSourceBoardOpen],
        ['Overview', () => useUIStore.getState().isOverviewOpen],
      ] as const) {
        expect(button(label).getAttribute('aria-pressed')).toBe('false');
        await act(async () => button(label).click());
        expect(isOpen()).toBe(true);
        expect(button(label).getAttribute('aria-pressed')).toBe('true');
        await act(async () => button(label).click());
        expect(isOpen()).toBe(false);
      }
    } finally {
      useUIStore.setState(initial);
    }
  });
});
