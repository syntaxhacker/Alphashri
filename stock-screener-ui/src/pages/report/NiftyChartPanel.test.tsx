// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import {
  CHART_HEIGHTS,
  NiftyChartPanel,
  LevelLegend,
  buildMarkLines,
  candlePriceRange,
  labelGapPctFor,
  levelBelongsToScale,
  levelsWithinScale,
  mergeCollidingLabels,
} from "./NiftyChartPanel";
import type { NiftyGex, NiftyReport } from "@/types/niftyReport";

vi.mock("@/components/chart/TradingViewChart", async () => {
  const React = await import("react");
  return {
    TradingViewChart: ({ candles, markLines, emaData, fitMarkLines, touchMarkers }: {
      candles?: unknown[];
      markLines?: { label: { formatter: string } }[];
      emaData?: unknown[];
      fitMarkLines?: boolean;
      touchMarkers?: { time: string; value: number }[];
    }) => {
      React.useEffect(() => {
        panelMocks.tvMounts += 1;
      }, []);
      return (
        <div
          data-testid="tradingview-chart"
          data-candles={candles?.length ?? 0}
          data-marklines={markLines?.length ?? 0}
          data-emas={emaData?.length ?? 0}
          data-fit-marklines={fitMarkLines ? "1" : "0"}
          data-touch-markers={touchMarkers?.length ?? 0}
        />
      );
    },
  };
});

const panelMocks = vi.hoisted(() => ({ tvMounts: 0, depthMounts: 0 }));

// forwardRef: NiftyDepthMap passes a ref for its manual resize/setOption
// driver (React 19 would tolerate a plain mock, but the ref would be lost).
vi.mock("echarts-for-react", async () => {
  const React = await import("react");
  const MockDepthChart = React.forwardRef(function MockDepthChart() {
    React.useEffect(() => {
      panelMocks.depthMounts += 1;
    }, []);
    return <div data-testid="nifty-depth-echarts" />;
  });
  return { default: MockDepthChart };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  panelMocks.tvMounts = 0;
  panelMocks.depthMounts = 0;
});

function Wrapper({ children }: { children: React.ReactNode }) {
  return <UIProvider>{children}</UIProvider>;
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: Wrapper });
}

function mockReport(overrides?: Record<string, unknown>): NiftyReport {
  return {
    mode: "live",
    date: "2026-10-12",
    expiry: "weekly",
    spot: 25750.5,
    ohlc: { open: 25600, high: 25800, low: 25550, close: 25750.5 },
    pcrOi: 1.12,
    pcrVol: 0.95,
    maxPain: 25700,
    walls: {
      calls: [
        { strike: 25800, oi: 5000 },
        { strike: 25900, oi: 4000 },
      ],
      puts: [
        { strike: 25600, oi: 6000 },
        { strike: 25500, oi: 4500 },
      ],
    },
    strikes: [],
    timeline: [],
    pivots: null,
    gex: null,
    intraday: [],
    candles: [],
    ...overrides,
  } as unknown as NiftyReport;
}

function candles3() {
  return [
    { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620, volume: 1000 },
    { time: "2026-10-12T09:16:00", open: 25620, high: 25680, low: 25600, close: 25640, volume: 1100 },
    { time: "2026-10-12T09:20:00", open: 25640, high: 25700, low: 25610, close: 25680, volume: 1200 },
  ];
}

/** Report with strikes inside ATM ±750 so the depth map renders its chart. */
function depthReport() {
  return mockReport({
    candles: candles3(),
    strikes: [
      { strike: 25700, ce: { oi: 2000 }, pe: { oi: 2500 } },
      { strike: 25800, ce: { oi: 9000 }, pe: { oi: 1000 } },
    ],
  });
}

describe("NiftyChartPanel", () => {
  test("renders chart, size + timeframe toggles and wrap (legend hidden)", () => {
    r(<NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />);
    expect(screen.getByTestId("nifty-chart-panel")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-tf-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-size")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-wrap")).toBeInTheDocument();
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "3");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-fit-marklines", "1");
    // Dense layout: levels are on the chart, no legend row in the panel.
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-empty")).not.toBeInTheDocument();
  });

  test("default fills; size toggle pins S 180px → XL 760px", async () => {
    const user = userEvent.setup();
    r(<NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />);
    // Default = fill: no fixed height, autoSize chart.
    const wrap = screen.getByTestId("nifty-chart-wrap");
    expect(wrap).toHaveAttribute("data-fill", "1");
    expect(wrap).not.toHaveStyle({ height: "180px" });
    await user.click(screen.getByRole("button", { name: "XL" }));
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveStyle({ height: "760px" });
    expect(screen.getByTestId("nifty-chart-wrap")).not.toHaveAttribute("data-fill");
    await user.click(screen.getByRole("button", { name: "S" }));
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveStyle({ height: "180px" });
    // same candles, same overlays — only the height changed
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "3");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-emas", "2");
  });

  test("fill mode caps the body; size changes notify the parent", async () => {
    const user = userEvent.setup();
    const onSizeChange = vi.fn();
    r(
      <NiftyChartPanel
        report={mockReport({ candles: candles3() })}
        mode="live"
        view="chart"
        onSizeChange={onSizeChange}
      />,
    );
    const wrap = screen.getByTestId("nifty-chart-wrap");
    // DESK reads at a glance: the auto chart stops at 300px (floor 260).
    expect(wrap).toHaveStyle({ maxHeight: "300px", minHeight: "260px" });
    await user.click(screen.getByRole("button", { name: "XL" }));
    // A manual preset drops the cap so S/M/L/XL keep their exact height.
    const xl = screen.getByTestId("nifty-chart-wrap");
    expect(xl).toHaveStyle({ height: "760px" });
    expect(xl).not.toHaveStyle({ maxHeight: "300px" });
    expect(onSizeChange).toHaveBeenLastCalledWith("xl");
  });

  test("timeframe toggle resamples 1m → 5m client-side", async () => {
    const user = userEvent.setup();
    r(<NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />);
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "3");
    // 09:15 + 09:16 fold into one 5m bucket, 09:20 starts the next → 2 bars
    await user.click(screen.getByRole("button", { name: "5m" }));
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "2");
    await user.click(screen.getByRole("button", { name: "1m" }));
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "3");
  });

  test("depth view keeps the chart mounted but hidden; toggles stay hidden", async () => {
    const user = userEvent.setup();
    const { rerender } = r(
      <NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />,
    );
    rerender(
      <NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="depth" />,
    );
    expect(await screen.findByTestId("nifty-depthmap")).toBeInTheDocument();
    // Both views stay mounted now (instant switching): the chart wrapper is
    // display:none instead of unmounted.
    expect(screen.getByTestId("tradingview-chart")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-view")).toHaveStyle({ display: "none" });
    expect(screen.getByTestId("nifty-depth-view")).not.toHaveStyle({ display: "none" });
    expect(screen.queryByTestId("nifty-tf-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-size")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
    void user;
  });

  test("lazy depth mount: no depth subtree until first depth view", () => {
    const { rerender } = r(
      <NiftyChartPanel report={depthReport()} mode="live" view="chart" />,
    );
    expect(screen.getByTestId("tradingview-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-depth-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-depthmap")).not.toBeInTheDocument();
    expect(panelMocks.depthMounts).toBe(0);

    rerender(<NiftyChartPanel report={depthReport()} mode="live" view="depth" />);
    expect(screen.getByTestId("nifty-depthmap")).toBeInTheDocument();
    expect(panelMocks.depthMounts).toBe(1);
  });

  test("Chart→Depth→Chart→Depth mounts ECharts once and never remounts the chart", () => {
    const report = depthReport();
    const { rerender } = r(
      <NiftyChartPanel report={report} mode="live" view="chart" />,
    );
    expect(panelMocks.tvMounts).toBe(1);
    expect(panelMocks.depthMounts).toBe(0);

    rerender(<NiftyChartPanel report={report} mode="live" view="depth" />);
    expect(panelMocks.depthMounts).toBe(1);
    expect(screen.getByTestId("nifty-chart-view")).toHaveStyle({ display: "none" });
    expect(screen.getByTestId("nifty-depth-view")).not.toHaveStyle({ display: "none" });

    rerender(<NiftyChartPanel report={report} mode="live" view="chart" />);
    expect(screen.getByTestId("nifty-chart-view")).not.toHaveStyle({ display: "none" });
    expect(screen.getByTestId("nifty-depth-view")).toHaveStyle({ display: "none" });

    rerender(<NiftyChartPanel report={report} mode="live" view="depth" />);
    // Still exactly one mount each — switching only flips visibility.
    expect(panelMocks.depthMounts).toBe(1);
    expect(panelMocks.tvMounts).toBe(1);
    expect(screen.getByTestId("nifty-depth-view")).not.toHaveStyle({ display: "none" });
    expect(screen.getByTestId("nifty-chart-view")).toHaveStyle({ display: "none" });
  });

  test("empty candles render the empty state, not the chart", () => {
    r(<NiftyChartPanel report={mockReport()} mode="live" view="chart" />);
    expect(screen.getByTestId("nifty-chart-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-wrap")).not.toBeInTheDocument();
  });

  test("marks bars whose close touches max pain and exposes the count", () => {
    // closes are 25620 / 25640 / 25680 → only the last is within 10 pts.
    r(<NiftyChartPanel report={mockReport({ candles: candles3(), maxPain: 25680 })} mode="live" view="chart" />);
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveAttribute("data-mp-touches", "1");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-touch-markers", "1");
  });

  test("no markers when no bar closes on max pain", () => {
    r(<NiftyChartPanel report={mockReport({ candles: candles3(), maxPain: 25700 })} mode="live" view="chart" />);
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveAttribute("data-mp-touches", "0");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-touch-markers", "0");
  });

  test("memo: same report reference keeps the wrap DOM node across parent re-renders", () => {
    const report = mockReport({ candles: candles3() });
    const { rerender } = r(<NiftyChartPanel report={report} mode="live" view="chart" />);
    const wrap = screen.getByTestId("nifty-chart-wrap");
    rerender(
      <NiftyChartPanel report={report} mode="live" view="chart" />,
    );
    // React.memo bailed out — the identical DOM node survived the re-render.
    expect(screen.getByTestId("nifty-chart-wrap")).toBe(wrap);
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
  });
});

/** Minimal GEX block; levels are filled per test. */
function gex(overrides: Partial<NiftyGex> = {}): NiftyGex {
  return {
    strikes: [],
    netTotal: 10,
    regime: "long",
    topPositive: [],
    topNegative: [],
    zeroCross: 25650,
    ...overrides,
  };
}

const gexLabels = (report: NiftyReport) =>
  buildMarkLines(report, true).map((l) => l.label.formatter);

describe("NiftyChartPanel live GEX overlay", () => {
  test("all four levels present: one pin/fuel per side is drawn and the legend matches", () => {
    const gexBlock = gex({
      levels: {
        support: { strike: 25400, netGex: 5, side: "below" },
        resistance: { strike: 26000, netGex: 4, side: "above" },
        fuelDown: { strike: 25300, netGex: -6, side: "below" },
        fuelUp: { strike: 26050, netGex: -5, side: "above" },
      },
    });
    const report = mockReport({ gex: gexBlock });
    const labels = gexLabels(report);
    // A side prefers its pin magnet: support below, resistance above. The
    // same-side fuel entries are alternatives, so no GFUEL line exists.
    expect(labels).toContain("GSUP 25400");
    expect(labels).toContain("GRES 26000");
    expect(labels).toContain("FLIP 25650");
    expect(labels.some((l) => l.startsWith("GFUEL"))).toBe(false);

    r(<NiftyChartPanel report={report} mode="live" view="chart" />);
    // The dense panel no longer renders the legend row; the exported
    // component still decodes the same codes for callers.
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
    r(<LevelLegend live gex={report.gex} spot={report.spot} />);
    const legend = screen.getByTestId("nifty-level-legend");
    for (const code of ["FLIP", "GSUP", "GRES"]) {
      expect(within(legend).getByText(code, { exact: true })).toBeInTheDocument();
    }
    // It cannot be drawn, so the legend must not advertise it.
    expect(within(legend).queryByText("GFUEL", { exact: true })).not.toBeInTheDocument();
  });

  test("today's shape (resistance + fuel_down) keeps GRES/GFUEL even on wall strikes", () => {
    // 2026-10-21 live tape: GRES 23,000 is also the top call wall and GFUEL
    // 22,500 is also a put wall; FLIP 23,300 is also pivot R2. The old
    // fresh() dedupe dropped all three. They must merge, not vanish.
    const report = mockReport({
      spot: 22718.4,
      maxPain: 22900,
      // Actual 2026-10-21 session range: 22,703–23,121. It makes GRES 23,000
      // a visible level while the 22,500 fuel and 23,300 R2 stay far away.
      intraday: [
        { time: "2026-10-21T09:15:00+05:30", open: 22760, high: 22780, low: 22703, close: 22740 },
        { time: "2026-10-21T13:20:00+05:30", open: 23050, high: 23121, low: 23020, close: 23100 },
      ],
      walls: {
        calls: [
          { strike: 23000, oi: 16256890 },
          { strike: 23500, oi: 15045355 },
        ],
        puts: [
          { strike: 22000, oi: 9676810 },
          { strike: 22500, oi: 9281415 },
        ],
      },
      pivots: {
        type: "classic",
        pp: 22969.73, r1: 23094.47, r2: 23299.98, r3: 23424.72,
        s1: 22764.22, s2: 22639.48, s3: 22433.97,
        prev: null,
      },
      gex: gex({
        strikes: [],
        regime: "short",
        levels: {
          support: null,
          resistance: { strike: 23000, netGex: 18.16, side: "above" },
          fuelDown: { strike: 22500, netGex: -10.73, side: "below" },
          fuelUp: null,
        },
        zeroCross: 23300,
      }),
    });
    const lines = buildMarkLines(report, true);
    const labels = lines.map((l) => l.label.formatter);
    const gres = lines.find((l) => l.label.formatter.includes("GRES"));
    const gfuel = lines.find((l) => l.label.formatter.includes("GFUEL"));
    const flip = lines.find((l) => l.label.formatter.includes("FLIP"));
    expect(labels).toContain("CW 23000 · GRES");
    expect(labels).toContain("PW 22500 · GFUEL↓");
    expect(labels).toContain("R2 23,300 · FLIP");
    expect(gres?.yAxis).toBe(23000);
    expect(gres?.lineStyle.color).toBe(palette.NEGATIVE);
    // GRES 23,000 is inside the session range → it may extend the scale.
    expect(gres?.includeInScale).toBe(true);
    expect(gfuel?.yAxis).toBe(22500);
    expect(gfuel?.lineStyle.color).toBe(palette.WARNING);
    // 22,500 is 218 pts below spot and outside the 22,703–23,121 session:
    // still drawn, but it must not widen the price scale.
    expect(gfuel?.includeInScale).toBe(false);
    expect(flip?.lineStyle.color).toBe(palette.WARNING);
    expect(flip?.lineStyle.type).toBe("dotted");
    // 23,300 R2/FLIP is 580 pts above spot and outside the session pad too.
    expect(flip?.includeInScale).toBe(false);
    // Walls stay out of the scale so a far call wall doesn't squash the candles.
    expect(lines.find((l) => l.label.formatter === "CW 23500")?.includeInScale).toBeFalsy();

    r(<NiftyChartPanel report={report} mode="live" view="chart" />);
    // The dense panel no longer renders the legend row; the exported
    // component still decodes the same codes for callers.
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
    r(<LevelLegend live gex={report.gex} spot={report.spot} />);
    const legend = screen.getByTestId("nifty-level-legend");
    for (const code of ["FLIP", "GRES", "GFUEL"]) {
      expect(within(legend).getByText(code, { exact: true })).toBeInTheDocument();
    }
    // support is null and the below side resolved to fuel, never GSUP
    expect(within(legend).queryByText("GSUP", { exact: true })).not.toBeInTheDocument();
  });

  test("all levels null: no GEX lines, legend keeps only FLIP when zero_cross exists", () => {
    const report = mockReport({
      gex: gex({
        strikes: [],
        levels: { support: null, resistance: null, fuelDown: null, fuelUp: null },
        zeroCross: 23300,
      }),
    });
    const labels = gexLabels(report);
    expect(labels.some((l) => /GSUP|GRES|GFUEL/.test(l))).toBe(false);
    expect(labels).toContain("FLIP 23300");

    r(<NiftyChartPanel report={report} mode="live" view="chart" />);
    // The dense panel no longer renders the legend row; the exported
    // component still decodes the same codes for callers.
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
    r(<LevelLegend live gex={report.gex} spot={report.spot} />);
    const legend = screen.getByTestId("nifty-level-legend");
    expect(within(legend).getByText("FLIP", { exact: true })).toBeInTheDocument();
    for (const code of ["GSUP", "GRES", "GFUEL"]) {
      expect(within(legend).queryByText(code, { exact: true })).not.toBeInTheDocument();
    }
  });

  test("all null with no zero_cross: FLIP is not advertised or drawn", () => {
    const report = mockReport({
      gex: gex({
        strikes: [],
        levels: { support: null, resistance: null, fuelDown: null, fuelUp: null },
        zeroCross: null,
      }),
    });
    expect(gexLabels(report).some((l) => /FLIP|GSUP|GRES|GFUEL/.test(l))).toBe(false);

    r(<NiftyChartPanel report={report} mode="live" view="chart" />);
    // The dense panel no longer renders the legend row; the exported
    // component still decodes the same codes for callers.
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
    r(<LevelLegend live gex={report.gex} spot={report.spot} />);
    const legend = screen.getByTestId("nifty-level-legend");
    for (const code of ["FLIP", "GSUP", "GRES", "GFUEL"]) {
      expect(within(legend).queryByText(code, { exact: true })).not.toBeInTheDocument();
    }
  });
});

/** 2026-10-21 session tape: candles 22,703–23,121, spot ~22,740. */
function sessionReport(overrides: Record<string, unknown> = {}) {
  return mockReport({
    spot: 22740,
    intraday: [
      { time: "2026-10-21T09:15:00+05:30", open: 22760, high: 22780, low: 22703, close: 22740 },
      { time: "2026-10-21T13:20:00+05:30", open: 23050, high: 23121, low: 23020, close: 23100 },
    ],
    ...overrides,
  });
}

describe("levelsWithinScale", () => {
  test("keeps only levels within ±0.6% of spot (≈±136 pts at 22,740)", () => {
    expect(levelsWithinScale([22500, 22700, 22800, 23300], 22740)).toEqual([22700, 22800]);
  });

  test("supports a custom pct and rejects an invalid spot", () => {
    expect(levelsWithinScale([22000, 23000], 22740, 0.05)).toEqual([22000, 23000]);
    expect(levelsWithinScale([22500], Number.NaN)).toEqual([]);
    expect(levelsWithinScale([22500], 0)).toEqual([]);
  });
});

describe("levelBelongsToScale", () => {
  const session = { low: 22703, high: 23121 };

  test("far levels stay out of the scale even when they are valid lines", () => {
    expect(levelBelongsToScale(22500, 22740, session)).toBe(false); // fuel
    expect(levelBelongsToScale(23300, 22740, session)).toBe(false); // R2/FLIP
  });

  test("near levels inside spot band or the session ±5% pad are included", () => {
    expect(levelBelongsToScale(22700, 22740, session)).toBe(true);
    expect(levelBelongsToScale(23000, 22740, session)).toBe(true);
    // 22,650 is outside the session but 90 pts from spot → within ±0.6%.
    expect(levelBelongsToScale(22650, 22740, session)).toBe(true);
  });

  test("short panels merge labels over a wider price gap than tall panels", () => {
    const short = labelGapPctFor(sessionReport(), CHART_HEIGHTS.s);
    const tall = labelGapPctFor(sessionReport(), CHART_HEIGHTS.xl);
    expect(short).toBeGreaterThan(tall);
    // ~20px of a 180px panel is ~11% of the 418-pt session ≈ 46 pts.
    expect(short * 22740).toBeGreaterThan(35);
    // Tall panels bottom out at the base 0.1% gap (~23 pts).
    expect(tall * 22740).toBeLessThanOrEqual(25);
  });

  test("candlePriceRange prefers intraday, then candles, then OHLC", () => {
    expect(candlePriceRange(sessionReport())).toEqual({ low: 22703, high: 23121 });
    expect(
      candlePriceRange(
        sessionReport({
          intraday: [],
          candles: [
            { time: "2026-10-21T09:15:00", open: 22710, high: 22800, low: 22690, close: 22750, volume: 0 },
          ],
        }),
      ),
    ).toEqual({ low: 22690, high: 22800 });
    expect(
      candlePriceRange(sessionReport({ intraday: [], candles: [], ohlc: { open: 1, high: 100, low: 50, close: 80 } })),
    ).toEqual({ low: 50, high: 100 });
  });

  test("window far from the last price: the bar-edge level still belongs to the scale", () => {
    // 2026-10-21 13:50 regression: visible bars 22,680–22,880 (10:00 ≈
    // 22,880 → 13:35 ≈ 22,680) with the last price at 22,690. A level at the
    // 22,880 bar edge is 190 pts above spot — outside the ±0.6% spot band
    // (≈±136) — but it is the top of the rendered window, so it must stay in
    // the scale via the bars-range ±5% rule instead of collapsing the axis to
    // a tight last-price slice.
    const report = sessionReport({
      spot: 22690,
      intraday: [
        { time: "2026-10-21T10:00:00+05:30", open: 22860, high: 22880, low: 22840, close: 22850 },
        { time: "2026-10-21T13:35:00+05:30", open: 22700, high: 22720, low: 22680, close: 22690 },
      ],
      walls: {
        calls: [{ strike: 22880, oi: 9000 }],
        puts: [{ strike: 22500, oi: 8000 }],
      },
      pivots: null,
    });
    expect(candlePriceRange(report)).toEqual({ low: 22680, high: 22880 });
    const lines = buildMarkLines(report);
    // 22,880 is drawn AND in-scale (bar edge, inside the range pad)…
    expect(lines.find((l) => l.yAxis === 22880)?.includeInScale).toBe(true);
    // …while the far 22,500 put wall stays drawn but out of the scale.
    const far = lines.find((l) => l.yAxis === 22500);
    expect(far).toBeTruthy();
    expect(far?.includeInScale).toBe(false);
  });
});

describe("mergeCollidingLabels", () => {
  const line = (yAxis: number, formatter: string) => ({
    yAxis,
    lineStyle: { color: "#fff", type: "solid", width: 1 },
    label: { position: "insideEndTop", formatter },
  });

  test("two labels inside the collision gap collapse into one label", () => {
    const out = mergeCollidingLabels(
      [line(22897, "PP 22,897"), line(22900, "MP 22900")],
      22740,
    );
    expect(out).toHaveLength(1);
    expect(out[0].label.formatter).toBe("PP 22,897 · MP");
  });

  test("labels beyond the gap are untouched", () => {
    const out = mergeCollidingLabels([line(22900, "MP 22900"), line(23000, "CW 23000")], 22740);
    expect(out).toHaveLength(2);
    expect(out.map((l) => l.label.formatter)).toEqual(["MP 22900", "CW 23000"]);
  });

  test("keeps codes from an already-merged GEX label", () => {
    const out = mergeCollidingLabels(
      [line(22900, "CW 23000 · GRES"), line(22905, "PP 22900")],
      22740,
    );
    expect(out).toHaveLength(1);
    expect(out[0].label.formatter).toContain("GRES");
    expect(out[0].label.formatter).toContain("PP");
  });

  test("buildMarkLines merges a colliding near-level pair", () => {
    const labels = buildMarkLines(
      sessionReport({
        maxPain: 22700,
        walls: { calls: [{ strike: 22705, oi: 9000 }], puts: [] },
        pivots: null,
      }),
    ).map((l) => l.label.formatter);
    // MP 22700 + CW 22705 are 5 pts apart → one gutter label, no duplicates.
    expect(labels.filter((l) => l.includes("MP 22700") || l.includes("CW 22705"))).toHaveLength(1);
    expect(labels.join(" ")).toContain("MP 22700 · CW");
  });
});
