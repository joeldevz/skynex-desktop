import React from 'react';
import { useI18n } from '@/lib/i18n';
import { useUIStore } from '@/stores/useUIStore';

const HANDLE_HEIGHT = 8;
const MIN_RATIO = 0.1;
const MAX_RATIO = 0.9;
const clampRatio = (ratio: number) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
const rows = (ratio: number) => `minmax(0, ${ratio}fr) ${HANDLE_HEIGHT}px minmax(0, ${1 - ratio}fr)`;

export function WorkspaceNavigationSplit({ children }: {
  children: readonly [React.ReactNode, React.ReactNode];
}) {
  const { t } = useI18n();
  const savedRatio = useUIStore((state) => state.workspaceSidebarSplitRatio);
  const saveRatio = useUIStore((state) => state.setWorkspaceSidebarSplitRatio);
  const ratio = Number.isFinite(savedRatio) ? clampRatio(savedRatio) : 0.5;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const handleRef = React.useRef<HTMLDivElement>(null);
  const liveRatio = React.useRef(ratio);
  const drag = React.useRef<{ pointerId: number; y: number; ratio: number; height: number } | null>(null);
  const [resizing, setResizing] = React.useState(false);

  const applyRatio = React.useCallback((value: number) => {
    liveRatio.current = clampRatio(value);
    if (containerRef.current) containerRef.current.style.gridTemplateRows = rows(liveRatio.current);
    handleRef.current?.setAttribute('aria-valuenow', String(Math.round(liveRatio.current * 100)));
  }, []);

  React.useLayoutEffect(() => {
    if (!drag.current) applyRatio(ratio);
  }, [ratio, applyRatio]);

  const finishResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    setResizing(false);
    saveRatio(liveRatio.current);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return <div ref={containerRef} className="grid min-h-0 flex-1" style={{ gridTemplateRows: rows(ratio) }}>
    <div className="min-h-0 overflow-hidden">{children[0]}</div>
    <div
      ref={handleRef}
      role="separator"
      tabIndex={0}
      aria-orientation="horizontal"
      aria-label={t('contextPanel.actions.resizePanelAria')}
      aria-valuemin={MIN_RATIO * 100}
      aria-valuemax={MAX_RATIO * 100}
      aria-valuenow={Math.round(ratio * 100)}
      className={`group relative flex touch-none cursor-row-resize items-center justify-center hover:bg-interactive-hover focus-visible:bg-interactive-hover ${resizing ? 'bg-interactive-hover' : ''}`}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        const height = (containerRef.current?.getBoundingClientRect().height ?? 0) - HANDLE_HEIGHT;
        if (height <= 0) return;
        event.preventDefault();
        try { event.currentTarget.setPointerCapture(event.pointerId); } catch { return; }
        drag.current = { pointerId: event.pointerId, y: event.clientY, ratio: liveRatio.current, height };
        setResizing(true);
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || active.pointerId !== event.pointerId) return;
        applyRatio(active.ratio + (event.clientY - active.y) / active.height);
      }}
      onPointerUp={finishResize}
      onPointerCancel={finishResize}
      onLostPointerCapture={finishResize}
      onKeyDown={(event) => {
        if (drag.current) return;
        let next: number;
        switch (event.key) {
          case 'ArrowUp': next = liveRatio.current - 0.02; break;
          case 'ArrowDown': next = liveRatio.current + 0.02; break;
          case 'Home': next = MIN_RATIO; break;
          case 'End': next = MAX_RATIO; break;
          default: return;
        }
        event.preventDefault();
        applyRatio(next);
        saveRatio(liveRatio.current);
      }}
    >
      <span aria-hidden="true" className="absolute h-px w-full bg-[var(--interactive-border)]" />
      <span aria-hidden="true" className={`relative h-0.5 w-6 rounded-full ${resizing ? 'bg-[var(--surface-foreground)]' : 'bg-[var(--surface-muted-foreground)] group-hover:bg-[var(--surface-foreground)] group-focus-visible:bg-[var(--surface-foreground)]'}`} />
    </div>
    <div className="min-h-0 overflow-hidden">{children[1]}</div>
  </div>;
}
