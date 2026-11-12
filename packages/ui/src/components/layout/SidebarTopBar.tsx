import React from 'react';
import { SidebarPageButtons } from '@/components/session/sidebar/shell/SidebarHeader';
import { TooltipProvider } from '@/components/ui/tooltip';
import { titlebarControlsWidthReaderRef } from './titlebarControlsWidth';

const TOP_BAR_PAGE_BUTTON_CLASS =
  'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md leading-none text-foreground hover:bg-interactive-hover focus-visible:outline-none disabled:cursor-not-allowed';
const TOP_BAR_PAGE_ICON_CLASS = 'h-4 w-4';

/**
 * Strip at the top of the desktop left sidebar that reserves room for the
 * persistent {@link TitlebarLeftControls} overlay at the start and hosts the
 * sidebar page toggles at the end, so both share one header row (`--oc-header-height`).
 *
 * The leading regions keep window dragging working around the overlay buttons:
 * a `drag` region for the window-controls inset, a `no-drag` carve matching the
 * overlay footprint (an OS drag region here would steal clicks from the
 * separate-subtree overlay in Electron/macOS), a `drag` remainder in the middle,
 * and a `no-drag` cluster for the page buttons at the end.
 */
export const SidebarTopBar: React.FC = () => (
  <div
    className="flex shrink-0"
    style={{ height: 'var(--oc-header-height, 3rem)' }}
  >
    {/* Drag region for the window-controls inset (traffic lights). */}
    <div
      aria-hidden
      className="app-region-drag shrink-0"
      style={{ width: 'var(--oc-titlebar-start-inset, 0.75rem)' }}
    />
    {/* No-drag carve under the overlay buttons so they stay clickable. */}
    <div
      aria-hidden
      ref={titlebarControlsWidthReaderRef}
      className="app-region-no-drag shrink-0"
      style={{ width: 'calc(var(--oc-titlebar-controls-width, 3.25rem) + 0.5rem)' }}
    />
    {/* Draggable remainder of the strip. */}
    <div aria-hidden className="app-region-drag min-w-0 flex-1" />
    <div className="app-region-no-drag flex shrink-0 items-center pe-2">
      <TooltipProvider delay={400} closeDelay={0} timeout={300}>
        <SidebarPageButtons
          showSourceBoard
          buttonClassName={TOP_BAR_PAGE_BUTTON_CLASS}
          iconClassName={TOP_BAR_PAGE_ICON_CLASS}
        />
      </TooltipProvider>
    </div>
  </div>
);
