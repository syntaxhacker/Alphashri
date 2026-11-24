import { For, Show, createMemo, createUniqueId } from "solid-js";
import { BORDER, NEGATIVE, POSITIVE, SCALE_GRAY, SURFACE, TEXT_MUTED } from "@/ui/palette";
import type { SectorHistorySeasonality } from "../../../../types/sectorHistory";
import { SVG_TEXT, finite, hitRatePercent, monthName, signedPct, truncate } from "./shared";

const LABEL_W = 116;
const CELL_W = 48;
const CELL_H = 22;
const HEADER_H = 22;
const FOOTER_H = 30;
const EMPTY_W = 360;
const EMPTY_H = 96;

export interface SeasonalityHeatmapProps {
  cells: SectorHistorySeasonality[];
  names: string[];
}

interface SeasonalityCell {
  key: string;
  index: number;
  avg: number | null;
  tooltip: string;
  fill: string;
  opacity: number;
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

  const model = createMemo(() => {
    const names = props.names;
    const cells = props.cells;
    const hasData = names.length > 0 && cells.length > 0;
    const width = hasData ? LABEL_W + 12 * CELL_W + 2 : EMPTY_W;
    const height = hasData ? HEADER_H + names.length * CELL_H + FOOTER_H : EMPTY_H;

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
    const sampleSize =
      inScope.reduce((max, cell) => Math.max(max, finite(cell.n) && cell.n > 0 ? cell.n : 0), 0) ||
      5;

    const rows: SeasonalityRow[] = names.map((name, rowIndex) => ({
      key: `${name}-${rowIndex}`,
      index: rowIndex,
      name,
      cells: Array.from({ length: 12 }, (_, month) => {
        const cell = findCell(name, month);
        const avg = cell && finite(cell.avg_return) ? cell.avg_return : null;
        const n = cell && finite(cell.n) ? cell.n : 0;
        const hitRate = cell?.hit_rate ?? null;
        const hitPct = finite(hitRate) ? hitRatePercent(hitRate) : 0;
        const up = n > 0 ? Math.round((hitPct / 100) * n) : 0;
        const tooltip =
          cell && avg !== null
            ? `${monthName(month)} · avg ${signedPct(avg)} · ${up}/${n} up (${Math.round(hitPct)}%)`
            : `${monthName(month)} · ${name} · no data`;
        const intensity = avg !== null && maxAbs > 0 ? Math.min(1, Math.abs(avg) / maxAbs) : 0;
        return {
          key: `${name}-${month}`,
          index: month,
          avg,
          tooltip,
          fill: avg === null || avg === 0 ? SURFACE : avg > 0 ? POSITIVE : NEGATIVE,
          opacity: avg !== null && avg !== 0 ? 0.14 + 0.56 * intensity : 1,
        };
      }),
    }));

    return { hasData, width, height, rows, sampleSize };
  });

  return (
    <svg
      data-testid="history-seasonality"
      width="100%"
      viewBox={`0 0 ${model().width} ${model().height}`}
      preserveAspectRatio="xMinYMin meet"
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      style={{ display: "block" }}
    >
      <title id={titleId}>
        {model().hasData
          ? `Monthly seasonality, average return by sector and calendar month. ${props.names.length} sectors.`
          : "Monthly seasonality, no data"}
      </title>
      <desc id={descId}>
        Rows are sectors and columns are January through December. Cells are coloured green for a
        positive average monthly return and red for a negative one; the text is the average return.
        Hover a cell for the hit rate and sample size.
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
                x={LABEL_W + index * CELL_W + CELL_W / 2}
                y={HEADER_H - 6}
                font-size={SVG_TEXT}
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
                    x={LABEL_W - 6}
                    y={rowY() + CELL_H / 2}
                    font-size={SVG_TEXT}
                    fill={TEXT_MUTED}
                    text-anchor="end"
                    dominant-baseline="central"
                  >
                    {truncate(row.name, 15)}
                  </text>
                  <For each={row.cells}>
                    {(cell) => {
                      const cellX = () => LABEL_W + cell.index * CELL_W;
                      return (
                        <g>
                          <rect
                            data-cell={`seasonality-${row.index}-${cell.index}`}
                            x={cellX()}
                            y={rowY()}
                            width={CELL_W}
                            height={CELL_H}
                            fill={cell.fill}
                            fill-opacity={cell.opacity}
                            stroke={BORDER}
                            stroke-width={0.5}
                            shape-rendering="crispEdges"
                            aria-label={cell.tooltip}
                          >
                            <title>{cell.tooltip}</title>
                          </rect>
                          <text
                            x={cellX() + CELL_W / 2}
                            y={rowY() + CELL_H / 2}
                            font-size={SVG_TEXT}
                            fill={cell.avg === null ? TEXT_MUTED : SCALE_GRAY[0]}
                            text-anchor="middle"
                            dominant-baseline="central"
                          >
                            {cell.avg === null ? "–" : signedPct(cell.avg)}
                          </text>
                        </g>
                      );
                    }}
                  </For>
                </g>
              );
            }}
          </For>

          <text x={LABEL_W} y={model().height - 9} font-size={SVG_TEXT} fill={TEXT_MUTED}>
            avg monthly return · green positive · red negative
          </text>
          <text
            data-testid="history-seasonality-note"
            x={model().width - 4}
            y={model().height - 9}
            font-size={SVG_TEXT}
            fill={TEXT_MUTED}
            text-anchor="end"
          >
            {`n=${model().sampleSize} per month`}
          </text>
        </g>
      </Show>
    </svg>
  );
}
