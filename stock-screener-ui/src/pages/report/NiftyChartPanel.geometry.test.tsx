// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, afterEach, beforeAll } from "vitest";
import { render, screen, within, cleanup } from "@solidjs/testing-library";
import { ChartBody } from "./NiftyChartPanel.body";
import type { JSX } from "solid-js";
import { UIProvider } from "@/ui";
import * as palette from "@/ui/palette";
import { emaSeries } from "./niftyChartMath";
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
import { TIME_AXIS_LABEL_GUTTER_PX } from "./NiftyChartPanel.constants";
import type { NiftyGex, NiftyReport } from "@/types/niftyReport";
import { verdictMarkLines } from "./niftyVerdictLevels";

vi.mock("@/components/chart/TradingViewChart", async () => {
  const { createSignal, onMount } = await import("solid-js");
  return {
    TradingViewChart: (props: {
      candles?: { open: number; high: number; low: number; close: number; time?: string }[];
      markLines?: { label: { formatter: string } }[];
      emaData?: unknown[];
      fitMarkLines?: boolean;
      hideLastValueTag?: boolean;
      onChartReady?: (chart: unknown) => void;
      touchMarkers?: {
        time: string;
        value: number;
        shape?: string;
        color?: string;
        text?: string;
      }[];
    }) => {
      const [labels, setLabels] = createSignal({ first: "", last: "" });
      panelMocks.setTimeLabels = setLabels;
      onMount(() => {
        panelMocks.tvMounts += 1;
        panelMocks.onChartReady = props.onChartReady ?? null;
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
        >
          <span data-testid="chart-time-first-label">{labels().first}</span>
          <span data-testid="chart-time-last-label">{labels().last}</span>
        </div>
      );
    },
  };
});

const panelMocks = vi.hoisted(() => ({
  tvMounts: 0,
  onChartReady: null as null | ((chart: unknown) => void),
  setTimeLabels: null as null | ((value: { first: string; last: string }) => void),
  mobile: false,
  mediaListeners: [] as Array<(event: { matches: boolean }) => void>,
}));

const CHART_SOURCE_KEY = "nifty.chartSource";

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("max-width: 600px") ? panelMocks.mobile : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: (_type: string, fn: (event: { matches: boolean }) => void) => {
        panelMocks.mediaListeners.push(fn);
      },
      removeEventListener: (_type: string, fn: (event: { matches: boolean }) => void) => {
        panelMocks.mediaListeners = panelMocks.mediaListeners.filter((f) => f !== fn);
      },
      dispatchEvent: () => false,
    }),
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(CHART_SOURCE_KEY);
  vi.clearAllMocks();
  panelMocks.tvMounts = 0;
  panelMocks.onChartReady = null;
  panelMocks.setTimeLabels = null;
  panelMocks.mobile = false;
  panelMocks.mediaListeners = [];
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

/** The exact 10-bar report payload used by setupNiftyReportMocks in the
 *  index-report evidence: EMA9 seeds at bar 9 and draws a short amber segment,
 *  EMA20 never seeds and draws nothing. */
function reportFixtureCandles() {
  return Array.from({ length: 10 }, (_, i) => ({
    time: `2026-10-12T${String(9 + Math.floor((15 + i * 5) / 60)).padStart(2, "0")}:${String((15 + i * 5) % 60).padStart(2, "0")}:00`,
    open: 22300 + i * 6,
    high: 22320 + i * 6,
    low: 22290 + i * 6,
    close: 22310 + i * 6,
    volume: 100000 + i * 1000,
  }));
}

describe("NiftyChartPanel", () => {
  test("marks bars whose close touches max pain and exposes the count", () => {
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

describe("verdict levels on the Nifty chart", () => {
  function verdictReport(overrides: Record<string, unknown> = {}) {
    return mockReport({
      spot: 25540,
      ohlc: { open: 25600, high: 25640, low: 25520, close: 25540 },
      maxPain: 25450,
      walls: { calls: [], puts: [] },
      pivots: {
        type: "classic",
        pp: 25600, r1: 25700, r2: 25800, r3: 25900,
        s1: 25500, s2: 25400, s3: 25300, prev: null,
      },
      strength: {
        verdict: "weak", score: 20, ema9: 25600, ema20: 25620,
        ema50: 25680, rsi: 40, pos_in_range: 0.2,
      },
      gex: {
        strikes: [], netTotal: -10, regime: "short",
        topPositive: [], topNegative: [], zeroCross: null,
      },
      candles: candles3(),
      ...overrides,
    });
  }

  test("chart renders SELL/CUT/TGT labels from the plan", () => {
    const report = verdictReport();
    r(() => <NiftyChartPanel report={report} mode="live" view="chart" />);
    const chart = screen.getByTestId("tradingview-chart");
    const labels = chart.getAttribute("data-markline-labels") ?? "";
    for (const code of ["SELL", "CUT", "TGT"]) expect(labels).toContain(code);
    expect(labels).not.toContain("BUY");

    const planLines = verdictMarkLines(report);
    expect(planLines.map((l) => l.label.formatter)).toEqual(["SELL 25,520", "CUT 25,540", "TGT 25,450"]);
    expect(Number(chart.getAttribute("data-marklines"))).toBeGreaterThanOrEqual(planLines.length);
  });

  test("replay/EOD takes verdict levels from the snapshot report with no live claim", () => {
    const report = verdictReport({
      mode: "eod",
      date: "2026-11-24",
      candles: [
        { time: "2026-11-24T09:15:00", open: 25520, high: 25560, low: 25510, close: 25540, volume: 1000 },
        { time: "2026-11-24T09:16:00", open: 25540, high: 25580, low: 25530, close: 25560, volume: 1100 },
      ],
    });
    r(() => (
      <NiftyChartPanel report={report} mode="eod" view="chart" asOf="2026-11-24T09:16:00" />
    ));
    const labels = screen.getByTestId("tradingview-chart").getAttribute("data-markline-labels") ?? "";
    for (const code of ["SELL", "CUT", "TGT"]) expect(labels).toContain(code);
    expect(labels).not.toContain("LIVE");
  });

  test("neutral plan adds no verdict labels to the chart", () => {
    r(() => <NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />);
    const labels = screen.getByTestId("tradingview-chart").getAttribute("data-markline-labels") ?? "";
    for (const code of ["SELL", "CUT", "TGT"]) expect(labels).not.toContain(code);
  });
});

describe("NiftyChartPanel — named overlays and honest spot labels", () => {
  test("the orange EMA overlay is named in a chart legend, not left to colour memory", () => {
    const bars = reportFixtureCandles();
    const closes = bars.map((c) => c.close);
    // Prove the fixture is the one that produced the two-point amber segment.
    expect(emaSeries(closes, 9).filter((v) => v != null)).toHaveLength(2);
    expect(emaSeries(closes, 20).every((v) => v == null)).toBe(true);
    r(() => <NiftyChartPanel report={mockReport({ candles: bars })} mode="live" view="chart" />);
    const legend = screen.getByTestId("nifty-chart-overlay-legend");
    expect(legend).toBeVisible();
    expect(legend).toHaveTextContent("EMA9");
    expect(legend).not.toHaveTextContent("EMA20");
    const swatches = legend.querySelectorAll("[data-overlay-swatch]");
    expect(Array.from(swatches).map((el) => (el as HTMLElement).style.backgroundColor)).toEqual([
      palette.WARNING,
    ]);
    // The chart's own overlay canvas is z-index 3; a key below it is not drawn.
    expect(Number(legend.style.zIndex)).toBeGreaterThan(3);
    expect(legend.getAttribute("title")).toContain("EMA9");
    expect(legend.getAttribute("title")).not.toContain("EMA20");
  });

  test("the chart boundary title separates the replay bar close from the snapshot spot", () => {
    r(() => (
      <NiftyChartPanel
        report={mockReport({ candles: candles3() })}
        mode="eod"
        view="chart"
        asOf="2026-10-12T09:20:00"
      />
    ));
    const boundary = screen.getByTestId("nifty-chart-last-data-boundary");
    expect(boundary.getAttribute("title")).toContain("25,680.00");
    expect(boundary.getAttribute("title")).toContain("Replay playhead 09:20");
    expect(boundary.getAttribute("title")).toContain("whole points");
  });

  test("a single zero-range spot tick is not a candle series: show the named empty state", () => {
    const flatBar = {
      time: "2026-10-12T09:15:00+05:30",
      open: 26000,
      high: 26000,
      low: 26000,
      close: 26000,
      volume: 0,
    };
    render(() => (
      <UIProvider>
        <ChartBody
          view="chart"
          offlineEmpty={false}
          sessionDate="2026-10-12"
          chartCandles={[flatBar]}
          candlesEverShown={true}
          chartHeight={null}
          fillContainer={true}
          mpTouchesLength={0}
          flipMarkerPresent={false}
          patternSourceState="idle"
          patternOverlayCount={0}
          chartMarkLines={[{ label: { formatter: "CW 26,000" } }] as never}
          chartEmaData={[] as never}
          touchMarkers={[] as never}
          lastDataBoundary="LAST DATA 09:15 · replay"
          scanBadge={null}
          chartSource="live"
          scanStatus="idle"
          chartTf="1m"
          symbol={() => "NIFTY"}
          onScanPatterns={() => {}}
        />
      </UIProvider>
    ));
    const empty = screen.getByTestId("nifty-chart-empty");
    expect(empty).toHaveTextContent("No intraday candles");
    expect(screen.getByTestId("nifty-chart-empty-slot")).toHaveAttribute(
      "data-reason",
      "pinned-playhead-no-candles",
    );
    expect(empty).toHaveTextContent("LAST DATA 09:15");
    expect(screen.getByTestId("nifty-chart-wrap")).toHaveStyle({ display: "none" });
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-marklines", "0");
  });

  const deskBody = (ema: { label: string; color: string; data: number[] }[]) =>
    render(() => (
      <UIProvider>
        <ChartBody
          view="chart"
          offlineEmpty={false}
          sessionDate="2026-10-12"
          chartCandles={candles3()}
          candlesEverShown={true}
          chartHeight={null}
          fillContainer={true}
          mpTouchesLength={0}
          flipMarkerPresent={false}
          patternSourceState="idle"
          patternOverlayCount={0}
          chartMarkLines={[] as never}
          chartEmaData={ema as never}
          touchMarkers={[] as never}
          lastDataBoundary="LAST DATA 09:20 · live"
          scanBadge={null}
          chartSource="live"
          scanStatus="idle"
          chartTf="1m"
          symbol={() => "NIFTY"}
          onScanPatterns={() => {}}
        />
      </UIProvider>
    ));

  test("DESK fill path mounts the key from the exact series the engine draws", () => {
    const closes = reportFixtureCandles().map((c) => c.close);
    deskBody([
      { label: "EMA9", color: palette.WARNING, data: emaSeries(closes, 9) },
      { label: "EMA20", color: palette.PRIMARY, data: emaSeries(closes, 20) },
    ]);
    const wrap = screen.getByTestId("nifty-chart-wrap");
    expect(wrap).toHaveAttribute("data-fill", "1");
    // The engine still receives both series; only the painted one is named.
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-emas", "2");
    const legend = screen.getByTestId("nifty-chart-overlay-legend");
    expect(wrap).toContainElement(legend);
    expect(legend).toHaveTextContent("EMA9");
    expect(legend).not.toHaveTextContent("EMA20");
    const swatches = legend.querySelectorAll("[data-overlay-swatch]");
    expect(Array.from(swatches).map((el) => (el as HTMLElement).style.backgroundColor)).toEqual([
      palette.WARNING,
    ]);
    expect(Number(legend.style.zIndex)).toBeGreaterThan(3);
  });

  test("no EMA or overlay series: no key advertises a line that is not drawn", () => {
    deskBody([]);
    expect(screen.getByTestId("tradingview-chart")).toHaveAttribute("data-emas", "0");
    expect(screen.queryByTestId("nifty-chart-overlay-legend")).not.toBeInTheDocument();
  });
});

/**
 * The engine centres the first/last `HH:MM` tick on its bar, so the plot needs
 * a half-label gutter on each edge. `entireTextOnly` only widens the price
 * axis; without this gutter the evidence PNGs read `:15` and `10:0` at both
 * 1600 and 390. Model the engine's coordinate mapping from the options the
 * panel actually pushes, then assert the whole five-glyph text in the DOM.
 */
describe("NiftyChartPanel — full HH:MM edge ticks", () => {
  const FIRST = "09:15";
  const LAST = "10:00";
  const CHAR_PX = 7.2;
  const HALF_LABEL_PX = 18;

  type Call = { scale: string; id?: string; options: Record<string, unknown> };

  function engine(width: number, barSpacing: number) {
    const calls: Call[] = [];
    let range: { from: number; to: number } | null = null;
    const scale = {
      applyOptions: (options: Record<string, unknown>) => calls.push({ scale: "time", options }),
      setVisibleLogicalRange: (next: { from: number; to: number }) => {
        range = next;
      },
      logicalToCoordinate: (logical: number) => (logical - (range?.from ?? 0)) * barSpacing,
      options: () => ({ barSpacing }),
    };
    return {
      chart: {
        timeScale: () => scale,
        priceScale: (id: string) => ({
          applyOptions: (options: Record<string, unknown>) => calls.push({ scale: "price", id, options }),
        }),
        panes: () => [],
      },
      calls,
      getRange: () => range,
      width,
      barSpacing,
    };
  }

  type Model = ReturnType<typeof engine>;

  function visibleTicks(model: Model) {
    const lastPrice = [...model.calls].reverse().find((c) => c.scale === "price" && c.id === "right");
    const lastOffset = [...model.calls].reverse().find((c) => c.scale === "time" && typeof c.options.rightOffsetPixels === "number");
    const axis = Number(lastPrice?.options.minimumWidth ?? 88);
    const rightOffset = Number(lastOffset?.options.rightOffsetPixels ?? 0);
    const from = model.getRange()?.from ?? 0;
    // Bar centre distances: the first from the plot's left edge, the last from
    // its right edge (the right offset is measured from the whole chart, so the
    // price axis width is subtracted).
    const firstGap = Math.round(-from * model.barSpacing);
    const lastGap = Math.round(rightOffset - axis);
    const shown = (text: string, gap: number, clipLeft: boolean) => {
      const chars = Math.min(text.length, Math.max(0, Math.floor((gap + HALF_LABEL_PX) / CHAR_PX)));
      return clipLeft ? text.slice(text.length - chars) : text.slice(0, chars);
    };
    return { first: shown(FIRST, firstGap, true), last: shown(LAST, lastGap, false), firstGap, lastGap };
  }

  async function measure(width: number, mobile: boolean) {
    panelMocks.mobile = mobile;
    const model = engine(width, width > 600 ? 18 : 27);
    r(() => <NiftyChartPanel report={mockReport({ candles: candles3() })} mode="live" view="chart" />);
    panelMocks.onChartReady!(model.chart);
    // The range pin runs on a microtask and two timers (0ms and 120ms).
    await new Promise((resolve) => setTimeout(resolve, 160));
    const ticks = visibleTicks(model);
    panelMocks.setTimeLabels!({ first: ticks.first, last: ticks.last });
    return { ticks, model };
  }

  test("1600 desktop reserves a full HH:MM gutter on both time-axis edges", async () => {
    const { ticks } = await measure(1600, false);
    expect(screen.getByTestId("chart-time-first-label")).toHaveTextContent(FIRST);
    expect(screen.getByTestId("chart-time-last-label")).toHaveTextContent(LAST);
    expect(ticks.firstGap).toBeGreaterThanOrEqual(TIME_AXIS_LABEL_GUTTER_PX);
    expect(ticks.lastGap).toBeGreaterThanOrEqual(TIME_AXIS_LABEL_GUTTER_PX);
  });

  test("390 monitor reserves a full HH:MM gutter on both time-axis edges", async () => {
    const { ticks } = await measure(390, true);
    expect(screen.getByTestId("chart-time-first-label")).toHaveTextContent(FIRST);
    expect(screen.getByTestId("chart-time-last-label")).toHaveTextContent(LAST);
    expect(ticks.firstGap).toBeGreaterThanOrEqual(TIME_AXIS_LABEL_GUTTER_PX);
    expect(ticks.lastGap).toBeGreaterThanOrEqual(TIME_AXIS_LABEL_GUTTER_PX);
  });
});
