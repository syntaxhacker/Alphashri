// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { PatternHitDTO } from "@/types/chartPatterns";

const mockUseChartPatterns = vi.hoisted(() => vi.fn());
const mockUsePatternUrlSync = vi.hoisted(() => vi.fn());
const mockLoadCatalog = vi.hoisted(() => vi.fn());
const pagePropsCapture = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock("@/hooks/useChartPatterns", () => ({
  useChartPatterns: (...args: unknown[]) => mockUseChartPatterns(...args),
}));

vi.mock("@/hooks/usePatternUrlSync", () => ({
  usePatternUrlSync: (...args: unknown[]) => mockUsePatternUrlSync(...args),
}));

vi.mock("@/state/chartPatterns", () => ({
  loadCatalog: (...args: unknown[]) => mockLoadCatalog(...args),
}));

vi.mock("./PatternsPage", () => ({
  PatternsPage: (props: Record<string, unknown>) => {
    pagePropsCapture.current = props;
    return <div data-testid="patterns-page-stub" />;
  },
}));

import { PatternsContainer } from "./PatternsContainer";

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

function makeVm() {
  return {
    timeframes: [{ id: "1D", label: "1D", minutes: 1440, native: "days/1", source_tf: null, max_lookback_days: 730, min_bars: 60 }],
    universes: [{ id: "nifty500", label: "Nifty 500", count: 500 }],
    patterns: [
      { pattern_id: "falling_wedge", name: "Falling Wedge", family: "reversal", direction: "bullish", description: "…" },
    ],
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
    summary: SUMMARY,
    results: [makeHit()],
    total: 1,
    loading: false,
    error: null,
    scan: vi.fn(),
    refresh: vi.fn(),
    forceRefresh: vi.fn(),
  };
}

describe("PatternsContainer", () => {
  afterEach(() => cleanup());

  test("bootstraps the catalog exactly once across remounts", () => {
    mockLoadCatalog.mockClear();
    mockUseChartPatterns.mockReturnValue(makeVm());
    render(<PatternsContainer />).unmount();
    render(<PatternsContainer />).unmount();
    // Module-level `catalogRequested` guard: StrictMode-style double mount
    // must not re-issue the catalog load within this session.
    expect(mockLoadCatalog).toHaveBeenCalledTimes(1);
  });

  test("wires the hook state into URL sync", () => {
    const vm = makeVm();
    mockUseChartPatterns.mockReturnValue(vm);
    mockUsePatternUrlSync.mockClear();
    render(<PatternsContainer />);
    expect(mockUsePatternUrlSync).toHaveBeenCalledTimes(1);
    const args = mockUsePatternUrlSync.mock.calls[0][0] as Record<string, unknown>;
    expect(args.universe).toBe(vm.universe);
    expect(args.timeframe).toBe(vm.timeframe);
    expect(args.lookbackBars).toBe(vm.lookbackBars);
    expect(args.computeTrendlines).toBe(vm.computeTrendlines);
    expect(args.filters).toBe(vm.filters);
    expect(args.setUniverse).toBe(vm.setUniverse);
    expect(args.setTimeframe).toBe(vm.setTimeframe);
    expect(args.setLookbackBars).toBe(vm.setLookbackBars);
    expect(args.setComputeTrendlines).toBe(vm.setComputeTrendlines);
    expect(args.applyFilters).toBe(vm.applyFilters);
  });

  test("passes every view-model prop through to PatternsPage", () => {
    const vm = makeVm();
    mockUseChartPatterns.mockReturnValue(vm);
    pagePropsCapture.current = null;
    render(<PatternsContainer />);
    expect(screen.getByTestId("patterns-page-stub")).toBeInTheDocument();
    const props = pagePropsCapture.current as unknown as Record<string, unknown>;
    const expectedKeys = [
      "timeframes", "universes", "patterns",
      "timeframe", "setTimeframe",
      "lookbackBars", "setLookbackBars",
      "universe", "setUniverse",
      "filters", "setFilter", "resetFilters", "applyFilters",
      "computeTrendlines", "setComputeTrendlines",
      "customUniverse", "selectSymbols",
      "job", "scanning", "queuePosition", "summary",
      "results", "total", "loading", "error",
      "scan", "refresh", "forceRefresh",
    ];
    expect(Object.keys(props).sort()).toEqual([...expectedKeys].sort());
    for (const key of expectedKeys) {
      expect(props[key], `prop ${key}`).toBe(vm[key as keyof typeof vm] as unknown);
    }
  });
});
