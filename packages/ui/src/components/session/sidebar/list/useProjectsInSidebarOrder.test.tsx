import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectEntry } from '@/lib/api/types';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { installHookTestDom } from '../test-utils/testDom';
import { useProjectsInSidebarOrder } from './useProjectsInSidebarOrder';

const projects: ProjectEntry[] = [
  { id: 'charlie', path: '/repos/charlie', label: 'Charlie', addedAt: 100, lastOpenedAt: 300 },
  { id: 'alpha', path: '/repos/alpha', label: 'Alpha', addedAt: 400, lastOpenedAt: 400 },
  { id: 'delta', path: '/repos/delta', label: 'Delta', addedAt: 200, lastOpenedAt: 200 },
  { id: 'bravo', path: '/repos/bravo', label: 'Bravo', addedAt: 300, lastOpenedAt: 100 },
];

const initialProjects = useProjectsStore.getState();

describe('useProjectsInSidebarOrder', () => {
  let dom: ReturnType<typeof installHookTestDom>;
  let root: ReturnType<typeof createRoot>;
  let shown: string[] = [];

  const Harness = ({ items, enabled }: { items: readonly { id: string }[]; enabled?: boolean }) => {
    shown = useProjectsInSidebarOrder(items, enabled).map((item) => item.id);
    return null;
  };

  beforeEach(() => {
    dom = installHookTestDom();
    root = createRoot(dom.container);
    useProjectsStore.setState({ projects });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    dom.restore();
    useProjectsStore.setState(initialProjects, true);
  });

  test('follows the fixed order in the project store', async () => {
    await act(async () => root.render(<Harness items={projects} />));
    expect(shown).toEqual(['charlie', 'alpha', 'delta', 'bravo']);

    await act(async () => useProjectsStore.setState({ projects: [...projects].reverse() }));
    expect(shown).toEqual(['bravo', 'delta', 'alpha', 'charlie']);
  });

  test('keeps non-project entries first and preserves order while a list closes', async () => {
    const withChat = [{ id: 'chat' }, ...projects];
    await act(async () => root.render(<Harness items={withChat} />));
    expect(shown).toEqual(['chat', 'charlie', 'alpha', 'delta', 'bravo']);

    await act(async () => root.render(<Harness items={withChat} enabled={false} />));
    expect(shown).toEqual(['chat', 'charlie', 'alpha', 'delta', 'bravo']);
  });

  test('renders an empty list', async () => {
    await act(async () => root.render(<Harness items={[]} />));
    expect(shown).toEqual([]);
  });
});
