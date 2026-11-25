// @vitest-environment node
import { describe, expect, it } from "vitest";
import { SECTION_CONCEPTS, SECTION_REGISTRY, validateSection } from "./registry";
import { DEFAULT_SECTIONS, newSection } from "./presets";
import * as presetsFacade from "./presets";
import type { SectionDefinition, SectionOp } from "./types";

/** Independent copy of the contract — do not import the vocabulary under test. */
const RAW_METRICS = [
  "close",
  "VWAP",
  "change|1",
  "change|5",
  "change|15",
  "volume_change|5",
  "relative_volume_10d_calc",
  "average_volume_10d_calc",
  "price_52_week_high",
  "price_52_week_low",
  "EMA20",
  "EMA50",
  "market_cap_basic",
  "update_mode",
] as const;

const CONCEPTS = [
  "vwap_above",
  "vwap_below",
  "vwap_cross",
  "momentum_1m",
  "momentum_5m",
  "momentum_15m",
  "volume_surge_5m",
  "rvol_spike",
  "52w_touch",
  "ema_cross",
  "orb_proxy",
] as const;

const OPS = ["gt", "gte", "lt", "lte", "crosses_above", "crosses_below", "eq"] as const;

describe("section registry contract", () => {
  it("exposes every concept exactly once", () => {
    expect([...SECTION_CONCEPTS].sort()).toEqual([...CONCEPTS].sort());
    expect(new Set(SECTION_CONCEPTS).size).toBe(CONCEPTS.length);
  });

  it("has a fully populated descriptor for every concept", () => {
    for (const concept of CONCEPTS) {
      const descriptor = SECTION_REGISTRY[concept];
      expect(descriptor, `descriptor for ${concept}`).toBeDefined();
      expect(descriptor.id).toBe(concept);
      expect(descriptor.label.length).toBeGreaterThan(0);
      expect(descriptor.description.length).toBeGreaterThan(0);
      expect(descriptor.fieldOptions.length).toBeGreaterThan(0);
      expect(descriptor.defaultConditions.length).toBeGreaterThan(0);
      expect(descriptor.defaultColumns.length).toBeGreaterThan(0);
      for (const column of descriptor.defaultColumns) expect(column.length).toBeGreaterThan(0);
    }
  });

  it("only orb_proxy requires bars", () => {
    for (const concept of CONCEPTS) {
      expect(SECTION_REGISTRY[concept].requires, concept).toBe(
        concept === "orb_proxy" ? "bars" : "tv",
      );
    }
  });

  it("uses only raw TradingView field names — no aliases", () => {
    const allowed = new Set<string>(RAW_METRICS);
    for (const concept of CONCEPTS) {
      const descriptor = SECTION_REGISTRY[concept];
      for (const option of descriptor.fieldOptions) {
        expect(allowed.has(option.metric), `${concept}.fieldOptions: ${option.metric}`).toBe(true);
        expect(option.label.length).toBeGreaterThan(0);
        for (const op of option.op) expect(OPS).toContain(op);
      }
      for (const condition of descriptor.defaultConditions) {
        expect(allowed.has(condition.metric), `${concept}.defaultConditions: ${condition.metric}`).toBe(
          true,
        );
        expect(OPS).toContain(condition.op);
      }
    }
  });

  it("covers the full raw-field vocabulary across descriptors", () => {
    const seen = new Set<string>();
    for (const concept of CONCEPTS) {
      for (const option of SECTION_REGISTRY[concept].fieldOptions) seen.add(option.metric);
    }
    expect([...seen].sort()).toEqual([...RAW_METRICS].sort());
  });
});

describe("starter presets", () => {
  it("ships exactly the seven starter sections in order", () => {
    expect(DEFAULT_SECTIONS.map((section) => section.name)).toEqual([
      "VWAP Reclaim",
      "VWAP Reject",
      "Momentum 5m + RVOL≥1.5",
      "Volume Surge 5m",
      "RVOL Spike ×2",
      "52W Touch",
      "EMA Cross",
    ]);
  });

  it("every starter preset is valid, enabled and table-rendered", () => {
    for (const section of DEFAULT_SECTIONS) {
      expect(validateSection(section), section.name).toEqual([]);
      expect(section.enabled, section.name).toBe(true);
      expect(section.render.type, section.name).toBe("table");
      expect(SECTION_CONCEPTS, section.name).toContain(section.concept);
    }
  });

  it("all preset conditions use raw field names and allowed ops", () => {
    const allowed = new Set<string>(RAW_METRICS);
    for (const section of DEFAULT_SECTIONS) {
      for (const condition of section.conditions) {
        expect(allowed.has(condition.metric), `${section.name}: ${condition.metric}`).toBe(true);
        expect(OPS, section.name).toContain(condition.op);
      }
    }
  });

  it("momentum preset combines a 5m change with RVOL >= 1.5", () => {
    const section = DEFAULT_SECTIONS.find((preset) => preset.concept === "momentum_5m");
    expect(section).toBeDefined();
    expect(section!.conditions).toEqual([
      { metric: "change|5", op: "gt", value: 0 },
      { metric: "relative_volume_10d_calc", op: "gte", value: 1.5 },
    ]);
  });

  it("RVOL spike preset uses a 2x threshold", () => {
    const section = DEFAULT_SECTIONS.find((preset) => preset.concept === "rvol_spike");
    expect(section).toBeDefined();
    expect(section!.conditions).toContainEqual({
      metric: "relative_volume_10d_calc",
      op: "gt",
      value: 2,
    });
  });
});

describe("newSection", () => {
  it("builds a fresh definition from the concept descriptor", () => {
    const first = newSection("momentum_5m");
    const second = newSection("momentum_5m");
    const descriptor = SECTION_REGISTRY.momentum_5m;

    expect(first.concept).toBe("momentum_5m");
    expect(first.name).toBe(descriptor.label);
    expect(first.description).toBe(descriptor.description);
    expect(first.conditions).toEqual(descriptor.defaultConditions);
    expect(first.render.columns).toEqual(descriptor.defaultColumns);
    expect(first.id).not.toBe(second.id);
    expect(first.conditions).not.toBe(descriptor.defaultConditions);
    expect(first.render.columns).not.toBe(descriptor.defaultColumns);
    expect(first.render.columns).not.toBe(second.render.columns);
  });

  it("returns a valid, enabled, unpinned definition for every concept", () => {
    for (const concept of CONCEPTS) {
      const section = newSection(concept);
      expect(validateSection(section), concept).toEqual([]);
      expect(section.enabled, concept).toBe(true);
      expect(section.pinned, concept).toBe(false);
      expect(["long", "short", "both"], concept).toContain(section.side);
      expect(section.refreshSec, concept).toBeGreaterThan(0);
    }
  });
});

describe("validateSection", () => {
  const base = (): SectionDefinition => newSection("momentum_1m");

  it("accepts a well-formed definition", () => {
    expect(validateSection(base())).toEqual([]);
  });

  it("rejects empty conditions", () => {
    const invalid = { ...base(), conditions: [] };
    expect(validateSection(invalid).join(" ")).toMatch(/condition/i);
  });

  it("rejects an unknown metric", () => {
    const invalid = { ...base(), conditions: [{ metric: "vwap", op: "gt" as const, value: 0 }] };
    expect(validateSection(invalid).join(" ")).toMatch(/vwap/);
  });

  it("rejects an unknown op", () => {
    const invalid = {
      ...base(),
      conditions: [{ metric: "close", op: "above" as unknown as SectionOp, value: 0 }],
    };
    expect(validateSection(invalid).join(" ")).toMatch(/above/);
  });

  it("accumulates multiple errors", () => {
    const invalid = {
      ...base(),
      conditions: [
        { metric: "rvol", op: "gt" as const, value: 0 },
        { metric: "close", op: "nope" as unknown as SectionOp, value: 0 },
      ],
    };
    expect(validateSection(invalid).length).toBeGreaterThanOrEqual(2);
  });
});

describe("public surface", () => {
  it("presets module re-exports the full contract", () => {
    for (const name of [
      "SECTION_CONCEPTS",
      "SECTION_REGISTRY",
      "DEFAULT_SECTIONS",
      "newSection",
      "validateSection",
    ]) {
      expect(name in presetsFacade, name).toBe(true);
    }
  });
});
