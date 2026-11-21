// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { PatternHitDTO, PatternSummary } from "@/types/chartPatterns";
import { For, Show } from "solid-js";
import type { JSX } from "solid-js";
import { PatternsPage, type PatternsPageProps } from "./PatternsPage";

vi.mock("@/hooks/useECharts", () => ({
  useECharts: () => ({
    chartRef: { current: null },
    chartInstance: { current: null },
    setChartOption: vi.fn(),
  }),
}));

const fetchSymbolChart = vi.fn();
const fetchWatchSetups = vi.fn();
const fetchWatch = vi.fn();
const fetchMarketStatus = vi.fn();
const fetchPatternMatrix = vi.fn();
const fetchPatternHit = vi.fn();
vi.mock("@/api/chartPatterns", () => ({
  fetchSymbolChart: (...args: unknown[]) => fetchSymbolChart(...args),
  fetchPatternMatrix: (...args: unknown[]) => fetchPatternMatrix(...args),
  fetchPatternHit: (...args: unknown[]) => fetchPatternHit(...args),
  fetchWatchSetups: (...args: unknown[]) => fetchWatchSetups(...args),
  fetchWatch: (...args: unknown[]) => fetchWatch(...args),
  fetchMarketStatus: (...args: unknown[]) => fetchMarketStatus(...args),
  // No live stream in these tests: fail fast so every load exercises the
  // non-streaming `fetchWatch` fallback deterministically.
  streamWatch: async (_query: unknown, handlers: { onError?: (e: Error) => void }) => {
    handlers.onError?.(new Error("stream unavailable"));
  },
}));

const fetchPatternImages = vi.fn();
vi.mock("@/api/patternImages", () => ({
  fetchPatternImages: (...args: unknown[]) => fetchPatternImages(...args),
}));

vi.mock("@/components/patterns/PatternGrid", () => ({
  PatternGrid: (props: any) => (
    <div data-testid="patterns-grid">
      <For each={props.hits as any[]}>{(hit: any) => <div>{hit.symbol}</div>}</For>
    </div>
  ),
}));

// Dense list stub so the page default (list view) renders deterministically.
vi.mock("@/components/patterns/PatternListView", () => ({
  PatternListView: (props: any) => (
    <div data-testid="patterns-list">
      <For each={props.hits as any[]}>{(hit: any) => <div>{hit.symbol}</div>}</For>
    </div>
  ),
}));

vi.mock("@/components/patterns/PatternFullscreenView", () => ({
  PatternFullscreenView: (props: any) => (
    <Show when={props.opened}>
      <div data-testid="patterns-fullscreen-modal">
        <div>{props.hit?.pattern_name ?? "watch-symbol"}</div>
        <Show when={(props.candles?.length ?? 0) === 0}>
          <div>No chart data</div>
        </Show>
        <button type="button" onClick={props.onClose}>
          Close
        </button>
      </div>
    </Show>
  ),
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
    trendlines: [],
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
    patterns: [],
    timeframe: "1D",
    setTimeframe: vi.fn(),
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
      min_base_days: 60,
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
    summary: SUMMARY,
    results: [makeHit()],
    total: 1,
    loading: false,
    error: null,
    scan: vi.fn(),
    refresh: vi.fn(),
    forceRefresh: vi.fn(),
    defaultView: "list",
    ...overrides,
  };
}

function watchPayload() {
  return {
    setup: "breakout",
    min_rel_volume: 1.5,
    updated_at: "2026-09-30T15:30:00+05:30",
    items: [
      {
        symbol: "RELIANCE",
        setup_id: "breakout",
        trigger_level: 3000,
        invalidate_level: 2800,
        base_days: 90,
        range_pct: 8.5,
        confidence: 78,
        status: "forming",
        end_date: "2026-09-30",
        ltp: 2950,
        rel_volume: 2.1,
        pct_to_trigger: 1.69,
        state: "armed",
      },
    ],
  };
}

function r(jsx: JSX.Element) {
  return render(() => <UIProvider>{jsx}</UIProvider>);
}

describe("PatternsPage watch tab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchPatternImages.mockResolvedValue({});
    fetchPatternHit.mockResolvedValue(undefined as never);
    fetchSymbolChart.mockResolvedValue({
      symbol: "RELIANCE",
      timeframe: "1D",
      candles: [],
      overlays: [],
      hits: [],
    });
    fetchWatchSetups.mockResolvedValue([
      {
        id: "breakout",
        label: "Breakout",
        description: "Base breakout candidates",
        default_min_rel_volume: 1.5,
      },
    ]);
    fetchWatch.mockResolvedValue(watchPayload());
    fetchMarketStatus.mockResolvedValue({
      open: true,
      holiday: false,
      now_ist: "2026-09-30T10:00:00+05:30",
      reason: "open",
    });
  });
  afterEach(() => cleanup());

  test("renders Scan and Watch tabs, defaulting to Scan", () => {
    r(<PatternsPage {...makeProps()} />);
    expect(screen.getByTestId("patterns-tab-scan")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-tab-watch")).toBeInTheDocument();
    expect(screen.getByTestId("patterns-list")).toBeInTheDocument();
    expect(screen.queryByTestId("watch-view")).not.toBeInTheDocument();
  });

  test("clicking the Watch tab renders the WatchView", async () => {
    r(<PatternsPage {...makeProps()} />);
    fireEvent.click(screen.getByTestId("patterns-tab-watch"));
    await waitFor(() => expect(screen.getByTestId("watch-view")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());
    expect(fetchWatch).toHaveBeenCalledWith(
      expect.objectContaining({
        setup: "breakout",
        universe: "nifty500",
        timeframe: "1D",
        minBaseDays: 60,
      }),
    );
  });

  test("controlled tab=watch renders the WatchView directly", async () => {
    r(<PatternsPage {...makeProps({ tab: "watch" })} />);
    await waitFor(() => expect(screen.getByTestId("watch-view")).toBeInTheDocument());
    expect(screen.queryByTestId("patterns-grid")).not.toBeInTheDocument();
  });

  test("controlled tab change calls setTab", async () => {
    const setTab = vi.fn();
    r(<PatternsPage {...makeProps({ tab: "watch", setTab })} />);
    fireEvent.click(screen.getByTestId("patterns-tab-scan"));
    expect(setTab).toHaveBeenCalledWith("scan");
  });

  test("clicking a watch row opens the fullscreen chart via detectPatterns", async () => {
    r(<PatternsPage {...makeProps({ tab: "watch" })} />);
    await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("watch-row-RELIANCE"));
    await waitFor(() =>
      expect(fetchSymbolChart).toHaveBeenCalledWith(
        "RELIANCE",
        "1D",
        expect.objectContaining({ detectPatterns: true }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("patterns-fullscreen-modal")).toBeInTheDocument(),
    );
  });

  test("desktop: a watch row renders the chart modal, not an invisible dock", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("1200px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    try {
      r(<PatternsPage {...makeProps({ tab: "watch" })} />);
      await waitFor(() => expect(screen.getByTestId("watch-row-RELIANCE")).toBeInTheDocument());
      fireEvent.click(screen.getByTestId("watch-row-RELIANCE"));
      expect(await screen.findByTestId("patterns-fullscreen-modal")).toBeInTheDocument();
      expect(screen.queryByTestId("patterns-chart-dock")).not.toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
