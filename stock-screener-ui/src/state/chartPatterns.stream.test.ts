import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../api/chartPatterns", async () => (await import("./chartPatternsTestFixtures")).chartPatternsApiMock());

import type { PatternHitDTO, PatternSummary } from "../types/chartPatterns";
import { streamResults, fetchResults } from "../api/chartPatterns";
import {
  getChartPatternsState,
  resetChartPatternsState,
  loadResults,
  setFilters,
  sortStreamedHits,
  subscribe,
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

function makeHit(
  id: number,
  symbol: string,
  confidence: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
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
    ...overrides,
  };
}

function asHits(hits: Record<string, unknown>[]): PatternHitDTO[] {
  return hits as unknown as PatternHitDTO[];
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
    mockedStreamResults.mockImplementation(async (_query, handlers = {}) => {
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
    mockedStreamResults.mockImplementation(async (_query, handlers = {}) => {
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
    mockedStreamResults.mockImplementation(async (_query, handlers = {}) => {
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

describe("incremental stream ordering", () => {
  // Longer than the store's STREAM_FLUSH_MS coalescing window so each batch is
  // committed by a separate flush (the incremental path under test).
  const FLUSH_WAIT_MS = 70;

  const box = [
    [{ t: "2026-01-01", price: 110 }],
    [{ t: "2026-01-01", price: 100 }],
  ];
  const base = { pattern_id: "consolidation", base_days: 80, trendlines: box };

  async function streamInBatches(batches: Record<string, unknown>[][]): Promise<void> {
    mockedStreamResults.mockImplementation(async (_query, handlers = {}) => {
      handlers.onMeta?.({
        total: batches.reduce((n, batch) => n + batch.length, 0),
        summary: SUMMARY,
        data_through: "2026-09-30",
      });
      for (const batch of batches) {
        for (const hit of batch) handlers.onItem?.(hit as never);
        await new Promise((resolve) => setTimeout(resolve, FLUSH_WAIT_MS));
      }
      handlers.onDone?.();
    });
    await loadResults();
  }

  function flushLengths(): { lengths: number[]; stop: () => void } {
    const lengths: number[] = [];
    const stop = subscribe(() => {
      const len = getChartPatternsState().results.length;
      if (lengths[lengths.length - 1] !== len) lengths.push(len);
    });
    return { lengths, stop };
  }

  // Deliberately not in id order, with ties across every comparator, a
  // duplicate id split across two batches and null/abs-tied distances.
  function variedPool(): Record<string, unknown>[] {
    return [
      makeHit(1, "D_NEAR_POS", 90, { ...base, last_close: 112 }),
      makeHit(2, "D_NEAR_NEG", 90, { ...base, last_close: 108 }),
      makeHit(3, "D_FAR", 40, { ...base, last_close: 130 }),
      makeHit(4, "D_NULL", 90, { ...base, trendlines: [] }),
      makeHit(5, "NON_BASE", 95, { last_close: 112, trendlines: box }),
      makeHit(6, "DUP_ID_A", 70, { ...base, last_close: 112 }),
      makeHit(6, "DUP_ID_B", 70, { ...base, last_close: 112 }),
      makeHit(7, "RANGE_HIGH", 55, { range_pos: 90, breakout_score: null, bars_ago: 5 }),
      makeHit(8, "RANGE_LOW", 55, { range_pos: 10, breakout_score: 20, bars_ago: 1 }),
      makeHit(9, "NEWEST", 30, { bars_ago: 0, range_pos: 50, breakout_score: 99 }),
      makeHit(10, "BREAK", 60, { breakout_score: 99, range_pos: 5, bars_ago: 9 }),
      makeHit(11, "TIE_CONF", 90, { range_pos: 90, breakout_score: 20, bars_ago: 5 }),
    ];
  }

  function variedBatches(): Record<string, unknown>[][] {
    const p = variedPool();
    return [
      [p[9], p[2], p[0], p[11]],
      [p[5], p[1], p[4], p[10]],
      [p[8], p[7], p[3], p[6]],
    ];
  }

  it("matches one sortStreamedHits call for every sort mode", async () => {
    const modes = ["confidence", "newest", "range_pos", "breakout", "distance"] as const;
    for (const mode of modes) {
      resetChartPatternsState();
      setFilters({ ...DEFAULT_PATTERN_FILTERS, sort: mode });
      const batches = variedBatches();
      const allHits = batches.flat();

      await streamInBatches(batches);

      const state = getChartPatternsState();
      expect(state.results, `sort=${mode}`).toEqual(sortStreamedHits(asHits(allHits), mode));
      expect(state.streaming).toBe(false);
      expect(state.error).toBeNull();
      expect(mockedFetchResults).not.toHaveBeenCalled();
    }
  });

  it("keeps stable order for equal keys, duplicate ids and null distances", async () => {
    setFilters({ ...DEFAULT_PATTERN_FILTERS, sort: "distance" });
    const hits = [
      makeHit(1, "ABS_POS", 90, { ...base, last_close: 112 }),
      makeHit(2, "ABS_NEG", 90, { ...base, last_close: 108 }),
      makeHit(7, "DUP_A", 70, { ...base, last_close: 112 }),
      makeHit(7, "DUP_B", 70, { ...base, last_close: 112 }),
      makeHit(3, "NULL_DIST", 95, { ...base, trendlines: [] }),
      makeHit(4, "NON_BASE", 95, { trendlines: box }),
    ];
    const batches = [[hits[2], hits[0], hits[5]], [hits[4], hits[1]], [hits[3]]];

    await streamInBatches(batches);

    // One-shot sort of the arrival order: ties keep that order (stable sort).
    expect(getChartPatternsState().results).toEqual(
      sortStreamedHits(asHits(batches.flat()), "distance"),
    );
  });

  it("has no order drift over 300 hits in 6 batches", async () => {
    setFilters({ ...DEFAULT_PATTERN_FILTERS, sort: "distance" });
    const hits = Array.from({ length: 300 }, (_, index) => {
      const id = 300 - index;
      return makeHit(id, `S${id}`, (id * 37) % 101, {
        bars_ago: id % 13,
        range_pos: id % 3 === 0 ? null : (id * 17) % 100,
        breakout_score: id % 4 === 0 ? null : (id * 23) % 100,
        ...(id % 2 === 0 ? { ...base, last_close: 100 + (id % 15) * 3 } : {}),
      });
    });
    // Interleave the reverse-id arrival stream across six flush windows.
    const batches = Array.from({ length: 6 }, (_, bucket) =>
      hits.filter((_, index) => index % 6 === bucket),
    );
    const tracker = flushLengths();

    await streamInBatches(batches);
    tracker.stop();

    expect(getChartPatternsState().results).toEqual(
      sortStreamedHits(asHits(batches.flat()), "distance"),
    );
    expect(tracker.lengths.filter((len) => len > 0).length).toBeGreaterThanOrEqual(6);
  });

  it("a same-query reload replaces on the first batch, then merges the rest", async () => {
    await streamInBatches([[makeHit(1, "OLD_A", 90), makeHit(2, "OLD_B", 80)]]);
    expect(getChartPatternsState().results.map((hit) => hit.symbol)).toEqual(["OLD_A", "OLD_B"]);

    const incoming = [
      makeHit(4, "NEW_C", 95),
      makeHit(3, "NEW_D", 70),
      makeHit(5, "NEW_E", 70),
    ];
    await streamInBatches([incoming.slice(0, 2), incoming.slice(2)]);

    expect(getChartPatternsState().results).toEqual(
      sortStreamedHits(asHits(incoming), "confidence"),
    );
    expect(getChartPatternsState().results.map((hit) => hit.symbol)).toEqual([
      "NEW_C",
      "NEW_E",
      "NEW_D",
    ]);
  });
});
