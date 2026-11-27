// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  const { typeSize } = await import("@/ui/typography");
  return { ...mockSolidUi(), typeSize };
});
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import type { ChartCandle, ChartIndicators, PatternHitDTO, SRZone } from "@/types/chartPatterns";
import type { TVMarker } from "./patternTVData";
import { createSignal } from "solid-js";
import { getPnLTextColor } from "@/utils/ui-helpers";
import {
  activeIndicatorChipWindow,
  markerLegendEntries,
  PatternChartBody,
  prioritizeCompactChips,
  resolveCloseSeries,
} from "./PatternChartBody";
import {
  __resetChartIndicatorPrefsForTests,
  chartIndicatorPrefs,
  setChartIndicator,
} from "@/state/chartIndicators";

vi.mock("./PatternTradingViewChart", () => ({
  PatternTradingViewChart: (props: {
    hit: PatternHitDTO | null;
    candles: ChartCandle[];
    market?: string;
    timeframe?: string;
    hiddenNames?: ReadonlySet<string>;
    data?: { candles: unknown[] };
  }) => (
    <div
      data-testid="pattern-tv-stub"
      data-hit-symbol={props.hit?.symbol ?? "null"}
      data-candle-count={String(props.candles.length)}
      data-market={props.market ?? "unset"}
      data-timeframe={props.timeframe ?? "unset"}
      data-data-candles={String(props.data?.candles.length ?? -1)}
      data-hidden={[...(props.hiddenNames ?? [])].sort().join(",")}
    />
  ),
}));

// Stub the sibling history list so the body can assert that onSelectHit is
// forwarded with the selected hit payload and that the history slice changes.
vi.mock("./FullscreenPatternList", () => {
  const FullscreenPatternList = ({
    hits,
    onSelect,
  }: {
    hits: PatternHitDTO[];
    onSelect?: (hit: PatternHitDTO) => void;
  }) => (
    <div
      data-testid="patterns-fullscreen-list-stub"
      data-count={String(hits.length)}
      onClick={() => onSelect?.(hits[0])}
      role="button"
      tabIndex={0}
    >
      {hits.map((h) => h.symbol).join(", ")}
    </div>
  );
  return { FullscreenPatternList, fullscreenHitKey: vi.fn(() => "hk-1") };
});

const CANDLES: ChartCandle[] = [
  { t: "2026-09-25", o: 100, h: 105, l: 99, c: 102, v: 1000 },
  { t: "2026-09-26", o: 102, h: 106, l: 101, c: 104, v: 1200 },
];

/** Enough bars for SMA200 availability in chip/count tests. */
const LONG_CANDLES: ChartCandle[] = Array.from({ length: 250 }, (_, index) => {
  const t = new Date(Date.UTC(2025, 0, 1 + index)).toISOString().slice(0, 10);
  return { t, o: 100, h: 101, l: 99, c: 100, v: 1000 };
});

const LONG_ZONES: SRZone[] = [
  {
    kind: "support",
    top: 101,
    bottom: 99,
    start_date: LONG_CANDLES[0]!.t,
    end_date: LONG_CANDLES[LONG_CANDLES.length - 1]!.t,
    touches: 3,
    score: 0.8,
  },
];

/** A payload whose series arrays are aligned 1:1 with LONG_CANDLES. */
function longIndicators(overrides: Partial<ChartIndicators> = {}): ChartIndicators {
  const values = LONG_CANDLES.map((_, index) => 100 + index * 0.01);
  return {
    ...INDICATORS,
    timeframe: "1D",
    series: INDICATORS.series.map((series) => ({ ...series, values })),
    crosses: [{ t: LONG_CANDLES[LONG_CANDLES.length - 1]!.t, kind: "golden" }],
    ...overrides,
  };
}

const HIT: PatternHitDTO = {
  id: 7,
  symbol: "IRCON",
  name: "IRCON International Ltd.",
  timeframe: "1D",
  pattern_id: "falling_wedge",
  pattern_name: "Falling Wedge",
  family: "reversal",
  direction: "bullish",
  status: "confirmed",
  quality: "strong",
  confidence: 78.4,
  start_date: "2026-04-26",
  end_date: "2026-09-26",
  start_price: 100,
  end_price: 112.6,
  breakout_level: 112.6,
  target: 129.6,
  stop: 102.5,
  rr: 1.7,
  bars_ago: 2,
  volume_confirmed: true,
  trendlines: [],
  notes: "Breakout above ₹112.60 on volume",
  last_close: 120,
  day_change_pct: 2.5,
  close_bar_date: "2026-09-26",
  pivots: [
    { t: "2026-05-04", price: 102.5, kind: "low" },
    { t: "2026-05-20", price: 112.6, kind: "high" },
  ],
};

const US_HIT: PatternHitDTO = {
  ...HIT,
  id: 101,
  symbol: "AAPL",
  name: "Apple Inc.",
  notes: "Breakout confirmed on volume",
  last_close: 352.25,
  day_change_pct: 1.2,
  close_bar_date: "2026-09-26",
  pivots: [],
};

const INDICATORS: ChartIndicators = {
  aligned: "candles",
  timeframe: "1D",
  session: "2026-09-26",
  partial_last: false,
  series: [
    { id: "sma20", values: [100, 101] },
    { id: "sma50", values: [99, 100] },
    { id: "sma200", values: [90, 91] },
    { id: "bbUpper", values: [110, 111] },
    { id: "bbMiddle", values: [105, 106] },
    { id: "bbLower", values: [100, 101] },
    { id: "vwap", values: [101, 102] },
  ],
  crosses: [],
};

const ZONES: SRZone[] = [
  {
    kind: "support",
    top: 101,
    bottom: 99,
    start_date: "2026-09-01",
    end_date: "2026-09-26",
    touches: 3,
    score: 0.8,
  },
];


describe("PatternChartBody", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    __resetChartIndicatorPrefsForTests();
  });

  test("default render (no hit): body, history control, empty TV, no chart data", () => {
    render(() => <PatternChartBody hit={null} candles={[]} />);
    expect(screen.getByTestId("patterns-chart-body")).toBeInTheDocument();
    const history = screen.getByTestId("patterns-history-count");
    expect(history).toBeInTheDocument();
    expect(within(history).getByRole("button", { name: "1" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5" })).toBeInTheDocument();
    const tv = screen.getByTestId("pattern-tv-stub");
    expect(tv).toHaveAttribute("data-hit-symbol", "null");
    expect(tv).toHaveAttribute("data-candle-count", "0");
    expect(screen.getByText("No chart data")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-fullscreen-panel")).toBeNull();
    expect(screen.queryByTestId("patterns-fullscreen-asof-banner")).toBeNull();
  });

  test("no hit and no emptyState: chart fills the width, no dead side column", () => {
    render(() => <PatternChartBody hit={null} candles={[]} />);
    const column = screen.getByTestId("patterns-chart-column");
    expect(column).toHaveClass("flex-1");
    expect(column.className).not.toContain("lg:flex-[0_0_80%]");
    expect(screen.queryByTestId("patterns-chart-panel-column")).toBeNull();
  });

  test("with a hit: chart keeps the 80/20 split and the side column renders", () => {
    render(() => <PatternChartBody hit={HIT} candles={CANDLES} />);
    const column = screen.getByTestId("patterns-chart-column");
    expect(column.className).toContain("lg:flex-[0_0_80%]");
    expect(screen.getByTestId("patterns-chart-panel-column")).toBeInTheDocument();
  });

  test("emptyState keeps the side column instead of collapsing the chart", () => {
    render(() => <PatternChartBody hit={null} candles={[]} emptyState={<div data-testid="panel-empty">No pattern selected</div>} />);
    const column = screen.getByTestId("patterns-chart-column");
    expect(column.className).toContain("lg:flex-[0_0_80%]");
    expect(screen.getByTestId("patterns-chart-panel-column")).toBeInTheDocument();
  });

  test("as-of banner renders the local datetime and is absent when null/empty", () => {
    const [asOf, setAsOf] = createSignal<string | null>("2026-09-26T14:30:00");
    render(() => <PatternChartBody hit={null} candles={[]} asOf={asOf()} />);
    expect(screen.getByTestId("patterns-fullscreen-asof-banner")).toHaveTextContent(
      "Viewing as of 2026-09-26 14:30:00",
    );
    setAsOf(null);
    expect(screen.queryByTestId("patterns-fullscreen-asof-banner")).toBeNull();
    setAsOf("");
    expect(screen.queryByTestId("patterns-fullscreen-asof-banner")).toBeNull();
  });

  test("hit present: meta panel with status, quality, last close and day change", () => {
    render(() => <PatternChartBody hit={HIT} candles={CANDLES} />);
    const panel = screen.getByTestId("patterns-fullscreen-panel");
    expect(panel).toBeInTheDocument();
    expect(screen.getAllByText("IRCON").length).toBeGreaterThan(0);
    expect(screen.getByText(/2 bars ago/)).toBeInTheDocument();
    
    expect(screen.getByTestId("patterns-status-confirmed")).toHaveTextContent("Confirmed");
    expect(screen.getByTestId("patterns-quality-strong")).toBeInTheDocument();
    expect(screen.getByText("₹120.00")).toBeInTheDocument();
    expect(screen.getByText("+2.50%")).toBeInTheDocument();
    expect(screen.getByText("Breakout above ₹112.60 on volume")).toBeInTheDocument();
    expect(screen.getByTestId("pattern-tv-stub")).toHaveAttribute("data-candle-count", "2");
    expect(screen.queryByText("No chart data")).toBeNull();
  });

  test("fullscreen panel symbol links to TradingView", () => {
    render(() => <PatternChartBody hit={HIT} candles={CANDLES} />);
    const link = screen.getByTestId("patterns-chart-symbol-link");
    expect(link).toHaveTextContent("IRCON");
    expect(link).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NSE%3AIRCON",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("1m header change compares with the prior session's last bar", () => {
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: null,
      day_change_pct: null,
      close_bar_date: null,
    };
    const candles: ChartCandle[] = [
      // 17 Nov session: 09:30 and 15:15 IST.
      { t: "2026-11-17T04:00:00+00:00", o: 100, h: 101, l: 99, c: 100, v: 900 },
      { t: "2026-11-17T09:45:00+00:00", o: 108, h: 111, l: 107, c: 110, v: 900 },
      // 18 Nov session: 09:30 and 10:00 IST.
      { t: "2026-11-18T04:00:00+00:00", o: 112, h: 116, l: 111, c: 115, v: 900 },
      { t: "2026-11-18T04:30:00+00:00", o: 118, h: 122, l: 117, c: 121, v: 900 },
    ];
    const series = resolveCloseSeries({ hit, candles, timeframe: "1m" });
    // (121 - 110) / 110, not the last bar's (121 - 115) / 115.
    expect(series.changePct).toBeCloseTo(10, 6);

    render(() => <PatternChartBody hit={hit} candles={candles} timeframe="1m" />);
    expect(screen.getByText("+10.00%")).toBeInTheDocument();
    expect(screen.queryByText("+5.22%")).toBeNull();
  });

  test("intraday without an earlier session falls back to the previous bar", () => {
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: null,
      day_change_pct: null,
      close_bar_date: null,
    };
    const candles: ChartCandle[] = [
      { t: "2026-11-18T04:00:00+00:00", o: 100, h: 101, l: 99, c: 100, v: 900 },
      { t: "2026-11-18T04:30:00+00:00", o: 110, h: 111, l: 109, c: 110, v: 900 },
    ];
    expect(
      resolveCloseSeries({ hit, candles, timeframe: "5m" }).changePct,
    ).toBeCloseTo(10, 6);
  });

  test("1D header change stays the prior daily candle's close", () => {
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: null,
      day_change_pct: null,
      close_bar_date: null,
    };
    const candles: ChartCandle[] = [
      { t: "2026-11-17", o: 100, h: 101, l: 99, c: 100, v: 900 },
      { t: "2026-11-18", o: 110, h: 111, l: 109, c: 110, v: 900 },
    ];
    expect(
      resolveCloseSeries({ hit, candles, timeframe: "1D" }).changePct,
    ).toBeCloseTo(10, 6);
  });

  test("1W header change stays prior period over prior period", () => {
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: null,
      day_change_pct: null,
      close_bar_date: null,
    };
    const candles: ChartCandle[] = [
      { t: "2026-11-13", o: 100, h: 101, l: 99, c: 100, v: 900 },
      { t: "2026-11-20", o: 90, h: 91, l: 89, c: 90, v: 900 },
    ];
    expect(
      resolveCloseSeries({ hit, candles, timeframe: "1W" }).changePct,
    ).toBeCloseTo(-10, 6);
  });

  test("a stored hit with no close_bar_date loses to the chart even when end_date is newer", () => {
    const candles: ChartCandle[] = [
      { t: "2026-11-12", o: 3500, h: 3510, l: 3470, c: 3484, v: 1000 },
      { t: "2026-11-13", o: 3484, h: 3450, l: 3420, c: 3430, v: 900 },
    ];
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: 3382,
      day_change_pct: 2.48,
      // Formation date is NOT the close's bar date — it must never win here.
      end_date: "2026-11-15",
      close_bar_date: null,
    };
    render(() => <PatternChartBody hit={hit} candles={candles} />);
    expect(screen.getByText("₹3430.00")).toBeInTheDocument();
    expect(screen.getByText("-1.55%")).toBeInTheDocument();
    expect(screen.queryByText("₹3382.00")).toBeNull();
    expect(screen.queryByText("+2.48%")).toBeNull();
    expect(screen.getByTestId("patterns-close-label")).toHaveTextContent("13 NOV");
    expect(screen.getByTestId("patterns-close-label")).not.toHaveTextContent("15 NOV");
    expect(screen.queryByText(/LAST CLOSE/i)).toBeNull();
    expect(resolveCloseSeries({ hit, candles }).source).toBe("chart");
  });

  test("a hit dated on the chart's last bar wins with its own close/change pair", () => {
    const candles: ChartCandle[] = [
      { t: "2026-11-12", o: 3500, h: 3510, l: 3470, c: 3484, v: 1000 },
      { t: "2026-11-13", o: 3484, h: 3450, l: 3420, c: 3430, v: 900 },
    ];
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: 3430,
      day_change_pct: -1.55,
      end_date: "2026-11-15",
      close_bar_date: "2026-11-13",
    };
    render(() => <PatternChartBody hit={hit} candles={candles} />);
    expect(screen.getByText("₹3430.00")).toBeInTheDocument();
    expect(screen.getByText("-1.55%")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-close-label")).toHaveTextContent("13 NOV");
    expect(resolveCloseSeries({ hit, candles })).toEqual({
      close: 3430,
      changePct: -1.55,
      barDate: "2026-11-13",
      source: "hit",
      isPartial: false,
    });
  });

  test("an older close_bar_date loses to the chart even with a stale close", () => {
    const candles: ChartCandle[] = [
      { t: "2026-11-12", o: 3500, h: 3510, l: 3470, c: 3484, v: 1000 },
      { t: "2026-11-13", o: 3484, h: 3450, l: 3420, c: 3430, v: 900 },
    ];
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: 3382,
      day_change_pct: 2.48,
      end_date: "2026-11-15",
      close_bar_date: "2026-11-10",
    };
    render(() => <PatternChartBody hit={hit} candles={candles} />);
    expect(screen.getByText("₹3430.00")).toBeInTheDocument();
    expect(screen.getByText("-1.55%")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-close-label")).toHaveTextContent("13 NOV");
    expect(resolveCloseSeries({ hit, candles }).source).toBe("chart");
  });

  test("an undated hit (close_bar_date absent) cannot override the chart candles", () => {
    const candles: ChartCandle[] = [
      { t: "2026-11-12", o: 3500, h: 3510, l: 3470, c: 3484, v: 1000 },
      { t: "2026-11-13", o: 3484, h: 3450, l: 3420, c: 3430, v: 900 },
    ];
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: 3382,
      day_change_pct: 2.48,
      end_date: "2026-11-13",
      close_bar_date: undefined,
    };
    render(() => <PatternChartBody hit={hit} candles={candles} />);
    expect(screen.getByText("₹3430.00")).toBeInTheDocument();
    expect(screen.getByText("-1.55%")).toBeInTheDocument();
    expect(resolveCloseSeries({ hit, candles }).source).toBe("chart");
  });

  test("a live quote renders a separate LTP line and never overwrites the dated close", () => {
    const candles: ChartCandle[] = [
      { t: "2026-11-12", o: 3500, h: 3510, l: 3470, c: 3484, v: 1000 },
      { t: "2026-11-13", o: 3484, h: 3450, l: 3420, c: 3430, v: 900 },
    ];
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: 3430,
      day_change_pct: -1.55,
      close_bar_date: "2026-11-13",
    };
    render(() => (
      <PatternChartBody hit={hit} candles={candles} livePrice={2986} liveChange={-12.94} />
    ));

    expect(screen.getByTestId("patterns-close-label")).toHaveTextContent("13 NOV");
    expect(screen.getByText("₹3430.00")).toBeInTheDocument();
    expect(screen.getByText("-1.55%")).toBeInTheDocument();

    // The live quote is an independent line, toned by its own sign.
    const ltp = screen.getByTestId("patterns-ltp-line");
    expect(ltp).toHaveTextContent("LTP");
    expect(ltp).toHaveTextContent("₹2986.00");
    expect(screen.getByTestId("patterns-ltp-change")).toHaveTextContent("-12.94%");
    expect(getPnLTextColor(-12.94)).toBe("error");
    expect(getPnLTextColor(2.5)).toBe("success");
  });

  test("null livePrice hides the LTP line and a failed quote still shows the close", () => {
    render(() => (
      <PatternChartBody hit={HIT} candles={CANDLES} livePrice={null} liveChange={null} />
    ));
    expect(screen.queryByTestId("patterns-ltp-line")).toBeNull();
    expect(screen.getByTestId("patterns-close-label")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-panel")).toBeInTheDocument();
  });

  test("livePrice with null liveChange renders a neutral dash (no success tone)", () => {
    const candles: ChartCandle[] = [
      { t: "2026-11-12", o: 3500, h: 3510, l: 3470, c: 3484, v: 1000 },
      { t: "2026-11-13", o: 3484, h: 3450, l: 3420, c: 3430, v: 900 },
    ];
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: 3430,
      day_change_pct: -1.55,
      close_bar_date: "2026-11-13",
    };
    render(() => (
      <PatternChartBody hit={hit} candles={candles} livePrice={2986} liveChange={null} />
    ));
    const ltp = screen.getByTestId("patterns-ltp-line");
    expect(ltp).toHaveTextContent("LTP");
    expect(ltp).toHaveTextContent("₹2986.00");
    const change = screen.getByTestId("patterns-ltp-change");
    expect(change).toHaveTextContent("—");
    expect(getPnLTextColor(0)).toBe("success");
    expect(change).not.toHaveClass("text-fin-positive");
    expect(change).not.toHaveClass("text-fin-negative");
  });

  test("a negative liveChange is toned red and does not disturb the dated close", () => {
    const candles: ChartCandle[] = [
      { t: "2026-11-12", o: 3500, h: 3510, l: 3470, c: 3484, v: 1000 },
      { t: "2026-11-13", o: 3484, h: 3450, l: 3420, c: 3430, v: 900 },
    ];
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: 3430,
      day_change_pct: -1.55,
      close_bar_date: "2026-11-13",
    };
    render(() => (
      <PatternChartBody hit={hit} candles={candles} livePrice={2986} liveChange={-12.94} />
    ));
    const change = screen.getByTestId("patterns-ltp-change");
    expect(change).toHaveTextContent("-12.94%");
    expect(getPnLTextColor(-12.94)).toBe("error");
    expect(screen.getByText("₹3430.00")).toBeInTheDocument();
    expect(screen.getByText("-1.55%")).toBeInTheDocument();
  });

  test("emptyState renders when there is no hit", () => {
    render(() => <PatternChartBody hit={null} candles={[]} emptyState={<div data-testid="panel-empty">No pattern selected</div>} />);
    expect(screen.getByTestId("panel-empty")).toHaveTextContent("No pattern selected");
    expect(screen.queryByTestId("patterns-fullscreen-panel")).toBeNull();
  });

  test("history segmented control defaults to 1 and toggles between 1/3/5", () => {
    const hits: PatternHitDTO[] = [1, 2, 3].map((n) => ({
      ...HIT,
      id: n,
      end_date: `2026-09-${String(27 - n).padStart(2, "0")}`,
      pattern_id: `pattern_${n}`,
      symbol: `SYM${n}`,
    }));
    render(() => <PatternChartBody hit={HIT} hits={hits} onSelectHit={vi.fn()} candles={CANDLES} />);
    const box = screen.getByTestId("patterns-history-count");
    expect(within(box).getByRole("button", { name: "1" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(box).getByRole("button", { name: "3" }));
    expect(within(box).getByRole("button", { name: "3" })).toHaveAttribute("aria-pressed", "true");
    expect(within(box).getByRole("button", { name: "1" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(within(box).getByRole("button", { name: "5" }));
    expect(within(box).getByRole("button", { name: "5" })).toHaveAttribute("aria-pressed", "true");
    expect(within(box).getByRole("button", { name: "3" })).toHaveAttribute("aria-pressed", "false");
  });

  test("clicking the history list calls onSelectHit with the selected hit payload", () => {
    const hits: PatternHitDTO[] = [
      { ...HIT, id: 1, end_date: "2026-09-26", pattern_id: "a", symbol: "AAA" },
      { ...HIT, id: 2, end_date: "2026-09-25", pattern_id: "b", symbol: "BBB" },
    ];
    const onSelectHit = vi.fn();
    render(() => <PatternChartBody hit={HIT} hits={hits} onSelectHit={onSelectHit} candles={CANDLES} />);
    fireEvent.click(screen.getByTestId("patterns-fullscreen-list-stub"));
    expect(onSelectHit).toHaveBeenCalledTimes(1);
    expect(onSelectHit).toHaveBeenCalledWith(hits[0]);
    expect(onSelectHit).toHaveBeenCalledWith(expect.objectContaining({ symbol: "AAA" }));
  });

  test("the last returned candle (16 Nov) drives the close label and price", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
    const candles: ChartCandle[] = [
      { t: "2026-11-13", o: 3484, h: 3450, l: 3420, c: 3430, v: 900 },
      { t: "2026-11-16", o: 3430, h: 3490, l: 3420, c: 3478, v: 1100 },
    ];
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: null,
      day_change_pct: null,
      close_bar_date: null,
    };
    render(() => <PatternChartBody hit={hit} candles={candles} />);
    const label = screen.getByTestId("patterns-close-label");
    expect(label).toHaveTextContent("CLOSE · 16 NOV");
    expect(label).not.toHaveTextContent("PREV CLOSE");
    expect(label).not.toHaveTextContent("13 NOV");
    expect(screen.getByText("₹3478.00")).toBeInTheDocument();
    expect(screen.getByText("+1.40%")).toBeInTheDocument();
    expect(screen.getByTestId("pattern-tv-stub")).toHaveAttribute("data-candle-count", "2");
  });

  test("a null close_bar_date falls back to the last candle's IST session date, not its UTC date", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-18T06:00:00Z")); // 11:30 IST on 18 Nov
    const candles: ChartCandle[] = [
      { t: "2026-11-13T18:30:00+00:00", o: 3430, h: 3450, l: 3420, c: 3430, v: 900 },
      { t: "2026-11-16T18:30:00+00:00", o: 3430, h: 3490, l: 3420, c: 3478, v: 1100 },
    ];
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: null,
      day_change_pct: null,
      close_bar_date: null,
    };
    render(() => <PatternChartBody hit={hit} candles={candles} />);
    // 18:30Z on 16 Nov is 00:00 IST on 17 Nov — the 17 Nov session.
    expect(screen.getByTestId("patterns-close-label")).toHaveTextContent("17 NOV");
    expect(screen.getByTestId("patterns-close-label")).not.toHaveTextContent("16 NOV");
  });

  test("the chart fallback stores a session key, not the raw UTC candle timestamp", () => {
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: null,
      day_change_pct: null,
      close_bar_date: null,
    };
    const series = resolveCloseSeries({
      hit,
      candles: [
        { t: "2026-11-16T18:30:00+00:00", o: 100, h: 101, l: 99, c: 100, v: 900 },
      ],
    });
    expect(series.source).toBe("chart");
    expect(series.barDate).toBe("2026-11-17");
    expect(series.barDate).not.toContain("T18:30");
  });

  test("an intraday bar keeps its own calendar day (no IST rollover off-by-one)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-17T12:00:00Z")); // 17:30 IST on 17 Nov
    const candles: ChartCandle[] = [
      { t: "2026-11-17T09:45:00+00:00", o: 100, h: 101, l: 99, c: 100, v: 900 },
    ];
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: null,
      day_change_pct: null,
      close_bar_date: null,
    };
    render(() => <PatternChartBody hit={hit} candles={candles} />);
    // 09:45Z = 15:15 IST on 17 Nov — still the 17th, not the 18th.
    expect(screen.getByTestId("patterns-close-label")).toHaveTextContent("17 NOV");
    expect(screen.getByTestId("patterns-close-label")).not.toHaveTextContent("18 NOV");
  });

  test("a partial last candle shows a (live) marker; a completed bar does not", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T12:00:00Z"));
    const base: ChartCandle[] = [
      { t: "2026-11-13", o: 3484, h: 3450, l: 3420, c: 3430, v: 900 },
      { t: "2026-11-16", o: 3430, h: 3490, l: 3420, c: 3478, v: 1100 },
    ];
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: null,
      day_change_pct: null,
      close_bar_date: null,
    };
    const partial: ChartCandle[] = [
      base[0]!,
      { ...base[1]!, is_partial: true },
    ];

    const view = render(() => <PatternChartBody hit={hit} candles={partial} />);
    expect(screen.getByTestId("patterns-close-label")).toHaveTextContent("CLOSE · 16 NOV");
    expect(screen.getByTestId("patterns-close-partial")).toHaveTextContent("(live)");
    // The marker never disturbs the price / percent pair.
    expect(screen.getByText("₹3478.00")).toBeInTheDocument();
    expect(screen.getByText("+1.40%")).toBeInTheDocument();

    view.unmount();
    render(() => <PatternChartBody hit={hit} candles={base} />);
    expect(screen.getByTestId("patterns-close-label")).toHaveTextContent("CLOSE · 16 NOV");
    expect(screen.queryByTestId("patterns-close-partial")).toBeNull();
  });

  test("market=usa keys an ET-offset candle to its New York session date, not IST", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T20:00:00Z")); // 15:00 ET / 01:30 IST next day
    const candles: ChartCandle[] = [
      { t: "2026-11-16T14:49:00-05:00", o: 100, h: 101, l: 99, c: 100, v: 900 },
    ];
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: null,
      day_change_pct: null,
      close_bar_date: null,
    };

    const us = render(() => <PatternChartBody hit={hit} candles={candles} market="usa" />);
    // 14:49 ET = 19:49Z = 01:19 IST on the 17th; the US session is the 16th.
    expect(screen.getByTestId("patterns-close-label")).toHaveTextContent("CLOSE · 16 NOV");
    expect(screen.getByTestId("patterns-close-label")).not.toHaveTextContent("17 NOV");
    us.unmount();

    render(() => <PatternChartBody hit={hit} candles={candles} />);
    expect(screen.getByTestId("patterns-close-label")).toHaveTextContent("CLOSE · 17 NOV");
  });

  test("market=usa keeps the ET calendar date across the DST boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-09T20:00:00Z"));
    // 23:30 EDT on 8 Mar -> 03:30Z on 9 Mar (IST already the 9th).
    const candles: ChartCandle[] = [
      { t: "2026-03-08T23:30:00-04:00", o: 100, h: 101, l: 99, c: 100, v: 900 },
    ];
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: null,
      day_change_pct: null,
      close_bar_date: null,
    };
    const us = render(() => <PatternChartBody hit={hit} candles={candles} market="usa" />);
    expect(screen.getByTestId("patterns-close-label")).toHaveTextContent("08 MAR");
    us.unmount();

    render(() => <PatternChartBody hit={hit} candles={candles} />);
    expect(screen.getByTestId("patterns-close-label")).toHaveTextContent("09 MAR");
  });

  test("an explicit timeZone overrides market", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T20:00:00Z"));
    const candles: ChartCandle[] = [
      { t: "2026-11-16T14:49:00-05:00", o: 100, h: 101, l: 99, c: 100, v: 900 },
    ];
    const hit: PatternHitDTO = {
      ...HIT,
      last_close: null,
      day_change_pct: null,
      close_bar_date: null,
    };
    render(() => (
      <PatternChartBody hit={hit} candles={candles} market="usa" timeZone="Asia/Kolkata" />
    ));
    expect(screen.getByTestId("patterns-close-label")).toHaveTextContent("17 NOV");
  });

  test("feed/delay labels render a source badge only when supplied", () => {
    const plain = render(() => <PatternChartBody hit={null} candles={[]} />);
    expect(screen.queryByTestId("patterns-feed-badge")).toBeNull();
    plain.unmount();

    render(() => (
      <PatternChartBody
        hit={null}
        candles={[]}
        market="usa"
        feedLabel="Yahoo"
        delayLabel="~1 min (forming)"
      />
    ));
    expect(screen.getByTestId("patterns-feed-badge")).toHaveTextContent(
      "Yahoo · ~1 min (forming)",
    );
  });

  test("market=usa: close and LTP render in USD with no rupee symbol", () => {
    render(() => (
      <PatternChartBody
        hit={US_HIT}
        candles={CANDLES}
        market="usa"
        livePrice={354.1}
        liveChange={0.53}
      />
    ));
    const panel = screen.getByTestId("patterns-fullscreen-panel");
    expect(within(panel).getByText("$352.25")).toBeInTheDocument();
    expect(within(panel).getByText("$354.10")).toBeInTheDocument();
    expect(panel.textContent).not.toContain("₹");
    expect(screen.getByTestId("pattern-tv-stub")).toHaveAttribute("data-market", "usa");
  });

  test("market=usa: chart body pivot prices render in $ with no ₹", () => {
    const usWithPivots: PatternHitDTO = {
      ...US_HIT,
      pivots: [
        { t: "2026-05-04", price: 1234.5, kind: "high" },
        { t: "2026-05-20", price: 1180, kind: "low" },
      ],
    };
    render(() => <PatternChartBody hit={usWithPivots} candles={CANDLES} market="usa" />);
    const pivots = screen.getByTestId("patterns-detail-pivots");
    expect(within(pivots).getByTestId("patterns-detail-pivot-0")).toHaveTextContent("$1,234.50");
    expect(within(pivots).getByTestId("patterns-detail-pivot-1")).toHaveTextContent("$1,180.00");
    expect(pivots.textContent).not.toContain("₹");
  });

  test("market=india keeps the ₹ price labels on close and LTP", () => {
    render(() => (
      <PatternChartBody
        hit={US_HIT}
        candles={CANDLES}
        market="india"
        livePrice={354.1}
        liveChange={0.53}
      />
    ));
    const panel = screen.getByTestId("patterns-fullscreen-panel");
    expect(within(panel).getByText("₹352.25")).toBeInTheDocument();
    expect(within(panel).getByText("₹354.10")).toBeInTheDocument();
    expect(panel.textContent).not.toContain("$");
  });

  test("renders the 28px indicator strip and forwards timeframe/indicators/zones to the chart", () => {
    render(() => (
      <PatternChartBody
        hit={HIT}
        candles={CANDLES}
        timeframe="5m"
        indicators={{ ...INDICATORS, timeframe: "5m" }}
        srZones={ZONES}
      />
    ));
    const strip = screen.getByTestId("patterns-chart-indicator-strip");
    expect(strip).toHaveStyle({ height: "28px" });
    expect(screen.getByTestId("patterns-chart-indicators-trigger")).toBeInTheDocument();

    const chart = screen.getByTestId("pattern-tv-stub");
    expect(chart).toHaveAttribute("data-timeframe", "5m");
    expect(chart).toHaveAttribute("data-data-candles", "2");
    // Default SMA20 is on; every other indicator starts hidden.
    expect(chart).toHaveAttribute(
      "data-hidden",
      "BB,Crosses,Pivots,Resistance,S/R,SMA200,SMA50,Support,VWAP",
    );

    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));
    expect(screen.getByTestId("chart-indicator-vwap")).toBeEnabled();
    expect(screen.getByTestId("chart-indicator-zones-count")).toHaveTextContent("1 zone");
  });

  test("raw zones that cannot be drawn show 'No zones' without a count badge", () => {
    setChartIndicator("srZones", true);
    const stale: SRZone[] = Array.from({ length: 4 }, (_, index) => ({
      kind: "support",
      top: 110 + index,
      bottom: 100 + index,
      start_date: "2020-01-01",
      end_date: "2020-01-31",
      touches: 1,
      score: 0.5,
    }));
    render(() => (
      <PatternChartBody
        hit={HIT}
        candles={CANDLES}
        timeframe="1D"
        indicators={INDICATORS}
        srZones={stale}
      />
    ));
    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));

    expect(screen.getByTestId("chart-indicator-srZones-reason")).toHaveTextContent("No zones");
    expect(screen.queryByTestId("chart-indicator-zones-count")).toBeNull();
    expect(screen.getByTestId("patterns-chart-indicators-count")).toHaveTextContent("1");
  });

  test("indicator prefs persist across pattern navigation while the pattern legend hidden set resets", () => {    const illustrated: PatternHitDTO = {
      ...HIT,
      trendlines: [
        [
          { t: "2026-09-25", price: 103 },
          { t: "2026-09-26", price: 106 },
        ],
        [
          { t: "2026-09-25", price: 99 },
          { t: "2026-09-26", price: 101 },
        ],
      ],
    };
    const [hit, setHit] = createSignal<PatternHitDTO>(illustrated);
    render(() => (
      <PatternChartBody
        hit={hit()}
        candles={CANDLES}
        timeframe="1D"
        indicators={INDICATORS}
        srZones={ZONES}
      />
    ));

    // Hide one pattern series through the legend.
    const boundary = screen.getByTestId("patterns-chart-legend-item-Falling Wedge");
    expect(boundary).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(boundary);
    expect(screen.getByTestId("patterns-chart-legend-item-Falling Wedge")).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    // Turn on SMA50 from the session menu.
    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));
    fireEvent.click(screen.getByTestId("chart-indicator-sma50"));
    expect(chartIndicatorPrefs().sma50).toBe(true);

    // A different hit resets the pattern legend visibility…
    setHit({
      ...illustrated,
      id: 8,
      pattern_id: "ascending_triangle",
      start_date: "2026-05-01",
    });
    expect(screen.getByTestId("patterns-chart-legend-item-Falling Wedge")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // …but the indicator preference is still on and drawn.
    expect(chartIndicatorPrefs().sma50).toBe(true);
    expect(screen.getByTestId("chart-indicator-sma50")).toBeChecked();
    expect(screen.getByTestId("pattern-tv-stub").getAttribute("data-hidden")).not.toContain(
      "SMA50",
    );
  });

  test("Crosses legend appears only while the indicator pref is enabled", () => {
    const noPivots: PatternHitDTO = { ...HIT, pivots: [] };
    const crossIndicators: ChartIndicators = {
      ...INDICATORS,
      crosses: [{ t: "2026-09-26", kind: "golden" }],
    };
    render(() => (
      <PatternChartBody
        hit={noPivots}
        candles={CANDLES}
        timeframe="1D"
        indicators={crossIndicators}
      />
    ));

    // Default pref is off: no legend entry and the marker stays hidden.
    expect(screen.queryByTestId("patterns-chart-legend-item-Crosses")).toBeNull();
    expect(screen.queryByTestId("patterns-chart-legend-item-Pivots")).toBeNull();
    expect(screen.queryByTestId("patterns-chart-legend-item-Key points")).toBeNull();
    expect(screen.getByTestId("pattern-tv-stub").getAttribute("data-hidden")).toContain(
      "Crosses",
    );

    // Enabling from the menu adds the entry and draws the markers.
    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));
    fireEvent.click(screen.getByTestId("chart-indicator-crosses"));
    expect(chartIndicatorPrefs().crosses).toBe(true);
    const crosses = screen.getByTestId("patterns-chart-legend-item-Crosses");
    expect(crosses).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("pattern-tv-stub").getAttribute("data-hidden")).not.toContain(
      "Crosses",
    );

    // Toggling the legend off removes both the entry and the markers.
    fireEvent.click(crosses);
    expect(chartIndicatorPrefs().crosses).toBe(false);
    expect(screen.queryByTestId("patterns-chart-legend-item-Crosses")).toBeNull();
    expect(screen.getByTestId("pattern-tv-stub").getAttribute("data-hidden")).toContain(
      "Crosses",
    );
  });

  test("markerLegendEntries gates Crosses but keeps pivots/key points", () => {
    const marker = (
      group: TVMarker["group"],
      legendName?: string,
    ): TVMarker => ({
      time: 1,
      position: "inBar",
      shape: "circle",
      color: "#fff",
      text: "",
      group,
      legendName,
    });

    expect(markerLegendEntries([marker("crosses", "Crosses")])).toEqual([]);
    expect(
      markerLegendEntries([marker("crosses", "Crosses")], { crossesEnabled: true }),
    ).toEqual([{ name: "Crosses", color: expect.any(String) }]);
    expect(markerLegendEntries([marker("pivots"), marker("keypoints")])).toEqual([
      { name: "Pivots", color: expect.any(String) },
      { name: "Key points", color: expect.any(String) },
    ]);
    expect(
      markerLegendEntries([marker("pivots"), marker("crosses", "Crosses")], {
        crossesEnabled: false,
      }),
    ).toEqual([{ name: "Pivots", color: expect.any(String) }]);
    expect(
      markerLegendEntries([marker("pivots"), marker("crosses", "Crosses")], {
        crossesEnabled: true,
      }),
    ).toEqual([
      { name: "Pivots", color: expect.any(String) },
      { name: "Crosses", color: expect.any(String) },
    ]);
  });

  test("VWAP visibility follows the timeframe gate even when the pref is on", () => {
    const [timeframe, setTimeframe] = createSignal<string | null>("5m");
    render(() => (
      <PatternChartBody
        hit={HIT}
        candles={CANDLES}
        timeframe={timeframe()}
        indicators={{ ...INDICATORS, timeframe: "5m" }}
      />
    ));
    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));
    fireEvent.click(screen.getByTestId("chart-indicator-vwap"));
    expect(chartIndicatorPrefs().vwap).toBe(true);
    expect(screen.getByTestId("pattern-tv-stub").getAttribute("data-hidden")).not.toContain(
      "VWAP",
    );

    setTimeframe("1D");
    expect(screen.getByTestId("pattern-tv-stub").getAttribute("data-hidden")).toContain("VWAP");
    expect(screen.getByTestId("chart-indicator-vwap")).toBeDisabled();
    expect(screen.getByTestId("chart-indicator-vwap-reason")).toHaveTextContent("Intraday only");
  });

  test("default state shows one active-indicator chip: SMA20", () => {
    render(() => (
      <PatternChartBody
        hit={HIT}
        candles={CANDLES}
        timeframe="1D"
        indicators={INDICATORS}
      />
    ));
    const row = screen.getByTestId("chart-active-indicators");
    expect(row).toHaveAttribute("data-active-count", "1");
    expect(row.querySelectorAll("[data-indicator]")).toHaveLength(1);
    expect(row.querySelector('[data-indicator="sma20"]')).toHaveTextContent("SMA20");
    expect(row.querySelector('[data-indicator="sma50"]')).toBeNull();
  });

  test("all-on chips label every non-Crosses active row including S/R", () => {
    for (const id of [
      "sma20",
      "sma50",
      "sma200",
      "vwap",
      "bb",
      "crosses",
      "srZones",
    ] as const) {
      setChartIndicator(id, true);
    }
    render(() => (
      <PatternChartBody
        hit={HIT}
        candles={LONG_CANDLES}
        timeframe="1D"
        indicators={longIndicators()}
        srZones={LONG_ZONES}
      />
    ));
    const row = screen.getByTestId("chart-active-indicators");
    // VWAP is disabled on 1D; the other six rows are drawable.
    expect(row).toHaveAttribute("data-active-count", "6");
    const ids = [...row.querySelectorAll("[data-indicator]")].map((chip) =>
      chip.getAttribute("data-indicator"),
    );
    expect(ids).toEqual(["sma20", "sma50", "sma200", "bb", "srZones"]);
    expect(row).toHaveTextContent("SMA20");
    expect(row).toHaveTextContent("SMA50");
    expect(row).toHaveTextContent("SMA200");
    expect(row).toHaveTextContent("BB");
    expect(row).toHaveTextContent("S/R");
    expect(row).not.toHaveTextContent("Crosses");
    expect(row).not.toHaveTextContent("VWAP");
  });

  test("compact 390px prioritizes SMA20/BB/S/R and keeps Crosses label visible", () => {
    const width = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(390);
    for (const id of [
      "sma20",
      "sma50",
      "sma200",
      "vwap",
      "bb",
      "crosses",
      "srZones",
    ] as const) {
      setChartIndicator(id, true);
    }
    try {
      render(() => (
        <PatternChartBody
          hit={HIT}
          candles={LONG_CANDLES}
          timeframe="1D"
          indicators={longIndicators()}
          srZones={LONG_ZONES}
        />
      ));
      const row = screen.getByTestId("chart-active-indicators");
      expect(row).toHaveAttribute("data-active-count", "6");
      const ids = [...row.querySelectorAll("[data-indicator]")].map((chip) =>
        chip.getAttribute("data-indicator"),
      );
      expect(ids).toEqual(["sma20", "bb", "srZones", "overflow"]);
      expect(row).toHaveTextContent("SMA20");
      expect(row).toHaveTextContent("BB");
      expect(row).toHaveTextContent("S/R");
      expect(row.querySelector('[data-indicator="overflow"]')).toHaveTextContent("+2");
      expect(row).not.toHaveTextContent("Crosses");
      expect(screen.getByTestId("patterns-chart-indicators-count")).toHaveTextContent("6");
      expect(screen.getByTestId("patterns-chart-indicators-trigger")).toHaveAttribute(
        "aria-label",
        "Indicators (6 active)",
      );

      const crossesLegend = screen.getByTestId("patterns-chart-legend-item-Crosses");
      expect(crossesLegend).toHaveTextContent("Crosses");
      const legendBlock = screen.getByTestId("patterns-chart-legend-block");
      expect(legendBlock.className).toContain("shrink-0");
      expect(legendBlock.className).toContain("min-w-[72px]");
    } finally {
      width.mockRestore();
    }
  });

  test("all-off hides the active-indicator chip row", () => {
    for (const id of [
      "sma20",
      "sma50",
      "sma200",
      "vwap",
      "bb",
      "crosses",
      "srZones",
    ] as const) {
      setChartIndicator(id, false);
    }
    render(() => (
      <PatternChartBody
        hit={HIT}
        candles={LONG_CANDLES}
        timeframe="1D"
        indicators={INDICATORS}
        srZones={ZONES}
      />
    ));
    expect(screen.queryByTestId("chart-active-indicators")).toBeNull();
  });

  test("compact chips prioritize SMA20, BB and S/R", () => {
    expect(
      prioritizeCompactChips([
        { id: "sma50" },
        { id: "srZones" },
        { id: "bb" },
        { id: "sma20" },
      ]).map((spec) => spec.id),
    ).toEqual(["sma20", "bb", "srZones", "sma50"]);
  });

  test("chip window handles 0 / 1 / 3 / overflow in compact mode", () => {
    expect(activeIndicatorChipWindow([], true)).toEqual({ visible: [], overflow: 0 });
    expect(activeIndicatorChipWindow(["a"], true)).toEqual({ visible: ["a"], overflow: 0 });
    expect(activeIndicatorChipWindow(["a", "b", "c"], true)).toEqual({
      visible: ["a", "b", "c"],
      overflow: 0,
    });
    expect(activeIndicatorChipWindow(["a", "b", "c", "d", "e"], true)).toEqual({
      visible: ["a", "b", "c"],
      overflow: 2,
    });
    expect(activeIndicatorChipWindow(["a", "b", "c", "d", "e", "f"], true)).toEqual({
      visible: ["a", "b", "c"],
      overflow: 3,
    });
    expect(activeIndicatorChipWindow(["a", "b", "c", "d", "e", "f"], false)).toEqual({
      visible: ["a", "b", "c", "d", "e", "f"],
      overflow: 0,
    });
  });

  const SUMMARY_ZONES: SRZone[] = [
    {
      kind: "support",
      top: 101,
      bottom: 99,
      start_date: "2026-09-01",
      end_date: "2026-09-26",
      touches: 3,
      score: 0.9,
    },
    {
      kind: "resistance",
      top: 112,
      bottom: 110,
      start_date: "2026-09-01",
      end_date: "2026-09-26",
      touches: 2,
      score: 0.8,
    },
    {
      // Aligned but never displayed: one band per side keeps the canvas legible.
      kind: "sr",
      top: 999,
      bottom: 998,
      start_date: "2026-09-01",
      end_date: "2026-09-26",
      touches: 1,
      score: 0.7,
    },
    {
      kind: "support",
      top: 777,
      bottom: 776,
      start_date: "2020-01-01",
      end_date: "2020-01-31",
      touches: 9,
      score: 1,
    },
  ];

  test("S/R summary describes the built, drawn bands rather than the raw payload", () => {
    setChartIndicator("srZones", true);
    render(() => (
      <PatternChartBody
        hit={HIT}
        candles={CANDLES}
        timeframe="1D"
        srZones={SUMMARY_ZONES}
      />
    ));

    const summary = screen.getByTestId("sr-zone-summary");
    expect(summary).toHaveClass("sr-only");
    const items = within(summary).getAllByRole("listitem").map((item) => item.textContent);
    expect(items).toEqual([
      "Support: ₹99.00 to ₹101.00, 3 touches",
      "Resistance: ₹110.00 to ₹112.00, 2 touches",
    ]);
    expect(summary.textContent).not.toContain("999.00");
    expect(summary.textContent).not.toContain("777.00");
  });

  test("hidden zones are absent from the summary and reappear with the pref", () => {
    render(() => (
      <PatternChartBody
        hit={HIT}
        candles={CANDLES}
        timeframe="1D"
        srZones={SUMMARY_ZONES}
      />
    ));
    expect(screen.queryByTestId("sr-zone-summary")).toBeNull();

    fireEvent.click(screen.getByTestId("patterns-chart-indicators-trigger"));
    fireEvent.click(screen.getByTestId("chart-indicator-srZones"));
    expect(screen.getByTestId("sr-zone-summary")).toHaveTextContent(
      "Support: ₹99.00 to ₹101.00, 3 touches",
    );

    fireEvent.click(screen.getByTestId("chart-indicator-srZones"));
    expect(screen.queryByTestId("sr-zone-summary")).toBeNull();
  });

  test("summary stays out of layout: sr-only node inside the unchanged chart container", () => {
    setChartIndicator("srZones", true);
    render(() => (
      <PatternChartBody
        hit={HIT}
        candles={CANDLES}
        timeframe="1D"
        srZones={SUMMARY_ZONES}
      />
    ));

    const container = screen.getByTestId("patterns-chart-indicator-strip").parentElement;
    expect(container).toHaveClass("h-[60vh]");
    expect(container).toHaveClass("min-h-[360px]");
    expect(container).toHaveClass("overflow-hidden");
    expect(screen.getByTestId("patterns-chart-indicator-strip")).toHaveStyle({ height: "28px" });
    const summary = screen.getByTestId("sr-zone-summary");
    expect(summary).toBe(container!.querySelector(".sr-only"));
    expect(summary.className).toBe("sr-only");
    expect(summary.getAttribute("style")).toBeNull();
    expect(screen.queryByText("Levels")).toBeNull();
  });
});
