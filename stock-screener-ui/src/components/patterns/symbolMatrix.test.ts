import { describe, expect, test } from "vitest";
import {
  directionGlyph,
  directionTone,
  formatTfLabel,
  lastNHitsPerTimeframe,
  matrixTfOrder,
  mergeMatrixQuotes,
} from "./symbolMatrix";
import type { PatternHitDTO, PatternMatrixRow } from "@/types/chartPatterns";
import { makePatternHit } from "./patternTestFixtures";

describe("formatTfLabel", () => {
  test("maps the canonical timeframes to compact labels", () => {
    expect(formatTfLabel("5m")).toBe("5m");
    expect(formatTfLabel("15m")).toBe("15m");
    expect(formatTfLabel("30m")).toBe("30m");
    expect(formatTfLabel("1h")).toBe("1h");
    expect(formatTfLabel("1D")).toBe("1D");
    expect(formatTfLabel("1W")).toBe("1W");
    expect(formatTfLabel("1M")).toBe("1M");
    expect(formatTfLabel("6M")).toBe("6M");
    expect(formatTfLabel("1Y")).toBe("1Y");
  });

  test("keeps minutes/hours lowercase so 3m is not read as 3 months", () => {
    expect(formatTfLabel("3m")).toBe("3m");
    expect(formatTfLabel("4h")).toBe("4h");
    expect(formatTfLabel("1M")).toBe("1M");
    expect(formatTfLabel("3M")).toBe("3M");
  });

  test("uppercases other unknown timeframes", () => {
    expect(formatTfLabel("2w")).toBe("2W");
  });

  test("returns an empty string for an empty timeframe", () => {
    expect(formatTfLabel("")).toBe("");
  });
});

describe("re-exported matrix formatters", () => {
  test("symbolMatrix still re-exports the canonical patternFormat helpers", async () => {
    const matrix = await import("./symbolMatrix");
    const format = await import("./patternFormat");
    expect(matrix.formatMatrixPrice).toBe(format.formatMatrixPrice);
    expect(matrix.formatMatrixPct).toBe(format.formatMatrixPct);
  });
});

describe("directionTone", () => {
  test("maps direction to a semantic tone", () => {
    expect(directionTone("bullish")).toBe("success");
    expect(directionTone("bearish")).toBe("error");
    expect(directionTone("neutral")).toBe("dimmed");
  });

  test("is case-insensitive and dims unknown values", () => {
    expect(directionTone("BULLISH")).toBe("success");
    expect(directionTone("Bearish")).toBe("error");
    expect(directionTone("mixed")).toBe("dimmed");
    expect(directionTone("")).toBe("dimmed");
  });
});

describe("directionGlyph", () => {
  test("maps direction to a glyph", () => {
    expect(directionGlyph("bullish")).toBe("▲");
    expect(directionGlyph("bearish")).toBe("▼");
    expect(directionGlyph("neutral")).toBe("◆");
  });

  test("is case-insensitive and falls back to the neutral glyph", () => {
    expect(directionGlyph("Bullish")).toBe("▲");
    expect(directionGlyph("BEARISH")).toBe("▼");
    expect(directionGlyph("sideways")).toBe("◆");
    expect(directionGlyph("")).toBe("◆");
  });
});

describe("matrixTfOrder", () => {
  test("orders timeframes by the canonical sequence", () => {
    expect(matrixTfOrder(["1D", "5m", "1h", "15m"])).toEqual(["5m", "15m", "1h", "1D"]);
    expect(matrixTfOrder(["1Y", "6M", "1M", "1W", "1D"])).toEqual(["1D", "1W", "1M", "6M", "1Y"]);
    expect(matrixTfOrder(["4h", "30m", "1W"])).toEqual(["30m", "4h", "1W"]);
  });

  test("places unknown timeframes at the end preserving their input order", () => {
    expect(matrixTfOrder(["2w", "1D", "7m", "5m"])).toEqual(["5m", "1D", "2w", "7m"]);
  });

  test("orders the extended registry timeframes", () => {
    expect(matrixTfOrder(["1W", "3m", "1m", "2h", "1D"])).toEqual(["1m", "3m", "2h", "1D", "1W"]);
  });

  test("matches known timeframes case-insensitively", () => {
    expect(matrixTfOrder(["1d", "5M", "1h"])).toEqual(["5M", "1h", "1d"]);
  });

  test("does not mutate the input and handles an empty list", () => {
    const input = ["1D", "5m"];
    const result = matrixTfOrder(input);
    expect(input).toEqual(["1D", "5m"]);
    expect(result).not.toBe(input);
    expect(matrixTfOrder([])).toEqual([]);
  });
});

function row(overrides: Partial<PatternMatrixRow> = {}): PatternMatrixRow {
  return {
    symbol: "AAA",
    name: null,
    ltp: null,
    day_change_pct: null,
    timeframes: {},
    hits: [],
    best: null,
    hit_count: 0,
    ...overrides,
  };
}

function hit(overrides: Partial<PatternHitDTO> = {}): PatternHitDTO {
  return makePatternHit({
    symbol: "AAA",
    name: "AAA Co",
    pattern_id: "double_bottom",
    pattern_name: "Double Bottom",
    ...overrides,
  });
}

describe("mergeMatrixQuotes", () => {
  test("fills ltp and day change from the active results", () => {
    const rows = [row({ ltp: null, day_change_pct: null })];
    const merged = mergeMatrixQuotes(rows, [
      hit({ last_close: 125.5, day_change_pct: 2.25 }),
    ]);
    expect(merged[0].ltp).toBe(125.5);
    expect(merged[0].day_change_pct).toBe(2.25);
  });

  test("falls back to the pattern-window move when the day change is unavailable", () => {
    const rows = [row({ ltp: null, day_change_pct: null })];
    const merged = mergeMatrixQuotes(rows, [
      hit({ last_close: null, end_price: 110, start_price: 100, day_change_pct: null }),
    ]);
    expect(merged[0].ltp).toBe(110);
    expect(merged[0].day_change_pct).toBeCloseTo(10);
  });

  test("keeps the existing quote when a symbol has no active result", () => {
    const rows = [row({ symbol: "BBB", ltp: 50, day_change_pct: -1 })];
    const merged = mergeMatrixQuotes(rows, [hit({ symbol: "AAA", last_close: 10 })]);
    expect(merged[0]).toEqual(rows[0]);
  });

  test("falls back to the best hit's pattern move for a row without an active result", () => {
    const rows = [
      row({
        symbol: "CCC",
        best: hit({ symbol: "CCC", start_price: 200, end_price: 210 }),
      }),
    ];
    const merged = mergeMatrixQuotes(rows, [hit({ symbol: "AAA", last_close: 10 })]);
    expect(merged[0].ltp).toBe(210);
    expect(merged[0].day_change_pct).toBeCloseTo(5);
  });

  test("prefers a non-null day change over a fallback move", () => {
    const rows = [row()];
    const merged = mergeMatrixQuotes(rows, [
      hit({ id: 1, day_change_pct: null, start_price: 100, end_price: 105 }),
      hit({ id: 2, day_change_pct: 3.5, start_price: 100, end_price: 105 }),
    ]);
    expect(merged[0].day_change_pct).toBe(3.5);
  });

  test("returns the same rows when there are no hits", () => {
    const rows = [row()];
    expect(mergeMatrixQuotes(rows, [])).toBe(rows);
  });
});

describe("lastNHitsPerTimeframe", () => {
  test("orders rows by the hit that is displayed, not an older duplicate", () => {
    const h = (id: number, symbol: string, end_date: string): PatternHitDTO =>
      ({
        id,
        symbol,
        timeframe: "1D",
        pattern_id: "consolidation",
        pattern_name: "Consolidation",
        start_date: "2026-01-01",
        end_date,
        confidence: 50,
      }) as PatternHitDTO;
    // AAA has an older duplicate at index 0 and its newest hit at index 2.
    // With n=1 the row shows the newest AAA, so it must sort after BBB.
    const hits = [h(1, "AAA", "2026-01-10"), h(2, "BBB", "2026-01-10"), h(3, "AAA", "2026-02-10")];
    expect(lastNHitsPerTimeframe(hits, 1).map((hit) => `${hit.symbol}:${hit.id}`)).toEqual([
      "BBB:2",
      "AAA:3",
    ]);
  });
});
