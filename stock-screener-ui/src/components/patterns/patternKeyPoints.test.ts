import { describe, expect, test } from "vitest";
import type { PatternHitDTO } from "@/types/chartPatterns";
import { buildPatternKeyPoints, keyPointMeanings } from "./patternKeyPoints";
import { makePatternHit, makePivot as pivot } from "./patternTestFixtures";

function hit(pattern_id: string, pivots: ReturnType<typeof pivot>[]): PatternHitDTO {
  return makePatternHit({ pattern_id, pattern_name: pattern_id, pivots });
}

const CUP_HANDLE_PIVOTS = [
  pivot("2026-01-02", 110, "high"),
  pivot("2026-01-10", 90, "low"),
  pivot("2026-01-20", 108, "high"),
  pivot("2026-01-25", 96, "low"),
];

function byLabel(points: ReturnType<typeof buildPatternKeyPoints>) {
  return Object.fromEntries(points.map((point) => [point.label, point.price]));
}

describe("buildPatternKeyPoints", () => {
  test("labels head & shoulders: shoulders, head and both neckline points", () => {
    const points = buildPatternKeyPoints(
      hit("head_shoulders", [
        pivot("2026-05-04", 234.4, "high"),
        pivot("2026-05-11", 208.03, "low"),
        pivot("2026-05-14", 229.0, "high"),
        pivot("2026-05-19", 216.19, "low"),
        pivot("2026-05-28", 254.2, "high"),
        pivot("2026-06-01", 227.41, "low"),
        pivot("2026-06-10", 214.8, "low"),
        pivot("2026-06-14", 227.0, "high"),
        pivot("2026-06-22", 235.5, "high"),
      ]),
    );
    expect(byLabel(points)).toMatchObject({
      LS: 234.4,
      H: 254.2,
      RS: 235.5,
      N1: 208.03,
      N2: 214.8,
    });
  });

  test("mirrors the labels for an inverse head & shoulders", () => {
    const points = buildPatternKeyPoints(
      hit("inverse_head_shoulders", [
        pivot("2026-01-02", 90, "low"),
        pivot("2026-01-05", 100, "high"),
        pivot("2026-01-10", 80, "low"),
        pivot("2026-01-15", 98, "high"),
        pivot("2026-01-20", 88, "low"),
      ]),
    );
    expect(byLabel(points)).toMatchObject({ LS: 90, H: 80, RS: 88, N1: 100, N2: 98 });
  });

  test("labels triple bottom and the two neckline highs", () => {
    const points = buildPatternKeyPoints(
      hit("triple_bottom", [
        pivot("2026-03-15", 1347.0, "low"),
        pivot("2026-03-17", 1411.1, "high"),
        pivot("2026-03-22", 1293.5, "low"),
        pivot("2026-03-24", 1392.7, "high"),
        pivot("2026-03-29", 1307.1, "low"),
        pivot("2026-03-31", 1405.4, "high"),
      ]),
    );
    expect(byLabel(points)).toMatchObject({
      B1: 1347.0,
      B2: 1293.5,
      B3: 1307.1,
      N1: 1411.1,
      N2: 1392.7,
    });
  });

  test("labels a double top with its neckline", () => {
    const points = buildPatternKeyPoints(
      hit("double_top", [
        pivot("2026-01-02", 100, "low"),
        pivot("2026-01-05", 120, "high"),
        pivot("2026-01-10", 105, "low"),
        pivot("2026-01-15", 118, "high"),
      ]),
    );
    expect(byLabel(points)).toMatchObject({ T1: 120, T2: 118, N1: 105 });
  });

  test("labels cup & handle: cup, both rims and the handle", () => {
    const points = buildPatternKeyPoints(
      hit("cup_handle", CUP_HANDLE_PIVOTS),
    );
    expect(byLabel(points)).toMatchObject({ C: 90, R1: 110, R2: 108, H: 96 });
  });

  test("falls back to labelled highs/lows for wedge and triangle patterns", () => {
    const points = buildPatternKeyPoints(
      hit("falling_wedge", [
        pivot("2026-01-02", 120, "high"),
        pivot("2026-01-05", 95, "low"),
        pivot("2026-01-10", 115, "high"),
        pivot("2026-01-15", 90, "low"),
      ]),
    );
    expect(points.map((point) => point.label)).toEqual(["H1", "L1", "H2", "L2"]);
  });

  test("explains the labels for head & shoulders, cup & handle and generic shapes", () => {
    const hs = buildPatternKeyPoints(
      hit("head_shoulders", [
        pivot("2026-01-02", 100, "high"),
        pivot("2026-01-05", 90, "low"),
        pivot("2026-01-10", 110, "high"),
        pivot("2026-01-15", 92, "low"),
        pivot("2026-01-20", 101, "high"),
      ]),
    );
    expect(keyPointMeanings("head_shoulders", hs)).toEqual(
      expect.arrayContaining([
        { label: "LS", meaning: "Left shoulder" },
        { label: "H", meaning: "Head" },
        { label: "RS", meaning: "Right shoulder" },
        { label: "N1", meaning: "Neckline" },
      ]),
    );

    const cup = buildPatternKeyPoints(
      hit("cup_handle", CUP_HANDLE_PIVOTS),
    );
    expect(keyPointMeanings("cup_handle", cup)).toContainEqual({ label: "H", meaning: "Handle" });

    const wedge = buildPatternKeyPoints(
      hit("falling_wedge", [
        pivot("2026-01-02", 120, "high"),
        pivot("2026-01-05", 95, "low"),
      ]),
    );
    expect(keyPointMeanings("falling_wedge", wedge)).toEqual([
      { label: "H1", meaning: "Swing high" },
      { label: "L1", meaning: "Swing low" },
    ]);
  });

  test("returns nothing without pivots", () => {
    expect(buildPatternKeyPoints(null)).toEqual([]);
    expect(buildPatternKeyPoints(hit("head_shoulders", []))).toEqual([]);
  });
});
