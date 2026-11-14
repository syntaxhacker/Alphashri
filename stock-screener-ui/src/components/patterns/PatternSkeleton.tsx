import { For } from "solid-js";

/** Band heights match the real tab / scope / tools strips so nothing shifts. */
const TAB_BAND_H = 31;
const SCOPE_BAND_H = 26;
const TOOLS_BAND_H = 30;
const CARD_H = 196;
const CARD_COUNT = 8;

const TAB_WIDTHS = [48, 44];
const STAT_WIDTHS = [30, 24, 24, 30, 24];
const PILL_WIDTHS = [46, 52, 40, 58, 44, 50];
/** Increasing widths so the tools band reads like a real control cluster. */
const TOOL_WIDTHS = [96, 132, 168, 210];
const CARD_SLOTS = Array.from({ length: CARD_COUNT }, (_, i) => i);

const CARD_GRID_CLASS =
  "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start gap-2 overflow-hidden pt-1 min-[900px]:grid-cols-[repeat(2,minmax(0,1fr))] min-[1200px]:grid-cols-[repeat(3,minmax(0,1fr))] min-[1400px]:grid-cols-[repeat(4,minmax(0,1fr))]";

function Bar(props: { width: string; height: string; pill?: boolean }) {
  return (
    <div
      className={`animate-pulse bg-fin-surface-alt ${props.pill ? "rounded-full" : "rounded-fin"}`}
      style={{ width: props.width, height: props.height }}
    />
  );
}

/** The results grid alone: mirrors `PatternGrid`'s card rhythm on a cold load. */
export function PatternGridSkeleton() {
  return (
    <div data-testid="patterns-skeleton-grid" className={CARD_GRID_CLASS}>
      <For each={CARD_SLOTS}>
        {() => (
          <div
            data-testid="patterns-skeleton-card"
            className="flex min-w-0 flex-col gap-2 rounded-fin border border-fin-border bg-fin-surface p-2"
            style={{ height: `${CARD_H}px` }}
          >
            <div className="flex shrink-0 items-center justify-between gap-2">
              <Bar width="58%" height="10px" />
              <Bar width="28px" height="10px" />
            </div>
            <Bar width="40%" height="9px" />
            <div className="min-h-0 flex-1 animate-pulse rounded-fin bg-fin-surface-alt" />
          </div>
        )}
      </For>
    </div>
  );
}

/**
 * Layout-matched placeholder for the Patterns route: the three toolbar bands
 * plus the card grid, so a cold render settles into the real layout instead of
 * a centred spinner over a black page.
 */
export function PatternSkeleton() {
  return (
    <div
      data-testid="patterns-skeleton"
      role="status"
      aria-busy="true"
      aria-label="Loading patterns"
      className="flex flex-1 min-h-0 flex-col gap-0.5 overflow-hidden px-2 py-[2px]"
    >
      <div
        className="flex shrink-0 items-stretch gap-2 border-b border-fin-border"
        style={{ height: `${TAB_BAND_H}px` }}
      >
        <div data-testid="patterns-skeleton-tabs" className="flex items-center gap-1">
          <For each={TAB_WIDTHS}>{(width) => <Bar width={`${width}px`} height="12px" />}</For>
        </div>
        <div
          data-testid="patterns-skeleton-stats"
          className="ml-auto flex min-w-0 items-center gap-2 overflow-hidden"
        >
          <For each={STAT_WIDTHS}>{(width) => <Bar width={`${width}px`} height="9px" />}</For>
        </div>
      </div>

      <div
        data-testid="patterns-skeleton-scope"
        className="flex shrink-0 items-center gap-1 overflow-hidden"
        style={{ height: `${SCOPE_BAND_H}px` }}
      >
        <For each={PILL_WIDTHS}>
          {(width) => <Bar width={`${width}px`} height="16px" pill />}
        </For>
      </div>

      <div
        data-testid="patterns-skeleton-tools"
        className="flex shrink-0 items-center gap-2 overflow-hidden"
        style={{ height: `${TOOLS_BAND_H}px` }}
      >
        <For each={TOOL_WIDTHS}>{(width) => <Bar width={`${width}px`} height="20px" />}</For>
      </div>

      <PatternGridSkeleton />
    </div>
  );
}
