import { For, Show, createMemo, createSignal, createUniqueId } from "solid-js";
import {
  alpha,
  BORDER,
  MONO,
  NEGATIVE,
  POSITIVE,
  PRIMARY,
  SCALE_GRAY,
  SURFACE,
  TEXT_MUTED,
} from "@/ui/palette";
import { compositeOver, pickTextColor } from "@/utils/contrast";
import type { SectorHistorySeasonality } from "../../../../types/sectorHistory";
import { SVG_TEXT, finite, hitRatePercent, monthName, signedPct } from "./shared";

const LABEL_MIN_W = 140;
const LABEL_MAX_W = 210;
const LABEL_CHAR_W = 7.4;
const CELL_W = 45;
const CELL_H = 26;
const HEADER_H = 26;
const EMPTY_W = 360;
const EMPTY_H = 96;
const HIT_BAR_INSET = 4;
const HIT_BAR_H = 2;
const HIT_BAR_TRACK_OPACITY = 0.18;
const HIT_BAR_OPACITY = 0.9;

export interface SeasonalityHeatmapProps {
  cells: SectorHistorySeasonality[];
  names: string[];
}

interface SeasonalityCell {
  key: string;
  index: number;
  avg: number | null;
  hitPct: number | null;
  tooltip: string;
  fill: string;
  opacity: number;
  ink: string;
}

interface SeasonalityRow {
  key: string;
  index: number;
  name: string;
  cells: SeasonalityCell[];
}

export function SeasonalityHeatmap(props: SeasonalityHeatmapProps) {
  const titleId = `history-seasonality-title-${createUniqueId()}`;
  const descId = `history-seasonality-desc-${createUniqueId()}`;
  const cellIdBase = `history-seasonality-cell-${createUniqueId()}`;
  const [activeCell, setActiveCell] = createSignal({ row: 0, col: 0 });

  const model = createMemo(() => {
    const names = props.names;
    const cells = props.cells;
    const hasData = names.length > 0 && cells.length > 0;
    const longestName = names.reduce((max, name) => Math.max(max, name.length), 0);
    const labelW = Math.max(
      LABEL_MIN_W,
      Math.min(LABEL_MAX_W, Math.ceil(longestName * LABEL_CHAR_W) + 14),
    );
    const width = hasData ? labelW + 12 * CELL_W + 2 : EMPTY_W;
    const height = hasData ? HEADER_H + names.length * CELL_H : EMPTY_H;

    // The API may send months as 0- or 1-based; the full-year range disambiguates them.
    const zeroBased =
      cells.some((cell) => cell.month === 0) && !cells.some((cell) => cell.month === 12);
    const cellMap = new Map<string, SectorHistorySeasonality>();
    for (const cell of cells) {
      const index = zeroBased ? cell.month : cell.month - 1;
      cellMap.set(`${cell.name}|${index}`, cell);
    }
    const findCell = (name: string, index: number) => cellMap.get(`${name}|${index}`) ?? null;

    const nameSet = new Set(names);
    const inScope = cells.filter((cell) => nameSet.has(cell.name) && finite(cell.avg_return));
    const avgReturns = inScope.map((cell) => cell.avg_return).filter(finite);
    const maxAbs = avgReturns.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
    const observations = inScope
      .map((cell) => (finite(cell.n) && cell.n > 0 ? Math.round(cell.n) : 0))
      .filter((value) => value > 0);
    const nMin = observations.length > 0 ? Math.min(...observations) : null;
    const nMax = observations.length > 0 ? Math.max(...observations) : null;
    const sampleLabel =
      nMin === null || nMax === null
        ? "n=—"
        : nMin === nMax
          ? `n=${nMax} per month`
          : `n=${nMin}–${nMax} per month`;

    const rows: SeasonalityRow[] = names.map((name, rowIndex) => ({
      key: `${name}-${rowIndex}`,
      index: rowIndex,
      name,
      cells: Array.from({ length: 12 }, (_, month) => {
        const cell = findCell(name, month);
        const avg = cell && finite(cell.avg_return) ? cell.avg_return : null;
        const n = cell && finite(cell.n) ? cell.n : 0;
        const hitRate = cell?.hit_rate ?? null;
        const hitPct = finite(hitRate) ? hitRatePercent(hitRate) : null;
        const hitLabel = hitPct === null ? "n/a" : `${Math.round(hitPct)}%`;
        const tooltip =
          cell && avg !== null
            ? `${monthName(month)} · ${name} · avg ${signedPct(avg)} · hit rate ${hitLabel} · n=${n}`
            : `${monthName(month)} · ${name} · no data · hit rate n/a · n=0`;
        const intensity = avg !== null && maxAbs > 0 ? Math.min(1, Math.abs(avg) / maxAbs) : 0;
        const fill = avg === null || avg === 0 ? SURFACE : avg > 0 ? POSITIVE : NEGATIVE;
        const opacity = avg !== null && avg !== 0 ? 0.14 + 0.5 * intensity : 1;
        const ink =
          avg === null ? TEXT_MUTED : pickTextColor(compositeOver(fill, SURFACE, opacity));
        return {
          key: `${name}-${month}`,
          index: month,
          avg,
          hitPct: hitPct !== null && n > 0 ? Math.max(0, Math.min(100, hitPct)) : null,
          tooltip,
          fill,
          opacity,
          ink,
        };
      }),
    }));

    return { hasData, width, height, labelW, rows, sampleLabel };
  });

  const seasonalityCellId = (row: number, col: number) => `${cellIdBase}-${row}-${col}`;

  const activeSeasonalityCell = () => {
    const rows = model().rows.length;
    if (rows === 0) return { row: 0, col: 0 };
    return { row: Math.min(activeCell().row, rows - 1), col: Math.min(activeCell().col, 11) };
  };

  const focusSeasonalityCell = (row: number, col: number) => {
    setActiveCell({ row, col });
    document.getElementById(seasonalityCellId(row, col))?.focus();
  };

  const onSeasonalityKeyDown = (event: KeyboardEvent, row: number, col: number) => {
    const maxRow = model().rows.length - 1;
    const maxCol = 11;
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
    focusSeasonalityCell(nextRow, nextCol);
  };

  return (
    <div class="history-seasonality min-w-0">
      <style>{`.history-seasonality [data-cell]:focus-visible { outline: 2px solid ${PRIMARY}; outline-offset: -2px; }`}</style>
      <Show when={model().hasData}>
        <div
          data-testid="history-seasonality-legend"
          class="mb-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 font-mono text-ui-micro text-fin-text-muted"
        >
          <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden="true"
              class="relative inline-block h-[2px] w-[24px]"
              style={{ "background-color": alpha(SCALE_GRAY[0], HIT_BAR_TRACK_OPACITY) }}
            >
              <span
                class="absolute inset-y-0 left-0"
                style={{
                  width: "16px",
                  "background-color": alpha(SCALE_GRAY[0], HIT_BAR_OPACITY),
                }}
              />
            </span>
            <span>bar = up-month hit rate</span>
          </span>
          <span class="min-w-0">
            longer bar = more up months · hit rate and n in each cell label
          </span>
          <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span>avg monthly return</span>
          </span>
          <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden="true"
              class="inline-block h-[10px] w-[10px] border border-fin-border"
              style={{ "background-color": NEGATIVE }}
            />
            <span>negative</span>
          </span>
          <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden="true"
              class="inline-block h-[10px] w-[10px] border border-fin-border bg-fin-surface"
            />
            <span>flat</span>
          </span>
          <span class="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span
              aria-hidden="true"
              class="inline-block h-[10px] w-[10px] border border-fin-border"
              style={{ "background-color": POSITIVE }}
            />
            <span>positive</span>
          </span>
          <span data-testid="history-seasonality-note" class="min-w-0">
            {`${model().sampleLabel} · history, not a forecast`}
          </span>
        </div>
      </Show>

      <div
        data-testid="history-seasonality-scroll"
        style={{ width: "100%", "overflow-x": "auto", "overflow-y": "hidden" }}
      >
        <div class="relative" style={{ "min-width": `${model().width}px` }}>
          <svg
            data-testid="history-seasonality"
            width="100%"
            viewBox={`0 0 ${model().width} ${model().height}`}
            preserveAspectRatio="xMinYMin meet"
            role="img"
            aria-labelledby={`${titleId} ${descId}`}
            font-family={MONO}
            class="history-seasonality"
            style={{
              display: "block",
              width: "100%",
              height: "auto",
              "min-width": model().hasData ? `${model().width}px` : "0px",
              "max-width": `${model().width}px`,
            }}
          >
            <title id={titleId}>
              {model().hasData
                ? `Monthly seasonality history, average return by sector and calendar month. ${props.names.length} sectors.`
                : "Monthly seasonality, no data"}
            </title>
            <desc id={descId}>
              Rows are sectors and columns are January through December. Cells are coloured green
              for a positive average monthly return and red for a negative one; the text is the
              average return. The bar along the bottom of each cell is the share of months that
              finished up, and each cell announces the exact hit rate and number of observations.
              The hit-rate legend sits above the matrix so it stays visible on narrow screens. This
              is descriptive history, not a forecast.
            </desc>
            <rect width={model().width} height={model().height} fill={SURFACE} />

            <Show
              when={model().hasData}
              fallback={
                <text
                  data-testid="history-seasonality-empty"
                  x={model().width / 2}
                  y={model().height / 2}
                  font-size={SVG_TEXT}
                  fill={TEXT_MUTED}
                  text-anchor="middle"
                  dominant-baseline="central"
                >
                  No seasonality data
                </text>
              }
            >
              <g>
                <For each={Array.from({ length: 12 }, (_, index) => index)}>
                  {(index) => (
                    <text
                      x={model().labelW + index * CELL_W + CELL_W / 2}
                      y={HEADER_H - 7}
                      font-size={SVG_TEXT}
                      font-weight={600}
                      fill={TEXT_MUTED}
                      text-anchor="middle"
                    >
                      {monthName(index)}
                    </text>
                  )}
                </For>

                <For each={model().rows}>
                  {(row) => {
                    const rowY = () => HEADER_H + row.index * CELL_H;
                    return (
                      <g>
                        <text
                          x={model().labelW - 6}
                          y={rowY() + CELL_H / 2}
                          font-size={SVG_TEXT}
                          fill={TEXT_MUTED}
                          text-anchor="end"
                          dominant-baseline="central"
                          aria-label={row.name}
                        >
                          <title>{row.name}</title>
                          {row.name}
                        </text>
                        <For each={row.cells}>
                          {(cell) => {
                            const cellX = () => model().labelW + cell.index * CELL_W;
                            const barWidth = () =>
                              cell.hitPct === null
                                ? 0
                                : (CELL_W - HIT_BAR_INSET * 2) * (cell.hitPct / 100);
                            return (
                              <g>
                                <rect
                                  id={seasonalityCellId(row.index, cell.index)}
                                  data-cell={`seasonality-${row.index}-${cell.index}`}
                                  data-ink={cell.avg === null ? undefined : cell.ink}
                                  x={cellX()}
                                  y={rowY()}
                                  width={CELL_W}
                                  height={CELL_H}
                                  fill={cell.fill}
                                  fill-opacity={cell.opacity}
                                  stroke={BORDER}
                                  stroke-width={0.5}
                                  shape-rendering="crispEdges"
                                  role="img"
                                  tabindex={
                                    activeSeasonalityCell().row === row.index &&
                                    activeSeasonalityCell().col === cell.index
                                      ? "0"
                                      : "-1"
                                  }
                                  aria-label={cell.tooltip}
                                  onFocus={() => setActiveCell({ row: row.index, col: cell.index })}
                                  onKeyDown={(event) =>
                                    onSeasonalityKeyDown(event, row.index, cell.index)
                                  }
                                >
                                  <title>{cell.tooltip}</title>
                                </rect>
                                <text
                                  x={cellX() + CELL_W / 2}
                                  y={rowY() + CELL_H / 2 - 1}
                                  font-size={SVG_TEXT}
                                  font-weight={500}
                                  fill={cell.ink}
                                  text-anchor="middle"
                                  dominant-baseline="central"
                                  pointer-events="none"
                                  aria-hidden="true"
                                >
                                  {cell.avg === null ? "–" : signedPct(cell.avg)}
                                </text>
                                <Show when={cell.avg !== null && cell.hitPct !== null}>
                                  <rect
                                    x={cellX() + HIT_BAR_INSET}
                                    y={rowY() + CELL_H - HIT_BAR_H - 3}
                                    width={CELL_W - HIT_BAR_INSET * 2}
                                    height={HIT_BAR_H}
                                    fill={SCALE_GRAY[0]}
                                    fill-opacity={HIT_BAR_TRACK_OPACITY}
                                    shape-rendering="crispEdges"
                                    pointer-events="none"
                                    aria-hidden="true"
                                  />
                                  <rect
                                    data-hit-bar={`seasonality-${row.index}-${cell.index}`}
                                    data-hit-pct={Math.round(cell.hitPct ?? 0)}
                                    x={cellX() + HIT_BAR_INSET}
                                    y={rowY() + CELL_H - HIT_BAR_H - 3}
                                    width={barWidth()}
                                    height={HIT_BAR_H}
                                    fill={SCALE_GRAY[0]}
                                    fill-opacity={HIT_BAR_OPACITY}
                                    shape-rendering="crispEdges"
                                    pointer-events="none"
                                    aria-hidden="true"
                                  />
                                </Show>
                              </g>
                            );
                          }}
                        </For>
                      </g>
                    );
                  }}
                </For>
              </g>
            </Show>
          </svg>
          <Show when={model().hasData}>
            <div
              data-testid="history-seasonality-row-rail"
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
                {(row) => (
                  <div
                    title={row.name}
                    class="absolute flex w-full items-center justify-end overflow-hidden border-r border-fin-border pr-1.5 font-mono text-ui-micro whitespace-nowrap text-fin-text-muted"
                    style={{
                      top: `${HEADER_H + row.index * CELL_H}px`,
                      height: `${CELL_H}px`,
                      "box-sizing": "border-box",
                    }}
                  >
                    {row.name}
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
