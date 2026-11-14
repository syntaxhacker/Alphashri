import { describe, expect, it } from "vitest";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { matchSequence } from "./sequenceMatch";

const h = (pattern_id: string, start_date: string, end_date: string): PatternHitDTO =>
  ({ pattern_id, start_date, end_date }) as PatternHitDTO;

describe("matchSequence", () => {
  it("matches consolidation -> rising wedge (current only)", () => {
    const out = matchSequence(
      [h("consolidation", "2026-01-01", "2026-02-01"), h("rising_wedge", "2026-02-10", "2026-03-01")],
      ["consolidation", "rising_wedge"],
    );
    expect(out.map((x) => x.pattern_id)).toEqual(["consolidation", "rising_wedge"]);
  });

  it("rejects when the latest hit is not the last step", () => {
    const out = matchSequence(
      [
        h("consolidation", "2026-01-01", "2026-02-01"),
        h("rising_wedge", "2026-02-10", "2026-03-01"),
        h("double_bottom", "2026-03-10", "2026-04-01"),
      ],
      ["consolidation", "rising_wedge"],
    );
    expect(out).toEqual([]);
  });

  it("rejects overlapping steps", () => {
    const out = matchSequence(
      [h("consolidation", "2026-01-01", "2026-02-15"), h("rising_wedge", "2026-02-10", "2026-03-01")],
      ["consolidation", "rising_wedge"],
    );
    expect(out).toEqual([]);
  });

  it("enforces the max gap", () => {
    const hits = [
      h("consolidation", "2026-01-01", "2026-02-01"),
      h("rising_wedge", "2026-06-01", "2026-06-20"),
    ];
    expect(matchSequence(hits, ["consolidation", "rising_wedge"], { maxGapDays: 20 })).toEqual([]);
    expect(matchSequence(hits, ["consolidation", "rising_wedge"], { maxGapDays: 200 })).toHaveLength(2);
  });

  it("uses the latest completed pair", () => {
    const out = matchSequence(
      [
        h("consolidation", "2025-01-01", "2025-02-01"),
        h("rising_wedge", "2025-02-10", "2025-03-01"),
        h("consolidation", "2026-01-01", "2026-02-01"),
        h("rising_wedge", "2026-02-10", "2026-03-01"),
      ],
      ["consolidation", "rising_wedge"],
    );
    expect(out.map((x) => x.end_date)).toEqual(["2026-02-01", "2026-03-01"]);
  });

  it("supports three steps", () => {
    const out = matchSequence(
      [
        h("double_bottom", "2026-01-01", "2026-01-20"),
        h("consolidation", "2026-02-01", "2026-02-20"),
        h("rising_wedge", "2026-03-01", "2026-03-20"),
      ],
      ["double_bottom", "consolidation", "rising_wedge"],
    );
    expect(out).toHaveLength(3);
  });

  it("enforces the last-step recency", () => {
    const hits: PatternHitDTO[] = [
      { ...h("consolidation", "2026-01-01", "2026-02-01"), status: "confirmed" },
      { ...h("rising_wedge", "2026-02-10", "2026-03-01"), status: "forming", bars_ago: 4 },
    ];
    expect(matchSequence(hits, ["consolidation", "rising_wedge"], { maxBarsAgo: 3 })).toEqual([]);
    expect(matchSequence(hits, ["consolidation", "rising_wedge"], { maxBarsAgo: 5 })).toHaveLength(2);
  });

  it("filters the earlier steps by status", () => {
    const hits: PatternHitDTO[] = [
      { ...h("consolidation", "2026-01-01", "2026-02-01"), status: "failed" },
      { ...h("rising_wedge", "2026-02-10", "2026-03-01"), status: "confirmed" },
    ];
    expect(matchSequence(hits, ["consolidation", "rising_wedge"], { stepStatuses: ["confirmed", "forming"] })).toEqual([]);
    expect(matchSequence(hits, ["consolidation", "rising_wedge"], { stepStatuses: [] })).toHaveLength(2);
  });

  it("rejects short sequences and missing steps", () => {
    expect(matchSequence([h("consolidation", "2026-01-01", "2026-02-01")], [])).toEqual([]);
    expect(matchSequence([h("consolidation", "2026-01-01", "2026-02-01")], ["consolidation"])).toEqual([]);
    expect(matchSequence([h("rising_wedge", "2026-02-10", "2026-03-01")], ["consolidation", "rising_wedge"])).toEqual([]);
  });
});
