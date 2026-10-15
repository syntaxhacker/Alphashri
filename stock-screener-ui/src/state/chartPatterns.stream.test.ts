import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api/chartPatterns", async () => {
  const actual = await vi.importActual<typeof import("../api/chartPatterns")>("../api/chartPatterns");
  return {
    QueueFullError: actual.QueueFullError,
    buildPatternsQuery: actual.buildPatternsQuery,
    fetchTimeframes: vi.fn(),
    fetchUniverses: vi.fn(),
    fetchPatternCatalog: vi.fn(),
    startScan: vi.fn(),
    fetchJob: vi.fn(),
    fetchActiveJobs: vi.fn(),
    fetchResults: vi.fn(),
    fetchSummary: vi.fn(),
    fetchSymbolDetail: vi.fn(),
    fetchSymbolChart: vi.fn(),
    streamResults: vi.fn(),
  };
});

import type { PatternSummary } from "../types/chartPatterns";
import { streamResults, fetchResults } from "../api/chartPatterns";
import {
  getChartPatternsState,
  resetChartPatternsState,
  loadResults,
  setFilters,
  DEFAULT_PATTERN_FILTERS,
} from "./chartPatterns";

const mockedStreamResults = vi.mocked(streamResults);
const mockedFetchResults = vi.mocked(fetchResults);

const SUMMARY: PatternSummary = {
  scanned: 500,
  patterns: 12,
  in_view: 8,
  confirmed: 5,
  bullish: 4,
  bearish: 1,
  data_through: "2026-09-30",
};

function makeHit(id: number, symbol: string, confidence: number): Record<string, unknown> {
  return {
    id,
    symbol,
    timeframe: "1D",
    pattern_id: "falling_wedge",
    pattern_name: "Falling Wedge",
    family: "reversal",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence,
    bars_ago: 2,
  };
}

async function waitForState(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for store state");
}

beforeEach(() => {
  vi.clearAllMocks();
  resetChartPatternsState();
});

afterEach(() => {
  resetChartPatternsState();
});

describe("loadResults streaming", () => {
  it("renders the meta + first item before done, keeps sort, clears streaming", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    mockedStreamResults.mockImplementation(async (_query, handlers) => {
      handlers.onMeta?.({ total: 2, summary: SUMMARY, data_through: "2026-09-30" });
      handlers.onItem?.(makeHit(1, "LOW", 50) as never);
      await gate;
      handlers.onItem?.(makeHit(2, "HIGH", 90) as never);
      handlers.onDone?.();
    });

    const pending = loadResults();
    // Meta shows early: total is set before the stream completes.
    await waitForState(() => getChartPatternsState().total === 2);
    expect(getChartPatternsState().summary).toEqual(SUMMARY);
    expect(getChartPatternsState().dataThrough).toBe("2026-09-30");
    // First item renders before done.
    await waitForState(() => getChartPatternsState().results.length === 1);
    expect(getChartPatternsState().results[0].symbol).toBe("LOW");
    expect(getChartPatternsState().streaming).toBe(true);
    expect(getChartPatternsState().loading).toBe(true);

    release();
    await pending;

    // Existing sort kept (confidence desc): HIGH first despite arriving last.
    const state = getChartPatternsState();
    expect(state.results.map((hit) => hit.symbol)).toEqual(["HIGH", "LOW"]);
    expect(state.streaming).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
    // Stream won: no fallback fetch.
    expect(mockedFetchResults).not.toHaveBeenCalled();
  });

  it("orders streamed items by breakout_score desc for sort=breakout", async () => {
    setFilters({ ...DEFAULT_PATTERN_FILTERS, sort: "breakout" });
    mockedStreamResults.mockImplementation(async (_query, handlers) => {
      handlers.onMeta?.({ total: 2, summary: SUMMARY, data_through: "2026-09-30" });
      // Arrives first but has the weaker conviction (lower score).
      handlers.onItem?.({
        ...makeHit(1, "WEAK", 99),
        breakout_score: 41.2,
        status: "forming",
        direction: "bearish",
        range_pos: 10,
      } as never);
      handlers.onItem?.({
        ...makeHit(2, "STRONG", 10),
        breakout_score: 73.0,
        status: "confirmed",
        direction: "bullish",
        range_pos: 90,
      } as never);
      handlers.onDone?.();
    });

    await loadResults();

    const state = getChartPatternsState();
    expect(state.results.map((hit) => hit.symbol)).toEqual(["STRONG", "WEAK"]);
    expect(state.streaming).toBe(false);
    expect(state.error).toBeNull();
    expect(mockedFetchResults).not.toHaveBeenCalled();
  });

  it("falls back to fetchResults when the stream errors", async () => {
    mockedStreamResults.mockImplementation(async (_query, handlers) => {
      handlers.onError?.(new Error("stream exploded"));
    });
    mockedFetchResults.mockResolvedValue({
      items: [makeHit(9, "FALLBACK", 77) as never],
      total: 1,
      summary: SUMMARY,
      data_through: "2026-10-01",
    });

    await loadResults();

    expect(mockedFetchResults).toHaveBeenCalledTimes(1);
    const state = getChartPatternsState();
    expect(state.results.map((hit) => hit.symbol)).toEqual(["FALLBACK"]);
    expect(state.total).toBe(1);
    expect(state.streaming).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();
  });
});
