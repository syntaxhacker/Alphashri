import { describe, it, expect } from "vitest";
import { getHighMomentumColumns } from "./highMomentum";
import { cellOf, cellText } from "./columnTestFixtures";

function fmt(key: string) {
  const c = getHighMomentumColumns().find((x) => x.key === key);
  if (!c?.format) throw new Error(key);
  return c.format as any;
}

describe("highMomentum columns", () => {
  it("8 columns", () => expect(getHighMomentumColumns().length).toBe(8));
  it("symbol first sector last", () => {
    const cols = getHighMomentumColumns();
    expect(cols[0].key).toBe("symbol");
    expect(cols[cols.length - 1].key).toBe("sector");
  });

  describe("rsi", () => {
    it("78.9 -> 78.9", () => expect(cellText(() => fmt("rsi")(78.9))).toBe("78.9"));
    it("null -> 0.0", () => expect(cellText(() => fmt("rsi")(null))).toBe("0.0"));
    it("NaN -> dash", () => expect(cellText(() => fmt("rsi")(NaN))).toBe("—"));
    it("Infinity -> dash", () => expect(cellText(() => fmt("rsi")(Infinity))).toBe("—"));
  });

  describe("day_change", () => {
    it("0 green", () => expect(cellOf(() => fmt("day_change")(0)).tone).toBe("success"));
    it("-1 red", () => expect(cellOf(() => fmt("day_change")(-1)).tone).toBe("error"));
  });

  describe("recent_return_5d", () => {
    it.each([
      [6.0, "🚀", "success"],
      [3.0, "🟢", "success"],
      [-4.5, "🔴", "error"],
      [0, "🔴", "error"],
    ])("return %s -> %s %s", (v, icon, expTone) => {
      const cell = cellOf(() => fmt("recent_return_5d")(v));
      expect(cell.text).toContain(icon);
      expect(cell.tone).toBe(expTone);
    });
  });

  describe("perf_w", () => {
    it.each([
      [2.1, "success"],
      [-1.0, "error"],
      [0, "error"],
    ])("perf %s -> %s", (v, expTone) => expect(cellOf(() => fmt("perf_w")(v)).tone).toBe(expTone));
  });

  describe("volume_m", () => {
    it("null -> 0.00", () => expect(cellText(() => fmt("volume_m")(null))).toBe("0.00"));
    it("0 -> 0.00", () => expect(cellText(() => fmt("volume_m")(0))).toBe("0.00"));
  });

  it("all sortable", () => getHighMomentumColumns().forEach((c) => expect(c.sortable).toBe(true)));

  describe("edge: volume 0, price 0/NaN", () => {
    it("volume 0 displays", () => expect(cellText(() => fmt("volume_m")(0))).toBe("0.00"));
    it("rsi 0 displays 0.0", () => expect(cellText(() => fmt("rsi")(0))).toBe("0.0"));
  });
});
