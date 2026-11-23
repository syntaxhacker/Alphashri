// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import type { JSX } from "solid-js";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import { NiftyChartPanel } from "./NiftyChartPanel";
import type { NiftyReport } from "@/types/niftyReport";
import { detectPatterns } from "@/api/chartPatterns";
import { REPORT_FONT } from "./reportTokens";

vi.mock("@/components/chart/TradingViewChart", async () => {
  const { onMount } = await import("solid-js");
  return {
    TradingViewChart: (props: {
      candles?: { open: number; high: number; low: number; close: number }[];
      markLines?: { label: { formatter: string } }[];
      emaData?: unknown[];
      fitMarkLines?: boolean;
      touchMarkers?: {
        time: string;
        value: number;
        shape?: string;
        color?: string;
        text?: string;
      }[];
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
          data-touch-details={(props.touchMarkers ?? [])
            .map((m) => `${m.shape ?? "circle"}:${m.color ?? ""}:${m.text ?? ""}`)
            .join("|")}
        />
      );
    },
  };
});

const panelMocks = vi.hoisted(() => ({ tvMounts: 0 }));

vi.mock("@/api/chartPatterns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/chartPatterns")>();
  return {
    ...actual,
    detectPatterns: vi.fn(async () => ({
      hits: [
        {
          pattern_id: "double-bottom",
          pattern_name: "Double bottom",
          direction: "bullish",
          status: "confirmed",
          breakout_level: 25650,
          target: 25800,
          stop: 25500,
          confidence: 80,
          bars_ago: 0,
        },
      ],
    })),
  };
});

const CHART_SOURCE_KEY = "nifty.chartSource";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(CHART_SOURCE_KEY);
  vi.clearAllMocks();
  panelMocks.tvMounts = 0;
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

describe("NiftyChartPanel", () => {
  test("flipAt draws a no-text marker on the candle close at that time", () => {
    const [report] = createSignal(mockReport({ candles: candles3() }));
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
    expect(Number(chart.getAttribute("data-first-open"))).toBe(25600);
    expect(Number(chart.getAttribute("data-first-close"))).toBe(25620);
  });
});

describe("NiftyChartPanel PATTERNS visible result", () => {
  const toggle = () => screen.getByTestId("nifty-chart-source");
  const choose = async (label: "LIVE" | "PATTERNS" | "OFFLINE") => {
    await userEvent.setup().click(within(toggle()).getByRole("button", { name: label }));
  };
  const withCandles = () =>
    mockReport({
      candles: [
        { time: "2026-10-12T09:15:00", open: 25600, high: 25650, low: 25580, close: 25620, volume: 1000 },
        { time: "2026-10-12T09:16:00", open: 25620, high: 25680, low: 25600, close: 25640, volume: 1100 },
        { time: "2026-10-12T09:20:00", open: 25640, high: 25700, low: 25610, close: 25680, volume: 1200 },
      ],
    });
  const chart = () => screen.getByTestId("tradingview-chart");
  const wrap = () => screen.getByTestId("nifty-chart-wrap");
  const scanAndWait = async () => {
    await userEvent.setup().click(screen.getByTestId("nifty-patterns-scan"));
    const strip = await screen.findByTestId("nifty-patterns-strip");
    expect(strip).toHaveAttribute("data-status", "ready");
    return strip;
  };

  test("(a) entering PATTERNS with no prior scan states it is not scanned yet and keeps the run affordance", async () => {
    r(() => <NiftyChartPanel report={withCandles()} mode="live" view="chart" />);
    await choose("PATTERNS");
    const empty = screen.getByTestId("nifty-patterns-empty");
    expect(empty).toHaveTextContent(/not scanned yet/i);
    expect(screen.getByTestId("nifty-patterns-run")).toBeInTheDocument();
    // The detector is on-demand: switching source does not fire a request.
    expect(detectPatterns).not.toHaveBeenCalled();
  });

  test("(b) a no-pattern result states the lookback and result legibly, at the 12px floor", async () => {
    vi.mocked(detectPatterns).mockResolvedValueOnce({
      symbol: "NIFTY",
      timeframe: "1m",
      data_through: "2026-10-12 15:30:00",
      hits: [],
      count: 0,
    });
    r(() => <NiftyChartPanel report={withCandles()} mode="live" view="chart" />);
    await choose("PATTERNS");
    const strip = await scanAndWait();
    expect(strip).toHaveTextContent(/no pattern/i);
    expect(strip.textContent).toMatch(/150[\s\S]*bars/i);
    expect(strip).toHaveStyle({ "font-size": `${REPORT_FONT.micro}px` });
    const badge = screen.getByTestId("nifty-patterns-chart-badge");
    expect(badge).toHaveTextContent(/150.*1m.*no pattern/i);
    expect(strip.title).toContain("2026-10-12 15:30:00");
  });

  test("(c) a no-pattern scan still changes chart input: one annotation marker, no fabricated levels", async () => {
    vi.mocked(detectPatterns).mockResolvedValueOnce({
      symbol: "NIFTY",
      timeframe: "1m",
      data_through: null,
      hits: [],
      count: 0,
    });
    r(() => <NiftyChartPanel report={withCandles()} mode="live" view="chart" />);
    const baseline = chart().getAttribute("data-touch-details") ?? "";
    const baseMarks = Number(chart().getAttribute("data-marklines") ?? 0);
    const baseCount = Number(chart().getAttribute("data-touch-markers") ?? 0);

    await choose("PATTERNS");
    await scanAndWait();
    expect(chart().getAttribute("data-touch-markers")).toBe(String(baseCount + 1));
    expect(chart().getAttribute("data-touch-details") ?? "").not.toBe(baseline);
    expect(chart().getAttribute("data-touch-details")).toContain(`circle:${palette.TEXT_MUTED}`);
    // No hit means no breakout/target/stop lines — nothing is presented as a signal.
    expect(Number(chart().getAttribute("data-marklines"))).toBe(baseMarks);
    expect(wrap()).toHaveAttribute("data-pattern-source", "none");
    expect(wrap()).toHaveAttribute("data-pattern-overlays", "0");
  });

  test("(d) a hit still renders exactly one overlay's worth of marks and no no-pattern marker", async () => {
    r(() => <NiftyChartPanel report={withCandles()} mode="live" view="chart" />);
    const baseMarks = Number(chart().getAttribute("data-marklines") ?? 0);
    await choose("PATTERNS");
    await scanAndWait();
    const labels = chart().getAttribute("data-markline-labels") ?? "";
    for (const code of ["P▸BRK", "P▸TGT", "P▸SL"]) {
      expect(labels.split(code)).toHaveLength(2);
    }
    expect(Number(chart().getAttribute("data-marklines"))).toBe(baseMarks + 3);
    expect(chart().getAttribute("data-touch-details") ?? "").not.toContain(`circle:${palette.TEXT_MUTED}`);
    expect(wrap()).toHaveAttribute("data-pattern-source", "hit");
    expect(wrap()).toHaveAttribute("data-pattern-overlays", "1");
  });

  test("(e) LIVE and OFFLINE emit no scan annotation and never call the detector", async () => {
    r(() => <NiftyChartPanel report={withCandles()} mode="live" view="chart" />);
    expect(chart().getAttribute("data-touch-details") ?? "").toBe("");
    expect(wrap()).toHaveAttribute("data-pattern-source", "off");
    await choose("OFFLINE");
    expect(chart().getAttribute("data-touch-details") ?? "").toBe("");
    expect(wrap()).toHaveAttribute("data-pattern-source", "off");
    await choose("LIVE");
    expect(chart().getAttribute("data-touch-details") ?? "").toBe("");
    expect(wrap()).toHaveAttribute("data-pattern-source", "off");
    expect(screen.queryByTestId("nifty-patterns-chart-badge")).not.toBeInTheDocument();
    expect(detectPatterns).not.toHaveBeenCalled();
  });
});
