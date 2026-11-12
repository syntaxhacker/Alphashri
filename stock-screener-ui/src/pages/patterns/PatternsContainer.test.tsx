// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { MemoryRouter, Route, createMemoryHistory } from "@solidjs/router";
import type { PatternHitDTO } from "@/types/chartPatterns";

const pagePropsCapture = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

// Store-shape mock: the container subscribes to the chart-patterns store
vi.mock("@/state/chartPatterns", () => ({
  subscribe: vi.fn(() => () => {}),
  getChartPatternsState: vi.fn(),
  loadCatalog: vi.fn(),
  triggerReplayScan: vi.fn(),
  selectTimeframe: vi.fn(),
  selectTimeframes: vi.fn(),
  selectUniverse: vi.fn(),
  selectSymbols: vi.fn(),
  setFilter: vi.fn(),
  setLookbackBars: vi.fn(),
  resetFilters: vi.fn(),
  applyFilters: vi.fn(),
  triggerScan: vi.fn(),
  refresh: vi.fn(),
  forceRefresh: vi.fn(),
  setComputeTrendlines: vi.fn(),
  DEFAULT_TIMEFRAME: "1D",
  CUSTOM_UNIVERSE: "custom",
  DEFAULT_PATTERN_FILTERS: {
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
}));

vi.mock("./PatternsPage", () => ({
  PatternsPage: (props: Record<string, unknown>) => {
    pagePropsCapture.current = props;
    return <div data-testid="patterns-page-stub" />;
  },
}));

import {
  getChartPatternsState,
  loadCatalog,
  selectTimeframe,
  selectTimeframes,
} from "@/state/chartPatterns";
import { PatternsContainer } from "./PatternsContainer";

const mockGetState = vi.mocked(getChartPatternsState);
const mockLoadCatalog = vi.mocked(loadCatalog);
const mockSelectTimeframes = vi.mocked(selectTimeframes);

function makeHit(): PatternHitDTO {
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
    notes: "",
  };
}

const SUMMARY = {
  scanned: 500,
  patterns: 12,
  in_view: 8,
  confirmed: 5,
  bullish: 7,
  bearish: 3,
  data_through: "2026-09-30",
};

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    timeframes: [{ id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 }],
    universes: [{ id: "nifty500", label: "Nifty 500", count: 500 }],
    patterns: [
      { pattern_id: "falling_wedge", name: "Falling Wedge", family: "reversal", direction: "bullish", description: "…" },
    ],
    timeframe: "1D",
    selectedTimeframes: ["1D"],
    lookbackBars: null,
    universe: "nifty500",
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
    computeTrendlines: true,
    job: null,
    scanning: false,
    queuePosition: null,
    summary: SUMMARY,
    results: [makeHit()],
    total: 1,
    streaming: false,
    loading: false,
    error: null,
    lastScanAsOf: null,
    lastScanFrom: null,
    ...overrides,
  };
}

function renderContainer(initialEntry = "/patterns") {
  const history = createMemoryHistory();
  history.set({ value: initialEntry, replace: true });
  return render(() => (
    <MemoryRouter history={history}>
      <Route path="/patterns" component={PatternsContainer} />
    </MemoryRouter>
  ));
}

describe("PatternsContainer", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("bootstraps the catalog on each mount", () => {
    mockLoadCatalog.mockClear();
    mockGetState.mockReturnValue(makeState());
    renderContainer();
    cleanup();
    renderContainer();
    expect(mockLoadCatalog).toHaveBeenCalledTimes(2);
  });

  test("adopts the timeframe from the URL on mount", async () => {
    mockGetState.mockReturnValue(makeState({ selectedTimeframes: ["1D"], timeframe: "1D" }));
    renderContainer("/patterns?tf=5m");
    await waitFor(() => expect(mockSelectTimeframes).toHaveBeenCalledWith(["5m"]));
  });

  test("passes every view-model prop through to PatternsPage", () => {
    const vm = makeState();
    mockGetState.mockReturnValue(vm);
    pagePropsCapture.current = null;
    renderContainer();
    expect(screen.getByTestId("patterns-page-stub")).toBeInTheDocument();
    const props = pagePropsCapture.current as unknown as Record<string, unknown>;
    const expectedKeys = [
      "timeframes", "universes", "patterns",
      "timeframe", "setTimeframe",
      "selectedTimeframes", "setSelectedTimeframes",
      "lookbackBars", "setLookbackBars",
      "universe", "setUniverse",
      "filters", "setFilter", "resetFilters", "applyFilters",
      "computeTrendlines", "setComputeTrendlines",
      "customUniverse", "selectSymbols",
      "job", "scanning", "queuePosition", "summary",
      "results", "total", "streaming", "loading", "error",
      "scan", "refresh", "forceRefresh",
      "scanReplay", "replayAsOf",
      "tab", "setTab",
      "view", "setView",
      "indexGroup", "setIndexGroup",
      "members", "setMembers",
    ];
    expect(Object.keys(props).sort()).toEqual([...expectedKeys].sort());

    expect(props.timeframes).toBe(vm.timeframes);
    expect(props.universes).toBe(vm.universes);
    expect(props.patterns).toBe(vm.patterns);
    expect(props.timeframe).toBe(vm.timeframe);
    expect(props.selectedTimeframes).toBe(vm.selectedTimeframes);
    expect(props.lookbackBars).toBe(vm.lookbackBars);
    expect(props.universe).toBe(vm.universe);
    expect(props.filters).toBe(vm.filters);
    expect(props.computeTrendlines).toBe(vm.computeTrendlines);
    expect(props.customUniverse).toBe("custom");
    expect(props.job).toBe(vm.job);
    expect(props.scanning).toBe(vm.scanning);
    expect(props.queuePosition).toBe(vm.queuePosition);
    expect(props.summary).toBe(vm.summary);
    expect(props.results).toBe(vm.results);
    expect(props.total).toBe(vm.total);
    expect(props.streaming).toBe(vm.streaming);
    expect(props.loading).toBe(vm.loading);
    expect(props.error).toBe(vm.error);

    expect(typeof props.setTimeframe).toBe("function");
    expect(typeof props.setSelectedTimeframes).toBe("function");
    expect(typeof props.setLookbackBars).toBe("function");
    expect(typeof props.setUniverse).toBe("function");
    expect(typeof props.setFilter).toBe("function");
    expect(typeof props.resetFilters).toBe("function");
    expect(typeof props.applyFilters).toBe("function");
    expect(typeof props.setComputeTrendlines).toBe("function");
    expect(typeof props.selectSymbols).toBe("function");
    expect(typeof props.scan).toBe("function");
    expect(typeof props.refresh).toBe("function");
    expect(typeof props.forceRefresh).toBe("function");
    expect(typeof props.scanReplay).toBe("function");
    expect(props.replayAsOf).toBe(vm.lastScanAsOf);
    expect(props.tab).toBe("scan");
    expect(typeof props.setTab).toBe("function");
    expect(props.view).toBe("matrix");
    expect(typeof props.setView).toBe("function");
    expect(props.indexGroup).toBe("all");
    expect(typeof props.setIndexGroup).toBe("function");
    expect(props.members).toBeNull();
    expect(typeof props.setMembers).toBe("function");
  });
});
