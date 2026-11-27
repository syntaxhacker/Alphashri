// @vitest-environment happy-dom
// Harness first: its mock registrations must run before any page imports.
import { SUMMARY, makeHit, makeProps, resetPureHarness, testHooks } from "./PatternsPage.mainHarness";
import type { PatternHitDTO, PatternMatrixResponse, PatternMatrixRow } from "@/types/chartPatterns";
import {
  buildMatrixRows,
  sameFilters,
  sameSequenceFilterArgs,
  sequenceFilterArgs,
  sequenceHits,
  stepIndex,
  summarizeDisplay,
  usedMatrixTimeframes,
} from "./patternsDerived";

const { beforeEach, describe, expect, test } = testHooks;

describe("patternsDerived", () => {
  beforeEach(resetPureHarness);
  const baseFilters = makeProps().filters;

  const matrixRow = (symbol: string, best: PatternHitDTO | null): PatternMatrixRow => ({
    symbol,
    name: null,
    ltp: null,
    day_change_pct: null,
    timeframes: {
      "1D": {
        direction: "bullish",
        status: "confirmed",
        count: best ? 1 : 0,
        confidence: best?.confidence ?? null,
        patterns: best ? [best.pattern_id] : [],
        best_id: best?.id ?? null,
      },
    },
    hits: [],
    best,
    hit_count: 0,
  });

  test("sequence slice maps filter defaults and ignores unrelated filters", () => {
    expect(sequenceFilterArgs(baseFilters)).toEqual({
      enabled: false,
      patternIds: [],
      maxGapDays: 20,
      maxBarsAgo: null,
      stepStatuses: [],
    });
    expect(sequenceFilterArgs({ ...baseFilters, sequence: true, pattern_id: ["only_one"] }).enabled).toBe(false);

    const f = {
      ...baseFilters,
      sequence: true,
      pattern_id: ["falling_wedge", "rising_wedge"],
      sequence_gap_days: 5,
      sequence_max_bars: 3,
      sequence_step_status: ["confirmed", "forming"],
    };
    const a = sequenceFilterArgs(f);
    expect(sameSequenceFilterArgs(a, sequenceFilterArgs({ ...f, q: "hello", sort: "confidence" }))).toBe(true);
    // Statuses are consumed through a Set; step order is positional.
    expect(sameSequenceFilterArgs(a, sequenceFilterArgs({
      ...f,
      sequence_step_status: ["forming", "confirmed"],
    }))).toBe(true);
    expect(sameSequenceFilterArgs(a, sequenceFilterArgs({
      ...f,
      sequence_step_status: ["confirmed", "confirmed"],
    }))).toBe(false);
    expect(sameSequenceFilterArgs(a, sequenceFilterArgs({
      ...f,
      pattern_id: ["rising_wedge", "falling_wedge"],
    }))).toBe(false);
    expect(sameSequenceFilterArgs(a, sequenceFilterArgs({ ...f, sequence: false }))).toBe(false);
    expect(sameSequenceFilterArgs(a, sequenceFilterArgs({ ...f, sequence_gap_days: 6 }))).toBe(false);
  });

  test("sequenceHits keeps only hits forming the configured sequence", () => {
    const first = makeHit({
      id: 1, symbol: "AAA", pattern_id: "falling_wedge",
      start_date: "2026-08-01", end_date: "2026-08-10",
    });
    const second = makeHit({
      id: 2, symbol: "AAA", pattern_id: "rising_wedge",
      start_date: "2026-08-15", end_date: "2026-08-20",
    });
    const noise = makeHit({
      id: 3, symbol: "BBB", pattern_id: "falling_wedge",
      start_date: "2026-08-01", end_date: "2026-08-10",
    });
    const args = sequenceFilterArgs({
      ...baseFilters,
      sequence: true,
      pattern_id: ["falling_wedge", "rising_wedge"],
    });
    const hits = [first, noise, second];
    expect(sequenceHits(hits, args).map((h) => h.id)).toEqual([1, 2]);
    expect(sequenceHits(hits, { ...args, enabled: false })).toBe(hits);
    expect(sequenceHits(hits, { ...args, maxGapDays: 2 })).toEqual([]);
  });

  test("buildMatrixRows narrows rows, merges quotes and selects recent hits", () => {
    const first = makeHit({ id: 1, symbol: "AAA", end_price: 110, day_change_pct: 2.5 });
    const second = makeHit({
      id: 2, symbol: "AAA", end_price: 120, day_change_pct: null, end_date: "2026-09-27",
    });
    const other = makeHit({ id: 3, symbol: "BBB" });
    const rows = [matrixRow("AAA", first), matrixRow("BBB", other), matrixRow("CCC", null)];

    const out = buildMatrixRows(rows, [first, second, other], 1);
    expect(out.map((r) => r.symbol)).toEqual(["AAA", "BBB"]);
    expect(out[0].ltp).toBe(110);
    expect(out[0].day_change_pct).toBe(2.5);
    expect(out[0].hit_count).toBe(2);
    expect(out[0].hits.map((h) => h.id)).toEqual([2]);
    expect(buildMatrixRows(rows, [], 1)).toEqual([]);
  });

  test("summarizeDisplay recomputes counts only for a fully loaded result set", () => {
    const latest = [
      makeHit({ id: 1 }),
      makeHit({
        id: 2, pattern_id: "rising_wedge", family: "continuation",
        direction: "bearish", status: "forming",
      }),
    ];
    expect(summarizeDisplay(SUMMARY, latest, 1, 2)).toBe(SUMMARY);
    expect(summarizeDisplay(null, latest, 2, 2)).toBeNull();

    const out = summarizeDisplay(SUMMARY, latest, 2, 2)!;
    expect(out.patterns).toBe(2);
    expect(out.in_view).toBe(2);
    expect(out.confirmed).toBe(1);
    expect(out.bullish).toBe(1);
    expect(out.bearish).toBe(1);
    expect(out.pattern_counts).toEqual({ falling_wedge: 1, rising_wedge: 1 });
    expect(out.family_counts).toEqual({ reversal: 1, continuation: 1 });
    expect(out.scanned).toBe(SUMMARY.scanned);
  });

  test("usedMatrixTimeframes keeps only timeframes present in matrix rows", () => {
    const cell = matrixRow("AAA", makeHit()).timeframes["1D"];
    const data: PatternMatrixResponse = {
      universe: "nifty500",
      timeframes: ["1m", "1D", "1W"],
      data_through: null,
      rows: [
        { ...matrixRow("AAA", null), timeframes: { "1D": cell } },
        { ...matrixRow("BBB", null), timeframes: { "1W": cell } },
      ],
    };
    expect(usedMatrixTimeframes(data)).toEqual(["1D", "1W"]);
    expect(usedMatrixTimeframes(null)).toEqual([]);
  });

  test("stepIndex wraps in both directions and guards an empty sequence", () => {
    expect(stepIndex(0, -1, 1)).toBe(-1);
    expect(stepIndex(3, -1, 1)).toBe(0);
    expect(stepIndex(3, -1, -1)).toBe(2);
    expect(stepIndex(3, 0, 1)).toBe(1);
    expect(stepIndex(3, 0, -1)).toBe(2);
    expect(stepIndex(3, 2, 1)).toBe(0);
  });

  test("sameFilters compares arrays without order sensitivity", () => {
    const a = { ...baseFilters, status: ["confirmed", "forming"] };
    const b = { ...baseFilters, status: ["forming", "confirmed"] };
    expect(sameFilters(a, b)).toBe(true);
    expect(sameFilters(a, { ...a, q: "x" })).toBe(false);
  });
});
