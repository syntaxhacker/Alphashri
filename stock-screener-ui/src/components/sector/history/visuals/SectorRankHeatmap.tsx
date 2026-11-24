import { For, Show, createMemo, createSignal, createUniqueId } from "solid-js";
import { BORDER, MONO, PRIMARY, SCALE_GRAY, SURFACE, TEXT_MUTED } from "@/ui/palette";
import { pickTextColor } from "@/utils/contrast";
import type { SectorHistorySeries } from "../../../../types/sectorHistory";
import { RANK_STOPS, CHART_CURRENT, rankColor } from "./chartPalette";
import { SVG_TEXT, finite, monthIndex, monthName, yearOf } from "./shared";

/** 60 months (5Y) plus a full-name rail stays inside the 1600px panel (1404px content). */
const CELL_W = 20;
const CELL_H = 22;
const LABEL_MIN_W = 140;
const LABEL_MAX_W = 210;
const LABEL_CHAR_W = 7.4;
const YEAR_ROW_H = 16;
const MONTH_ROW_H = 18;
const HEADER_H = YEAR_ROW_H + MONTH_ROW_H;
const EMPTY_W = 320;
const EMPTY_H = 92;
const QUARTER_MONTHS = 3;
const TOP_RANKS = 3;

export interface SectorRankHeatmapProps {
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

export function SectorRankHeatmap(props: SectorRankHeatmapProps) {
  const titleId = `history-rank-heatmap-title-${createUniqueId()}`;
  const descId = `history-rank-heatmap-desc-${createUniqueId()}`;
  const cellIdBase = `history-rank-cell-${createUniqueId()}`;
  const [activeCell, setActiveCell] = createSignal({ row: 0, col: 0 });

  const model = createMemo(() => {
    const months = props.months;
    const sectors = props.series.filter((item) => !item.is_benchmark);
    const hasData = sectors.length > 0 && months.length > 0;
    const longestName = sectors.reduce((max, sector) => Math.max(max, sector.name.length), 0);
    const labelW = Math.max(
      LABEL_MIN_W,
      Math.min(LABEL_MAX_W, Math.ceil(longestName * LABEL_CHAR_W) + 14),
    );
    const width = hasData ? labelW + months.length * CELL_W : EMPTY_W;
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
        const rawRank = sector.ranks[monthIndexValue];
        const rank = finite(rawRank) ? rawRank : null;
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
    const latest: LatestRank[] =
      latestIndex < 0
        ? []
        : sectors
            .map((sector, order) => ({
              name: sector.name,
              rank: sector.ranks[latestIndex],
              order,
            }))
            .filter((item): item is { name: string; rank: number; order: number } =>
              finite(item.rank),
            )
            .sort((a, b) => a.rank - b.rank || a.order - b.order)
            .slice(0, TOP_RANKS)
            .map((item) => ({ rank: Math.round(item.rank), name: item.name }));

    return {
      hasData,
      width,
      height,
      labelW,
      yearMarks,
      quarterMarks,
      rows,
      latest,
      latestIndex,
      latestMonth: latestIndex >= 0 ? months[latestIndex] : "",
      sectorCount: sectors.length,
      topN: Math.min(TOP_RANKS, sectors.length),
    };
  });

  const latestKey = () => {
    const info = model();
    const month = info.latestMonth
      ? `${monthName(monthIndex(info.latestMonth))} ${yearOf(info.latestMonth)}`
      : "";
    const ranks = info.latest.map((item) => `#${item.rank} ${item.name}`).join(" · ");
    return `Current ${month}: ${ranks}`;
  };

  const rankCellId = (row: number, col: number) => `${cellIdBase}-${row}-${col}`;

  const activeRankCell = () => {
    const rows = model().rows.length;
    const cols = props.months.length;
    if (rows === 0 || cols === 0) return { row: 0, col: 0 };
    return {
      row: Math.min(activeCell().row, rows - 1),
      col: Math.min(activeCell().col, cols - 1),
    };
  };

  const focusRankCell = (row: number, col: number) => {
    setActiveCell({ row, col });
    document.getElementById(rankCellId(row, col))?.focus();
  };

  const onRankKeyDown = (event: KeyboardEvent, row: number, col: number) => {
    const maxRow = model().rows.length - 1;
    const maxCol = props.months.length - 1;
    let nextRow = row;
    let nextCol = col;
    switch (event.key) {
      case "ArrowLeft":
        nextCol = Math.max(0, col - 1);
        break;
      case "ArrowRight":
        nextCol = Math.min(maxCol, col + 1);
        break;
      case "ArrowUp":
        nextRow = Math.max(0, row - 1);
        break;
      case "ArrowDown":
        nextRow = Math.min(maxRow, row + 1);
        break;
      case "Home":
        nextCol = 0;
        break;
      case "End":
        nextCol = maxCol;
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        return;
      default:
        return;
    }
    event.preventDefault();
    if (nextRow === row && nextCol === col) {
      setActiveCell({ row, col });
      return;
    }
    focusRankCell(nextRow, nextCol);
  };

  return (
    <div class="history-rank-heatmap min-w-0" style={{ "min-width": `${model().width}px` }}>
      <style>{`.history-rank-heatmap [data-cell]:focus-visible { outline: 2px solid ${PRIMARY}; outline-offset: -2px; }`}</style>
      <div data-testid="history-rank-layout" class="flex flex-wrap items-start gap-4">
        <div
          data-testid="history-rank-chart"
          class="min-w-0"
          style={{ flex: "0 0 auto", width: `${model().width}px` }}
        >
          <svg
            data-testid="history-rank-heatmap"
            width="100%"
            viewBox={`0 0 ${model().width} ${model().height}`}
            preserveAspectRatio="xMinYMin meet"
            role="img"
            aria-labelledby={`${titleId} ${descId}`}
            font-family={MONO}
            style={{
              display: "block",
              height: "auto",
              "min-width": `${model().width}px`,
              "max-width": `${model().width}px`,
            }}
          >
            <title id={titleId}>
              {model().hasData
                ? `Sector rank heatmap, ${model().sectorCount} sectors across ${props.months.length} months. Rank 1 is strongest and light outlines mark the top ${model().topN}.`
                : "Sector rank heatmap, no data"}
            </title>
            <desc id={descId}>
              Rows are sectors and columns are months, grouped by year and labelled at each quarter.
              Green marks a high rank (1 is strongest), red marks a low rank, and the middle of the
              field is neutral. A light ink outline marks ranks 1 through {model().topN}. The dashed
              cyan outline marks the current month. Missing ranks leave the cell empty. The current
              key names the latest month's top {model().topN}. Cells are keyboard-focusable and
              announce the month, sector and rank.
            </desc>
            <rect width={model().width} height={model().height} fill={SURFACE} />

            <Show
              when={model().hasData}
              fallback={
                <text
                  data-testid="history-rank-heatmap-empty"
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
              <g>
                <For each={model().yearMarks}>
                  {(mark) => (
                    <text
                      x={model().labelW + mark.index * CELL_W + 2}
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
                        x={model().labelW + mark.index * CELL_W + 2}
                        y={HEADER_H - 5}
                        font-size={SVG_TEXT}
                        fill={SCALE_GRAY[2]}
                      >
                        {mark.label}
                      </text>
                      <Show when={mark.index > 0 && monthIndex(props.months[mark.index]) !== 0}>
                        <line
                          x1={model().labelW + mark.index * CELL_W}
                          x2={model().labelW + mark.index * CELL_W}
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
                      x1={model().labelW + mark.index * CELL_W}
                      x2={model().labelW + mark.index * CELL_W}
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
                            const cellX = () => model().labelW + cell.index * CELL_W;
                            return (
                              <g>
                                <rect
                                  id={rankCellId(sector.index, cell.index)}
                                  data-cell={`rank-${sector.index}-${cell.index}`}
                                  data-top3={cell.top3 ? "true" : "false"}
                                  x={cellX()}
                                  y={rowY()}
                                  width={CELL_W}
                                  height={CELL_H}
                                  fill={cell.fill}
                                  stroke={BORDER}
                                  stroke-width={0.5}
                                  shape-rendering="crispEdges"
                                  role="img"
                                  tabindex={
                                    activeRankCell().row === sector.index &&
                                    activeRankCell().col === cell.index
                                      ? "0"
                                      : "-1"
                                  }
                                  aria-label={cell.label}
                                  onFocus={() =>
                                    setActiveCell({ row: sector.index, col: cell.index })
                                  }
                                  onKeyDown={(event) =>
                                    onRankKeyDown(event, sector.index, cell.index)
                                  }
                                >
                                  <title>{cell.label}</title>
                                </rect>
                                <Show when={cell.top3}>
                                  <rect
                                    data-top3-outline="true"
                                    x={cellX() + 1.25}
                                    y={rowY() + 1.25}
                                    width={CELL_W - 2.5}
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
                                  x={cellX() + CELL_W / 2}
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
                    x={model().labelW + model().latestIndex * CELL_W + 0.5}
                    y={HEADER_H}
                    width={CELL_W - 1}
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
            </Show>
          </svg>
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
                    {sector.name}
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
        <aside
          data-testid="history-rank-aside"
          class="min-w-0"
          style={{ flex: "1 1 200px", "min-width": "200px" }}
        >
          <Show when={model().hasData && model().latest.length > 0}>
            <div
              data-testid="history-rank-latest-key"
              class="w-full border-t border-fin-border px-1 pt-1 font-mono text-ui-micro leading-snug text-fin-text-muted"
              style={{
                position: "sticky",
                left: "0px",
                "z-index": "10",
                "max-width": "calc(100vw - 48px)",
                color: CHART_CURRENT,
              }}
            >
              {latestKey()}
            </div>
          </Show>
          <Show when={model().hasData}>
            <div
              data-testid="history-rank-legend"
              class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-1 font-mono text-ui-micro text-fin-text-muted"
              style={{
                position: "sticky",
                left: "0px",
                "z-index": "9",
                "max-width": "calc(100vw - 48px)",
              }}
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
                  {`1 best → ${model().sectorCount} worst`}
                </span>
              </span>
              <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
                <span
                  aria-hidden="true"
                  class="inline-block h-[11px] w-[18px] border-2 bg-fin-surface"
                  style={{ "border-color": SCALE_GRAY[0] }}
                />
                <span data-testid="history-rank-top3-legend">{`top ${model().topN}`}</span>
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
      </div>
    </div>
  );
}
