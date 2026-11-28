/**
 * Market → Vis "Trend alignment".
 *
 * Chart form: the D3 gallery "Dot matrix" / "Heatmap" — a compact matrix of
 * discrete states, one row per stock, with three MA-status dots, a rank count
 * and a signed day change. Reference:
 * https://observablehq.com/@d3/gallery (Dot matrix plot and Heatmap).
 * Data inks come from VIZ_*; none of the app's amber chrome is reused here.
 */
import { For, Show, createMemo, createSignal } from "solid-js";
import { Box, Text, ToolbarRow } from "@/ui";
import { VIZ_BG, VIZ_DOWN, VIZ_GRID, VIZ_MUTED, VIZ_PANEL, VIZ_TEXT, VIZ_UP } from "@/ui/palette";
import type { MarketRow } from "@/types/marketScreener";
import type { VisRenderProps } from "./MarketMapView";

export type MaState = "above" | "below" | "null";
export type TrendFilter = "all" | "3/3" | "2+" | "below200";

export const MA_PERIODS = [20, 50, 200] as const;
export const TREND_ROW_LIMIT = 150;
/** Hard ceiling for the incremental reveal — beyond this the matrix stops growing. */
export const TREND_ROW_MAX = 600;

export const TREND_FILTERS: ReadonlyArray<{ value: TrendFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "3/3", label: "3/3" },
  { value: "2+", label: "2+" },
  { value: "below200", label: "below 200" },
];

export interface TrendAlignmentRow {
  symbol: string;
  /** Finite day change in percent; null when the source has no quote. */
  change: number | null;
  /** MA states in MA_PERIODS order: 20-day, 50-day, 200-day. */
  states: MaState[];
  /** How many MAs the close sits above; a missing MA counts as neither. */
  count: number;
  label: string;
  /** False when all three MAs are missing — there is nothing to align. */
  hasData: boolean;
}

const EMPTY: MarketRow[] = [];

const finite = (value: number | null | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export function maState(close: number | null | undefined, ma: number | null | undefined): MaState {
  const price = finite(close);
  const average = finite(ma);
  if (price === null || average === null) return "null";
  return price > average ? "above" : "below";
}

export function toAlignmentRow(row: MarketRow): TrendAlignmentRow {
  const states = MA_PERIODS.map((period) =>
    maState(row.close, row[`sma${period}` as "sma20" | "sma50" | "sma200"]),
  );
  const count = states.filter((state) => state === "above").length;
  return {
    symbol: row.symbol,
    change: finite(row.change),
    states,
    count,
    label: `${count}/${MA_PERIODS.length}`,
    hasData: states.some((state) => state !== "null"),
  };
}

/** Count desc, then 1D change desc; symbol breaks ties so the order is stable. */
export function sortTrendRows(rows: TrendAlignmentRow[]): TrendAlignmentRow[] {
  const changeOf = (value: number | null) => (value === null ? Number.NEGATIVE_INFINITY : value);
  return [...rows].sort(
    (a, b) =>
      b.count - a.count || changeOf(b.change) - changeOf(a.change) || a.symbol.localeCompare(b.symbol),
  );
}

export function filterTrendRows(rows: TrendAlignmentRow[], filter: TrendFilter): TrendAlignmentRow[] {
  switch (filter) {
    case "3/3":
      return rows.filter((row) => row.count === MA_PERIODS.length);
    case "2+":
      return rows.filter((row) => row.count >= 2);
    // "below 200" is the bearish leg: close at or under the 200-day average.
    case "below200":
      return rows.filter((row) => row.states[MA_PERIODS.length - 1] === "below");
    default:
      return rows;
  }
}

export function trendDotColor(state: MaState): string {
  if (state === "above") return VIZ_UP;
  if (state === "below") return VIZ_DOWN;
  return VIZ_MUTED;
}

const stateLabel = (state: MaState) => (state === "null" ? "n/a" : state);

export function formatTrendChange(value: number | null): string {
  if (value === null) return "—";
  const rounded = Math.abs(value) < 0.005 ? 0 : value;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(2)}%`;
}

function changeColor(value: number | null): string {
  if (value === null) return VIZ_MUTED;
  return value > 0 ? VIZ_UP : value < 0 ? VIZ_DOWN : VIZ_TEXT;
}

/**
 * A row is a native button so Enter/Space open the chart and a screen reader
 * announces the symbol; the dots carry text alternatives, not colour alone.
 */
export function TrendAlignmentView(props: VisRenderProps) {
  const [filter, setFilter] = createSignal<TrendFilter>("all");
  const [limit, setLimit] = createSignal(TREND_ROW_LIMIT);

  const aligned = createMemo(() =>
    sortTrendRows((props.rows ?? EMPTY).map(toAlignmentRow).filter((row) => row.hasData)),
  );
  const filtered = createMemo(() => filterTrendRows(aligned(), filter()));
  const shown = createMemo(() => filtered().slice(0, limit()));
  const hasMore = () => limit() < Math.min(filtered().length, TREND_ROW_MAX);
  const atCeiling = () => limit() >= TREND_ROW_MAX;
  const countTitle = () =>
    `Showing ${shown().length} of ${aligned().length} · visible cap ${limit()} (max ${TREND_ROW_MAX}). ` +
    (hasMore()
      ? `Use Load more to reveal the next ${TREND_ROW_LIMIT} matches.`
      : atCeiling()
        ? `The ${TREND_ROW_MAX}-row ceiling is reached; narrow the filter to see a different slice.`
        : "All matches are shown.");
  const selectFilter = (value: TrendFilter) => {
    setFilter(value);
    setLimit(TREND_ROW_LIMIT);
  };

  return (
    <Box
      className="w-full flex-1 min-w-0 min-h-0 flex flex-col"
      data-testid="trend-alignment-view"
      style={{ "background-color": VIZ_BG, color: VIZ_TEXT }}
    >
      <ToolbarRow
        gap={8}
        wrap
        className="px-2 min-h-10 py-1 flex-shrink-0"
        style={{ "border-bottom": `1px solid ${VIZ_GRID}` }}
        data-testid="trend-toolbar"
      >
        {/* Four nowrap chips cannot be clipped: at 390 the track scrolls inside
            its own bounded cell so no filter (or the count below) disappears. */}
        <Box
          className="flex items-center gap-2 min-w-0 flex-1 overflow-x-auto"
          data-testid="trend-filters"
        >
          <For each={TREND_FILTERS}>
            {(chip) => (
              <button
                type="button"
                data-testid={`trend-filter-${chip.value}`}
                aria-pressed={filter() === chip.value}
                className={`h-6 shrink-0 rounded px-2 text-ui-micro font-semibold whitespace-nowrap ${
                  filter() === chip.value
                    ? "border border-fin-primary bg-fin-primary/12 text-fin-primary"
                    : "border border-fin-border text-fin-text-muted hover:text-fin-text"
                }`}
                onClick={() => selectFilter(chip.value)}
              >
                {chip.label}
              </button>
            )}
          </For>
        </Box>
      </ToolbarRow>

      <ToolbarRow
        gap={8}
        className="px-2 h-8 flex-shrink-0"
        style={{ "border-bottom": `1px solid ${VIZ_GRID}` }}
        data-testid="trend-footer"
      >
        <Text
          size="xs"
          c="dimmed"
          className="min-w-0 truncate"
          title={countTitle()}
          data-testid="trend-showing"
        >
          showing {shown().length} of {aligned().length}
        </Text>
        <Box className="flex-1 min-w-0" />
        <Show when={hasMore()}>
          <button
            type="button"
            data-testid="trend-load-more"
            className="h-6 shrink-0 whitespace-nowrap rounded border border-fin-border px-2 text-ui-micro font-semibold text-fin-text hover:text-fin-primary"
            onClick={() => setLimit((value) => Math.min(value + TREND_ROW_LIMIT, TREND_ROW_MAX))}
          >
            Load more
          </button>
        </Show>
      </ToolbarRow>

      <Box
        className="w-full flex items-center gap-2 px-2 h-8 flex-shrink-0"
        style={{ "border-bottom": `1px solid ${VIZ_GRID}` }}
        data-testid="trend-head"
      >
        <Text size="xs" c="dimmed" className="flex-1 min-w-0">
          Symbol
        </Text>
        <Text size="xs" c="dimmed" className="w-10 shrink-0 text-right">
          MA
        </Text>
        <Text size="xs" c="dimmed" className="w-8 shrink-0 text-right">
          Align
        </Text>
        <Text size="xs" c="dimmed" className="w-14 shrink-0 text-right">
          1D
        </Text>
      </Box>

      <Show
        when={aligned().length > 0}
        fallback={
          <Box className="flex-1 flex items-center justify-center p-4" data-testid="trend-empty">
            <Text size="sm" c="dimmed">
              No moving-average data.
            </Text>
          </Box>
        }
      >
        <Show
          when={shown().length > 0}
          fallback={
            <Box className="flex-1 flex items-center justify-center p-4" data-testid="trend-empty-filter">
              <Text size="sm" c="dimmed">
                No stocks match this filter.
              </Text>
            </Box>
          }
        >
          <Box
            className="w-full flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-auto"
            data-testid="trend-scroll"
          >
            <For each={shown()}>
              {(item) => (
                <Box
                  component="button"
                  type="button"
                  data-testid="trend-row"
                  data-symbol={item.symbol}
                  className="w-full min-w-0 flex items-center gap-2 px-2 py-1 text-left hover:bg-fin-surface-alt"
                  style={{ "border-bottom": `1px solid ${VIZ_GRID}`, color: VIZ_TEXT, cursor: "pointer" }}
                  onClick={() => props.onSymbolClick?.(item.symbol)}
                >
                  <Text
                    size="xs"
                    span
                    className="min-w-0 flex-1 truncate font-mono"
                    data-testid="trend-symbol"
                    title={item.symbol}
                  >
                    {item.symbol}
                  </Text>
                  <Box className="flex shrink-0 justify-end gap-1 w-10">
                    <For each={MA_PERIODS}>
                      {(period, index) => {
                        const state = () => item.states[index()];
                        return (
                          <Box
                            component="span"
                            role="img"
                            data-testid="trend-dot"
                            data-ma={period}
                            data-state={state()}
                            aria-label={`${period}-day ${stateLabel(state())}`}
                            title={`${period}-day ${stateLabel(state())}`}
                            className="size-2 rounded-full shrink-0"
                            style={{ "background-color": trendDotColor(state()) }}
                          />
                        );
                      }}
                    </For>
                  </Box>
                  <Text
                    size="xs"
                    span
                    className="w-8 shrink-0 text-right font-mono tabular-nums"
                    data-testid="trend-count"
                  >
                    {item.label}
                  </Text>
                  <Text
                    size="xs"
                    span
                    className="w-14 shrink-0 text-right font-mono tabular-nums"
                    data-testid="trend-change"
                    style={{ color: changeColor(item.change) }}
                  >
                    {formatTrendChange(item.change)}
                  </Text>
                </Box>
              )}
            </For>
          </Box>
        </Show>
      </Show>

      <Box
        className="flex flex-wrap items-center gap-2 px-2 min-h-8 py-1 flex-shrink-0"
        style={{ "border-top": `1px solid ${VIZ_GRID}`, "background-color": VIZ_PANEL }}
        data-testid="trend-legend"
      >
        <Text
          size="xs"
          span
          c="dimmed"
          className="hidden sm:block whitespace-nowrap"
          title="sorted by alignment, then 1D"
        >
          sorted by alignment, then 1D
        </Text>
        <For each={["above", "below", "null"] as MaState[]}>
          {(state) => (
            <Box className="flex items-center gap-1">
              <Box
                component="span"
                className="size-2 rounded-full"
                style={{ "background-color": trendDotColor(state) }}
              />
              <Text size="xs" c="dimmed">
                {stateLabel(state)}
              </Text>
            </Box>
          )}
        </For>
      </Box>
    </Box>
  );
}
