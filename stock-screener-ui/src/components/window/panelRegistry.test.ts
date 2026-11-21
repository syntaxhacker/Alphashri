import { describe, expect, it } from "vitest";
import { CATALYST_RADAR_PANEL } from "./panels/catalystRadar";
import { getPanelSpec, WINDOW_PANEL_TYPES, WINDOW_PANELS } from "./panelRegistry";

describe("window panel registry", () => {
  it("(a) resolves the catalyst radar to the shipped panel spec", () => {
    expect(getPanelSpec("catalyst.radar")).toBe(CATALYST_RADAR_PANEL);
    expect(CATALYST_RADAR_PANEL.id).toBe("catalyst.radar");
    expect(WINDOW_PANEL_TYPES.has("catalyst.radar")).toBe(true);
  });

  it("(b) every panel id is dotted and registered exactly once", () => {
    const ids = WINDOW_PANELS.map((spec) => spec.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id, id).toMatch(/^[a-z0-9]+\.[a-z0-9]+$/);
      expect(getPanelSpec(id)?.id).toBe(id);
    }
  });

  it("(c) the type set mirrors the panel list — no orphan type or panel", () => {
    expect([...WINDOW_PANEL_TYPES].sort()).toEqual(WINDOW_PANELS.map((spec) => spec.id).sort());
  });

  it("(d) an unknown or removed id resolves to undefined instead of a fallback", () => {
    expect(getPanelSpec("catalyst.unknown")).toBeUndefined();
    expect(getPanelSpec("paper.positions")).toBeUndefined();
  });
});
