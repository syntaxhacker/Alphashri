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
          <option key={tf.id} value={tf.id}>
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
    <div data-testid="patterns-fullscreen-body">
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
            <option key={tf.id} value={tf.id}>
              {tf.label || tf.id}
            </option>
          ))}
        </select>
      )}
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
  return render(() => (
    <UIProvider>
      <MemoryRouter history={history}>
        <Route path="/chart/:symbol?" component={ChartView} />
      </MemoryRouter>
    </UIProvider>
  ));
}

describe("ChartView (pattern workspace)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetchTimeframes).mockResolvedValue(TIMEFRAMES);
    vi.mocked(fetchSymbolChart).mockResolvedValue(chartPayload());
  });

  it("renders the page with the symbol title", async () => {
    renderPage();
    expect(screen.getByTestId("chart-view")).toBeInTheDocument();
    expect(screen.getByTestId("chart-title")).toHaveTextContent("TEST");
    await waitFor(() => expect(screen.getByTestId("patterns-fullscreen-body")).toBeInTheDocument());
  });

  it("loads the symbol chart with live detection on the default timeframe", async () => {
    renderPage();
    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith("TEST", "1D", {
        detectPatterns: true,
        computeTrendlines: true,
      }),
    );
  });

  it("shows a loader while the first fetch is in flight", () => {
    vi.mocked(fetchSymbolChart).mockImplementation(
      () => new Promise(() => {}) as Promise<ChartPayload>,
    );
    renderPage();
    expect(screen.getByTestId("chart-loading")).toBeInTheDocument();
  });

  it("renders the detected pattern in the right-hand panel", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("patterns-fullscreen-panel")).toBeInTheDocument());
    expect(screen.getByTestId("patterns-fullscreen-list-item-0")).toHaveTextContent(
      "Falling Wedge",
    );
  });

  it("switches timeframe and refetches on the new frame", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByTestId("chart-timeframe-select")).toBeInTheDocument());

    fireEvent.change(screen.getByTestId("chart-timeframe-select"), { target: { value: "1W" } });

    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith("TEST", "1W", {
        detectPatterns: true,
        computeTrendlines: true,
      }),
    );
  });

  it("shows the as-of banner and passes the replay cutoff to the API", async () => {
    renderPage("/chart/TEST?asof=2026-09-20T15:30");
    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith(
        "TEST",
        "1D",
        expect.objectContaining({ asOf: "2026-09-20T15:30" }),
      ),
    );
    expect(screen.getByTestId("patterns-fullscreen-asof-banner")).toBeInTheDocument();
  });

  it("shows the empty state when the timeframe has candles but no patterns", async () => {
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
