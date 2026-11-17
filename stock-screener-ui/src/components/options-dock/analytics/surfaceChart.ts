/**
 * Pure helpers for the strike × expiry IV surface. Kept DOM- and Solid-free so
 * the lattice (quoted vs. missing) can be asserted directly in tests and reused
 * by the panel without re-deriving it inside the chart option.
 *
 * Missing is a first-class cell here: every strike/expiry intersection exists
 * in the lattice, and a cell without a usable IV is returned in `missing`, not
 * dropped or zeroed.
 */

import type { SurfaceGrid } from "@/utils/optionsAnalyticsMath";
import * as palette from "@/ui/palette";

/** Chart text floor: the analytics band is 206px tall, sub-10px ticks vanish. */
export const CHART_LABEL_FONT_SIZE = 10;

/** Colour-bar geometry: a horizontal legend must be wider than it is tall. */
export const SURFACE_LEGEND_ITEM_WIDTH = 44;
export const SURFACE_LEGEND_ITEM_HEIGHT = 6;

/** At most this many strike labels across a 390–675px dock. */
export const SURFACE_MAX_X_LABELS = 7;

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function expiryShort(date: string): string {
  const parts = date.split("-");
  if (parts.length !== 3) return date;
  return `${parts[2]} ${MONTHS[Number(parts[1]) - 1] ?? parts[1]}`;
}

export function strikeLabel(strike: number): string {
  return strike >= 10_000 ? `${Math.round(strike / 1000)}k` : String(Math.round(strike));
}

/**
 * Explicit category-axis interval: `maxLabels` labels across `count` columns.
 * ECharts' `interval` is "show one label every interval + 1", so a 21-strike
 * lattice with a seven-label budget yields `2`. Width-independent, therefore
 * the same option is legible at 390 and 675px.
 */
export function categoryAxisInterval(count: number, maxLabels = SURFACE_MAX_X_LABELS): number {
  if (count <= 1 || count <= maxLabels) return 0;
  return Math.ceil(count / maxLabels) - 1;
}

/** Locale-independent grouping — ICU may be trimmed in test runtimes. */
function groupThousands(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

export interface SurfaceQuoteCell {
  strike: number;
  expiry: string;
  iv: number;
  /** Strike index in the aligned lattice. */
  x: number;
  /** Expiry index in the aligned lattice. */
  y: number;
}

export interface SurfaceMissingCell {
  strike: number;
  expiry: string;
  x: number;
  y: number;
}

export interface SurfaceChartCells {
  quotes: SurfaceQuoteCell[];
  missing: SurfaceMissingCell[];
}

/**
 * Split the full `strikes × expiries` lattice into quoted and missing cells.
 * A quoted cell is one `surfaceGrid` actually filled; every other intersection
 * is returned as missing so the UI can hatch/dim it explicitly.
 */
export function surfaceChartCells(grid: SurfaceGrid): SurfaceChartCells {
  const strikeIndex = new Map(grid.strikes.map((strike, index) => [strike, index]));
  const expiryIndex = new Map(grid.expiries.map((expiry, index) => [expiry, index]));
  const quoted = new Set(grid.cells.map((cell) => `${cell.expiry}|${cell.strike}`));

  const quotes: SurfaceQuoteCell[] = grid.cells.map((cell) => ({
    strike: cell.strike,
    expiry: cell.expiry,
    iv: cell.iv,
    x: strikeIndex.get(cell.strike) ?? -1,
    y: expiryIndex.get(cell.expiry) ?? -1,
  }));

  const missing: SurfaceMissingCell[] = [];
  for (const expiry of grid.expiries) {
    for (const strike of grid.strikes) {
      if (quoted.has(`${expiry}|${strike}`)) continue;
      missing.push({
        strike,
        expiry,
        x: strikeIndex.get(strike) ?? -1,
        y: expiryIndex.get(expiry) ?? -1,
      });
    }
  }

  return { quotes, missing };
}

/** Tooltip for a hatched intersection — never claim it is a 0-IV quote. */
export function missingCellTooltip(expiry: string, strike: number): string {
  return `No valid IV quote · ${expiryShort(expiry)} ${groupThousands(strike)}`;
}

export function selectedRowIndex(grid: SurfaceGrid, expiry: string | null): number | null {
  if (expiry == null) return null;
  const index = grid.expiries.indexOf(expiry);
  return index >= 0 ? index : null;
}

/** True only when the front expiry has at least one filled quote cell. */
export function frontHasQuotes(grid: SurfaceGrid): boolean {
  const front = grid.expiries[0];
  return front != null && grid.cells.some((cell) => cell.expiry === front);
}

export const SURFACE_METRIC_LABELS = {
  grid: "GRID",
  coverage: "COVERAGE",
  frontAtm: "FRONT ATM",
  skew: "25Δ RR",
} as const;

/** Shown instead of a bare dash when the front expiry has no quotes. */
export const NO_FRONT_QUOTES = "NO FRONT QUOTES";

export interface SurfaceChartInput {
  grid: SurfaceGrid;
  atmStrike: number | null;
  /** Index of the selected expiry row, or null when nothing is selected. */
  selectedRow: number | null;
  ink: string;
}

/**
 * Pure ECharts option for the strike × expiry heatmap. Exported so the axis,
 * legend and label placement are asserted without mounting a canvas.
 *
 * Axis names are omitted deliberately: `containLabel` does not reserve room for
 * them, and a 206px band cannot pay for a name row on two axes. The caption and
 * the tick formats carry the units instead.
 */
export function buildSurfaceOption(input: SurfaceChartInput): Record<string, unknown> {
  const { grid, atmStrike, selectedRow, ink } = input;
  const color = ink;
  const cells = surfaceChartCells(grid);
  const ivs = cells.quotes.map((cell) => cell.iv);
  const min = ivs.length ? Math.min(...ivs) : 0;
  const max = ivs.length ? Math.max(...ivs) : 1;
  const xLabels = grid.strikes.map(strikeLabel);
  const yLabels = grid.expiries.map(expiryShort);

  return {
    animation: false,
    backgroundColor: "transparent",
    // 18px of top room for the colour bar; it lives outside the grid so it can
    // never cover the strike ticks at the bottom.
    grid: { left: 2, right: 8, top: 18, bottom: 2, containLabel: true },
    tooltip: {
      position: "top",
      backgroundColor: palette.TOOLTIP_BG,
      borderColor: palette.TOOLTIP_BORDER,
      textStyle: { color: palette.OPTION_PAYOFF_TOOLTIP_TEXT, fontSize: 10 },
    },
    xAxis: {
      type: "category",
      data: xLabels,
      axisLine: { lineStyle: { color: palette.AXIS_LINE } },
      axisTick: { show: false },
      axisLabel: {
        color,
        fontSize: CHART_LABEL_FONT_SIZE,
        margin: 4,
        interval: categoryAxisInterval(xLabels.length),
        hideOverlap: true,
        rotate: 0,
      },
      splitArea: { show: false },
    },
    yAxis: {
      type: "category",
      data: yLabels,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color,
        fontSize: CHART_LABEL_FONT_SIZE,
        margin: 4,
        // Rows are only a few px tall in the 206px band; hide a label rather
        // than paint two expiries on top of each other.
        interval: "auto",
        hideOverlap: true,
      },
      splitArea: { show: false },
    },
    visualMap: {
      type: "continuous",
      min: Number(min.toFixed(1)),
      max: Number(Math.max(max, min + 0.1).toFixed(1)),
      calculable: false,
      orient: "horizontal",
      top: 0,
      right: 2,
      itemWidth: SURFACE_LEGEND_ITEM_WIDTH,
      itemHeight: SURFACE_LEGEND_ITEM_HEIGHT,
      // Only the quote series is colour-mapped; the hatched series keeps its
      // explicit low-contrast fill and is never read as an IV value.
      series: [0],
      text: ["High IV", "Low IV"],
      textGap: 4,
      textStyle: { color, fontSize: CHART_LABEL_FONT_SIZE },
      inRange: {
        color: [
          palette.SCALE_BLUE[8],
          palette.SCALE_BLUE[5],
          palette.RAMP_NEUTRAL,
          palette.SCALE_ORANGE[4],
          palette.SCALE_ORANGE[2],
        ],
      },
    },
    series: [
      {
        name: "IV",
        type: "heatmap",
        data: cells.quotes.map((cell) => [cell.x, cell.y, Number(cell.iv.toFixed(1))]),
        itemStyle: { borderColor: palette.BG, borderWidth: 0.5 },
        emphasis: { itemStyle: { borderColor: palette.TEXT, borderWidth: 1 } },
      },
      {
        name: "Missing",
        type: "heatmap",
        // The trailing 0 is a geometry placeholder only — `visualMap.series`
        // excludes this series, so it is never painted on the IV ramp.
        data: cells.missing.map((cell) => ({
          value: [cell.x, cell.y, 0],
          tooltip: { formatter: () => missingCellTooltip(cell.expiry, cell.strike) },
        })),
        itemStyle: {
          color: palette.SURFACE_ALT,
          borderColor: palette.BORDER,
          borderWidth: 0.5,
          decal: {
            symbol: "rect",
            symbolSize: 1,
            dashArrayX: [1, 5],
            dashArrayY: [1, 0],
            rotation: Math.PI / 4,
            color: palette.BORDER,
          },
        },
        emphasis: { itemStyle: { color: palette.SURFACE_ALT, borderColor: palette.TEXT } },
      },
      {
        name: "marks",
        type: "line",
        data: [],
        silent: true,
        markLine: {
          silent: true,
          symbol: "none",
          label: { show: true },
          data:
            atmStrike != null
              ? [
                  {
                    xAxis: strikeLabel(atmStrike),
                    lineStyle: { color: palette.PRIMARY, width: 1, type: "dashed" as const },
                    label: {
                      show: true,
                      position: "insideEndTop" as const,
                      formatter: "ATM",
                      color,
                      fontSize: CHART_LABEL_FONT_SIZE,
                      backgroundColor: palette.SURFACE,
                      padding: [1, 3],
                      borderRadius: 2,
                    },
                  },
                ]
              : [],
        },
        markArea:
          selectedRow != null
            ? {
                silent: true,
                itemStyle: { color: palette.alpha(palette.INFO, 0.14) },
                label: {
                  show: true,
                  formatter: "SEL",
                  position: "insideLeft",
                  color: palette.INFO,
                  fontSize: CHART_LABEL_FONT_SIZE,
                  backgroundColor: palette.SURFACE,
                  padding: [1, 3],
                  borderRadius: 2,
                },
                data: [[{ yAxis: yLabels[selectedRow] }, { yAxis: yLabels[selectedRow] }]],
              }
            : undefined,
      },
    ],
  };
}
