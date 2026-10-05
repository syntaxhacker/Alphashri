import { describe, it, expect } from "vitest";
import {
  BUILTIN_PRESETS,
  PATTERN_CATALOG,
  PATTERN_FAMILIES,
  PATTERN_LABELS,
  QUALITY_INFO,
  STATUS_INFO,
} from "./patternCatalog";

const EXPECTED_IDS = [
  "falling_wedge",
  "rising_wedge",
  "diamond_bottom",
  "triple_bottom",
  "double_bottom",
  "head_shoulders",
  "inverse_head_shoulders",
  "rounding_bottom",
  "ascending_channel",
  "descending_channel",
  "bull_flag",
  "bear_flag",
  "pennant",
  "rectangle",
  "ascending_triangle",
  "descending_triangle",
  "consolidation",
  "curve_bearish",
  "cup_handle",
];

describe("patternCatalog", () => {
  it("contains all 19 catalog patterns in a stable order", () => {
    expect(PATTERN_CATALOG.map((p) => p.id)).toEqual(EXPECTED_IDS);
    expect(PATTERN_FAMILIES.flatMap((f) => f.patterns)).toHaveLength(19);
  });

  it("groups patterns by family", () => {
    expect(PATTERN_FAMILIES.map((f) => f.id)).toEqual([
      "reversal",
      "continuation",
      "curve_cup",
    ]);
    expect(PATTERN_FAMILIES.find((f) => f.id === "reversal")?.patterns).toHaveLength(8);
    expect(PATTERN_FAMILIES.find((f) => f.id === "continuation")?.patterns).toHaveLength(9);
    expect(PATTERN_FAMILIES.find((f) => f.id === "curve_cup")?.patterns).toHaveLength(2);
  });

  it("exposes an id → name label map for every pattern", () => {
    for (const id of EXPECTED_IDS) {
      expect(PATTERN_LABELS[id]).toBeTruthy();
    }
    expect(PATTERN_LABELS.ascending_channel).toBe("Ascending Channel");
  });

  it("documents every quality tier", () => {
    expect(Object.keys(QUALITY_INFO)).toEqual(["textbook", "strong", "fair", "marginal"]);
    for (const entry of Object.values(QUALITY_INFO)) {
      expect(entry.label).toBeTruthy();
      expect(entry.description.length).toBeGreaterThan(10);
    }
  });

  it("documents every detection status", () => {
    expect(Object.keys(STATUS_INFO)).toEqual(["confirmed", "forming", "failed", "marginal"]);
    for (const entry of Object.values(STATUS_INFO)) {
      expect(entry.label).toBeTruthy();
      expect(entry.description.length).toBeGreaterThan(10);
    }
  });

  it("ships a last_30d preset scoping the formation window", () => {
    const preset = BUILTIN_PRESETS.find((p) => p.id === "last_30d");
    expect(preset).toBeTruthy();
    expect(preset?.filters.from_date).toBeTruthy();
    const parsed = Date.parse(String(preset?.filters.from_date));
    expect(Number.isNaN(parsed)).toBe(false);
    const daysAgo = (Date.now() - parsed) / 86_400_000;
    expect(daysAgo).toBeGreaterThan(29);
    expect(daysAgo).toBeLessThan(31);
  });
});
