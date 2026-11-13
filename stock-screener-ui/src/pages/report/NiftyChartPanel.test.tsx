// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
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
  const { onMount } = await import("solid-js");
  return {
    TradingViewChart: (props: {
      candles?: { open: number; high: number; low: number; close: number }[];
      markLines?: { label: { formatter: string } }[];
      emaData?: unknown[];
      fitMarkLines?: boolean;
      touchMarkers?: { time: string; value: number }[];
    }) => {
      onMount(() => {
        panelMocks.tvMounts += 1;
      });
      const first = () => props.candles?.[0];
      return (
        <div
          data-testid="tradingview-chart"
          data-candles={props.candles?.length ?? 0}
          data-first-open={first()?.open}
          data-first-high={first()?.high}
          data-first-low={first()?.low}
          data-first-close={first()?.close}
          data-marklines={props.markLines?.length ?? 0}
          data-markline-labels={(props.markLines ?? []).map((l) => l.label.formatter).join("|")}
          data-emas={props.emaData?.length ?? 0}
          data-fit-marklines={props.fitMarkLines ? "1" : "0"}
          data-touch-markers={props.touchMarkers?.length ?? 0}
        />
      );
    },
  };
});

const panelMocks = vi.hoisted(() => ({ tvMounts: 0, depthMounts: 0 }));

// DepthChart mock: counts mounts; renders a stand-in with the same testid.
vi.mock("./DepthChart", async () => {
  const { onMount } = await import("solid-js");
  const MockDepthChart = () => {
    onMount(() => {
      panelMocks.depthMounts += 1;
    });
    return <div data-testid="nifty-depth-echarts" />;
  };
  return { DepthChart: MockDepthChart };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  panelMocks.tvMounts = 0;
  panelMocks.depthMounts = 0;
});

function r(ui: () => JSX.Element) {
  return render(() => <UIProvider>{ui()}</UIProvider>);
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
  test("flipAt draws a no-text marker on the candle close at that time", () => {
    const [report, setReport] = createSignal(mockReport({ candles: candles3() }));
    const [flipAt, setFlipAt] = createSignal("2026-10-12T09:16:00");
    r(() => <NiftyChartPanel report={report()} mode="live" view="chart" flipAt={flipAt()} />);
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveAttribute("data-flip-marker", "1");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-touch-markers", "1");
    setFlipAt(undefined as unknown as string);
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveAttribute("data-flip-marker", "0");
  });

  test("an invalid flipAt draws no marker", () => {
    r(() => (
      <NiftyChartPanel
        report={mockReport({ candles: candles3() })}
        mode="live"
        view="chart"
        flipAt="not-a-date"
      />
    ));
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveAttribute("data-flip-marker", "0");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-touch-markers", "0");
  });

  test("an omitted flipAt draws no marker", () => {
    r(() => <NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />);
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveAttribute("data-flip-marker", "0");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-touch-markers", "0");
  });

  test("a flipAt between two candles marks the candle at/before it", () => {
    // 09:17:30 sits between the 09:16 and 09:20 closes → the marker lands on
    // the 09:16 candle (the last close at/before the flip stamp).
    r(() => (
      <NiftyChartPanel
        report={mockReport({ candles: candles3() })}
        mode="live"
        view="chart"
        flipAt="2026-10-12T09:17:30"
      />
    ));
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveAttribute("data-flip-marker", "1");
    // The flip marker is one of the chart's touch markers (no max-pain touches
    // here: maxPain 25,700 vs closes 25,620/25,640/25,680, no bursts).
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-touch-markers", "1");
  });

  test("renders chart, size + timeframe toggles and wrap (legend hidden)", () => {
    r(() => <NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />);
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
    r(() => <NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />);
    // Default = "fill": no fixed height, autoSize chart.
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
    r(() => (
      <NiftyChartPanel
        report={mockReport({ candles: candles3() })}
        mode="live"
        view="chart"
        onSizeChange={onSizeChange}
      />
    ));
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
    r(() => <NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />);
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "3");
    // 09:15 + 09:16 fold into one 5m bucket, 09:20 starts the next → 2 bars
    await user.click(screen.getByRole("button", { name: "5m" }));
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "2");
    await user.click(screen.getByRole("button", { name: "1m" }));
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "3");
  });

  test("depth view keeps the chart mounted but hidden; toggles stay hidden", async () => {
    const [view, setView] = createSignal<"chart" | "depth">("chart");
    const [report] = createSignal(mockReport({ candles: candles3() }));
    r(() => <NiftyChartPanel report={report()} mode="live" view={view()} />);
    setView("depth");
    expect(await screen.findByTestId("nifty-depthmap")).toBeInTheDocument();
    // Both views stay mounted now (instant switching): the chart wrapper is
    // display:none instead of unmounted.
    expect(screen.getByTestId("tradingview-chart")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-view")).toHaveStyle({ display: "none" });
    expect(screen.getByTestId("nifty-depth-view")).not.toHaveStyle({ display: "none" });
    expect(screen.queryByTestId("nifty-tf-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-size")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
  });

  test("lazy depth mount: no depth subtree until first depth view", () => {
    const [view, setView] = createSignal<"chart" | "depth">("chart");
    const [report] = createSignal(depthReport());
    r(() => <NiftyChartPanel report={report()} mode="live" view={view()} />);
    expect(screen.getByTestId("tradingview-chart")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-depth-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("nifty-depthmap")).not.toBeInTheDocument();
    expect(panelMocks.depthMounts).toBe(0);

    setView("depth");
    expect(screen.getByTestId("nifty-depthmap")).toBeInTheDocument();
    expect(panelMocks.depthMounts).toBe(1);
  });

  test("Chart→Depth→Chart→Depth mounts ECharts once and never remounts the chart", () => {
    const [view, setView] = createSignal<"chart" | "depth">("chart");
    const [report] = createSignal(depthReport());
    r(() => <NiftyChartPanel report={report()} mode="live" view={view()} />);
    expect(panelMocks.tvMounts).toBe(1);
    expect(panelMocks.depthMounts).toBe(0);

    setView("depth");
    expect(panelMocks.depthMounts).toBe(1);
    expect(screen.getByTestId("nifty-chart-view")).toHaveStyle({ display: "none" });
    expect(screen.getByTestId("nifty-depth-view")).not.toHaveStyle({ display: "none" });

    setView("chart");
    expect(screen.getByTestId("nifty-chart-view")).not.toHaveStyle({ display: "none" });
    expect(screen.getByTestId("nifty-depth-view")).toHaveStyle({ display: "none" });

    setView("depth");
    // Still exactly one mount each — switching only flips visibility.
    expect(panelMocks.depthMounts).toBe(1);
    expect(panelMocks.tvMounts).toBe(1);
    expect(screen.getByTestId("nifty-depth-view")).not.toHaveStyle({ display: "none" });
    expect(screen.getByTestId("nifty-chart-view")).toHaveStyle({ display: "none" });
  });

  test("empty candles render the empty state, not the chart", () => {
    r(() => <NiftyChartPanel report={mockReport()} mode="live" view="chart" />);
    expect(screen.getByTestId("nifty-chart-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("nifty-chart-wrap")).not.toBeInTheDocument();
  });

  test("a poll with no candles hides the chart instead of unmounting it", () => {
    const [report, setReport] = createSignal(mockReport({ candles: candles3() }));
    r(() => <NiftyChartPanel report={report()} mode="live" view="chart" />);
    expect(panelMocks.tvMounts).toBe(1);

    // Transient empty poll (feed hiccup / replay boundary): the empty state
    // shows, but the engine stays mounted so the next poll does not rebuild
    // every canvas, series and price line from scratch.
    setReport(mockReport());
    expect(screen.getByTestId("nifty-chart-empty")).toBeInTheDocument();
    expect(screen.getByTestId("nifty-chart-wrap")).toBeInTheDocument();
    expect(panelMocks.tvMounts).toBe(1);

    setReport(mockReport({ candles: candles3() }));
    expect(screen.queryByTestId("nifty-chart-empty")).not.toBeInTheDocument();
    expect(panelMocks.tvMounts).toBe(1);
  });

  test("marks bars whose close touches max pain and exposes the count", () => {
    // closes are 25620 / 25640 / 25680 → only the last is within 10 pts.
    r(() => <NiftyChartPanel report={mockReport({ candles: candles3(), maxPain: 25680 })} mode="live" view="chart" />);
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveAttribute("data-mp-touches", "1");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-touch-markers", "1");
  });

  test("no markers when no bar closes on max pain", () => {
    r(() => <NiftyChartPanel report={mockReport({ candles: candles3(), maxPain: 25700 })} mode="live" view="chart" />);
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveAttribute("data-mp-touches", "0");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-touch-markers", "0");
  });

  test("SENSEX fixture: 100-pt strike step → tol=20, close 15 pts from max pain = touch", () => {
    // SENSEX: spot ~79,150, strikes every 100 pts, maxPain 79,000
    // A candle close at 79,015 (15 pts away) should be a touch with tol=20
    const sensexCandles = [
      { time: "2026-10-12T09:15:00", open: 79100, high: 79150, low: 79050, close: 79120, volume: 1000 },
      { time: "2026-10-12T09:16:00", open: 79120, high: 79180, low: 79080, close: 79015, volume: 1100 }, // 15 pts from 79,000
      { time: "2026-10-12T09:17:00", open: 79015, high: 79080, low: 78980, close: 79040, volume: 1200 },
    ];
    const sensexStrikes = Array.from({ length: 11 }, (_, i) => ({ strike: 78500 + i * 100 })); // 78500..79500 step 100
    r(() => (
      <NiftyChartPanel
        report={mockReport({
          candles: sensexCandles,
          maxPain: 79000,
          spot: 79150,
          strikes: sensexStrikes,
        })}
        mode="live"
        view="chart"
        symbol="SENSEX"
      />
    ));
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveAttribute("data-mp-touches", "1");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-touch-markers", "1");
  });

  test("NIFTY fixture: 50-pt strike step → tol=10, close 15 pts from max pain = no touch", () => {
    // NIFTY: spot ~23,000, strikes every 50 pts, maxPain 23,000
    // A candle close at 23,015 (15 pts away) should NOT be a touch with tol=10
    const niftyCandles = [
      { time: "2026-10-12T09:15:00", open: 22950, high: 23000, low: 22900, close: 22970, volume: 1000 },
      { time: "2026-10-12T09:16:00", open: 22970, high: 23030, low: 22930, close: 23015, volume: 1100 }, // 15 pts from 23,000
      { time: "2026-10-12T09:17:00", open: 23015, high: 23060, low: 22980, close: 23040, volume: 1200 },
    ];
    const niftyStrikes = Array.from({ length: 11 }, (_, i) => ({ strike: 22500 + i * 50 })); // 22500..23000 step 50
    r(() => (
      <NiftyChartPanel
        report={mockReport({
          candles: niftyCandles,
          maxPain: 23000,
          spot: 23000,
          strikes: niftyStrikes,
        })}
        mode="live"
        view="chart"
        symbol="NIFTY"
      />
    ));
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveAttribute("data-mp-touches", "0");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-touch-markers", "0");
  });

  test("replay drops wall events after the playhead (no look-ahead)", () => {
    const bursts = [
      { id: "rej", side: "call", type: "rejection", t: "2026-10-12T09:16:30", strike: 25800, spot: 25760, target: 25700 },
      { id: "brk", side: "call", type: "break", t: "2026-10-12T15:29:00", strike: 25900, spot: 25910 },
    ];
    const [asOf, setAsOf] = createSignal("2026-10-12T09:17:00");
    const [report] = createSignal(mockReport({ candles: candles3(), maxPain: 25700 }));
    r(() => <NiftyChartPanel report={report()} mode="eod" view="chart" asOf={asOf()} bursts={bursts} />);
    // Only the 09:16 rejection is knowable; the 15:29 break must not appear.
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-touch-markers", "1");

    setAsOf("2026-10-12T15:30:00");
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-touch-markers", "2");
  });

  test("10s chain snapshots build true 1-minute OHLC with wicks", () => {
    const spotPoints = [
      { t: "2026-10-12T09:15:00", spot: 25600 },
      { t: "2026-10-12T09:15:10", spot: 25640 }, // minute high
      { t: "2026-10-12T09:15:20", spot: 25580 }, // minute low
      { t: "2026-10-12T09:15:30", spot: 25620 },
      { t: "2026-10-12T09:16:00", spot: 25650 },
      { t: "2026-10-12T09:16:10", spot: 25630 },
    ];
    r(() => (
      <NiftyChartPanel
        report={mockReport({ date: "2026-10-12", intraday: [], candles: [] })}
        spotPoints={spotPoints}
        mode="live"
        view="chart"
      />
    ));
    const chart = screen.getByTestId("tradingview-chart");
    expect(chart).toHaveAttribute("data-candles", "2");
    expect(Number(chart.getAttribute("data-first-open"))).toBe(25600);
    expect(Number(chart.getAttribute("data-first-close"))).toBe(25620);
    expect(Number(chart.getAttribute("data-first-high"))).toBe(25640);
    expect(Number(chart.getAttribute("data-first-low"))).toBe(25580);
    // True wicks: the extremes exceed the body on both sides.
    expect(Number(chart.getAttribute("data-first-high"))).toBeGreaterThan(
      Math.max(25600, 25620),
    );
    expect(Number(chart.getAttribute("data-first-low"))).toBeLessThan(
      Math.min(25600, 25620),
    );
  });

  test("a single spot minute merges with tape instead of being vetoed", () => {
    const spotPoints = [{ t: "2026-10-12T09:15:00", spot: 25600 }];
    const tape = {
      rows: [
        { t: "2026-10-12T09:15:00", spot: 25620 },
        { t: "2026-10-12T09:16:00", spot: 25640 },
        { t: "2026-10-12T09:17:00", spot: 25630 },
      ],
    } as unknown as Parameters<typeof NiftyChartPanel>[0]["tape"];
    r(() => (
      <NiftyChartPanel
        report={mockReport({ date: "2026-10-12", intraday: [], candles: [] })}
        spotPoints={spotPoints}
        tape={tape}
        mode="live"
        view="chart"
      />
    ));
    const chart = screen.getByTestId("tradingview-chart");
    expect(chart).toHaveAttribute("data-candles", "3");
    // The 09:15 spot minute wins over the tape's 09:15 body; the other two
    // tape minutes still fill the tail.
    expect(Number(chart.getAttribute("data-first-high"))).toBe(25600);
    expect(Number(chart.getAttribute("data-first-low"))).toBe(25600);
  });

  test("spot points win over the tape when both are present", () => {
    const spotPoints = [
      { t: "2026-10-12T09:15:00", spot: 25600 },
      { t: "2026-10-12T09:15:10", spot: 25640 },
      { t: "2026-10-12T09:15:20", spot: 25580 },
      { t: "2026-10-12T09:15:30", spot: 25620 },
      { t: "2026-10-12T09:16:00", spot: 25650 },
      { t: "2026-10-12T09:16:10", spot: 25630 },
    ];
    const tape = {
      rows: [
        { t: "2026-10-12T09:15:00", spot: 25000 },
        { t: "2026-10-12T09:16:00", spot: 25010 },
        { t: "2026-10-12T09:17:00", spot: 25020 },
      ],
    } as unknown as Parameters<typeof NiftyChartPanel>[0]["tape"];
    r(() => (
      <NiftyChartPanel
        report={mockReport({ date: "2026-10-12", intraday: [], candles: [] })}
        spotPoints={spotPoints}
        tape={tape}
        mode="live"
        view="chart"
      />
    ));
    const chart = screen.getByTestId("tradingview-chart");
    expect(chart).toHaveAttribute("data-candles", "3");
    expect(Number(chart.getAttribute("data-first-high"))).toBe(25640);
  });

  test("report intraday candles still win over spot points", () => {
    const spotPoints = [
      { t: "2026-10-12T09:15:00", spot: 25600 },
      { t: "2026-10-12T09:15:10", spot: 25640 },
      { t: "2026-10-12T09:16:00", spot: 25650 },
    ];
    const intraday = [
      { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620 },
      { time: "2026-10-12T09:16:00", open: 25620, high: 25680, low: 25600, close: 25640 },
    ];
    r(() => (
      <NiftyChartPanel
        report={mockReport({ date: "2026-10-12", intraday, candles: [] })}
        spotPoints={spotPoints}
        mode="live"
        view="chart"
      />
    ));
    const chart = screen.getByTestId("tradingview-chart");
    expect(chart).toHaveAttribute("data-candles", "2");
    expect(Number(chart.getAttribute("data-first-high"))).toBe(25650);
    expect(Number(chart.getAttribute("data-first-low"))).toBe(25580);
  });

  test("generic underlying with no candles plots the 1m tape spots", () => {
    const tape = {
      rows: [
        { t: "2026-10-12T09:15:00", spot: 25620 },
        { t: "2026-10-12T09:16:00", spot: 25640 },
        { t: "2026-10-12T09:17:00", spot: 25630 },
      ],
    } as unknown as Parameters<typeof NiftyChartPanel>[0]["tape"];
    r(() => (
      <NiftyChartPanel
        report={mockReport({ date: "2026-10-12", intraday: [], candles: [] })}
        tape={tape}
        mode="live"
        view="chart"
      />
    ));
    expect(screen.queryByTestId("nifty-chart-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "3");
  });

  test("previous-session candles are dropped instead of mixed with today's tape", () => {
    const tape = {
      rows: [
        { t: "2026-10-12T09:15:00", spot: 25620 },
        { t: "2026-10-12T09:16:00", spot: 25640 },
      ],
    } as unknown as Parameters<typeof NiftyChartPanel>[0]["tape"];
    r(() => (
      <NiftyChartPanel
        report={mockReport({
          date: "2026-10-12",
          intraday: [],
          candles: [
            { time: "2026-10-11T15:00:00", open: 25000, high: 25010, low: 24990, close: 25000, volume: 0 },
            { time: "2026-10-11T15:01:00", open: 25000, high: 25010, low: 24990, close: 25000, volume: 0 },
            { time: "2026-10-11T15:02:00", open: 25000, high: 25010, low: 24990, close: 25000, volume: 0 },
          ],
        })}
        tape={tape}
        mode="live"
        view="chart"
      />
    ));
    // 2 today-only tape bars, not 3 stale candles + 2 tape bars (the old
    // two-day chart with an overnight jump).
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "2");
  });

  test("previous-session intraday bars are dropped instead of mixing with today's tape", () => {
    const tape = {
      rows: [
        { t: "2026-10-12T09:15:00", spot: 25620 },
        { t: "2026-10-12T09:16:00", spot: 25640 },
      ],
    } as unknown as Parameters<typeof NiftyChartPanel>[0]["tape"];
    r(() => (
      <NiftyChartPanel
        report={mockReport({
          date: "2026-10-12",
          intraday: [
            { time: "2026-10-11T09:15:00", open: 25000, high: 25010, low: 24990, close: 25000, volume: 0 },
            { time: "2026-10-11T09:16:00", open: 25000, high: 25010, low: 24990, close: 25000, volume: 0 },
            { time: "2026-10-11T09:17:00", open: 25000, high: 25010, low: 24990, close: 25000, volume: 0 },
          ],
          candles: [],
        })}
        tape={tape}
        mode="live"
        view="chart"
      />
    ));
    // 2 today-only tape bars — the 3 stale previous-session intraday bars
    // never mix into today's chart (same session-scoping rule as the
    // `candles` fallback above).
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-candles", "2");
  });

  test("maxWalls from the walls card overrides the report's max-OI lines", () => {
    r(() => (
      <NiftyChartPanel
        report={mockReport({
          candles: candles3(),
          walls: {
            calls: [{ strike: 25000, oi: 900 }, { strike: 24500, oi: 800 }],
            puts: [{ strike: 25500, oi: 700 }],
          },
        })}
        maxWalls={{
          calls: [{ strike: 24000, oi: 500 }],
          puts: [{ strike: 25600, oi: 600 }],
        }}
        mode="live"
        view="chart"
      />
    ));
    const labels = screen.getByTestId("tradingview-chart").getAttribute("data-markline-labels") ?? "";
    // maxWalls call at 24,000 is below spot (25,750.5) → CW (BELOW) since no call above
    expect(labels).toContain("CW (BELOW) 24,000");
    // maxWalls put at 25,600 is below spot → PW (support)
    expect(labels).toContain("PW 25,600");
    expect(labels).not.toContain("CW 25,000");
  });

  test("parent-driven prop updates keep the wrap DOM node mounted", () => {
    const [flipAt, setFlipAt] = createSignal<string | undefined>(undefined);
    const [report] = createSignal(mockReport({ candles: candles3() }));
    r(() => <NiftyChartPanel report={report()} mode="live" view="chart" flipAt={flipAt()} />);
    const wrap = screen.getByTestId("nifty-chart-wrap");
    setFlipAt("2026-10-12T09:16:00");
    expect(screen.getByTestId("nifty-chart-wrap")).toBe(wrap);
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
  });

  test("stale report intraday + fresh spotPoints → chart merges morning + fresh minute", () => {
    // Stale intraday from 11:56 (old REST snapshot)
    const staleIntraday = [
      { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620 },
      { time: "2026-10-12T11:56:00", open: 25700, high: 25720, low: 25680, close: 25710 },
    ];
    // Fresh spot points from 10s chain feed at 12:20
    const freshSpotPoints = [
      { t: "2026-10-12T09:15:00", spot: 25600 },
      { t: "2026-10-12T09:15:10", spot: 25640 },
      { t: "2026-10-12T09:15:20", spot: 25580 },
      { t: "2026-10-12T09:15:30", spot: 25620 },
      { t: "2026-10-12T12:20:00", spot: 25755 },
      { t: "2026-10-12T12:20:10", spot: 25760 },
    ];
    r(() => (
      <NiftyChartPanel
        report={mockReport({ date: "2026-10-12", intraday: staleIntraday, candles: [] })}
        spotPoints={freshSpotPoints}
        mode="live"
        view="chart"
      />
    ));
    const chart = screen.getByTestId("tradingview-chart");
    // Morning 09:15/11:56 from intraday + fresh 12:20 from spot points.
    expect(chart).toHaveAttribute("data-candles", "3");
    // The 12:20 candle should have the fresh spot data
    // The last candle (12:20) should reflect the fresh spot ~25755-25760
    // Since we only check the first candle attributes in the mock, verify count
    // and that it didn't use the stale 11:56 intraday candle
    expect(Number(chart.getAttribute("data-first-open"))).toBe(25600);
    expect(Number(chart.getAttribute("data-first-close"))).toBe(25620);
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

    r(() => <NiftyChartPanel report={report} mode="live" view="chart" />);
    // The dense panel no longer renders the legend row; the exported
    // component still decodes the same codes for callers.
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
    r(() => <LevelLegend live gex={report.gex} spot={report.spot} />);
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
    expect(labels).toContain("CW 23,000 · GRES");
    expect(labels).toContain("PW 22,500 · GFUEL↓");
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
    expect(lines.find((l) => l.label.formatter === "CW 23,500")?.includeInScale).toBeFalsy();

    r(() => <NiftyChartPanel report={report} mode="live" view="chart" />);
    // The dense panel no longer renders the legend row; the exported
    // component still decodes the same codes for callers.
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
    r(() => <LevelLegend live gex={report.gex} spot={report.spot} />);
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

    r(() => <NiftyChartPanel report={report} mode="live" view="chart" />);
    // The dense panel no longer renders the legend row; the exported
    // component still decodes the same codes for callers.
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
    r(() => <LevelLegend live gex={report.gex} spot={report.spot} />);
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

    r(() => <NiftyChartPanel report={report} mode="live" view="chart" />);
    // The dense panel no longer renders the legend row; the exported
    // component still decodes the same codes for callers.
    expect(screen.queryByTestId("nifty-level-legend")).not.toBeInTheDocument();
    r(() => <LevelLegend live gex={report.gex} spot={report.spot} />);
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
    expect(labels.filter((l) => l.includes("MP 22,700") || l.includes("CW 22,705"))).toHaveLength(1);
    expect(labels.join(" ")).toContain("MP 22,700 · CW");
  });
});
