import { describe, expect, test } from "vitest";
import presets from "../../../api/value_scan/presets.json";
import { PRESET_IDS, VALUE_PRESETS } from "../../api/valuePresets.generated";

describe("valuePresets.generated.ts ↔ api/value_scan/presets.json", () => {
  test("the ids and labels match the backend source of truth", () => {
    const ids = Object.keys(presets);
    expect([...PRESET_IDS]).toEqual(ids);
    expect(Object.keys(VALUE_PRESETS).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(VALUE_PRESETS[id]?.label, `${id} label`).toBe(
        presets[id as keyof typeof presets].label,
      );
    }
  });

  test("descriptions and gates match the backend source of truth", () => {
    for (const [id, preset] of Object.entries(presets)) {
      expect(VALUE_PRESETS[id]?.description, `${id} description`).toBe(preset.description);
      expect(VALUE_PRESETS[id]?.gates, `${id} gates`).toEqual(preset.gates);
    }
  });
});
