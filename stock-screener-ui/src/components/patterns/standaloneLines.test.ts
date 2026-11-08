import { describe, expect, it } from "vitest";
import { NEGATIVE, POSITIVE } from "@/ui/palette";
import type { TrendLine } from "@/types/chartPatterns";
import { mapStandaloneLine, resolveVisibleStandalone } from "./standaloneLines";
import { makeIRCONHit, makeTrendLine } from "./patternTestFixtures";

const TIMES = ["2026-04-01", "2026-04-02", "2026-04-03", "2026-04-04", "2026-04-05"];

describe("resolveVisibleStandalone", () => {
  it("keeps both lines when view is 'both'", () => {
    const out = resolveVisibleStandalone([makeTrendLine(), makeTrendLine({ kind: "resistance" })], null, "both");
    expect(out).toHaveLength(2);
  });

  it("keeps only support when view is 'support'", () => {
    const out = resolveVisibleStandalone([makeTrendLine(), makeTrendLine({ kind: "resistance" })], null, "support");
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("support");
  });

  it("keeps only resistance when view is 'resistance'", () => {
    const out = resolveVisibleStandalone([makeTrendLine(), makeTrendLine({ kind: "resistance" })], null, "resistance");
    expect(out).toHaveLength(1);
    expect(out[0]?.kind).toBe("resistance");
  });

  it("returns [] when view is 'none'", () => {
    expect(resolveVisibleStandalone([makeTrendLine()], null, "none")).toEqual([]);
  });

  it("falls back to hit.trend_lines when no explicit list", () => {
    const out = resolveVisibleStandalone(undefined, makeIRCONHit({ trend_lines: [makeTrendLine()] }), "both");
    expect(out).toHaveLength(1);
  });

  it("returns [] when there are no lines at all", () => {
    expect(resolveVisibleStandalone(undefined, makeIRCONHit(), "both")).toEqual([]);
  });
});

describe("mapStandaloneLine", () => {
  it("maps TLS/TLR name, colour and points", () => {
    const mapped = mapStandaloneLine(makeTrendLine(), TIMES);
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
    const mapped = mapStandaloneLine(makeTrendLine({ kind: "resistance" }), TIMES);
    expect(mapped).toMatchObject({ name: "TLR", color: NEGATIVE });
  });

  it("returns null for a null line", () => {
    expect(mapStandaloneLine(null as unknown as TrendLine, TIMES)).toBeNull();
  });

  it("returns null when the segment falls outside the window", () => {
    const outside = makeTrendLine({ start_date: "2025-01-01", end_date: "2025-01-05" });
    expect(mapStandaloneLine(outside, TIMES)).toBeNull();
  });
});
