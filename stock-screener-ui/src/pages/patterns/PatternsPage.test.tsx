// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  test("renders all contract regions and testids", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-page")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-universe-bar")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-job-status")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-stats")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-timeframe-select")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-filter-rail")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-grid")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-card-IRCON-falling_wedge")).toBeInTheDocument();
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
    await userEvent.click(screen.getByTestId("patterns-family-reversal"));
    expect(props.setFilter).toHaveBeenCalledWith("family", ["reversal"]);
  });
});
