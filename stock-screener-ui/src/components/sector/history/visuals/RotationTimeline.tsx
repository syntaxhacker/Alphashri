import { For, Show, createMemo, createSignal } from "solid-js";
import {
  alpha,
  BORDER,
  INFO,
  PRIMARY,
  SCALE_CYAN,
  SCALE_GRAPE,
  SCALE_INDIGO,
  SCALE_LIME,
  SCALE_ORANGE,
  SCALE_PINK,
  SCALE_TEAL,
  SCALE_VIOLET,
  SCALE_YELLOW,
  SURFACE,
  SURFACE_ALT,
  TEXT,
  TEXT_MUTED,
  TOOLTIP_BG,
  TOOLTIP_BORDER,
  TOOLTIP_TEXT,
} from "@/ui/palette";
import { typeSize } from "@/ui/typography";
import type { SectorHistorySeries } from "../../../../types/sectorHistory";
import { EChart } from "../../../common/EChart";
import { monthIndex, yearOf } from "./shared";

const LABEL_FONT = typeSize("micro");
const CHART_HEIGHT = 230;
const CHART_MIN_WIDTH = 900;
const MAX_RANK_ROWS = 3;

/** Background heatmap keeps the month × rank lattice visible through gaps. */
export const ROTATION_BACKGROUND_SERIES = "__rotation-matrix-background";
export const ROTATION_MATRIX_SERIES = "Leadership";

/**
 * Categorical hues only: green/red stay reserved for return semantics. Values
 * come from distinct scales/steps so ten historical leaders cannot share a hue.
 */
const LEADER_COLORS = [
  PRIMARY,
  INFO,
  SCALE_PINK[4],
  SCALE_TEAL[2],
  SCALE_VIOLET[4],
  SCALE_LIME[4],
  SCALE_ORANGE[3],
  SCALE_CYAN[4],
  SCALE_GRAPE[1],
  SCALE_INDIGO[5],
  SCALE_YELLOW[1],
  SCALE_VIOLET[6],
];

export interface RotationTimelineProps {
  months: string[];
  series: SectorHistorySeries[];
  topN?: number;
}

export interface RotationTimelineInput {
  months: string[];
  series: SectorHistorySeries[];
  topN?: number;
}

export interface RotationLeader {
  name: string;
  color: string;
  sectorIndex: number;
}

export interface RotationCell {
  monthIndex: number;
  month: string;
  rankIndex: number;
  rank: number;
  sectorIndex: number;
  sector: string;
  color: string;
}

export interface RotationCurrentLeader {
  rank: number;
  name: string;
  color: string;
}

export interface RotationInspectorRow {
  rank: number;
  name: string | null;
  color: string | null;
}

export interface RotationTimelineModel {
  hasData: boolean;
  rowCount: number;
  cells: RotationCell[];
  leaders: RotationLeader[];
  current: RotationCurrentLeader[];
  latestMonth: string | null;
}

export interface RotationTooltipParam {
  data?: unknown;
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

export function formatRotationTooltip(params: RotationTooltipParam): string {
  const data = params.data as Partial<RotationCell> | undefined;
  if (
    !data ||
    typeof data.month !== "string" ||
    typeof data.rank !== "number" ||
    typeof data.sector !== "string"
  ) {
    return "";
  }
  return `${escapeHtml(data.month)} · #${data.rank} · ${escapeHtml(data.sector)}`;
}

export function buildRotationModel(input: RotationTimelineInput): RotationTimelineModel {
  const months = input.months;
  const sectors = input.series.filter((item) => !item.is_benchmark);
  const rowCount = Math.min(MAX_RANK_ROWS, Math.max(1, Math.round(input.topN ?? MAX_RANK_ROWS)));
  const colored = sectors.map((sector, sectorIndex) => ({
    sector,
    sectorIndex,
    color: LEADER_COLORS[sectorIndex % LEADER_COLORS.length],
  }));

  const cells: RotationCell[] = [];
  months.forEach((month, monthIndex) => {
    for (let rankIndex = 0; rankIndex < rowCount; rankIndex++) {
      const rank = rankIndex + 1;
      const match = colored.find((item) => item.sector.ranks[monthIndex] === rank);
      if (!match) continue;
      cells.push({
        monthIndex,
        month,
        rankIndex,
        rank,
        sectorIndex: match.sectorIndex,
        sector: match.sector.name,
        color: match.color,
      });
    }
  });

  const appearing = new Set(cells.map((cell) => cell.sectorIndex));
  const leaders: RotationLeader[] = colored
    .filter((item) => appearing.has(item.sectorIndex))
    .map((item) => ({ name: item.sector.name, color: item.color, sectorIndex: item.sectorIndex }));

  let latestMonthIndex = -1;
  for (let index = months.length - 1; index >= 0; index--) {
    if (cells.some((cell) => cell.monthIndex === index)) {
      latestMonthIndex = index;
      break;
    }
  }
  const current: RotationCurrentLeader[] = cells
    .filter((cell) => cell.monthIndex === latestMonthIndex)
    .sort((a, b) => a.rankIndex - b.rankIndex)
    .map((cell) => ({ rank: cell.rank, name: cell.sector, color: cell.color }));

  return {
    hasData: months.length > 0 && cells.length > 0,
    rowCount,
    cells,
    leaders,
    current,
    latestMonth: latestMonthIndex >= 0 ? months[latestMonthIndex] : null,
  };
}

export function buildRotationOption(input: RotationTimelineInput): Record<string, unknown> {
  const model = buildRotationModel(input);
  const months = input.months;
  const rankLabels = Array.from({ length: model.rowCount }, (_, index) => `#${index + 1}`);

  const background = months.flatMap((_, monthIndex) =>
    Array.from({ length: model.rowCount }, (_, rankIndex) => ({
      value: [monthIndex, rankIndex, -1],
      itemStyle: {
        borderColor: alpha(BORDER, 0.45),
        borderWidth: 0.5,
        borderRadius: 2,
      },
    })),
  );

  const cells = model.cells.map((cell) => ({
    value: [cell.monthIndex, cell.rankIndex, cell.sectorIndex],
    month: cell.month,
    rank: cell.rank,
    sector: cell.sector,
    itemStyle: {
      borderColor: cell.rank === 1 ? alpha(TEXT_MUTED, 0.9) : SURFACE,
      borderWidth: cell.rank === 1 ? 1.5 : 1,
      borderRadius: 2,
    },
  }));

  return {
    animation: false,
    backgroundColor: "transparent",
    aria: {
      enabled: true,
      label: {
        description:
          `Top ${model.rowCount} sector leadership matrix by month. ` +
          `Rank 1 is strongest; rank, not return. Missing ranks leave a gap.`,
      },
    },
    // ECharts rejects a heatmap series with no visualMap; this one also owns the
    // empty-slot colour (-1) so the lattice needs no second map.
    visualMap: {
      type: "piecewise",
      show: false,
      dimension: 2,
      seriesIndex: [0, 1],
      pieces: [
        { value: -1, color: alpha(SURFACE_ALT, 0.45) },
        ...model.leaders.map((leader) => ({ value: leader.sectorIndex, color: leader.color })),
      ],
      outOfRange: { color: alpha(SURFACE_ALT, 0.45) },
    },
    grid: { left: 6, right: 10, top: 8, bottom: 4, containLabel: true },
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: TOOLTIP_BG,
      borderColor: TOOLTIP_BORDER,
      textStyle: { color: TOOLTIP_TEXT, fontSize: LABEL_FONT },
      formatter: (params: RotationTooltipParam) => formatRotationTooltip(params),
    },
    xAxis: {
      type: "category",
      data: months,
      axisLine: { lineStyle: { color: BORDER } },
      axisTick: { show: false },
      axisLabel: {
        color: TEXT_MUTED,
        fontSize: LABEL_FONT,
        hideOverlap: true,
        interval: 0,
        margin: 8,
        formatter: (value: string) => monthAxisLabel(value),
      },
      splitLine: {
        show: true,
        interval: (_index: number, value: string) => monthIndex(value) === 0,
        lineStyle: { color: alpha(BORDER, 0.75), width: 1 },
      },
    },
    yAxis: {
      type: "category",
      data: rankLabels,
      inverse: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: TEXT_MUTED,
        fontSize: LABEL_FONT,
        formatter: (value: string) => (value === "#1" ? `{top|${value}}` : `{rest|${value}}`),
        rich: {
          top: { color: TEXT, fontWeight: "bold", fontSize: LABEL_FONT },
          rest: { color: TEXT_MUTED, fontSize: LABEL_FONT },
        },
      },
      splitLine: { show: true, lineStyle: { color: alpha(BORDER, 0.55), width: 0.5 } },
    },
    series: [
      {
        name: ROTATION_BACKGROUND_SERIES,
        type: "heatmap",
        data: background,
        silent: true,
        tooltip: { show: false },
        emphasis: { disabled: true },
        z: 0,
      },
      {
        name: ROTATION_MATRIX_SERIES,
        type: "heatmap",
        data: cells,
        label: { show: false },
        itemStyle: { borderColor: SURFACE, borderWidth: 1, borderRadius: 2 },
        emphasis: { itemStyle: { borderColor: TEXT_MUTED, borderWidth: 2 } },
        z: 2,
      },
    ],
  };
}

/**
 * A month × rank matrix, not a line chart: one coloured cell per occupied rank
 * slot, so a nine-leader history cannot collapse into grey spaghetti.
 */
export function RotationTimeline(props: RotationTimelineProps) {
  const model = createMemo(() =>
    buildRotationModel({ months: props.months, series: props.series, topN: props.topN }),
  );
  const option = createMemo(() =>
    buildRotationOption({ months: props.months, series: props.series, topN: props.topN }),
  );
  const [selectedMonth, setSelectedMonth] = createSignal<string | null>(null);

  const activeMonth = createMemo(() => {
    const chosen = selectedMonth();
    if (chosen && props.months.includes(chosen)) return chosen;
    return model().latestMonth ?? props.months[props.months.length - 1] ?? "";
  });

  const inspectorRows = createMemo<RotationInspectorRow[]>(() => {
    const month = activeMonth();
    return Array.from({ length: model().rowCount }, (_, index) => {
      const rank = index + 1;
      const cell = model().cells.find((item) => item.month === month && item.rank === rank);
      return { rank, name: cell?.sector ?? null, color: cell?.color ?? null };
    });
  });

  return (
    <div
      class="flex min-w-0 flex-col gap-1"
      data-testid={model().hasData ? undefined : "history-rotation-timeline"}
    >
      <Show
        when={model().hasData}
        fallback={
          <div
            data-testid="history-rotation-timeline-empty"
            class="py-3 text-center text-ui-micro text-fin-text-muted"
          >
            No rotation history
          </div>
        }
      >
        <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span class="text-ui-micro font-semibold text-fin-text">
            Top {model().rowCount} leadership · rank, not return
          </span>
          <span class="text-ui-micro text-fin-text-muted">{model().latestMonth}</span>
        </div>

        <div
          data-testid="history-rotation-current"
          class="flex flex-wrap items-center gap-x-3 gap-y-1"
        >
          <For each={model().current}>
            {(leader) => (
              <span
                class="inline-flex items-center gap-1 text-ui-micro text-fin-text"
                aria-label={`#${leader.rank} ${leader.name}`}
              >
                <span
                  aria-hidden="true"
                  class="inline-block h-2 w-2 shrink-0 rounded-sm"
                  style={{ "background-color": leader.color }}
                />
                <span class="font-mono tabular-nums">{`#${leader.rank}`}</span>
                <span>{leader.name}</span>
              </span>
            )}
          </For>
        </div>

        <div
          data-testid="history-rotation-legend"
          aria-label="Sector colours"
          class="flex flex-wrap items-center gap-x-2 gap-y-0.5"
        >
          <span class="hidden shrink-0 text-ui-micro text-fin-text-muted sm:inline">Sectors</span>
          <For each={model().leaders}>
            {(leader) => (
              <span class="inline-flex shrink-0 items-center gap-1 text-ui-micro text-fin-text-muted">
                <span
                  aria-hidden="true"
                  class="inline-block h-2 w-2 rounded-sm"
                  style={{ "background-color": leader.color }}
                />
                {leader.name}
              </span>
            )}
          </For>
        </div>

        <div class="flex flex-col gap-0.5">
          <span class="text-ui-micro text-fin-text-muted">
            Cells are the sector ranked #1–#3 that month · missing = no rank
          </span>
          <span
            data-testid="history-rotation-scroll-hint"
            class="text-ui-micro text-fin-text-muted sm:hidden"
          >
            Scroll →
          </span>
        </div>

        <div data-testid="history-rotation-scroll" class="w-full overflow-x-auto">
          <div style={{ "min-width": `${CHART_MIN_WIDTH}px`, width: "100%" }}>
            <EChart
              option={option()}
              data-testid="history-rotation-timeline"
              style={{
                height: `${CHART_HEIGHT}px`,
                flex: "none",
                width: "100%",
                "min-height": "0px",
              }}
            />
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
                  <span
                    aria-hidden="true"
                    class="inline-block h-2 w-2 rounded-sm border border-fin-border"
                    style={{ "background-color": row.color ?? "transparent" }}
                  />
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
