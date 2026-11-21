import { describe, it, expect } from "vitest";
import { getNear52wBreakoutColumns } from "./near52wBreakout";
import { cellOf, cellText, fmtOf, expectSymbolFirstSectorLast } from "./columnTestFixtures";

const fmt = (key: string) => fmtOf(getNear52wBreakoutColumns, key);

describe("near52wBreakout columns", () => {
  it("returns 9 columns symbol first sector last", () => {
    expectSymbolFirstSectorLast(getNear52wBreakoutColumns(), 9);
  });

  describe("to_52w_high gap %", () => {
    it.each([
      [-2, "-2.00%"],
      [0, "0.00%"],
      [1.5, "+1.50%"],
      [2.01, "+2.01%"],
      [5, "+5.00%"],
    ])("val %s -> %s", (v, ev) => {
      expect(cellText(() => fmt("to_52w_high")(v))).toBe(ev);
    });
    it("handles NaN/Infinity", () => {
      expect(() => cellText(() => fmt("to_52w_high")(NaN))).not.toThrow();
      expect(() => cellText(() => fmt("to_52w_high")(Infinity))).not.toThrow();
      expect(cellText(() => fmt("to_52w_high")(0))).toBe("0.00%");
    });
  });

  describe("rsi/adx formatting", () => {
    it("rsi 65.3 -> 65.3", () => expect(cellText(() => fmt("rsi")(65.3))).toBe("65.3"));
    it("adx 30 -> 30.0", () => expect(cellText(() => fmt("adx")(30))).toBe("30.0"));
    it("rsi null -> 0.0", () => expect(cellText(() => fmt("rsi")(null))).toBe("0.0"));
    it("adx undefined -> 0.0", () => expect(cellText(() => fmt("adx")(undefined))).toBe("0.0"));
    it("handles NaN", () => expect(() => cellText(() => fmt("rsi")(NaN))).not.toThrow());
  });

  describe("day_change", () => {
    it.each([
      [2.5, "+2.50%", "success"],
      [-1, "-1.00%", "error"],
    ])("day_change %s", (v, ev, ec) => {
      const cell = cellOf(() => fmt("day_change")(v));
      expect(cell.text).toBe(ev);
      expect(cell.tone).toBe(ec);
    });
  });

  describe("recent_return_5d / perf_w", () => {
    it("rocket >5", () => {
      expect(cellText(() => fmt("recent_return_5d")(8))).toContain("🚀");
    });
    it("perf_w green/red", () => {
      expect(cellOf(() => fmt("perf_w")(2)).tone).toBe("success");
      expect(cellOf(() => fmt("perf_w")(-1)).tone).toBe("error");
    });
  });

  it("all sortable", () =>
    getNear52wBreakoutColumns().forEach((c) => expect(c.sortable).toBe(true)));
});
