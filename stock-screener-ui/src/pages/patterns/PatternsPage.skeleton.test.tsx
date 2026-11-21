// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";

// `ScanStats` sits at the top of the page tree: making it suspend proves the
// page's own boundary is what swaps in the skeleton (the route-level lazy
// chunk is resolved long before this render).
vi.mock("@/components/patterns/ScanStats", async () => {
  const { lazy } = await import("solid-js");
  return { ScanStats: lazy(() => new Promise(() => {})) };
});

vi.mock("@/components/patterns/IndexMembersDrawer", () => ({
  IndexMembersDrawer: () => null,
}));
vi.mock("@/hooks/useECharts", () => ({
  useECharts: () => ({
    chartRef: { current: null },
    chartInstance: { current: null },
    setChartOption: vi.fn(),
  }),
}));
vi.mock("@/api/chartPatterns", () => ({
  fetchSymbolChart: vi.fn(),
  fetchPatternMatrix: vi.fn(),
  fetchPatternHit: vi.fn(),
}));
vi.mock("@/api/patternImages", () => ({ fetchPatternImages: vi.fn() }));

const { PatternsPage } = await import("./PatternsPage");
type PageProps = import("./PatternsPage").PatternsPageProps;

function makeProps(): PageProps {
  return {
    timeframes: [],
    universes: [{ id: "nifty500", label: "Nifty 500", count: 500 }],
    patterns: [],
    timeframe: "1D",
    setTimeframe: vi.fn(),
    selectedTimeframes: ["1D"],
    setSelectedTimeframes: vi.fn(),
    lookbackBars: null,
    setLookbackBars: vi.fn(),
    universe: "nifty500",
    setUniverse: vi.fn(),
    filters: {
      family: [],
      pattern_id: [],
      direction: [],
      status: [],
      quality: null,
      formed_within_bars: null,
      volume_confirmed: null,
      min_rr: null,
      symbol: null,
      symbols: [],
      q: "",
      min_base_days: null,
      max_range_pct: null,
      sort: "confidence",
      trendlines: "both",
    },
    setFilter: vi.fn(),
    resetFilters: vi.fn(),
    applyFilters: vi.fn(),
    computeTrendlines: true,
    setComputeTrendlines: vi.fn(),
    customUniverse: "custom",
    selectSymbols: vi.fn(),
    job: null,
    scanning: false,
    queuePosition: null,
    summary: null,
    results: [],
    total: 0,
    loading: true,
    error: null,
    scan: vi.fn(),
    refresh: vi.fn(),
    forceRefresh: vi.fn(),
    defaultView: "list",
  };
}

describe("PatternsPage cold load", () => {
  afterEach(() => cleanup());

  test("a suspended page tree shows the layout-matched skeleton", () => {
    render(() => (
      <UIProvider>
        <PatternsPage {...makeProps()} />
      </UIProvider>
    ));
    expect(screen.getByTestId("patterns-skeleton")).toBeInTheDocument();
    expect(screen.getAllByTestId("patterns-skeleton-card")).toHaveLength(8);
    // The real page never mounts while the boundary is held.
    expect(screen.queryByTestId("patterns-page")).not.toBeInTheDocument();
  });
});
