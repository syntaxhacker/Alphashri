import { For, Show, createMemo, createSignal } from "solid-js";
import {
  alpha,
  BORDER,
  SURFACE,
  TEXT_MUTED,
  TOOLTIP_BG,
  TOOLTIP_BORDER,
  TOOLTIP_TEXT,
} from "@/ui/palette";
import { typeSize } from "@/ui/typography";
import type { SectorHistorySeries } from "../../../../types/sectorHistory";
import { EChart } from "../../../common/EChart";
import { CHART_CURRENT, CHART_LINE, CHART_TOP3 } from "./chartPalette";
import { useScrollHint } from "./matrices/useScrollHint";
import { finite, monthIndex, yearOf } from "./shared";

const LABEL_FONT = typeSize("micro");
const CHART_MIN_WIDTH = 900;
export const ROTATION_ROW_HEIGHT = 36;
export const ROTATION_ROW_GAP = 4;
export const ROTATION_PLOT_TOP = 6;
export const ROTATION_PLOT_HEIGHT = 24;
export const ROTATION_CHART_TOP = 4;
export const ROTATION_AXIS_HEIGHT = 24;
export const ROTATION_TOP_BAND_FILL = alpha(CHART_TOP3, 0.18);
export const ROTATION_TOP_BAND_BORDER = alpha(CHART_TOP3, 0.35);
const TOP_BAND_END = 3.5;

export interface RotationTimelineProps {
  months: string[];
  series: SectorHistorySeries[];
}

export interface RotationTimelineInput {
  months: string[];
  series: SectorHistorySeries[];
}

export interface RotationRow {
  name: string;
  ranks: (number | null)[];
  currentRank: number | null;
}

export interface RotationTimelineModel {
  hasData: boolean;
  rows: RotationRow[];
  rankMax: number;
  latestMonthIndex: number;
  latestMonth: string | null;
}

export interface RotationTooltipParam {
  axisValue?: string;
  name?: string;
  seriesName?: string;
  value?: unknown;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Year starts carry the year; July gives one mid-year anchor; the rest stay blank. */
function monthAxisLabel(value: string): string {
  if (!yearOf(value)) return value;
  const index = monthIndex(value);
  if (index === 0) return yearOf(value);
  return index === 6 ? "Jul" : "";
}

function rankOf(value: unknown): number | null {
  const raw = Array.isArray(value) ? value[value.length - 1] : value;
  if (raw === null || raw === undefined || raw === "") return null;
  const rank = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(rank) ? rank : null;
}

export function formatRotationTooltip(
  params: RotationTooltipParam | RotationTooltipParam[],
): string {
  const list = Array.isArray(params) ? params : [params];
  const item = list.find((entry) => rankOf(entry.value) !== null);
  if (!item) return "";
  const month = item.axisValue ?? item.name ?? "";
  return `${escapeHtml(month)} · ${escapeHtml(item.seriesName ?? "")} · rank ${Math.round(rankOf(item.value)!)}`;
}

export function buildRotationModel(input: RotationTimelineInput): RotationTimelineModel {
  const months = input.months;
  const sectors = input.series.filter((item) => !item.is_benchmark);
  const rows: RotationRow[] = sectors.map((sector) => {
    const ranks = months.map((_, index) => {
      const rank = sector.ranks[index];
      return finite(rank) ? rank : null;
    });
    let currentRank: number | null = null;
    for (let index = ranks.length - 1; index >= 0; index--) {
      if (finite(ranks[index])) {
        currentRank = ranks[index];
        break;
      }
    }
    return { name: sector.name, ranks, currentRank };
  });

  const observed = rows.flatMap((row) => row.ranks).filter(finite);
  const rankMax = Math.max(3, rows.length, ...observed);

  let latestMonthIndex = -1;
  for (let index = months.length - 1; index >= 0; index--) {
    if (rows.some((row) => finite(row.ranks[index]))) {
      latestMonthIndex = index;
      break;
    }
  }

  return {
    hasData: months.length > 0 && rows.length > 0 && observed.length > 0,
    rows,
    rankMax,
    latestMonthIndex,
    latestMonth: latestMonthIndex >= 0 ? months[latestMonthIndex] : null,
  };
}

export function buildRotationOption(input: RotationTimelineInput): Record<string, unknown> {
  const model = buildRotationModel(input);
  const months = input.months;
  const lastRow = model.rows.length - 1;

  const grids = model.rows.map((_, index) => ({
    left: 6,
    right: 8,
    top:
      ROTATION_CHART_TOP +
      index * (ROTATION_ROW_HEIGHT + ROTATION_ROW_GAP) +
      ROTATION_PLOT_TOP,
    height: ROTATION_PLOT_HEIGHT,
    containLabel: false,
  }));

  const xAxes = model.rows.map((_, index) => ({
    type: "category",
    gridIndex: index,
    data: months,
    boundaryGap: false,
    axisLine: { show: index === lastRow, lineStyle: { color: BORDER } },
    axisTick: { show: false },
    axisLabel: {
      show: index === lastRow,
      color: TEXT_MUTED,
      fontSize: LABEL_FONT,
      hideOverlap: true,
      interval: 0,
      margin: 6,
      formatter: (value: string) => monthAxisLabel(value),
    },
    splitLine: {
      show: true,
      interval: (_index: number, value: string) => monthIndex(value) === 0,
      lineStyle: { color: alpha(BORDER, 0.55), width: 0.5 },
    },
  }));

  const yAxes = model.rows.map((_, index) => ({
    type: "value",
    gridIndex: index,
    inverse: true,
    min: 1,
    max: model.rankMax,
    interval: 1,
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { show: false },
    splitLine: { show: false },
  }));

  const series = model.rows.map((row, index) => ({
    name: row.name,
    type: "line",
    gridIndex: index,
    xAxisIndex: index,
    yAxisIndex: index,
    data: row.ranks.map((rank) => {
      const top = finite(rank) && rank <= 3;
      return {
        value: rank,
        symbolSize: top ? 4 : 2,
        itemStyle: top
          ? { color: CHART_TOP3, opacity: 1, borderColor: SURFACE, borderWidth: 1 }
          : { color: CHART_LINE, opacity: 0.35 },
      };
    }),
    connectNulls: false,
    symbol: "circle",
    symbolSize: 2,
    showSymbol: true,
    lineStyle: { color: CHART_LINE, width: 1.4, opacity: 0.8 },
    emphasis: { focus: "series", lineStyle: { width: 2 } },
    markArea: {
      silent: true,
      itemStyle: {
        color: ROTATION_TOP_BAND_FILL,
        borderColor: ROTATION_TOP_BAND_BORDER,
        borderWidth: 0.5,
      },
      data: [[{ yAxis: 0.5 }, { yAxis: TOP_BAND_END }]],
    },
    z: 2,
  }));

  return {
    animation: false,
    backgroundColor: "transparent",
    aria: {
      enabled: true,
      label: {
        description:
          "Rank history by sector. Each row is a sector; higher is stronger; " +
          "rank ticks at the left mark the scale and the shaded band is the top 3. " +
          "Hover a month to read its exact rank.",
      },
    },
    grid: grids,
    xAxis: xAxes,
    yAxis: yAxes,
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: TOOLTIP_BG,
      borderColor: TOOLTIP_BORDER,
      textStyle: { color: TOOLTIP_TEXT, fontSize: LABEL_FONT },
      formatter: (params: RotationTooltipParam | RotationTooltipParam[]) =>
        formatRotationTooltip(params),
    },
    series,
  };
}

/**
 * D3-gallery small multiples: one rank strip per sector, direct HTML labels and
 * no categorical palette — identity comes from the row, not a colour legend.
 */
export function RotationTimeline(props: RotationTimelineProps) {
  const model = createMemo(() =>
    buildRotationModel({ months: props.months, series: props.series }),
  );
  const option = createMemo(() =>
    buildRotationOption({ months: props.months, series: props.series }),
  );
  const [selectedMonth, setSelectedMonth] = createSignal<string | null>(null);
  const hint = useScrollHint();

  const activeMonth = createMemo(() => {
    const chosen = selectedMonth();
    if (chosen && props.months.includes(chosen)) return chosen;
    return model().latestMonth ?? props.months[props.months.length - 1] ?? "";
  });
  const activeMonthIndex = createMemo(() => props.months.indexOf(activeMonth()));

  const rowsAt = (monthIndex: number) =>
    Array.from({ length: 3 }, (_, index) => {
      const rank = index + 1;
      const row = model().rows.find((item) => item.ranks[monthIndex] === rank);
      return { rank, name: row?.name ?? null };
    });

  const currentRows = createMemo(() => rowsAt(model().latestMonthIndex));
  const inspectorRows = createMemo(() => rowsAt(activeMonthIndex()));
  const chartHeight = createMemo(
    () =>
      ROTATION_CHART_TOP +
      model().rows.length * (ROTATION_ROW_HEIGHT + ROTATION_ROW_GAP) -
      ROTATION_ROW_GAP +
      ROTATION_AXIS_HEIGHT,
  );
  const bottomSpacer = ROTATION_AXIS_HEIGHT - ROTATION_ROW_GAP;
  const rankTicks = createMemo(() =>
    Array.from({ length: model().rankMax }, (_, index) => index + 1),
  );
  const rankSpacing = () => ROTATION_PLOT_HEIGHT / Math.max(1, model().rankMax - 1);
  const rankTop = (rank: number) =>
    ROTATION_PLOT_TOP + ((rank - 1) / Math.max(1, model().rankMax - 1)) * ROTATION_PLOT_HEIGHT;
  // Labels share one 12px line each; only show the ones the top-3 band has room for.
  const showRankLabel = (rank: number) => {
    if (rank > 3) return false;
    if (rank === 1) return true;
    if (rank === 2) return rankSpacing() >= 12;
    return rankSpacing() >= 6;
  };

  return (
    <div class="flex min-w-0 flex-col gap-1">
      <Show
        when={model().hasData}
        fallback={
          <div
            data-testid="history-rotation-timeline"
            class="py-3 text-center text-ui-micro text-fin-text-muted"
          >
            <div data-testid="history-rotation-timeline-empty">No rotation history</div>
          </div>
        }
      >
        <div class="flex flex-col gap-0.5">
          <span class="text-ui-micro font-semibold text-fin-text">Rank history by sector</span>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span class="text-ui-micro text-fin-text-muted">
              Each row is a sector · higher is stronger · rank ticks at left · shaded band = top 3
            </span>
            <span
              data-testid="history-rotation-band-key"
              class="inline-flex items-center gap-1 text-ui-micro text-fin-text-muted"
            >
              <span
                data-testid="history-rotation-band-swatch"
                aria-hidden="true"
                class="inline-block h-2 w-2 rounded-sm border"
                style={{
                  "background-color": ROTATION_TOP_BAND_FILL,
                  "border-color": ROTATION_TOP_BAND_BORDER,
                }}
              />
              top 3
            </span>
          </div>
        </div>

        <div
          data-testid="history-rotation-current"
          class="flex flex-wrap items-baseline gap-x-2 text-ui-micro text-fin-text-muted"
        >
          <span
            data-testid="history-rotation-current-badge"
            class="inline-flex items-center rounded-sm border px-1 font-mono text-ui-micro"
            style={{
              color: CHART_CURRENT,
              "border-color": alpha(CHART_CURRENT, 0.5),
              "background-color": alpha(CHART_CURRENT, 0.15),
            }}
          >
            {model().latestMonth}
          </span>
          <For each={currentRows()}>
            {(item) => <span>{`#${item.rank} ${item.name ?? "no rank"}`}</span>}
          </For>
        </div>

        <div
          aria-hidden="true"
          data-testid="history-rotation-scroll-hint"
          class={`mb-0.5 items-center justify-end ${hint.overflowing() ? "flex" : "hidden"}`}
        >
          <span class="rounded-[1px] border border-fin-border bg-fin-surface-alt px-1 py-px text-ui-micro text-fin-text-muted">
            {hint.atEnd() ? "Scroll ←" : "Scroll →"}
          </span>
        </div>

        <div class="flex w-full min-w-0 items-start gap-1">
          <div
            data-testid="history-rotation-rail"
            class="sticky left-0 z-10 flex shrink-0 flex-col border-r border-fin-border bg-fin-surface"
            style={{ width: "150px" }}
          >
            <div style={{ height: `${ROTATION_CHART_TOP}px` }} />
            <For each={model().rows}>
              {(row, index) => (
                <div
                  class="flex items-center"
                  style={{
                    height: `${ROTATION_ROW_HEIGHT}px`,
                    "margin-bottom": `${ROTATION_ROW_GAP}px`,
                  }}
                >
                  <span
                    class={
                      row.currentRank !== null && row.currentRank <= 3
                        ? "min-w-0 flex-1 truncate text-ui-micro text-fin-text"
                        : "min-w-0 flex-1 truncate text-ui-micro text-fin-text-muted"
                    }
                    title={row.name}
                  >
                    {row.name}
                  </span>
                  <div
                    data-testid={`history-rotation-ranks-${index()}`}
                    class="relative h-full w-9 shrink-0"
                  >
                    <For each={rankTicks()}>
                      {(rank) => (
                        <div
                          data-testid={`history-rotation-rank-tick-${index()}-${rank}`}
                          class="absolute right-0 flex items-center justify-end gap-0.5"
                          style={{
                            top: `${rankTop(rank)}px`,
                            transform: "translateY(-50%)",
                          }}
                        >
                          <Show when={showRankLabel(rank)}>
                            <span
                              data-testid={`history-rotation-rank-label-${index()}-${rank}`}
                              class="font-mono text-ui-micro leading-none tabular-nums text-fin-text-muted"
                            >
                              {`#${rank}`}
                            </span>
                          </Show>
                          <span
                            aria-hidden="true"
                            class="h-px w-1.5 shrink-0 bg-fin-border"
                          />
                        </div>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
            <div style={{ height: `${bottomSpacer}px` }} />
          </div>

          <div
            ref={hint.setRef}
            data-testid="history-rotation-scroll"
            role="region"
            tabIndex={0}
            aria-label="Rotation timeline chart. Scroll sideways for all months."
            class="min-w-0 flex-1 overflow-x-auto focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-primary"
          >
            <div
              class="min-w-0 overflow-hidden"
              style={{ "min-width": `${CHART_MIN_WIDTH}px`, height: `${chartHeight()}px` }}
            >
              <EChart
                option={option()}
                data-testid="history-rotation-timeline"
                style={{
                  height: `${chartHeight()}px`,
                  flex: "none",
                  width: "100%",
                  "min-height": "0px",
                  position: "relative",
                  overflow: "hidden",
                }}
              />
            </div>
          </div>

          <div
            data-testid="history-rotation-badges"
            class="flex shrink-0 flex-col"
            style={{ width: "44px" }}
          >
            <div style={{ height: `${ROTATION_CHART_TOP}px` }} />
            <For each={model().rows}>
              {(row, index) => (
                <div
                  class="flex items-center justify-end"
                  style={{
                    height: `${ROTATION_ROW_HEIGHT}px`,
                    "margin-bottom": `${ROTATION_ROW_GAP}px`,
                  }}
                >
                  <span
                    data-testid={`history-rotation-badge-${index()}`}
                    data-top3={row.currentRank !== null && row.currentRank <= 3 ? "true" : "false"}
                    aria-label={`Current rank ${row.currentRank ?? "none"}`}
                    class={
                      row.currentRank !== null && row.currentRank <= 3
                        ? "inline-flex h-4 min-w-6 items-center justify-center rounded-sm border px-1 font-mono text-ui-micro tabular-nums"
                        : "inline-flex h-4 min-w-6 items-center justify-center rounded-sm border border-fin-border bg-fin-surface-alt px-1 font-mono text-ui-micro tabular-nums text-fin-text-muted"
                    }
                    style={
                      row.currentRank !== null && row.currentRank <= 3
                        ? {
                            "border-color": alpha(CHART_CURRENT, 0.5),
                            "background-color": alpha(CHART_CURRENT, 0.15),
                            color: CHART_CURRENT,
                          }
                        : undefined
                    }
                  >
                    {row.currentRank !== null ? `#${row.currentRank}` : "—"}
                  </span>
                </div>
              )}
            </For>
            <div style={{ height: `${bottomSpacer}px` }} />
          </div>
        </div>

        <div
          data-testid="history-rotation-inspector"
          class="flex flex-wrap items-center gap-x-3 gap-y-1"
        >
          <label class="inline-flex items-center gap-1.5 text-ui-micro text-fin-text-muted">
            <span>Month</span>
            <select
              data-testid="history-rotation-month"
              aria-label="Inspect rotation month"
              class="h-6 rounded-fin border border-fin-border bg-fin-surface px-1.5 font-mono text-ui-micro text-fin-text"
              value={activeMonth()}
              onChange={(event) => setSelectedMonth(event.currentTarget.value)}
            >
              <For each={props.months}>{(month) => <option value={month}>{month}</option>}</For>
            </select>
          </label>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1" role="list">
            <For each={inspectorRows()}>
              {(row) => (
                <span
                  role="listitem"
                  data-testid={`history-rotation-inspector-${row.rank}`}
                  aria-label={`#${row.rank} ${row.name ?? "no rank"}`}
                  class="inline-flex items-center gap-1 text-ui-micro"
                >
                  <span class="font-mono tabular-nums text-fin-text-muted">{`#${row.rank}`}</span>
                  <span class={row.name ? "text-fin-text" : "text-fin-text-muted"}>
                    {row.name ?? "no rank"}
                  </span>
                </span>
              )}
            </For>
          </div>
        </div>
      </Show>
    </div>
  );
}
