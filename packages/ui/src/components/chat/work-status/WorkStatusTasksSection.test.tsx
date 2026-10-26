import { expect, spyOn, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { I18nProvider } from '@/lib/i18n';
import { skynexTasksApi, type SkynexTask } from '@/lib/skynexTasksApi';
import { useUIStore } from '@/stores/useUIStore';
import { PresenceContext } from './presenceContext';
import { WorkStatusTasksSection } from './WorkStatusTasksSection';

test('Tasks has one collapsible heading, retains notebook controls, and needs a directory', async () => {
  const dom = new Window({ url: 'http://status.test' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({
    window: dom, document: dom.document, navigator: dom.navigator,
    HTMLElement: dom.HTMLElement, Event: dom.Event, IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const previous = useUIStore.getState().workStatusExpandedSections;
  const notebook: SkynexTask[] = [{
    id: 'one', title: 'First task',
    steps: [{ id: 'parent', title: 'Parent step', done: false }, { id: 'child', title: 'Child step', done: false, parent: 'parent' }],
    progress: { done: 0, total: 2 },
  }, { id: 'two', title: 'Second task', steps: [], progress: { done: 0, total: 0 } }];
  const list = spyOn(skynexTasksApi, 'list').mockResolvedValue(notebook);
  const complete = spyOn(skynexTasksApi, 'completeStep').mockResolvedValue({
    ...notebook[0], steps: notebook[0].steps.map((step) => ({ ...step, done: step.id === 'child' })),
    progress: { done: 1, total: 2 },
  });
  const presence: Array<[string, boolean]> = [];
  const report = (id: string, present: boolean) => { presence.push([id, present]); };
  const render = async (directory: string | null) => act(async () => root.render(
    <I18nProvider><PresenceContext.Provider value={report}><WorkStatusTasksSection directory={directory} /></PresenceContext.Provider></I18nProvider>,
  ));
  const button = (label: string) => {
    const result = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .find((element) => element.getAttribute('aria-label') === label || element.textContent === label);
    if (!result) throw new Error(`Missing button ${label}`);
    return result;
  };
  try {
    useUIStore.setState({ workStatusExpandedSections: {} });
    await render(null);
    expect(container.childElementCount).toBe(0);
    expect(list.mock.calls).toEqual([]);
    expect(presence.at(-1)).toEqual(['tasks', false]);

    await render('/project');
    expect(list.mock.calls).toEqual([['/project']]);
    expect(presence.at(-1)).toEqual(['tasks', true]);
    expect(container.querySelectorAll('section')).toHaveLength(1);
    expect(container.querySelectorAll('[data-work-status-heading]')).toHaveLength(1);
    expect(container.querySelectorAll('.oc-panel-edge')).toHaveLength(0);
    expect(container.querySelector('select')?.value).toBe('one');
    expect(container.querySelector('li li')?.textContent).toBe('Child step');
    expect(container.textContent).toContain('0 of 2');
    expect(button('Refresh').disabled).toBe(false);
    expect(button('Add task').disabled).toBe(false);
    await act(async () => button('Add step').click());
    expect(container.querySelector('form')).not.toBeNull();

    const toggle = container.querySelector<HTMLButtonElement>('[data-work-status-heading] button[aria-expanded]');
    if (!toggle) throw new Error('Missing Tasks collapse control');
    await act(async () => toggle.click());
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('select')).toBeNull();
    expect(useUIStore.getState().workStatusExpandedSections.tasks).toBe(false);
    expect(presence.at(-1)).toEqual(['tasks', true]);
    await act(async () => toggle.click());
    expect(container.querySelector('select')?.value).toBe('one');
    expect(container.querySelector('form')).not.toBeNull();
    expect(list.mock.calls).toEqual([['/project']]);
    const child = container.querySelector<HTMLInputElement>('li li input');
    if (!child) throw new Error('Missing subtask checkbox');
    await act(async () => child.click());
    expect(complete.mock.calls).toEqual([['/project', 'one', 'child']]);
    expect(container.textContent).toContain('1 of 2');
    expect(container.querySelector<HTMLInputElement>('li li input')?.checked).toBe(true);
    await render(null);
    expect(container.childElementCount).toBe(0);
    expect(presence.at(-1)).toEqual(['tasks', false]);
  } finally {
    await act(async () => root.unmount());
    list.mockRestore();
    complete.mockRestore();
    useUIStore.setState({ workStatusExpandedSections: previous });
    await dom.happyDOM.close();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
