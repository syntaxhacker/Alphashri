import { For, Show, createMemo, createSignal } from "solid-js";
import { Box, Button, SegmentedControl, Text, ToolbarRow } from "@/ui";
import {
  alpha,
  VIZ_BG,
  VIZ_CATEGORICAL,
  VIZ_GRID,
  VIZ_MUTED,
  VIZ_PANEL,
  VIZ_TEXT,
  VIZ_UP,
  VIZ_DOWN,
} from "@/ui/palette";
import type { MarketRow } from "@/types/marketScreener";
import type { VisRenderProps } from "./MarketMapView";
import { VisTitle } from "./vis/VisFrame";
import { isFiniteNumber as finite, vizPnlColor as pnlScaleColor } from "./vis/visScale";

export { pnlScaleColor };

/**
 * Market → Vis "52-week range": the D3 gallery's Range plot / Dot plot form —
 * one horizontal low→high rail per stock with the close marked as a dot, plus a
 * compact 10-bin position histogram. Implemented with local `@/ui` DOM
 * primitives (CSS-percent geometry, native scroll and keyboard focus), not the
 * ECharts custom-series alternative; the list is a scrollable table-like view,
 * so a canvas would only duplicate layout the browser already does.
 * Reference: https://observablehq.com/@d3/gallery (Range plot / Dot plot).
 */

const EMPTY: MarketRow[] = [];
const INITIAL_ROWS = 150;
const LOAD_STEP = 150;
const MAX_CEILING = 600;
const BIN_COUNT = 10;

export const RANGE52_FILTERS = [
  { id: "all", label: "All", threshold: null },
  { id: "2", label: "within 2%", threshold: 2 },
  { id: "5", label: "within 5%", threshold: 5 },
  { id: "10", label: "within 10%", threshold: 10 },
] as const;
export type Range52Filter = (typeof RANGE52_FILTERS)[number]["id"];

type RangedRow = MarketRow & { close: number; high52w: number; low52w: number };

/** A null range is data we do not have, never a zero-width track. */
export function hasRange(row: MarketRow): row is RangedRow {
  return (
    !!row &&
    finite(row.close) &&
    finite(row.high52w) &&
    finite(row.low52w) &&
    row.high52w > row.low52w
  );
}

/** Signed: at the high is 0, below it is negative, above it is positive. */
export function toHighPct(row: MarketRow): number | null {
  if (finite(row.to52wHighPct)) return row.to52wHighPct;
  if (hasRange(row)) return ((row.close - row.high52w) / row.high52w) * 100;
  return null;
}

/** Raw percentage along the track; the renderer clamps it to the rail. */
export function dotOffsetPct(row: MarketRow): number | null {
  if (!hasRange(row)) return null;
  return ((row.close - row.low52w) / (row.high52w - row.low52w)) * 100;
}

export function positionPct(row: MarketRow): number | null {
  if (finite(row.pos52w)) return Math.min(100, Math.max(0, row.pos52w));
  if (!hasRange(row)) return null;
  return Math.min(100, Math.max(0, dotOffsetPct(row) ?? 0));
}

/**
 * Fixed-point percentage with negative zero suppressed. A value that rounds to
 * zero must read 0.0% — "-0.0%" is rejected by the evidence rules — while a
 * genuine small negative (e.g. -0.44 → -0.4%) keeps its sign. Every displayed
 * percentage in this view goes through here.
 */
export function formatPct(value: number, digits = 1): string {
  const rounded = Number(value.toFixed(digits));
  return `${(rounded === 0 ? 0 : rounded).toFixed(digits)}%`;
}

export function toHighText(row: MarketRow): string {
  const value = toHighPct(row);
  if (value === null) return "n/a";
  const text = formatPct(value);
  return Number(value.toFixed(1)) > 0 ? `+${text} above high` : `${text} to high`;
}

export function positionText(row: MarketRow): string {
  const value = positionPct(row);
  return value === null ? "n/a" : formatPct(value, 0);
}

export interface PosHistogram {
  bins: number[];
  median: number | null;
  total: number;
}

export function posHistogram(rows: MarketRow[]): PosHistogram {
  const values = rows
    .map(positionPct)
    .filter((value): value is number => value !== null)
    .sort((a, b) => a - b);
  const bins = Array.from({ length: BIN_COUNT }, () => 0);
  for (const value of values) {
    bins[Math.min(BIN_COUNT - 1, Math.floor(value / (100 / BIN_COUNT)))] += 1;
  }
  const middle = Math.floor(values.length / 2);
  const median =
    values.length === 0
      ? null
      : values.length % 2 === 1
        ? values[middle]
        : (values[middle - 1] + values[middle]) / 2;
  return { bins, median, total: values.length };
}

export function sortRangeRows(rows: MarketRow[]): MarketRow[] {
  return [...rows].sort((a, b) => {
    const av = toHighPct(a);
    const bv = toHighPct(b);
    const aSort = av === null ? Number.NEGATIVE_INFINITY : av;
    const bSort = bv === null ? Number.NEGATIVE_INFINITY : bv;
    return bSort - aSort || a.symbol.localeCompare(b.symbol);
  });
}

/** "Within" is symmetric distance from the high, so new highs still qualify. */
export function filterRangeRows(rows: MarketRow[], filter: string): MarketRow[] {
  const threshold = RANGE52_FILTERS.find((f) => f.id === filter)?.threshold ?? null;
  if (threshold === null) return rows;
  return rows.filter((row) => {
    const value = toHighPct(row);
    return value !== null && Math.abs(value) <= threshold;
  });
}

export function Range52View(props: VisRenderProps) {
  const [filter, setFilter] = createSignal<string>("all");
  const [cap, setCap] = createSignal(INITIAL_ROWS);
  const rows = createMemo(() => props.rows ?? EMPTY);
  const sorted = createMemo(() => sortRangeRows(rows()));
  const filtered = createMemo(() => filterRangeRows(sorted(), filter()));
  const visible = createMemo(() => filtered().slice(0, cap()));
  const moreAvailable = createMemo(() => filtered().length > visible().length);
  const atCeiling = createMemo(() => cap() >= MAX_CEILING);
  const changeFilter = (value: string) => {
    setFilter(value);
    setCap(INITIAL_ROWS);
  };
  const loadMore = () => setCap((current) => Math.min(MAX_CEILING, current + LOAD_STEP));
  const countTitle = () =>
    `Showing ${visible().length} of ${filtered().length} matches · visible cap ${cap()} (max ${MAX_CEILING}). ` +
    (moreAvailable()
      ? atCeiling()
        ? "The 600-row ceiling is reached; narrow the filter to see a different slice."
        : `Use Load more to reveal the next ${LOAD_STEP} matches.`
      : "All matches are shown.");
  const hist = createMemo(() => posHistogram(filtered()));
  const extent = createMemo(() => {
    let max = 1;
    for (const row of filtered()) {
      if (finite(row.change)) max = Math.max(max, Math.abs(row.change));
    }
    return max;
  });
  const maxBin = createMemo(() => Math.max(1, ...hist().bins));
  const medianLeft = createMemo(() =>
    formatPct(Math.min(100, Math.max(0, hist().median ?? 0)), 2),
  );
  const barHeight = (count: number) =>
    count === 0 ? "2px" : `${((count / maxBin()) * 100).toFixed(1)}%`;
  const dotLeft = (row: MarketRow) =>
    `${Math.min(100, Math.max(0, dotOffsetPct(row) ?? 0)).toFixed(3)}%`;
  const rowColor = (row: MarketRow) => {
    const change = finite(row.change) ? row.change : 0;
    return change > 0 ? VIZ_UP : change < 0 ? VIZ_DOWN : VIZ_MUTED;
  };
  const changeTooltip = (row: MarketRow) => {
    const change = finite(row.change)
      ? `${Number(row.change.toFixed(2)) > 0 ? "+" : ""}${formatPct(row.change, 2)}`
      : "n/a";
    return `${row.symbol} · ${row.name} · change ${change} · ${toHighText(row)} · position ${positionText(row)}`;
  };

  return (
    <Box
      className="flex-1 min-w-0 min-h-0 flex flex-col"
      style={{ "background-color": VIZ_BG }}
      data-testid="range52-view"
    >
      <ToolbarRow
        gap={8}
        wrap
        className="px-2 py-1 flex-shrink-0"
        style={{ "border-bottom": `1px solid ${VIZ_GRID}` }}
        data-testid="range52-toolbar"
      >
        <VisTitle>52-week range</VisTitle>
        {/* Four unshrinkable chips clipped the count at 390px; one bounded,
            scrollable rail keeps every proximity option reachable. The unit
            label cannot share this cell: the rail's scroll cue covered it. */}
        <Box
          className="flex-1 min-w-0"
          title="Proximity to 52-week high — within % of high"
        >
          <SegmentedControl
            value={filter()}
            onChange={changeFilter}
            data={RANGE52_FILTERS.map((option) => ({ value: option.id, label: option.label }))}
            size="xs"
            scrollable
            scrollLabel="Scroll proximity filters"
            scrollTestId="range52-filter-scroll"
            aria-label="Proximity filters — within % of 52-week high"
            data-testid="range52-filter-selector"
          />
        </Box>
        {/* Its own line at 390: the scrollable chip rail's cue covers a unit
            label that shares its bounded cell. Full width restores the inline
            placement once the toolbar has room at 900px and above. */}
        <Text
          size="xs"
          c={VIZ_MUTED}
          className="w-full shrink-0 whitespace-nowrap text-right min-[900px]:w-auto min-[900px]:text-left"
          data-testid="range52-of-high"
        >
          of high
        </Text>
        <Box
          className="flex items-center gap-2 w-full sm:w-auto min-w-0"
          data-testid="range52-footer"
        >
          <Text
            size="xs"
            c={VIZ_MUTED}
            className="whitespace-nowrap font-mono tabular-nums"
            title={countTitle()}
            data-testid="range52-count"
          >
            showing {visible().length} of {filtered().length}
          </Text>
          <Show when={moreAvailable()}>
            <Button
              size="xs"
              variant="outline"
              disabled={atCeiling()}
              onClick={loadMore}
              data-testid="range52-load-more"
            >
              Load more
            </Button>
          </Show>
        </Box>
      </ToolbarRow>

      <Show
        when={filtered().length > 0}
        fallback={
          <Box
            className="flex-1 min-w-0 min-h-0 flex items-center justify-center p-4"
            data-testid="range52-empty"
          >
            <Text size="sm" c={VIZ_MUTED}>
              No 52-week data in the current filter.
            </Text>
          </Box>
        }
      >
        <Box
          className="flex-shrink-0 flex flex-col gap-1 px-2 py-2"
          style={{
            "background-color": VIZ_PANEL,
            "border-bottom": `1px solid ${VIZ_GRID}`,
          }}
          data-testid="range52-histogram-panel"
        >
          <ToolbarRow gap={8} className="h-5">
            <Text size="xs" fw={600} c={VIZ_TEXT}>
              52-week position
            </Text>
            <Text
              size="xs"
              c={VIZ_MUTED}
              className="font-mono tabular-nums"
              data-testid="range52-histogram-count"
            >
              {hist().total} stocks · median {hist().median === null ? "n/a" : `${Math.round(hist().median ?? 0)}%`}
            </Text>
          </ToolbarRow>
          <Box
            className="relative h-12 flex-shrink-0 flex items-end gap-px"
            data-testid="range52-histogram"
          >
            <For each={hist().bins}>
              {(count, index) => (
                <Box className="flex-1 h-full flex items-end">
                  <Box
                    className="w-full"
                    data-testid={`range52-histogram-bar-${index()}`}
                    data-count={count}
                    style={{
                      height: barHeight(count),
                      "background-color": alpha(VIZ_CATEGORICAL[0], 0.7),
                    }}
                  />
                </Box>
              )}
            </For>
            <Show when={hist().median !== null}>
              <Box
                className="absolute inset-y-0 w-px"
                data-testid="range52-histogram-median"
                data-median={hist().median?.toFixed(2)}
                style={{ left: medianLeft(), "background-color": VIZ_TEXT }}
              />
            </Show>
          </Box>
          <ToolbarRow gap={8} className="h-4">
            <Text span size="xs" c={VIZ_MUTED} className="font-mono tabular-nums">
              0
            </Text>
            <Box className="flex-1 min-w-0" />
            <Text span size="xs" c={VIZ_MUTED} className="font-mono tabular-nums">
              100
            </Text>
          </ToolbarRow>
        </Box>

        <ToolbarRow
          gap={8}
          className="px-2 h-7 flex-shrink-0"
          style={{ "border-bottom": `1px solid ${VIZ_GRID}` }}
          data-testid="range52-header"
        >
          <Text span size="xs" c={VIZ_MUTED} className="w-24 flex-shrink-0">
            Symbol
          </Text>
          <Text span size="xs" c={VIZ_MUTED} className="flex-1 min-w-0">
            Low → high
          </Text>
          <Text span size="xs" c={VIZ_MUTED} className="w-32 flex-shrink-0 text-right">
            To high
          </Text>
          <Text span size="xs" c={VIZ_MUTED} className="w-12 flex-shrink-0 text-right">
            Pos
          </Text>
        </ToolbarRow>

        <Box
          className="flex-1 min-w-0 min-h-0 flex flex-col gap-1 overflow-auto p-2"
          data-testid="range52-list"
        >
          <For each={visible()}>
            {(row, index) => (
              <button
                type="button"
                data-testid={`range52-row-${row.symbol}`}
                data-row-key={`${index()}-${row.symbol}`}
                title={changeTooltip(row)}
                onClick={() => props.onSymbolClick?.(row.symbol)}
                className="flex w-full items-center gap-2 rounded-fin border px-2 py-1 text-left cursor-pointer hover:brightness-110 focus-visible:outline-none focus-visible:ring-1"
                style={{ "border-color": VIZ_GRID, "background-color": VIZ_BG }}
              >
                <Text
                  span
                  size="xs"
                  fw={600}
                  c={VIZ_TEXT}
                  class="w-24 flex-shrink-0 truncate"
                  title={`${row.symbol} · ${row.name}`}
                >
                  {row.symbol}
                </Text>
                <Box
                  className="relative flex-1 min-w-0 h-4"
                  style={{ "background-color": alpha(VIZ_GRID, 0.55) }}
                >
                  <Show
                    when={hasRange(row)}
                    fallback={
                      <Text
                        span
                        size="xs"
                        c={VIZ_MUTED}
                        class="absolute inset-0 flex items-center justify-center"
                        data-testid={`range52-na-${row.symbol}`}
                      >
                        n/a
                      </Text>
                    }
                  >
                    <Box
                      className="absolute top-1/2 size-2 -translate-y-1/2 rounded-full"
                      data-testid={`range52-dot-${row.symbol}`}
                      data-dot-pct={dotOffsetPct(row)?.toFixed(3) ?? "n/a"}
                      data-dot-color={pnlScaleColor(row.change, extent())}
                      style={{
                        left: dotLeft(row),
                        "background-color": pnlScaleColor(row.change, extent()),
                      }}
                    />
                  </Show>
                </Box>
                <Text
                  span
                  size="xs"
                  class="w-32 flex-shrink-0 text-right font-mono tabular-nums"
                  c={rowColor(row)}
                >
                  {toHighText(row)}
                </Text>
                <Text
                  span
                  size="xs"
                  c={VIZ_MUTED}
                  class="w-12 flex-shrink-0 text-right font-mono tabular-nums"
                >
                  {positionText(row)}
                </Text>
              </button>
            )}
          </For>
        </Box>
      </Show>
    </Box>
  );
}
