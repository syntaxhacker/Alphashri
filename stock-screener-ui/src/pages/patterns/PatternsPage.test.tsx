// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UIProvider } from "@/ui";
import type { PatternHitDTO, PatternSummary } from "@/types/chartPatterns";
import { PatternsPage, type PatternsPageProps } from "./PatternsPage";

vi.mock("@/hooks/useECharts", () => ({
  useECharts: () => ({
    chartRef: { current: null },
    chartInstance: { current: null },
    setChartOption: vi.fn(),
  }),
}));

const fetchSymbolChart = vi.fn();
vi.mock("@/api/chartPatterns", () => ({
  fetchSymbolChart: (...args: unknown[]) => fetchSymbolChart(...args),
}));

const fetchPatternImages = vi.fn();
vi.mock("@/api/patternImages", () => ({
  fetchPatternImages: (...args: unknown[]) => fetchPatternImages(...args),
}));

function makeHit(overrides: Partial<PatternHitDTO> = {}): PatternHitDTO {
  return {
    id: 1,
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
    start_price: 129.8,
    end_price: 112.6,
    breakout_level: 112.6,
    target: 129.6,
    stop: 102.5,
    rr: 1.7,
    bars_ago: 1,
    volume_confirmed: true,
    trendlines: [
      [
        { t: "2026-04-26", price: 129.8 },
        { t: "2026-09-26", price: 112.6 },
      ],
    ],
    notes: "Higher lows into a falling wedge.",
    ...overrides,
  };
}

const SUMMARY: PatternSummary = {
  scanned: 500,
  patterns: 12,
  in_view: 8,
  confirmed: 5,
  bullish: 7,
  bearish: 3,
  data_through: "2026-09-30",
};

function makeProps(overrides: Partial<PatternsPageProps> = {}): PatternsPageProps {
  return {
    timeframes: [],
    universes: [{ id: "nifty500", label: "Nifty 500", count: 500 }],
    patterns: [
      { pattern_id: "falling_wedge", name: "Falling Wedge", family: "reversal", direction: "bullish", description: "…" },
    ],
    timeframe: "1D",
    setTimeframe: vi.fn(),
    universe: "nifty500",
    setUniverse: vi.fn(),
    filters: {
      family: [],
      direction: [],
      status: [],
      quality: null,
      formed_within_bars: null,
      volume_confirmed: null,
      min_rr: null,
      symbol: null,
    },
    setFilter: vi.fn(),
    resetFilters: vi.fn(),
    applyFilters: vi.fn(),
    job: null,
    scanning: false,
    queuePosition: null,
    summary: SUMMARY,
    results: [makeHit()],
    total: 1,
    loading: false,
    error: null,
    scan: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  };
}

function r(jsx: React.ReactElement) {
  return render(jsx, { wrapper: ({ children }) => <UIProvider>{children}</UIProvider> });
}

describe("PatternsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPatternImages.mockResolvedValue({
      falling_wedge: "/api/chart-patterns/image/falling_wedge",
    });
    fetchSymbolChart.mockResolvedValue({
      symbol: "IRCON",
      timeframe: "1D",
      candles: [],
      overlays: [
        {
          pattern_id: "rising_wedge",
          pattern_name: "Rising Wedge",
          trendlines: [[{ t: "2026-06-10", price: 235 }, { t: "2026-09-15", price: 311 }]],
        },
      ],
    });
  });
  afterEach(() => cleanup());

  test("renders all contract regions and testids", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-page")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-universe-bar")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-job-status")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-stats")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-timeframe-select")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-open-filters")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-grid")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-card-IRCON-falling_wedge")).toBeInTheDocument();
  });

  test("Filters button opens the modal with the full rail", async () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.queryByTestId("patterns-filter-rail")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("patterns-open-filters"));
    expect(await screen.findByTestId("patterns-filter-rail")).toBeInTheDocument();
    // Pattern tiles show the reference image + label.
    const img = await screen.findByTestId("pattern-image-falling_wedge");
    expect(img).toHaveAttribute("src", "/api/chart-patterns/image/falling_wedge");
    expect(screen.getByTestId("patterns-filter-pattern-falling_wedge")).toHaveTextContent(
      "Falling Wedge",
    );
    await userEvent.click(screen.getByTestId("patterns-filters-done"));
    await waitFor(() => expect(screen.queryByTestId("patterns-filter-rail")).not.toBeInTheDocument());
  });

  test("renders symbol filter and results search controls", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-symbol-filter")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-results-search")).toBeInTheDocument();
  });

  test("renders every required stat key", () => {
    r(<PatternsPage {...makeProps()} />);
    for (const key of ["scanned", "patterns", "in_view", "confirmed", "bull_bear", "data_through"]) {
      expect(screen.getByTestId(`patterns-stat-${key}`)).toBeInTheDocument();
    }
    expect(screen.getByTestId("patterns-stat-bull_bear")).toHaveTextContent("7");
  });

  test("shows loading state", () => {
    r(<PatternsPage {...makeProps({ loading: true, results: [], total: 0 })} />);
    expect(screen.getByTestId("patterns-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-empty")).not.toBeInTheDocument();
  });

  test("shows scan progress in the grid while a scan is running", () => {
    r(
      <PatternsPage
        {...makeProps({
          results: [],
          total: 0,
          scanning: true,
          timeframe: "1h",
          job: {
            job_id: "cpj_x",
            universe: "nifty50",
            timeframe: "1h",
            status: "running",
            total: 50,
            done: 12,
            failed: 0,
            skipped: 0,
            queue_position: null,
            started_at: null,
            finished_at: null,
            data_through: null,
            error: null,
          },
        })}
      />,
    );
    expect(screen.getByTestId("patterns-scan-progress")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-scan-progress-count")).toHaveTextContent("12 / 50 stocks");
  });

  test("shows empty state with refresh action", async () => {
    const props = makeProps({ results: [], total: 0 });
    r(<PatternsPage {...props} />);
    expect(screen.getByTestId("patterns-empty")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(props.refresh).toHaveBeenCalledTimes(1);
  });

  test("empty state offers a scan CTA for the current universe/timeframe", async () => {
    const props = makeProps({ results: [], total: 0, timeframe: "15m", universe: "nifty500" });
    r(<PatternsPage {...props} />);
    const cta = screen.getByTestId("patterns-empty-scan");
    expect(cta).toHaveTextContent("Scan 15m now");
    expect(screen.getByTestId("patterns-empty")).toHaveTextContent("nifty500 · 15m");
    await userEvent.click(cta);
    expect(props.scan).toHaveBeenCalledTimes(1);
  });

  test("clicking a card opens the fullscreen chart", async () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.queryByTestId("patterns-fullscreen-modal")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-fullscreen-chart")).toBeInTheDocument();
  });

  test("scan again triggers scan", async () => {
    const props = makeProps();
    r(<PatternsPage {...props} />);
    await userEvent.click(screen.getByTestId("patterns-scan-again"));
    expect(props.scan).toHaveBeenCalledTimes(1);
  });

  test("toggling a family chip calls setFilter", async () => {
    const props = makeProps();
    r(<PatternsPage {...props} />);
    await userEvent.click(screen.getByTestId("patterns-open-filters"));
    await userEvent.click(await screen.findByTestId("patterns-family-reversal"));
    expect(props.setFilter).toHaveBeenCalledWith("family", ["reversal"]);
  });

  test("shows the error alert instead of the generic empty copy when error is set", () => {
    r(<PatternsPage {...makeProps({ results: [], total: 0, error: "Scan failed: boom" })} />);
    expect(screen.getByTestId("patterns-error")).toHaveTextContent("Scan failed: boom");
    expect(screen.getByTestId("patterns-empty")).toBeInTheDocument();
  });

  test("keeps the grid mounted with a refresh overlay while reloading", () => {
    r(<PatternsPage {...makeProps({ loading: true })} />);
    // Existing results stay visible (no mini-chart remount churn)…
    expect(screen.getByTestId("patterns-grid")).toBeInTheDocument();
    // …with an overlay spinner instead of the full-page loader.
    expect(screen.getByTestId("patterns-refreshing")).toBeInTheDocument();
    expect(screen.queryByTestId("patterns-loading")).not.toBeInTheDocument();
  });

  test("stale same-symbol fetches never overwrite the newer selection", async () => {
    let resolveFirst!: (v: unknown) => void;
    let resolveSecond!: (v: unknown) => void;
    fetchSymbolChart
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveFirst = resolve; }),
      )
      .mockImplementationOnce(
        () => new Promise((resolve) => { resolveSecond = resolve; }),
      );
    const first = makeHit({ id: 11, pattern_id: "falling_wedge", pattern_name: "Falling Wedge", start_date: "2026-04-26" });
    const second = makeHit({ id: 22, pattern_id: "rising_wedge", pattern_name: "Rising Wedge", start_date: "2026-07-01" });
    r(<PatternsPage {...makeProps({ results: [first, second], total: 2 })} />);

    // Click two cards of the same symbol in quick succession.
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-falling_wedge"));
    await userEvent.click(screen.getByTestId("patterns-card-IRCON-rising_wedge"));
    expect(fetchSymbolChart).toHaveBeenCalledTimes(2);

    // Current request resolves with no candles; the stale one resolves last
    // carrying candles. Without the guard the stale fetch would paint the
    // first hit's candles into the second hit's fullscreen view.
    resolveSecond({ symbol: "IRCON", timeframe: "1D", candles: [], overlays: [] });
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-modal")).toHaveTextContent("Rising Wedge"),
    );
    resolveFirst({
      symbol: "IRCON",
      timeframe: "1D",
      candles: [{ t: "2026-05-04T18:30:00+00:00", o: 1, h: 1, l: 1, c: 1, v: 1 }],
      overlays: [],
    });
    // Flush the stale promise chain: without the guard it would paint the
    // first hit's candles here and remove "No chart data".
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    // The newer selection stands: still the second hit, still no chart data.
    expect(screen.getByTestId("patterns-fullscreen-modal")).toHaveTextContent("Rising Wedge");
    expect(screen.getByText("No chart data")).toBeInTheDocument();
  });
});
