// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import { PRESET_IDS, VALUE_PRESETS } from "./valuePresets.generated";
import { VALUE_PRESETS as REEXPORTED_PRESETS } from "./valueScan";

const EXPECTED_IDS = ["SERIOUS", "DEEP", "GARP_VALUE", "YIELD", "TURNAROUND", "NO_GATE"];
const EXPECTED_LABELS: Record<string, string> = {
  SERIOUS: "Serious",
  DEEP: "Deep",
  GARP_VALUE: "GARP Value",
  YIELD: "Yield",
  TURNAROUND: "Turnaround",
  NO_GATE: "No gate",
};

describe("generated value presets", () => {
  test("ids, labels, descriptions and gates match the canonical set", () => {
    expect([...PRESET_IDS]).toEqual(EXPECTED_IDS);
    expect(Object.keys(VALUE_PRESETS)).toEqual(EXPECTED_IDS);
    for (const id of EXPECTED_IDS) {
      expect(VALUE_PRESETS[id].label).toBe(EXPECTED_LABELS[id]);
      expect(VALUE_PRESETS[id].description.length).toBeGreaterThan(0);
      expect(VALUE_PRESETS[id].gates).toBeTypeOf("object");
    }
    // The E2E selects DEEP by the visible "Deep" label.
    expect(VALUE_PRESETS.DEEP.label).toBe("Deep");
    expect(VALUE_PRESETS.NO_GATE.gates).toEqual({});
  });

  test("valueScan re-exports the generated artifact unchanged", () => {
    expect(REEXPORTED_PRESETS).toBe(VALUE_PRESETS);
  });
});
