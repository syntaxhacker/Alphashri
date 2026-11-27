// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import type { AnalyticsExpiry, OptionsAnalytics } from "@/api/optionsAnalytics";
import { SURFACE_MAX_STRIKES } from "@/config/optionsAnalytics";
import { surfaceGrid } from "@/utils/optionsAnalyticsMath";

const chartStub = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
vi.mock("@/utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chartStub) })),
}));

import { SurfacePanel } from "./SurfacePanel";
import {
  buildSurfaceOption,
  categoryAxisInterval,
  frontHasQuotes,
  missingCellTooltip,
  selectedRowIndex,
  surfaceChartCells,
} from "./surfaceChart";

function expiry(date: string, dte: number, rows: [number, number][]): AnalyticsExpiry {
  return {
    date,
    dte,
    atmIv: null,
    rr25: null,
    bf25: null,
    slope: null,
    fitR2: null,
    points: rows.map(([strike, iv]) => ({ strike, iv, delta: 0.3, oi: 100, moneyness: null })),
  };
}

function analytics(expiries: AnalyticsExpiry[]): OptionsAnalytics {
  return {
    symbol: "NIFTY",
    spot: 100,
    asOf: null,
    quotesLive: true,
    expiries,
    term: [],
    surface: { strikes: [], expiries: [], iv: [], missing: [] },
    levels: {
      callWall: null,
      putWall: null,
      maxPain: null,
      gex: { support: null, resistance: null, fuelUp: null, fuelDown: null },
    },
    probability: {
      model: null,
      flatPop: null,
      skewPop: null,
      expectedPnl: null,
      sigma: null,
      density: [],
      quantiles: { p05: null, p25: null, p50: null, p75: null, p95: null },
      cone: [],
    },
    warnings: [],
  };
}

const data = () =>
  analytics([
    expiry("2026-11-19", 3, [
      [100, 12],
      [105, 12.5],
      [110, 13],
      [115, 13.5],
    ]),
    expiry("2026-11-26", 10, [
      [100, 11],
      [105, 11.6],
      // 121 is more than one tick from 115, so that intersection stays empty.
      [121, 12],
    ]),
  ]);

/** Front expiry has strikes but no usable IV; the back expiry is fully quoted. */
const noFrontData = (): OptionsAnalytics => ({
  ...analytics([]),
  expiries: [
    {
      ...expiry("2026-11-19", 3, []),
      points: [
        { strike: 100, iv: null, delta: null, oi: null, moneyness: null },
        { strike: 105, iv: null, delta: null, oi: null, moneyness: null },
      ],
    },
    expiry("2026-11-26", 10, [
      [100, 11],
      [105, 11.6],
    ]),
  ],
});

type Series = {
  name?: string;
  data?: unknown[];
  itemStyle?: { color?: string; decal?: unknown };
  markLine?: { data?: any[] };
  markArea?: { data?: any[]; label?: { formatter?: string } };
};
type AxisLabel = {
  fontSize?: number;
  interval?: number | "auto";
  hideOverlap?: boolean;
  rotate?: number;
};
type Option = {
  grid?: { containLabel?: boolean; left?: number; right?: number; top?: number; bottom?: number };
  series?: Series[];
  visualMap?: {
    itemWidth?: number;
    itemHeight?: number;
    orient?: string;
    top?: number;
    bottom?: number;
    inRange?: { color?: string[] };
    text?: string[];
    textStyle?: { fontSize?: number };
    series?: number[];
  };
  xAxis?: { name?: string; axisLabel?: AxisLabel };
  yAxis?: { name?: string; axisLabel?: AxisLabel };
};
const option = (): Option => (chartStub.setOption.mock.calls.at(-1)?.[0] ?? {}) as Option;

afterEach(() => {
  cleanup();
  chartStub.setOption.mockClear();
  chartStub.dispose.mockClear();
});

describe("surfaceChart lattice helpers", () => {
  test("splits the full lattice into quoted and missing cells", () => {
    const grid = surfaceGrid(data(), SURFACE_MAX_STRIKES);
    const cells = surfaceChartCells(grid);

    // Front 4 + back 3 quoted; the back 115 intersection is the one hole.
    expect(cells.quotes).toHaveLength(7);
    expect(cells.missing).toHaveLength(grid.total - grid.coverage);
    expect(cells.missing).toHaveLength(1);
    expect(cells.missing[0]).toMatchObject({ expiry: "2026-11-26", strike: 115, x: 3, y: 1 });
  });

  test("returns the selected expiry index, or null when absent", () => {
    const grid = surfaceGrid(data(), SURFACE_MAX_STRIKES);
    expect(selectedRowIndex(grid, "2026-11-19")).toBe(0);
    expect(selectedRowIndex(grid, "2026-11-26")).toBe(1);
    expect(selectedRowIndex(grid, "2026-11-01")).toBeNull();
    expect(selectedRowIndex(grid, null)).toBeNull();
  });

  test("detects whether the front expiry has any quotes", () => {
    expect(frontHasQuotes(surfaceGrid(data(), SURFACE_MAX_STRIKES))).toBe(true);
    expect(frontHasQuotes(surfaceGrid(noFrontData(), SURFACE_MAX_STRIKES))).toBe(false);
  });

  test("formats a missing-cell tooltip without claiming a zero IV", () => {
    expect(missingCellTooltip("2026-12-29", 3000)).toBe("No valid IV quote · 29 DEC 3,000");
  });
});

describe("surfaceChart option builder — legibility", () => {
  const build = (source = data()) => {
    const grid = surfaceGrid(source, SURFACE_MAX_STRIKES);
    return buildSurfaceOption({ grid, atmStrike: 100, selectedRow: 0, ink: "#c8ccd4" });
  };

  test("categoryAxisInterval keeps 21 strikes to seven labels", () => {
    expect(categoryAxisInterval(21)).toBe(2);
    expect(categoryAxisInterval(6)).toBe(0);
    expect(categoryAxisInterval(1)).toBe(0);
    expect(categoryAxisInterval(70)).toBe(9);
  });

  test("uses 10px ticks, containLabel and an explicit strike interval", () => {
    const option = build() as Option;
    expect(option.grid!.containLabel).toBe(true);
    expect(option.xAxis!.axisLabel!.fontSize).toBeGreaterThanOrEqual(10);
    expect(option.yAxis!.axisLabel!.fontSize).toBeGreaterThanOrEqual(10);
    expect(option.yAxis!.axisLabel!.interval).toBe("auto");
    expect(option.yAxis!.axisLabel!.hideOverlap).toBe(true);
    // Four strikes fit without thinning; 21 would step by two.
    expect(option.xAxis!.axisLabel!.interval).toBe(categoryAxisInterval(4));
    expect(option.xAxis!.axisLabel!.rotate).toBe(0);
  });

  test("keeps the ATM mark label inside the plot", () => {
    const option = build() as Option;
    const marks = option.series!.find((series) => series.name === "marks")!;
    const atm = marks.markLine!.data![0];
    expect(atm.label.position).toBe("insideEndTop");
    expect(atm.label.fontSize).toBeGreaterThanOrEqual(10);
  });
});

describe("SurfacePanel", () => {
  test("draws quoted cells on the IV ramp and hatched cells off-ramp", async () => {
    render(() => (
      <UIProvider>
        <SurfacePanel data={data()} selectedExpiry="2026-11-19" />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const heatmap = option().series!.find((series) => series.name === "IV")!;
    // Present cells only: a missing intersection is never painted as a 0.
    expect(heatmap.data).toHaveLength(7);
    expect(heatmap.data!.every((cell) => (cell as number[])[2] > 0)).toBe(true);

    const missing = option().series!.find((series) => series.name === "Missing")!;
    expect(missing.data).toHaveLength(1);
    expect(missing.itemStyle!.color).toBe(palette.SURFACE_ALT);
    expect(missing.itemStyle!.decal).toBeDefined();

    const visualMap = option().visualMap!;
    expect(visualMap.series).toEqual([0]);
    // A horizontal colour bar must be wider than it is tall — the old 8×56
    // geometry was a vertical strip anchored in the x-axis band.
    expect(visualMap.itemWidth).toBeGreaterThan(visualMap.itemHeight!);
    expect(visualMap.itemHeight).toBe(6);
    expect(visualMap.inRange!.color).toContain(palette.RAMP_NEUTRAL);
  });

  test("labels the IV colour scale above the grid, clear of the strike ticks", async () => {
    render(() => (
      <UIProvider>
        <SurfacePanel data={data()} selectedExpiry="2026-11-19" />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    expect(option().visualMap!.text).toEqual(["High IV", "Low IV"]);
    expect(option().visualMap!.orient).toBe("horizontal");
    expect(option().visualMap!.top).toBe(0);
    expect(option().visualMap!.bottom).toBeUndefined();
    expect(option().visualMap!.textStyle!.fontSize).toBeGreaterThanOrEqual(10);

    // No canvas axis names: they would overlap the 10px tick labels.
    expect(option().xAxis!.name).toBeUndefined();
    expect(option().yAxis!.name).toBeUndefined();
  });

  test("marks the ATM column and highlights the selected expiry row with a SEL band", async () => {
    render(() => (
      <UIProvider>
        <SurfacePanel data={data()} selectedExpiry="2026-11-19" />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const marks = option().series!.find((series) => series.name === "marks")!;
    expect(marks.markLine!.data!.some((mark) => mark.xAxis === "100")).toBe(true);
    expect(marks.markArea!.data![0][0].yAxis).toBe("19 NOV");
    expect(marks.markArea!.label!.formatter).toBe("SEL");
  });

  test("omits the selection band when no expiry is selected", async () => {
    render(() => (
      <UIProvider>
        <SurfacePanel data={data()} selectedExpiry={null} />
      </UIProvider>
    ));
    await waitFor(() => expect(chartStub.setOption).toHaveBeenCalled());

    const marks = option().series!.find((series) => series.name === "marks")!;
    expect(marks.markArea).toBeUndefined();
    expect(marks.markLine!.data!.some((mark) => mark.xAxis === "100")).toBe(true);
  });

  test("prints GRID/COVERAGE/FRONT ATM/25Δ RR with the new labels", async () => {
    render(() => (
      <UIProvider>
        <SurfacePanel data={data()} selectedExpiry={null} />
      </UIProvider>
    ));
    await waitFor(() => expect(screen.getByTestId("surface-metric-grid-value")).toHaveTextContent("4×2"));

    expect(screen.getByText("GRID")).toBeInTheDocument();
    expect(screen.getByText("COVERAGE")).toBeInTheDocument();
    expect(screen.getByText("FRONT ATM")).toBeInTheDocument();
    expect(screen.getByText("25Δ RR")).toBeInTheDocument();
    expect(screen.getByTestId("surface-metric-coverage-value")).toHaveTextContent("88%");
    expect(screen.getByTestId("surface-metric-ridge-value")).toHaveTextContent("12.0");
    expect(screen.getByTestId("surface-metric-skew-value")).toHaveTextContent("—");
  });

  test("shows NO FRONT QUOTES instead of a bare dash when the front has no quotes", async () => {
    render(() => (
      <UIProvider>
        <SurfacePanel data={noFrontData()} selectedExpiry={null} />
      </UIProvider>
    ));
    await waitFor(() =>
      expect(screen.getAllByText("NO FRONT QUOTES")).toHaveLength(2),
    );
    expect(screen.getByTestId("surface-metric-coverage-value")).toHaveTextContent("50%");
  });

  test("captions hatched gaps as missing rather than zero", async () => {
    render(() => (
      <UIProvider>
        <SurfacePanel data={data()} selectedExpiry={null} />
      </UIProvider>
    ));
    await waitFor(() => expect(screen.getByTestId("surface-caption")).toHaveTextContent(
      "Strikes × expiries · blank/hatched = no valid IV quote (not zero)",
    ));
    expect((screen.getByTestId("surface-caption") as HTMLElement).style.fontSize).toBe("12px");
  });

  test("shows No surface grid for an empty payload", async () => {
    render(() => (
      <UIProvider>
        <SurfacePanel data={analytics([])} selectedExpiry={null} />
      </UIProvider>
    ));
    await waitFor(() => expect(screen.getByTestId("surface-chart-empty")).toHaveTextContent("No surface grid"));
    expect(screen.getByTestId("surface-metric-grid-value")).toHaveTextContent("0×0");
    expect(screen.getByTestId("surface-metric-coverage-value")).toHaveTextContent("0%");
  });
});
