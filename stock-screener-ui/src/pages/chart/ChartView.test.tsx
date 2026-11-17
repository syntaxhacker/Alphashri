// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { MemoryRouter, Route, createMemoryHistory } from "@solidjs/router";
import { UIProvider } from "@/ui";
import type { ChartPayload, PatternHitDTO, TFSpec } from "@/types/chartPatterns";
import ChartView from "./ChartView";
import { fetchSymbolChart, fetchTimeframes } from "@/api/chartPatterns";

vi.mock("@/api/chartPatterns", () => ({
  fetchSymbolChart: vi.fn(),
  fetchTimeframes: vi.fn(),
}));

vi.mock("@/components/patterns/PatternTradingViewChart", () => ({
  PatternTradingViewChart: () => <div data-testid="patterns-tv-chart" />,
}));

// Native-select stub so the timeframe wiring is deterministic (the real Select needs popup interaction). Same test id as the real control.
vi.mock("@/components/patterns/ChartTimeframeSelect", () => ({
  ChartTimeframeSelect: (props: any) => {
    const source =
      (props.timeframes as any[]).length > 0
        ? (props.timeframes as any[])
        : [{ id: props.value, label: props.value }];
    return (
      <select
        data-testid="chart-timeframe-select"
        aria-label="Timeframe"
        value={props.value}
        onChange={(e) => props.onChange(e.currentTarget.value)}
      >
        {source.map((tf: any) => (
          <option value={tf.id}>
            {tf.label || tf.id}
          </option>
        ))}
      </select>
    );
  },
}));

// PatternChartBody is still React and cannot mount under Solid. Stub it with
// the same structure the assertions rely on (panel, list item, as-of banner,
// empty state slot).
vi.mock("@/components/patterns/PatternChartBody", () => ({
  PatternChartBody: (props: any) => (
    <div
      data-testid="patterns-fullscreen-body"
      data-hits={(props.hits ?? []).length}
      data-trend-lines={(props.trendLines ?? []).length}
      data-overlays={(props.overlays ?? []).length}
      data-hit-source={props.hit?.source ?? ""}
    >
      {props.asOf ? (
        <div data-testid="patterns-fullscreen-asof-banner">as of {props.asOf}</div>
      ) : null}
      {props.hit ? (
        <div data-testid="patterns-fullscreen-panel">
          <div data-testid="patterns-fullscreen-list-item-0">
            {props.hits?.[0]?.pattern_name ?? props.hit.pattern_name}
          </div>
        </div>
      ) : (
        props.emptyState
      )}
    </div>
  ),
}));

// PatternChartToolbar is Solid-compilable but renders @/ui Box (broken). Stub
// it to expose the same slots/testids the page wires into it.
vi.mock("@/components/patterns/PatternChartToolbar", () => ({
  PatternChartToolbar: (props: any) => (
    <div data-testid="patterns-chart-toolbar">
      {props.leading}
      <div data-testid={props.titleTestId}>{props.title}</div>
      {props.onTimeframeChange && (
        <select
          data-testid="chart-timeframe-select"
          aria-label="Timeframe"
          value={props.timeframe}
          onChange={(e) => props.onTimeframeChange(e.currentTarget.value)}
        >
          {(props.timeframes ?? []).map((tf: any) => (
            <option value={tf.id}>
              {tf.label || tf.id}
            </option>
          ))}
        </select>
      )}
      {props.onAsOfChange ? (
        <>
          <input
            data-testid="test-asof-input"
            aria-label="As of"
            value={props.asOf ?? ""}
            onInput={(e) => props.onAsOfChange(e.currentTarget.value || null, props.fromDate ?? null)}
          />
          <input
            data-testid="test-from-input"
            aria-label="From"
            value={props.fromDate ?? ""}
            onInput={(e) => props.onAsOfChange(props.asOf ?? null, e.currentTarget.value || null)}
          />
        </>
      ) : null}
      {props.asOf ? (
        <div data-testid="patterns-fullscreen-asof-toolbar">{props.asOf}</div>
      ) : null}
    </div>
  ),
}));

const TIMEFRAMES: TFSpec[] = [
  { id: "1D", label: "1D" },
  { id: "1W", label: "1W" },
  { id: "1h", label: "1h" },
  { id: "15m", label: "15m" },
] as TFSpec[];

const HIT: PatternHitDTO = {
  id: 7,
  symbol: "TEST",
  name: "Test Industries",
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
  bars_ago: 1,
  volume_confirmed: true,
  trendlines: [],
  trend_lines: [],
  notes: "Higher lows into a falling wedge.",
  pivots: [],
};

// The stored table hit and the live-detected hit carry an optional `source`
// marker on newer payloads. Cast: the field is not in the older DTO type.
const STORED_HIT = {
  ...HIT,
  id: 10,
  symbol: "APLAPOLLO",
  pattern_id: "consolidation",
  pattern_name: "Consolidation",
  source: "scan",
} as PatternHitDTO;

const LIVE_HIT = {
  ...HIT,
  id: 11,
  symbol: "APLAPOLLO",
  pattern_id: "ascending_triangle",
  pattern_name: "Ascending Triangle",
  source: "live",
} as PatternHitDTO;

function chartPayload(overrides: Partial<ChartPayload> = {}): ChartPayload {
  return {
    symbol: "TEST",
    timeframe: "1D",
    candles: [
      { t: "2026-09-25T00:00:00+05:30", o: 100, h: 105, l: 99, c: 104, v: 1000 },
      { t: "2026-09-26T00:00:00+05:30", o: 104, h: 113, l: 103, c: 112, v: 1200 },
    ],
    overlays: [],
    trend_lines: [],
    hits: [HIT],
    ...overrides,
  };
}

function renderPage(initial = "/chart/TEST") {
  const history = createMemoryHistory();
  history.set({ value: initial });
  const rendered = render(() => (
    <UIProvider>
      <MemoryRouter history={history}>
        <Route path="/chart/:symbol?" component={ChartView} />
      </MemoryRouter>
    </UIProvider>
  ));
  return { ...rendered, history };
}

/** Default option objects used by the stored-first calls. */
const STORED_OPTIONS = { computeTrendlines: true, detectPatterns: false };
const LIVE_OPTIONS = { computeTrendlines: true, detectPatterns: true };

describe("ChartView (pattern workspace)", () => {
  beforeEach(() => {
    // resetAllMocks (not clearAllMocks) also drops queued mockResolvedValueOnce
    // values so a test that never reaches its fallback cannot leak into another.
    vi.resetAllMocks();
    vi.mocked(fetchTimeframes).mockResolvedValue(TIMEFRAMES);
    vi.mocked(fetchSymbolChart).mockResolvedValue(chartPayload());
  });

  it("renders the page with the symbol title", async () => {
    renderPage();
    expect(screen.getByTestId("chart-view")).toBeInTheDocument();
    expect(screen.getByTestId("chart-title")).toHaveTextContent("TEST");
    await waitFor(() => expect(screen.getByTestId("patterns-fullscreen-body")).toBeInTheDocument());
  });

  it("loads stored hits first with detection off", async () => {
    renderPage();
    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith("TEST", "1D", STORED_OPTIONS),
    );
    expect(fetchSymbolChart).toHaveBeenCalledTimes(1);
  });

  it("shows a loader while the first fetch is in flight", () => {
    vi.mocked(fetchSymbolChart).mockImplementation(
      () => new Promise(() => {}) as Promise<ChartPayload>,
    );
    renderPage();
    expect(screen.getByTestId("chart-loading")).toBeInTheDocument();
  });

  it("renders the stored pattern in the right-hand panel", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("patterns-fullscreen-panel")).toBeInTheDocument());
    expect(screen.getByTestId("patterns-fullscreen-list-item-0")).toHaveTextContent(
      "Falling Wedge",
    );
  });

  it("switches timeframe and re-runs the stored-first sequence on the new frame", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("chart-timeframe-select")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("chart-timeframe-select"), { target: { value: "1W" } });

    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith("TEST", "1W", STORED_OPTIONS),
    );
  });

  it("falls back to exactly one live fetch when there are no stored hits", async () => {
    vi.mocked(fetchSymbolChart)
      .mockResolvedValueOnce(chartPayload({ hits: [] }))
      .mockResolvedValueOnce(chartPayload({ hits: [LIVE_HIT] }));
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-list-item-0")).toHaveTextContent(
        "Ascending Triangle",
      ),
    );
    expect(fetchSymbolChart).toHaveBeenCalledTimes(2);
    expect(fetchSymbolChart).toHaveBeenNthCalledWith(1, "TEST", "1D", STORED_OPTIONS);
    expect(fetchSymbolChart).toHaveBeenNthCalledWith(2, "TEST", "1D", LIVE_OPTIONS);
  });

  it("APLAPOLLO: stored Consolidation wins over a live Ascending Triangle", async () => {
    vi.mocked(fetchSymbolChart)
      .mockResolvedValueOnce(chartPayload({ symbol: "APLAPOLLO", hits: [STORED_HIT] }))
      .mockResolvedValueOnce(chartPayload({ symbol: "APLAPOLLO", hits: [LIVE_HIT] }));
    renderPage("/chart/APLAPOLLO");
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-list-item-0")).toHaveTextContent(
        "Consolidation",
      ),
    );
    // The live call is never made once stored hits are returned.
    expect(fetchSymbolChart).toHaveBeenCalledTimes(1);
    expect(fetchSymbolChart).toHaveBeenCalledWith("APLAPOLLO", "1D", STORED_OPTIONS);
  });

  it("as-of replay skips the stored path and uses live detection only", async () => {
    renderPage("/chart/TEST?asof=2026-09-20T15:30");
    await waitFor(() => expect(fetchSymbolChart).toHaveBeenCalled());
    expect(fetchSymbolChart).toHaveBeenCalledTimes(1);
    expect(fetchSymbolChart).toHaveBeenCalledWith("TEST", "1D", {
      computeTrendlines: true,
      detectPatterns: true,
      asOf: "2026-09-20T15:30",
    });
    expect(screen.getByTestId("patterns-fullscreen-asof-banner")).toBeInTheDocument();
    expect(screen.getByTestId("test-asof-input")).toBeInTheDocument();
  });

  it("shows a SCAN badge when the selected stored hit carries source=scan", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue(chartPayload({ hits: [STORED_HIT] }));
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("chart-pattern-source")).toHaveTextContent("SCAN"),
    );
  });

  it("shows a LIVE badge when the fallback hit carries source=live", async () => {
    vi.mocked(fetchSymbolChart)
      .mockResolvedValueOnce(chartPayload({ hits: [] }))
      .mockResolvedValueOnce(chartPayload({ hits: [LIVE_HIT] }));
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("chart-pattern-source")).toHaveTextContent("LIVE"),
    );
  });

  it("omits the source badge when no hit carries a source", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("patterns-fullscreen-panel")).toBeInTheDocument());
    expect(screen.queryByTestId("chart-pattern-source")).toBeNull();
  });

  it("shows the empty state when no timeframe has patterns", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue(chartPayload({ hits: [] }));
    renderPage();
    await waitFor(() => expect(screen.getByTestId("chart-no-patterns")).toBeInTheDocument());
    expect(screen.queryByTestId("patterns-fullscreen-panel")).toBeNull();
  });

  it("offers an alternative timeframe from the empty state", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue(chartPayload({ hits: [] }));
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId("chart-empty-timeframe-1W")).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId("chart-empty-timeframe-1W"));

    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith("TEST", "1W", expect.any(Object)),
    );
  });

  it("shows the no-data state when no candles come back", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue(
      chartPayload({ candles: [], hits: [] }),
    );
    renderPage();
    await waitFor(() => expect(screen.getByTestId("chart-empty")).toBeInTheDocument());
  });

  it("shows the error state and retries the fetch", async () => {
    vi.mocked(fetchSymbolChart).mockRejectedValueOnce(new Error("Network down"));
    renderPage();
    await waitFor(() => expect(screen.getByTestId("chart-error")).toBeInTheDocument());
    expect(screen.getByText("Network down")).toBeInTheDocument();

    vi.mocked(fetchSymbolChart).mockResolvedValue(chartPayload());
    fireEvent.click(screen.getByTestId("chart-retry-btn"));

    await waitFor(() => expect(screen.getByTestId("patterns-fullscreen-body")).toBeInTheDocument());
  });

  it("shows the missing-symbol state on /chart", () => {
    renderPage("/chart");
    expect(screen.getByTestId("chart-view-error")).toBeInTheDocument();
    expect(screen.getByText("Back to Screener")).toBeInTheDocument();
  });

  it("keeps the back button in the page header", () => {
    renderPage();
    expect(screen.getByTestId("chart-back-btn")).toBeInTheDocument();
  });

  it("falls back to 1D when the URL timeframe is unknown", async () => {
    renderPage("/chart/TEST?tf=nope");
    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith("TEST", "1D", expect.any(Object)),
    );
  });
});

/**
 * US payload carries live-detected hits/trend lines plus US metadata; the view
 * must apply all of them (single live-detection read, no stored lookup). Cast
 * because those fields are not on the shared (India-first) transport type.
 */
function usChartPayload(): ChartPayload {
  return {
    ...chartPayload({
      symbol: "AAPL",
      hits: [{ ...HIT, source: "live" } as PatternHitDTO],
      overlays: [
        {
          pattern_id: "falling_wedge",
          pattern_name: "Falling Wedge",
          direction: "bullish",
          trendlines: [[{ t: "2026-11-01", price: 100 }, { t: "2026-11-17", price: 110 }]],
        },
      ],
      trend_lines: [
        {
          kind: "support",
          start_date: "2026-11-16",
          start_price: 100,
          end_date: "2026-11-17",
          end_price: 101,
          slope: 1,
          touches: 2,
          span_bars: 5,
          violations: 0,
        },
      ],
    }),
    market: "usa",
    feed: "yahoo",
    delay_label: "~1 min (forming)",
    session_date: "2026-11-17",
  } as ChartPayload;
}

describe("ChartView (US market)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fetchTimeframes).mockResolvedValue(TIMEFRAMES);
    vi.mocked(fetchSymbolChart).mockResolvedValue(usChartPayload());
  });

  it("makes exactly one live-detection fetch with market=usa", async () => {
    renderPage("/chart/AAPL?market=usa");
    await waitFor(() => expect(fetchSymbolChart).toHaveBeenCalledTimes(1));
    expect(fetchSymbolChart).toHaveBeenCalledWith("AAPL", "1D", {
      computeTrendlines: true,
      detectPatterns: true,
      market: "usa",
    });
  });

  it("propagates feed, delay and session date into the chart state", async () => {
    renderPage("/chart/AAPL?market=usa");
    await waitFor(() => expect(screen.getByTestId("patterns-fullscreen-body")).toBeInTheDocument());

    const view = screen.getByTestId("chart-view");
    expect(view).toHaveAttribute("data-market", "usa");
    expect(view).toHaveAttribute("data-feed", "yahoo");
    expect(view).toHaveAttribute("data-delay-label", "~1 min (forming)");
    expect(view).toHaveAttribute("data-session-date", "2026-11-17");
    expect(screen.getByTestId("chart-us-feed")).toHaveTextContent("yahoo · ~1 min (forming)");
    expect(screen.getByTestId("chart-us-session")).toHaveTextContent("2026-11-17");
  });

  it("never shows the SCAN/LIVE badge or the no-patterns panel for US", async () => {
    renderPage("/chart/AAPL?market=usa");
    await waitFor(() => expect(screen.getByTestId("patterns-fullscreen-body")).toBeInTheDocument());
    expect(screen.queryByTestId("chart-pattern-source")).toBeNull();
    expect(screen.queryByTestId("chart-no-patterns")).toBeNull();
  });

  it("applies live hits, overlays and trend lines on the US path", async () => {
    renderPage("/chart/AAPL?market=usa");
    await waitFor(() => expect(screen.getByTestId("patterns-fullscreen-body")).toBeInTheDocument());
    const body = screen.getByTestId("patterns-fullscreen-body");
    expect(body).toHaveAttribute("data-hits", "1");
    expect(body).toHaveAttribute("data-trend-lines", "1");
    expect(screen.getByTestId("patterns-fullscreen-list-item-0")).toHaveTextContent(
      "Falling Wedge",
    );
  });

  it("regression: a LIVE-sourced US hit is rendered, never dropped", async () => {
    vi.mocked(fetchSymbolChart).mockResolvedValue(usChartPayload());
    renderPage("/chart/AAPL?market=usa");

    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-body")).toHaveAttribute("data-hits", "1"),
    );
    const body = screen.getByTestId("patterns-fullscreen-body");
    expect(body).toHaveAttribute("data-hit-source", "live");
    expect(body).toHaveAttribute("data-overlays", "1");
    expect(screen.getByTestId("patterns-fullscreen-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("chart-no-patterns")).toBeNull();
    expect(screen.queryByTestId("chart-pattern-source")).toBeNull();
  });

  it("offers only US-supported timeframes in the toolbar", async () => {
    renderPage("/chart/AAPL?market=usa");
    await waitFor(() => expect(screen.getByTestId("chart-timeframe-select")).toBeInTheDocument());
    const values = Array.from(
      screen.getByTestId("chart-timeframe-select").querySelectorAll("option"),
    ).map((option) => option.value);
    expect(values).toContain("1D");
    expect(values).not.toContain("1W");
  });

  it("retains market=usa when the timeframe changes", async () => {
    const { history } = renderPage("/chart/AAPL?market=usa");
    await waitFor(() => expect(screen.getByTestId("chart-timeframe-select")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("chart-timeframe-select"), { target: { value: "15m" } });

    await waitFor(() => expect(history.get()).toContain("tf=15m"));
    expect(history.get()).toContain("market=usa");
    expect(fetchSymbolChart).toHaveBeenCalledWith("AAPL", "15m", {
      computeTrendlines: true,
      detectPatterns: true,
      market: "usa",
    });
  });

  it("retains market=usa when an unknown timeframe falls back to 1D", async () => {
    const { history } = renderPage("/chart/AAPL?market=usa&tf=nope");
    await waitFor(() => expect(history.get()).toContain("tf=1D"));
    expect(history.get()).toContain("market=usa");
    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith("AAPL", "1D", {
        computeTrendlines: true,
        detectPatterns: true,
        market: "usa",
      }),
    );
  });

  // Regression: the async /timeframes ladder starts as [1D]. A valid US deep
  // link must not be validated against that placeholder — doing so rewrote
  // tf=5m to tf=1D and fired a second, wrong request before options arrived.
  it("keeps a deep-linked valid US timeframe: exactly one 5m request, URL unchanged", async () => {
    const { history } = renderPage("/chart/AAPL?market=usa&tf=5m");
    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith("AAPL", "5m", {
        computeTrendlines: true,
        detectPatterns: true,
        market: "usa",
      }),
    );
    expect(fetchSymbolChart).toHaveBeenCalledTimes(1);
    expect(fetchSymbolChart).not.toHaveBeenCalledWith("AAPL", "1D", expect.any(Object));
    expect(history.get()).toContain("tf=5m");
    expect(history.get()).not.toContain("tf=1D");
    expect(history.get()).toContain("market=usa");
  });

  it("hides the as-of/replay control and banner for US", async () => {
    renderPage("/chart/AAPL?market=usa");
    await waitFor(() => expect(screen.getByTestId("patterns-fullscreen-body")).toBeInTheDocument());
    expect(screen.queryByTestId("test-asof-input")).toBeNull();
    expect(screen.queryByTestId("test-from-input")).toBeNull();
    expect(screen.queryByTestId("patterns-fullscreen-asof-banner")).toBeNull();
    expect(screen.queryByTestId("patterns-fullscreen-asof-toolbar")).toBeNull();
  });

  it("ignores an as-of URL param on the US path", async () => {
    renderPage("/chart/AAPL?market=usa&asof=2026-11-01T10:00");
    await waitFor(() => expect(fetchSymbolChart).toHaveBeenCalled());
    expect(fetchSymbolChart).toHaveBeenCalledWith("AAPL", "1D", {
      computeTrendlines: true,
      detectPatterns: true,
      market: "usa",
    });
    expect(screen.queryByTestId("patterns-fullscreen-asof-banner")).toBeNull();
  });

  it("shows the active timeframe after the async US ladder loads", async () => {
    vi.mocked(fetchTimeframes).mockResolvedValue([
      { id: "15m", label: "15m" },
      { id: "1h", label: "1h" },
      { id: "1D", label: "1D" },
      { id: "1m", label: "1m" },
    ] as TFSpec[]);
    renderPage("/chart/AAPL?market=usa");
    await waitFor(() =>
      expect(
        screen.getByTestId("chart-timeframe-select").querySelectorAll("option"),
      ).toHaveLength(4),
    );

    const select = screen.getByTestId("chart-timeframe-select");
    expect(select).toHaveValue("1D");
    expect(select.querySelector("option")?.value).toBe("1D");
  });

  it("keeps the India path when ?market is absent or overridden to india", async () => {
    renderPage("/chart/AAPL?market=india");
    await waitFor(() => expect(fetchSymbolChart).toHaveBeenCalled());
    expect(fetchSymbolChart).toHaveBeenCalledWith("AAPL", "1D", STORED_OPTIONS);
    expect(screen.getByTestId("chart-view")).toHaveAttribute("data-market", "india");
    expect(screen.queryByTestId("chart-us-feed")).toBeNull();
  });
});
