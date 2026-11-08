import { describe, expect, it } from "vitest";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { triggerDistancePct, triggerLevels } from "./triggerDistance";
import { makePatternHit } from "./patternTestFixtures";

function makeHit(overrides: Partial<PatternHitDTO> = {}): PatternHitDTO {
  return makePatternHit({ symbol: "IRCON", ...overrides });
}

describe("triggerLevels", () => {
  it("reads box top/bottom from the two flat trendlines", () => {
    const hit = makeHit({
      trendlines: [
        [{ t: "2026-01-01", price: 130 }],
        [{ t: "2026-01-01", price: 110 }],
      ],
    });
    expect(triggerLevels(hit)).toEqual({ upper: 130, lower: 110 });
  });

  it("returns null for both levels when there are no trendlines or pivots", () => {
    expect(triggerLevels(makeHit())).toEqual({ upper: null, lower: null });
  });

  it("falls back to pivot highs/lows when trendlines are absent", () => {
    const hit = makeHit({
      trendlines: [],
      pivots: [
        { t: "2026-01-01", price: 130, kind: "high" },
        { t: "2026-01-02", price: 120, kind: "high" },
        { t: "2026-01-01", price: 110, kind: "low" },
        { t: "2026-01-02", price: 100, kind: "low" },
      ],
    });
    expect(triggerLevels(hit)).toEqual({ upper: 130, lower: 100 });
  });

  it("ignores non-finite and missing trendline prices", () => {
    const hit = makeHit({
      trendlines: [
        [{ t: "2026-01-01", price: NaN }],
        [{ t: "2026-01-01", price: 110 }],
      ],
    });
    expect(triggerLevels(hit)).toEqual({ upper: 110, lower: null });
  });

  it("never throws on malformed input", () => {
    expect(() => triggerLevels({} as PatternHitDTO)).not.toThrow();
    expect(triggerLevels({} as PatternHitDTO)).toEqual({ upper: null, lower: null });
  });
});

describe("triggerDistancePct", () => {
  const trendlines = [
    [{ t: "2026-01-01", price: 110 }],
    [{ t: "2026-01-01", price: 100 }],
  ];

  it("is positive when price is above the upper trigger", () => {
    const d = triggerDistancePct(makeHit({ last_close: 115, trendlines }));
    expect(d).toBeCloseTo(((115 - 110) / 110) * 100, 6);
    expect(d).toBeCloseTo(4.545454, 4);
  });

  it("is negative when price is below the upper trigger", () => {
    const d = triggerDistancePct(makeHit({ last_close: 105, trendlines }));
    expect(d).toBeCloseTo(-4.545454, 4);
  });

  it("is zero when price is exactly on the trigger", () => {
    expect(triggerDistancePct(makeHit({ last_close: 110, trendlines }))).toBe(0);
  });

  it("falls back to end_price when last_close is missing", () => {
    const d = triggerDistancePct(makeHit({ last_close: null, end_price: 115, trendlines }));
    expect(d).toBeCloseTo(4.545454, 4);
  });

  it("falls back to pivot highs when trendlines are absent", () => {
    const hit = makeHit({
      trendlines: [],
      pivots: [{ t: "2026-01-01", price: 110, kind: "high" }],
      last_close: 115,
    });
    expect(triggerDistancePct(hit)).toBeCloseTo(4.545454, 4);
  });

  it("is null when the trigger level is missing", () => {
    expect(triggerDistancePct(makeHit({ last_close: 115 }))).toBeNull();
    expect(triggerDistancePct(makeHit({ last_close: null, end_price: 115 }))).toBeNull();
  });

  it("is null when the trigger level is zero", () => {
    expect(
      triggerDistancePct(makeHit({ last_close: 100, trendlines: [[{ t: "x", price: 0 }], [{ t: "x", price: 0 }]] })),
    ).toBeNull();
  });

  it("is null when the close is NaN", () => {
    expect(triggerDistancePct(makeHit({ last_close: NaN, trendlines }))).toBeNull();
  });

  it("is null when the trigger level is NaN", () => {
    expect(
      triggerDistancePct(makeHit({ last_close: 100, trendlines: [[{ t: "x", price: NaN }], [{ t: "x", price: NaN }]] })),
    ).toBeNull();
  });

  it("never throws on malformed input", () => {
    expect(() => triggerDistancePct({} as PatternHitDTO)).not.toThrow();
    expect(triggerDistancePct({} as PatternHitDTO)).toBeNull();
  });
});
