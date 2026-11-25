import { For, Show, createEffect, createMemo, createUniqueId, on } from "solid-js";
import { useMediaQuery } from "@/ui/hooks";
import { BORDER, SCALE_GRAY, SURFACE, TEXT_MUTED } from "@/ui/palette";
import { pickTextColor } from "@/utils/contrast";
import { rankAt } from "../historyMath";
import type { SectorHistorySeries } from "../../../../types/sectorHistory";
import { RANK_STOPS, CHART_CURRENT, rankColor } from "./chartPalette";
import { labelWidthFor } from "./matrices/labelWidth";
import { MatrixFrame } from "./matrices/MatrixFrame";
import { useRovingGrid } from "./matrices/useRovingGrid";
import { SVG_TEXT, monthIndex, monthName, yearOf } from "./shared";

const CELL_W = 20;
/** A desktop 3Y board has room to breathe; narrow and longer lookbacks stay dense. */
const CELL_W_3Y = 34;
const CELL_H = 22;

/** Short display label for the sticky rail only; identity stays in `title`/aria. */
function railName(name: string, compact: boolean): string {
  if (!compact) return name;
  if (name === "US Consumer Discretionary") return "US Cons. Disc.";
  if (name === "US Consumer Staples") return "US Cons. Staples";
  return name;
}
const YEAR_ROW_H = 16;
const MONTH_ROW_H = 18;
const HEADER_H = YEAR_ROW_H + MONTH_ROW_H;
const EMPTY_W = 320;
const EMPTY_H = 92;
const QUARTER_MONTHS = 3;
const TOP_RANKS = 3;
/** Right gutter keeps the final quarter label and current-column outline off the clip edge. */
const RANK_RIGHT_PAD = 6;

export interface SectorRankHeatmapProps {
  months: string[];
  series: SectorHistorySeries[];
  /** Set false when the host renders `SectorRankSummary` outside the scrollport. */
  showSummary?: boolean;
}

export interface SectorRankSummaryProps {
  months: string[];
  series: SectorHistorySeries[];
}

interface RankCell {
  key: string;
  index: number;
  rank: number | null;
  label: string;
  fill: string;
  ink: string;
  top3: boolean;
}

interface RankRow {
  key: string;
  index: number;
  name: string;
  cells: RankCell[];
}

interface LatestRank {
  rank: number;
  name: string;
}

/** Newest-month top ranks in display order, shared by the heatmap and the summary. */
function latestRanks(sectors: SectorHistorySeries[], latestIndex: number): LatestRank[] {
  if (latestIndex < 0) return [];
  return sectors
    .map((sector, order) => ({
      name: sector.name,
      rank: rankAt(sector, latestIndex),
      order,
    }))
    .filter((item): item is { name: string; rank: number; order: number } => item.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, TOP_RANKS)
    .map((item) => ({ rank: Math.round(item.rank), name: item.name }));
}

export function SectorRankHeatmap(props: SectorRankHeatmapProps) {
  const cellIdBase = `history-rank-cell-${createUniqueId()}`;
  const compact = useMediaQuery("(max-width: 640px)", undefined, { noSsr: true });

  const model = createMemo(() => {
    const months = props.months;
    const sectors = props.series.filter((item) => !item.is_benchmark);
    const hasData = sectors.length > 0 && months.length > 0;
    const labels = sectors.map((sector) => railName(sector.name, compact()));
    const labelW = labelWidthFor(labels, 140, compact() ? 150 : 210);
    const cellW = compact() ? CELL_W : months.length <= 36 ? CELL_W_3Y : CELL_W;
    const width = hasData ? labelW + months.length * cellW + RANK_RIGHT_PAD : EMPTY_W;
    const height = hasData ? HEADER_H + sectors.length * CELL_H : EMPTY_H;

    const yearMarks = months.reduce<Array<{ index: number; year: string }>>(
      (marks, month, index) => {
        const year = yearOf(month);
        if (index === 0 || year !== yearOf(months[index - 1])) marks.push({ index, year });
        return marks;
      },
      [],
    );

    const quarterMarks = months.reduce<Array<{ index: number; label: string }>>(
      (marks, month, index) => {
        if (!/^\d{4}-\d{2}/.test(month)) return marks;
        if (index === 0 || monthIndex(month) % QUARTER_MONTHS === 0) {
          marks.push({ index, label: monthName(monthIndex(month)) });
        }
        return marks;
      },
      [],
    );

    const rows: RankRow[] = sectors.map((sector, rowIndex) => ({
      key: `${sector.name}-${rowIndex}`,
      index: rowIndex,
      name: sector.name,
      cells: months.map((month, monthIndexValue) => {
        const rank = rankAt(sector, monthIndexValue);
        const label =
          rank === null
            ? `${month} · ${sector.name} · no rank`
            : `${month} · ${sector.name} · rank ${Math.round(rank)}`;
        const fill = rank === null ? SURFACE : rankColor(rank, sectors.length);
        return {
          key: `${sector.name}-${month}`,
          index: monthIndexValue,
          rank,
          label,
          fill,
          ink: rank === null ? TEXT_MUTED : pickTextColor(fill),
          top3: rank !== null && rank <= TOP_RANKS,
        };
      }),
    }));

    const latestIndex = months.length - 1;

    return {
      hasData,
      width,
      height,
      labelW,
      cellW,
      yearMarks,
      quarterMarks,
      rows,
      latestIndex,
      sectorCount: sectors.length,
      topN: Math.min(TOP_RANKS, sectors.length),
    };
  });

  const rankCellId = (row: number, col: number) => `${cellIdBase}-${row}-${col}`;
  const grid = useRovingGrid({
    rows: () => model().rows.length,
    cols: () => props.months.length,
    cellId: rankCellId,
    initial: { row: 0, col: Math.max(0, props.months.length - 1) },
  });

  // A lookback change grows the grid in place. Move the single tab stop to the
  // new newest column so keyboard focus lands in the visible pinned window.
  createEffect(
    on(
      () => props.months.length,
      (length) => {
        if (length <= 0) return;
        grid.setActive(grid.active().row, length - 1);
      },
      { defer: true },
    ),
  );

  return (
    <div class="history-rank-heatmap min-w-0" style={{ "min-width": `${model().width}px` }}>
      <div data-testid="history-rank-layout" class="flex flex-wrap items-start gap-4">
        <div
          data-testid="history-rank-chart"
          class="min-w-0"
          style={{ flex: "0 0 auto", width: `${model().width}px` }}
        >
          <MatrixFrame
            testId="history-rank-heatmap"
            title={
              model().hasData
                ? `Sector rank heatmap, ${model().sectorCount} sectors across ${props.months.length} months. Rank 1 is strongest and light outlines mark the top ${model().topN}.`
                : "Sector rank heatmap, no data"
            }
            desc={`Rows are sectors and columns are months, grouped by year and labelled at each quarter. Green marks a high rank (1 is strongest), red marks a low rank, and the middle of the field is neutral. A light ink outline marks ranks 1 through ${model().topN}. The dashed cyan outline marks the current month. Missing ranks leave the cell empty. The current key names the latest month's top ${model().topN}. Cells are keyboard-focusable and announce the month, sector and rank.`}
            width={model().width}
            height={model().height}
            empty={
              <text
                x={model().width / 2}
                y={model().height / 2}
                font-size={SVG_TEXT}
                fill={TEXT_MUTED}
                text-anchor="middle"
                dominant-baseline="central"
              >
                No sector history
              </text>
            }
          >
            {model().hasData ? (
              <g>
                <For each={model().yearMarks}>
                  {(mark) => (
                    <text
                      x={model().labelW + mark.index * model().cellW + 2}
                      y={12}
                      font-size={SVG_TEXT}
                      font-weight={700}
                      fill={TEXT_MUTED}
                    >
                      {mark.year}
                    </text>
                  )}
                </For>

                <For each={model().quarterMarks}>
                  {(mark) => (
                    <g>
                      <text
                        x={model().labelW + mark.index * model().cellW + 2}
                        y={HEADER_H - 5}
                        font-size={SVG_TEXT}
                        fill={SCALE_GRAY[2]}
                      >
                        {mark.label}
                      </text>
                      <Show when={mark.index > 0 && monthIndex(props.months[mark.index]) !== 0}>
                        <line
                          x1={model().labelW + mark.index * model().cellW}
                          x2={model().labelW + mark.index * model().cellW}
                          y1={HEADER_H - 3}
                          y2={HEADER_H}
                          stroke={BORDER}
                          stroke-width={0.75}
                          shape-rendering="crispEdges"
                        />
                      </Show>
                    </g>
                  )}
                </For>

                <For each={model().yearMarks.filter((mark) => mark.index > 0)}>
                  {(mark) => (
                    <line
                      x1={model().labelW + mark.index * model().cellW}
                      x2={model().labelW + mark.index * model().cellW}
                      y1={0}
                      y2={HEADER_H + model().rows.length * CELL_H}
                      stroke={BORDER}
                      stroke-width={0.5}
                      shape-rendering="crispEdges"
                    />
                  )}
                </For>

                <For each={model().rows}>
                  {(sector) => {
                    const rowY = () => HEADER_H + sector.index * CELL_H;
                    return (
                      <g>
                        <text
                          x={model().labelW - 6}
                          y={rowY() + CELL_H / 2}
                          font-size={SVG_TEXT}
                          fill={TEXT_MUTED}
                          text-anchor="end"
                          dominant-baseline="central"
                          aria-label={sector.name}
                        >
                          <title>{sector.name}</title>
                          {sector.name}
                        </text>
                        <For each={sector.cells}>
                          {(cell) => {
                            const cellX = () => model().labelW + cell.index * model().cellW;
                            return (
                              <g>
                                <rect
                                  id={rankCellId(sector.index, cell.index)}
                                  data-cell={`rank-${sector.index}-${cell.index}`}
                                  data-top3={cell.top3 ? "true" : "false"}
                                  x={cellX()}
                                  y={rowY()}
                                  width={model().cellW}
                                  height={CELL_H}
                                  fill={cell.fill}
                                  stroke={BORDER}
                                  stroke-width={0.5}
                                  shape-rendering="crispEdges"
                                  role="img"
                                  tabindex={grid.tabIndex(sector.index, cell.index)}
                                  aria-label={cell.label}
                                  onFocus={() => grid.setActive(sector.index, cell.index)}
                                  onKeyDown={(event) =>
                                    grid.onKeyDown(event, sector.index, cell.index)
                                  }
                                >
                                  <title>{cell.label}</title>
                                </rect>
                                <Show when={cell.top3}>
                                  <rect
                                    data-top3-outline="true"
                                    x={cellX() + 1.25}
                                    y={rowY() + 1.25}
                                    width={model().cellW - 2.5}
                                    height={CELL_H - 2.5}
                                    fill="none"
                                    stroke={SCALE_GRAY[0]}
                                    stroke-width={2}
                                    shape-rendering="crispEdges"
                                    pointer-events="none"
                                    aria-hidden="true"
                                  />
                                </Show>
                                <text
                                  x={cellX() + model().cellW / 2}
                                  y={rowY() + CELL_H / 2}
                                  font-size={SVG_TEXT}
                                  font-weight={cell.top3 ? 700 : 500}
                                  fill={cell.ink}
                                  text-anchor="middle"
                                  dominant-baseline="central"
                                  pointer-events="none"
                                  aria-hidden="true"
                                >
                                  {cell.rank === null ? "–" : Math.round(cell.rank)}
                                </text>
                              </g>
                            );
                          }}
                        </For>
                      </g>
                    );
                  }}
                </For>

                <Show when={model().latestIndex >= 0}>
                  <rect
                    data-latest-column="true"
                    x={model().labelW + model().latestIndex * model().cellW + 0.5}
                    y={HEADER_H}
                    width={model().cellW - 1}
                    height={model().rows.length * CELL_H}
                    fill="none"
                    stroke={CHART_CURRENT}
                    stroke-width={1.5}
                    stroke-dasharray="2 2"
                    shape-rendering="crispEdges"
                    pointer-events="none"
                    aria-hidden="true"
                  />
                </Show>
              </g>
            ) : undefined}
          </MatrixFrame>
          {/* MatrixFrame derives rail testids from the SVG testid; the legacy rank rail id is part of the contract. */}
          <Show when={model().hasData}>
            <div
              data-testid="history-rank-row-rail"
              aria-hidden="true"
              style={{
                position: "sticky",
                left: "0px",
                width: `${model().labelW}px`,
                height: `${HEADER_H + model().rows.length * CELL_H}px`,
                "margin-top": `-${model().height}px`,
                "z-index": "2",
                "background-color": SURFACE,
                "pointer-events": "none",
              }}
            >
              <For each={model().rows}>
                {(sector) => (
                  <div
                    title={sector.name}
                    class="absolute flex w-full items-center justify-end overflow-hidden border-r border-fin-border pr-1.5 font-mono text-ui-micro whitespace-nowrap text-fin-text-muted"
                    style={{
                      top: `${HEADER_H + sector.index * CELL_H}px`,
                      height: `${CELL_H}px`,
                      "box-sizing": "border-box",
                    }}
                  >
                    {railName(sector.name, compact())}
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
        <Show when={props.showSummary !== false}>
          <SectorRankSummary months={props.months} series={props.series} />
        </Show>
      </div>
    </div>
  );
}

/**
 * Latest-month key and legend. The history overview renders this outside the
 * horizontal rank scrollport so a pinned 10Y view cannot push it under the
 * desktop nav; the sticky placement was only needed while it lived inside the
 * scroller.
 */
export function SectorRankSummary(props: SectorRankSummaryProps) {
  const summary = createMemo(() => {
    const sectors = props.series.filter((item) => !item.is_benchmark);
    const latestIndex = props.months.length - 1;
    const latest = latestRanks(sectors, latestIndex);
    const latestMonth = latestIndex >= 0 ? props.months[latestIndex] : "";
    const month = latestMonth ? `${monthName(monthIndex(latestMonth))} ${yearOf(latestMonth)}` : "";
    return {
      hasData: sectors.length > 0 && props.months.length > 0,
      latest,
      latestKey: `Current ${month}: ${latest.map((item) => `#${item.rank} ${item.name}`).join(" · ")}`,
      sectorCount: sectors.length,
      topN: Math.min(TOP_RANKS, sectors.length),
    };
  });

  return (
    <aside
      data-testid="history-rank-aside"
      class="w-full min-w-0"
      style={{ flex: "1 1 100%", "min-width": "200px" }}
    >
      <Show when={summary().hasData && summary().latest.length > 0}>
        <div
          data-testid="history-rank-latest-key"
          class="w-full min-w-0 border-t border-fin-border px-1 pt-1 font-mono text-ui-micro leading-snug text-fin-text-muted"
          style={{ color: CHART_CURRENT }}
        >
          {summary().latestKey}
        </div>
      </Show>
      <Show when={summary().hasData}>
        <div
          data-testid="history-rank-legend"
          class="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 font-mono text-ui-micro text-fin-text-muted"
        >
          <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden="true"
              class="inline-block h-[11px] w-[84px] border border-fin-border"
              style={{
                background: `linear-gradient(90deg, ${RANK_STOPS.join(", ")})`,
              }}
            />
            <span data-testid="history-rank-heatmap-legend">
              {`1 best → ${summary().sectorCount} worst`}
            </span>
          </span>
          <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden="true"
              class="inline-block h-[11px] w-[18px] border-2 bg-fin-surface"
              style={{ "border-color": SCALE_GRAY[0] }}
            />
            <span data-testid="history-rank-top3-legend">{`top ${summary().topN}`}</span>
          </span>
          <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden="true"
              class="inline-block h-[11px] w-[18px] border border-dashed"
              style={{ "border-color": CHART_CURRENT }}
            />
            <span data-testid="history-rank-current-legend" style={{ color: CHART_CURRENT }}>
              dashed = current month
            </span>
          </span>
        </div>
      </Show>
    </aside>
  );
}
