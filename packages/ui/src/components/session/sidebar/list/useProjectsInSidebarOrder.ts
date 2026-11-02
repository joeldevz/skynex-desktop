import React from 'react';
import { useProjectsStore } from '@/stores/useProjectsStore';

/**
 * Projects follow the order in the project store. Unregistered entries such
 * as the composer's Chat target stay ahead in their incoming order.
 */
export const useProjectsInSidebarOrder = <T extends { id: string }>(
  items: readonly T[],
  enabled = true,
): readonly T[] => {
  const projects = useProjectsStore((state) => state.projects);
  const ordered = React.useMemo(() => {
    if (!enabled) return null;
    const rankById = new Map(projects.map((project, index) => [project.id, index]));
    return [...items].sort((left, right) => (rankById.get(left.id) ?? -1) - (rankById.get(right.id) ?? -1));
  }, [enabled, items, projects]);

  // A closing popup stays on screen through its fade: keep the order it showed.
  const shownRef = React.useRef<{ items: readonly T[]; ordered: readonly T[] } | null>(null);
  if (ordered) {
    shownRef.current = { items, ordered };
    return ordered;
  }
  return shownRef.current?.items === items ? shownRef.current.ordered : items;
};
