import { For, Show, createMemo, createUniqueId } from "solid-js";
import { BORDER, PRIMARY, SCALE_GRAY, SURFACE, TEXT_MUTED } from "@/ui/palette";
import { pickTextColor } from "@/utils/contrast";
import { shareColor } from "./chartPalette";
import { MatrixFrame } from "./matrices/MatrixFrame";
import { useRovingGrid } from "./matrices/useRovingGrid";
import { useScrollHint } from "./matrices/useScrollHint";
import { SVG_TEXT, finite } from "./shared";

const LABEL_W = 76;
const CELL_W = 48;
const CELL_H = 24;
const HEADER_H = 50;
const FOOTER_H = 66;
const COUNT_ROW_H = 14;
const EMPTY_W = 360;
const EMPTY_H = 96;
const TOP_N = 3;

export interface PersistenceMatrixProps {
  names: string[];
  matrix: (number | null)[][];
  /** Optional monthly transition sample size, e.g. (months - 1) * universe. */
  transitionCount?: number;
}

interface PersistenceCell {
  key: string;
  col: number;
  pct: number | null;
  diagonal: boolean;
  top3: boolean;
  title: string;
  fill: string;
  ink: string;
}

interface PersistenceRow {
  key: string;
  index: number;
  cells: PersistenceCell[];
}

function exactPct(value: number): string {
  return `${value.toFixed(2).replace(/\.?0+$/, "")}%`;
}

export function PersistenceMatrix(props: PersistenceMatrixProps) {
  const cellIdBase = `history-persistence-cell-${createUniqueId()}`;
  const hint = useScrollHint();

  const model = createMemo(() => {
    const matrix = props.matrix;
    const rows = matrix.length;
    const cols = rows > 0 ? matrix.reduce((max, row) => Math.max(max, row.length), 0) : 0;
    const hasData = rows > 0 && cols > 0;
    const count = finite(props.transitionCount)
      ? Math.max(0, Math.round(props.transitionCount))
      : null;
    const footerH = FOOTER_H + (count === null ? 0 : COUNT_ROW_H);
    const width = hasData ? LABEL_W + cols * CELL_W + 2 : EMPTY_W;
    const height = hasData ? HEADER_H + rows * CELL_H + footerH : EMPTY_H;
    const sectorCount = Math.max(props.names.length, rows);

    const finiteValues = matrix.flat().filter(finite);
    const rowSums = matrix
      .map((row) => row.filter(finite))
      .filter((row) => row.length > 0)
      .map((row) => row.reduce((sum, value) => sum + value, 0));
    const percentRows = rowSums.filter((sum) => sum >= 95 && sum <= 105).length;
    const fractionRows = rowSums.filter((sum) => sum >= 0.95 && sum <= 1.05).length;
    const maxRaw = finiteValues.reduce((max, value) => Math.max(max, value), 0);
    const asFraction =
      fractionRows > percentRows
        ? true
        : percentRows > fractionRows
          ? false
          : maxRaw > 0 && maxRaw <= 1.0001;
    const pctOf = (value: number | null): number | null => {
      if (!finite(value)) return null;
      return asFraction ? value * 100 : value;
    };
    const maxPct = Math.max(
      1,
      finiteValues.reduce((max, value) => Math.max(max, asFraction ? value * 100 : value), 0),
    );

    const topRows = Math.min(TOP_N, rows);
    const topCols = Math.min(TOP_N, cols);
    let topStay = 0;
    let topTotal = 0;
    for (let row = 0; row < topRows; row++) {
      for (let col = 0; col < cols; col++) {
        const pct = pctOf(matrix[row][col] ?? null);
        if (pct === null) continue;
        topTotal += pct;
        if (col < topCols) topStay += pct;
      }
    }
    const stickiness = topTotal > 0 ? (topStay / topTotal) * 100 : null;

    const grid: PersistenceRow[] = matrix.map((rowValues, rowIndex) => ({
      key: `row-${rowIndex}`,
      index: rowIndex,
      cells: Array.from({ length: cols }, (_, col) => {
        const pct = pctOf(rowValues[col] ?? null);
        const diagonal = rowIndex === col;
        const fill = pct === null ? SURFACE : shareColor(pct, maxPct);
        const ink = pct === null ? TEXT_MUTED : pickTextColor(fill);
        return {
          key: `${rowIndex}-${col}`,
          col,
          pct,
          diagonal,
          top3: rowIndex < topRows && col < topCols,
          title:
            pct === null
              ? `#${rowIndex + 1} → #${col + 1} · no data`
              : `#${rowIndex + 1} → #${col + 1} · ${exactPct(pct)}`,
          fill,
          ink,
        };
      }),
    }));

    return {
      hasData,
      width,
      height,
      rows,
      cols,
      grid,
      sectorCount,
      maxPct,
      topRows,
      topCols,
      stickiness,
      count,
      footerH,
      footerTop: height - footerH,
    };
  });

  const stickinessLabel = () =>
    model().stickiness === null
      ? "top-3 stickiness n/a"
      : `top-3 stickiness ${Math.round(model().stickiness ?? 0)}%`;

  const persistenceCellId = (row: number, col: number) => `${cellIdBase}-${row}-${col}`;
  const grid = useRovingGrid({
    rows: () => model().rows,
    cols: () => model().cols,
    cellId: persistenceCellId,
  });

  return (
    <div class="min-w-0">
      <div
        aria-hidden="true"
        data-testid="history-persistence-scroll-hint"
        class={`mb-1 items-center justify-end ${hint.overflowing() ? "flex" : "hidden"}`}
      >
        <span class="text-ui-micro text-fin-text-muted">
          {hint.atEnd() ? "Scroll ←" : "Scroll →"}
        </span>
      </div>
      <div
        ref={hint.setRef}
        data-testid="history-persistence-scroll"
        role="region"
        tabIndex={0}
        aria-label="Rank persistence matrix. Scroll sideways for all next-month ranks."
        style={{ width: "100%", "overflow-x": "auto", "overflow-y": "hidden" }}
        class="min-w-0 max-w-full focus-visible:outline focus-visible:outline-1 focus-visible:outline-fin-primary"
      >
        <div class="relative" style={{ "min-width": `${model().width}px` }}>
          <MatrixFrame
            testId="history-persistence"
            title={
              model().hasData
                ? `Rank persistence matrix for ${model().sectorCount} sectors, ${model().rows} by ${model().cols} ranks. ${stickinessLabel()}.`
                : "Rank persistence matrix, no data"
            }
            desc={`Rows are this month's sector rank and columns are next month's rank, from 1 through ${Math.max(model().rows, model().cols)}, across ${model().sectorCount} sectors. Each cell is the share of transitions that moved between those ranks, in percent. The diagonal marks sectors that stayed in the same rank, and the dashed amber box marks the top-3 to top-3 region. Cells are keyboard-focusable and announce the rank transition and exact share.`}
            width={model().width}
            height={model().height}
            rowRail={
              model().hasData
                ? {
                    rows: model().grid.map((row) => ({ label: `#${row.index + 1}` })),
                    labelWidth: LABEL_W,
                    headerHeight: HEADER_H,
                    rowHeight: CELL_H,
                    footerHeight: model().footerH,
                  }
                : undefined
            }
            empty={
              <text
                x={model().width / 2}
                y={model().height / 2}
                font-size={SVG_TEXT}
                fill={TEXT_MUTED}
                text-anchor="middle"
                dominant-baseline="central"
              >
                No persistence data
              </text>
            }
          >
            {model().hasData ? (
              <g>
                <text x={4} y={12} font-size={SVG_TEXT} font-weight={600} fill={TEXT_MUTED}>
                  rows: this month rank ↓
                </text>
                <text
                  x={LABEL_W + 4}
                  y={27}
                  font-size={SVG_TEXT}
                  font-weight={600}
                  fill={TEXT_MUTED}
                >
                  columns: next month rank →
                </text>

                <For each={Array.from({ length: model().cols }, (_, index) => index)}>
                  {(col) => (
                    <text
                      x={LABEL_W + col * CELL_W + CELL_W / 2}
                      y={HEADER_H - 7}
                      font-size={SVG_TEXT}
                      fill={TEXT_MUTED}
                      text-anchor="middle"
                    >
                      {col + 1}
                    </text>
                  )}
                </For>

                <For each={model().grid}>
                  {(row) => {
                    const rowY = () => HEADER_H + row.index * CELL_H;
                    return (
                      <g>
                        <text
                          x={LABEL_W - 8}
                          y={rowY() + CELL_H / 2}
                          font-size={SVG_TEXT}
                          fill={TEXT_MUTED}
                          text-anchor="end"
                          dominant-baseline="central"
                        >
                          {`#${row.index + 1}`}
                        </text>
                        <For each={row.cells}>
                          {(cell) => {
                            const cellX = () => LABEL_W + cell.col * CELL_W;
                            return (
                              <g>
                                <rect
                                  id={persistenceCellId(row.index, cell.col)}
                                  data-cell={`persistence-${row.index}-${cell.col}`}
                                  data-diagonal={cell.diagonal ? "true" : "false"}
                                  data-top3={cell.top3 ? "true" : "false"}
                                  data-ink={cell.pct === null ? undefined : cell.ink}
                                  x={cellX()}
                                  y={rowY()}
                                  width={CELL_W}
                                  height={CELL_H}
                                  fill={cell.fill}
                                  stroke={cell.diagonal ? PRIMARY : BORDER}
                                  stroke-width={cell.diagonal ? 1.5 : 0.5}
                                  shape-rendering="crispEdges"
                                  role="img"
                                  tabindex={grid.tabIndex(row.index, cell.col)}
                                  aria-label={cell.title}
                                  onFocus={() => grid.setActive(row.index, cell.col)}
                                  onKeyDown={(event) => grid.onKeyDown(event, row.index, cell.col)}
                                >
                                  <title>{cell.title}</title>
                                </rect>
                                <Show when={cell.pct !== null && cell.pct >= 10}>
                                  <text
                                    x={cellX() + CELL_W / 2}
                                    y={rowY() + CELL_H / 2}
                                    font-size={SVG_TEXT}
                                    font-weight={cell.diagonal ? 700 : 500}
                                    fill={cell.ink}
                                    text-anchor="middle"
                                    dominant-baseline="central"
                                    pointer-events="none"
                                    aria-hidden="true"
                                  >
                                    {`${Math.round(cell.pct ?? 0)}%`}
                                  </text>
                                </Show>
                              </g>
                            );
                          }}
                        </For>
                      </g>
                    );
                  }}
                </For>

                <Show when={model().topRows > 0 && model().topCols > 0}>
                  <rect
                    data-top3-zone="true"
                    x={LABEL_W + 1}
                    y={HEADER_H + 1}
                    width={model().topCols * CELL_W - 2}
                    height={model().topRows * CELL_H - 2}
                    fill="none"
                    stroke={PRIMARY}
                    stroke-width={1.5}
                    stroke-dasharray="4 3"
                    pointer-events="none"
                    aria-hidden="true"
                  />
                </Show>

                <line
                  x1={4}
                  x2={model().width - 4}
                  y1={model().footerTop + 4}
                  y2={model().footerTop + 4}
                  stroke={BORDER}
                  stroke-width={0.5}
                  shape-rendering="crispEdges"
                />

                <text
                  data-testid="history-persistence-stickiness"
                  x={4}
                  y={model().footerTop + 18}
                  font-size={SVG_TEXT}
                  font-weight={600}
                  fill={SCALE_GRAY[1]}
                >
                  {stickinessLabel()}
                </text>
                <text x={4} y={model().footerTop + 32} font-size={SVG_TEXT} fill={TEXT_MUTED}>
                  {`dashed box = rows #1–#${model().topRows} → cols #1–#${model().topCols}`}
                </text>
                <text x={4} y={model().footerTop + 46} font-size={SVG_TEXT} fill={TEXT_MUTED}>
                  cell value = share of transitions
                </text>
                <text x={4} y={model().footerTop + 60} font-size={SVG_TEXT} fill={TEXT_MUTED}>
                  diagonal = stayed · labels ≥10%
                </text>
                <Show when={model().count !== null}>
                  <text
                    data-testid="history-persistence-count"
                    x={4}
                    y={model().footerTop + 74}
                    font-size={SVG_TEXT}
                    fill={TEXT_MUTED}
                  >
                    {`n=${model().count} monthly transitions`}
                  </text>
                </Show>
              </g>
            ) : undefined}
          </MatrixFrame>
        </div>
      </div>
    </div>
  );
}
