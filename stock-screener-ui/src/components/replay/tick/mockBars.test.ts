import { describe, expect, it } from "vitest";
import { detectFVG } from "@/utils/smc";
import { genMockBars } from "./mockBars";

describe("genMockBars", () => {
  it("is deterministic for the same seed", () => {
    expect(genMockBars(60, 42)).toEqual(genMockBars(60, 42));
  });
  it("emits 60s-spaced bars with valid OHLC", () => {
    const bars = genMockBars(100);
    expect(bars).toHaveLength(100);
    for (let i = 1; i < bars.length; i++) expect(bars[i].time - bars[i - 1].time).toBe(60);
    for (const b of bars) {
      expect(b.high).toBeGreaterThanOrEqual(Math.max(b.open, b.close));
      expect(b.low).toBeLessThanOrEqual(Math.min(b.open, b.close));
    }
  });
  it("has no FVG gaps by construction (clean chart)", () => {
    expect(detectFVG(genMockBars(260))).toEqual([]);
  });
});
