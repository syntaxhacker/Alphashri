import { describe, it, expect } from "vitest";
import { getNiftyMoversColumns } from "./niftyMovers";
import { cellOf, cellText, fmtOf, expectSymbolFirstSectorLast } from "./columnTestFixtures";

const fmt = (key: string) => fmtOf(getNiftyMoversColumns, key);

describe("niftyMovers columns", () => {
  it("7 columns symbol first sector last", () => {
    expectSymbolFirstSectorLast(getNiftyMoversColumns(), 7);
  });

  describe("impact_score", () => {
    it.each([
      [2.5, "+2.50", "success"],
      [-1.3, "-1.30", "error"],
      [0, "+0.00", "success"],
    ])("impact %s -> %s %s", (v, ev, ec) => {
      const cell = cellOf(() => fmt("impact_score")(v));
      expect(cell.text).toBe(ev);
      expect(cell.tone).toBe(ec);
    });
    it("only values above zero earn the plus sign", () => {
      expect(cellText(() => fmt("impact_score")(-2))).toBe("-2.00");
    });
    it("NaN/Infinity render the dash", () => {
      expect(cellText(() => fmt("impact_score")(NaN))).toBe("—");
      expect(cellText(() => fmt("impact_score")(Infinity))).toBe("—");
    });
  });

  describe("market_cap_b", () => {
    it.each([
      [185.3, "185.3B"],
      [0, "0.0B"],
      [10, "10.0B"],
    ])("mcap %s -> %s", (v, exp) => expect(cellText(() => fmt("market_cap_b")(v))).toBe(exp));
    it("null/undefined -> 0.0B", () => {
      expect(cellText(() => fmt("market_cap_b")(null))).toBe("0.0B");
      expect(cellText(() => fmt("market_cap_b")(undefined))).toBe("0.0B");
    });
    it("NaN -> 0.0B without throwing", () =>
      expect(() => cellText(() => fmt("market_cap_b")(NaN))).not.toThrow());
  });

  describe("day_change", () => {
    it("positive green negative red zero green", () => {
      expect(cellOf(() => fmt("day_change")(1.5)).tone).toBe("success");
      expect(cellOf(() => fmt("day_change")(-2)).tone).toBe("error");
      expect(cellOf(() => fmt("day_change")(0)).tone).toBe("success");
    });
  });

  describe("volume_m", () => {
    it("formats and null fallback", () => {
      expect(cellText(() => fmt("volume_m")(5))).toBe("5.00");
      expect(cellText(() => fmt("volume_m")(null))).toBe("0.00");
      expect(() => cellText(() => fmt("volume_m")(NaN))).not.toThrow();
    });
  });

  it("all sortable", () => getNiftyMoversColumns().forEach((c) => expect(c.sortable).toBe(true)));
});
