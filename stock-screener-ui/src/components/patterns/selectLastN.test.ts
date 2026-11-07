import { describe, expect, it } from "vitest";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { hitsOverlap, selectLastN } from "./selectLastN";

const hit = (
  pattern_id: string,
  start_date: string,
  end_date: string,
  confidence = 50,
): PatternHitDTO =>
  ({ pattern_id, pattern_name: pattern_id, start_date, end_date, confidence }) as PatternHitDTO;

describe("selectLastN", () => {
  it("returns newest first", () => {
    const out = selectLastN(
      [hit("a", "2026-01-01", "2026-01-10"), hit("b", "2026-02-01", "2026-02-10"), hit("c", "2026-03-01", "2026-03-10")],
      2,
    );
    expect(out.map((h) => h.pattern_id)).toEqual(["c", "b"]);
  });

  it("keeps different patterns even when their spans overlap", () => {
    const out = selectLastN(
      [
        hit("triangle", "2026-01-01", "2026-01-20"),
        hit("consolidation", "2026-01-15", "2026-02-20"),
        hit("channel", "2026-02-15", "2026-03-01"),
      ],
      3,
    );
    expect(out.map((h) => h.pattern_id)).toEqual(["channel", "consolidation", "triangle"]);
  });

  it("collapses the same pattern re-detected over the same span", () => {
    const out = selectLastN(
      [
        hit("consolidation", "2026-08-06", "2026-11-02", 68),
        hit("consolidation", "2026-08-11", "2026-11-05", 82),
      ],
      3,
    );
    expect(out).toHaveLength(1);
    expect(out[0].end_date).toBe("2026-11-05");
  });

  it("keeps the same pattern when the instances do not overlap", () => {
    const out = selectLastN(
      [
        hit("consolidation", "2026-01-01", "2026-02-01"),
        hit("consolidation", "2026-04-01", "2026-05-01"),
      ],
      3,
    );
    expect(out).toHaveLength(2);
  });

  it("allows overlaps when disabled", () => {
    const out = selectLastN(
      [hit("a", "2026-01-01", "2026-01-20"), hit("a", "2026-01-15", "2026-02-20")],
      2,
      false,
    );
    expect(out).toHaveLength(2);
  });

  it("caps at n", () => {
    const hits = [1, 2, 3, 4, 5].map((i) => hit(String(i), `2026-0${i}-01`, `2026-0${i}-10`));
    expect(selectLastN(hits, 3)).toHaveLength(3);
  });

  it("tie-breaks on confidence", () => {
    const out = selectLastN(
      [hit("low", "2026-01-01", "2026-01-10", 40), hit("high", "2026-01-01", "2026-01-10", 90)],
      1,
    );
    expect(out[0].pattern_id).toBe("high");
  });

  it("handles empty and zero", () => {
    expect(selectLastN([], 3)).toEqual([]);
    expect(selectLastN([hit("a", "2026-01-01", "2026-01-10")], 0)).toEqual([]);
  });

  it("treats touching endpoints as overlap", () => {
    expect(hitsOverlap(hit("a", "2026-01-01", "2026-01-10"), hit("b", "2026-01-10", "2026-01-20"))).toBe(true);
    expect(hitsOverlap(hit("a", "2026-01-01", "2026-01-10"), hit("c", "2026-01-11", "2026-01-20"))).toBe(false);
  });
});
