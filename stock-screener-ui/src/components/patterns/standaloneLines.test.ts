import { describe, expect, it } from "vitest";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import type { PatternHitDTO, TrendLine } from "@/types/chartPatterns";
import { mapStandaloneLine, resolveVisibleStandalone } from "./standaloneLines";

function line(overrides: Partial<TrendLine> = {}): TrendLine {
  return {
    kind: "support",
    start_date: "2026-04-01",
    start_price: 99,
    end_date: "2026-04-05",
    end_price: 103,
    slope: 1,
    touches: 3,
    span_bars: 5,
    violations: 0,
    ...overrides,
  };
}

function hit(overrides: Partial<PatternHitDTO> = {}): PatternHitDTO {
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
    start_date: "2026-04-01",
    end_date: "2026-04-05",
    start_price: 100,
    end_price: 108,
    breakout_level: 109,
    target: 120,
    stop: 99,
    rr: 1.7,
    bars_ago: 2,
    volume_confirmed: true,
    trendlines: [],
    trend_lines: [],
    pivots: [],
    notes: "",
    ...overrides,
  };
}

const TIMES = ["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04", "2026-04-05"];

describe("resolveVisibleStandalone", () => {
  it("keeps both lines when view is 'both'", () => {
    const out = resolveVisibleStandalone([line(), line({ kind: "resistance" })], null, "both");
    expect(out).toHaveLength(2);
  });

  it("keeps only support when view is 'support'", () => {
    const out = resolveVisibleStandalone([line(), line({ kind: "resistance" })], null, "support");
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("support");
  });

  it("keeps only resistance when view is 'resistance'", () => {
    const out = resolveVisibleStandalone([line(), line({ kind: "resistance" })], null, "resistance");
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("resistance");
  });

  it("returns [] when view is 'none'", () => {
    expect(resolveVisibleStandalone([line()], null, "none")).toEqual([]);
  });

  it("falls back to hit.trend_lines when no explicit list", () => {
    const out = resolveVisibleStandalone(undefined, hit({ trend_lines: [line()] }), "both");
    expect(out).toHaveLength(1);
  });

  it("returns [] when there are no lines at all", () => {
    expect(resolveVisibleStandalone(undefined, hit(), "both")).toEqual([]);
  });
});

describe("mapStandaloneLine", () => {
  it("maps TLS/TLR name, colour and points", () => {
    const mapped = mapStandaloneLine(line(), TIMES);
    expect(mapped).toMatchObject({
      name: "TLS",
      color: POSITIVE,
      line: expect.anything(),
    });
    expect(mapped?.points).toHaveLength(2);
    expect(mapped?.points[0]).toMatchObject({ index: 0, price: 99 });
    expect(mapped?.points[1]).toMatchObject({ index: 4, price: 103 });
  });

  it("maps resistance as TLR in NEGATIVE colour", () => {
    const mapped = mapStandaloneLine(line({ kind: "resistance" }), TIMES);
    expect(mapped).toMatchObject({ name: "TLR", color: NEGATIVE });
  });

  it("returns null for a null line", () => {
    expect(mapStandaloneLine(null as unknown as TrendLine, TIMES)).toBeNull();
  });

  it("returns null when the segment falls outside the window", () => {
    const outside = line({ start_date: "2025-01-01", end_date: "2025-01-05" });
    expect(mapStandaloneLine(outside, TIMES)).toBeNull();
  });
});
