// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import { useChartPatterns } from "./useChartPatterns";
import {
  CUSTOM_UNIVERSE,
  DEFAULT_PATTERN_FILTERS,
  getChartPatternsState,
  resetChartPatternsState,
} from "../state/chartPatterns";

// Never hit the network: store-triggered reloads (loadResults/loadSummary/
// triggerScan/loadSymbolDetail) all suspend on these pending promises, while
// the synchronous patch+notify under test still applies deterministically.
vi.mock("../api/chartPatterns", async () => {
  const actual =
    await vi.importActual<typeof import("../api/chartPatterns")>("../api/chartPatterns");
  const pending = () => new Promise<never>(() => {});
  return {
    QueueFullError: actual.QueueFullError,
    buildPatternsQuery: actual.buildPatternsQuery,
    fetchTimeframes: vi.fn(pending),
    fetchUniverses: vi.fn(pending),
    fetchPatternCatalog: vi.fn(pending),
    startScan: vi.fn(pending),
    fetchJob: vi.fn(pending),
    fetchActiveJobs: vi.fn(pending),
    fetchResults: vi.fn(pending),
    fetchSummary: vi.fn(pending),
    fetchSymbolDetail: vi.fn(pending),
    fetchSymbolChart: vi.fn(pending),
  };
});

beforeEach(() => {
  resetChartPatternsState();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const CONTRACT_KEYS = [
  "timeframes",
  "universes",
  "patterns",
  "timeframe",
  "setTimeframe",
  "lookbackBars",
  "setLookbackBars",
  "universe",
  "setUniverse",
  "customUniverse",
  "selectSymbols",
  "filters",
  "setFilter",
  "resetFilters",
  "applyFilters",
  "computeTrendlines",
  "setComputeTrendlines",
  "job",
  "scanning",
  "queuePosition",
  "summary",
  "results",
  "total",
  "selectedSymbol",
  "setSelectedSymbol",
  "detail",
  "detailChart",
  "loading",
  "error",
  "scan",
  "refresh",
  "loadSymbol",
];

describe("useChartPatterns", () => {
  it("returns the frozen contract shape mirroring store state", () => {
    const { result } = renderHook(() => useChartPatterns());
    const state = getChartPatternsState();

    expect(Object.keys(result.current).sort()).toEqual([...CONTRACT_KEYS].sort());
    expect(result.current.timeframe).toBe(state.timeframe);
    expect(result.current.universe).toBe(state.universe);
    expect(result.current.lookbackBars).toBe(state.lookbackBars);
    expect(result.current.computeTrendlines).toBe(state.computeTrendlines);
    expect(result.current.filters).toEqual(state.filters);
    expect(result.current.filters).toEqual(DEFAULT_PATTERN_FILTERS);
    expect(result.current.job).toBeNull();
    expect(result.current.queuePosition).toBeNull();
    expect(result.current.scanning).toBe(false);
    expect(result.current.results).toEqual([]);
    expect(result.current.total).toBe(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("keeps stable identities for setFilter/scan/loadSymbol across re-renders", () => {
    const { result, rerender } = renderHook(() => useChartPatterns());
    const { setFilter, scan, loadSymbol } = result.current;

    rerender();
    rerender();

    expect(result.current.setFilter).toBe(setFilter);
    expect(result.current.scan).toBe(scan);
    expect(result.current.loadSymbol).toBe(loadSymbol);
  });

  it("delegates setFilter to the store", () => {
    const { result } = renderHook(() => useChartPatterns());

    act(() => {
      result.current.setFilter("q", "bank");
    });

    expect(result.current.filters.q).toBe("bank");
    expect(getChartPatternsState().filters.q).toBe("bank");
  });

  it("delegates loadSymbol to the store detail loader", () => {
    const { result } = renderHook(() => useChartPatterns());

    act(() => {
      result.current.loadSymbol("SBIN");
    });

    expect(result.current.selectedSymbol).toBe("SBIN");
  });

  it("exposes computeTrendlines/setComputeTrendlines and reflects updates", () => {
    const { result } = renderHook(() => useChartPatterns());
    expect(result.current.computeTrendlines).toBe(true);

    act(() => {
      result.current.setComputeTrendlines(false);
    });

    expect(result.current.computeTrendlines).toBe(false);
    expect(getChartPatternsState().computeTrendlines).toBe(false);
  });

  it("exposes lookbackBars/setLookbackBars and reflects updates", () => {
    const { result } = renderHook(() => useChartPatterns());
    expect(result.current.lookbackBars).toBeNull();

    act(() => {
      result.current.setLookbackBars(250);
    });

    expect(result.current.lookbackBars).toBe(250);
    expect(getChartPatternsState().lookbackBars).toBe(250);
  });

  it("exposes customUniverse and selectSymbols scopes to the custom universe", () => {
    const { result } = renderHook(() => useChartPatterns());
    expect(result.current.customUniverse).toBe(CUSTOM_UNIVERSE);

    act(() => {
      result.current.selectSymbols(["sbin", "tcs"]);
    });

    expect(result.current.universe).toBe(CUSTOM_UNIVERSE);
    expect(result.current.filters.symbols).toEqual(["SBIN", "TCS"]);
  });

  it("re-renders on store notify", () => {
    const { result } = renderHook(() => useChartPatterns());
    expect(result.current.universe).toBe("");

    act(() => {
      result.current.setUniverse("nifty50");
    });

    expect(result.current.universe).toBe("nifty50");
  });
});
