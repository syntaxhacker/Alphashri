// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";

vi.mock("@/ui", async () => {
  const { mockSolidUi } = await import("@/test-utils/solidUiMock");
  return mockSolidUi();
});
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import type { ChartCandle, PatternHitDTO } from "@/types/chartPatterns";
import { createSignal } from "solid-js";
import { getPnLTextColor } from "@/utils/ui-helpers";
import { PatternChartBody, resolveCloseSeries } from "./PatternChartBody";

vi.mock("./PatternTradingViewChart", () => ({
  PatternTradingViewChart: ({
    hit,
    candles,
    market,
  }: {
    hit: PatternHitDTO | null;
    candles: ChartCandle[];
    market?: string;
  }) => (
    <div
      data-testid="pattern-tv-stub"
      data-hit-symbol={hit?.symbol ?? "null"}
      data-candle-count={String(candles.length)}
      data-market={market ?? "unset"}
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
  trend_lines: [],
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


describe("PatternChartBody", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test("default render (no hit): body, history control, empty TV, no chart data", () => {
    render(() => <PatternChartBody hit={null} candles={[]} />);
    expect(screen.getByTestId("patterns-chart-body")).toBeInTheDocument();
    const history = screen.getByTestId("patterns-history-count");
    expect(history).toBeInTheDocument();
    expect(within(history).getByRole("button", { name: "3" })).toHaveAttribute("aria-pressed", "true");
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

  test("history segmented control toggles between 1/3/5", () => {
    const hits: PatternHitDTO[] = [1, 2, 3].map((n) => ({
      ...HIT,
      id: n,
      end_date: `2026-09-${String(27 - n).padStart(2, "0")}`,
      pattern_id: `pattern_${n}`,
      symbol: `SYM${n}`,
    }));
    render(() => <PatternChartBody hit={HIT} hits={hits} onSelectHit={vi.fn()} candles={CANDLES} />);
    const box = screen.getByTestId("patterns-history-count");
    expect(within(box).getByRole("button", { name: "3" })).toHaveAttribute("aria-pressed", "true");

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
});
