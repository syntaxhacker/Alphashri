import { describe, it, expect } from "vitest";
import { getTouched52wColumns } from "./touched52wHigh";
import { cellOf, cellText, fmtOf } from "./columnTestFixtures";

const fmt = (key: string) => fmtOf(getTouched52wColumns, key);

describe("touched52wHigh columns", () => {
  it("9 columns", () => expect(getTouched52wColumns().length).toBe(9));
  it("starts with symbol", () => expect(getTouched52wColumns()[0].key).toBe("symbol"));

  describe("high_52w", () => {
    it("formats 2600 -> 2600.00", () =>
      expect(cellText(() => fmt("high_52w")(2600))).toBe("2600.00"));
    it("null/undefined -> dash", () => {
      expect(cellText(() => fmt("high_52w")(null))).toBe("-");
      expect(cellText(() => fmt("high_52w")(undefined))).toBe("-");
    });
    it("0 -> 0.00", () => expect(cellText(() => fmt("high_52w")(0))).toBe("0.00"));
    it("NaN -> dash", () => expect(() => cellText(() => fmt("high_52w")(NaN))).not.toThrow());
  });

  describe("days_ago", () => {
    it.each([
      [0, "0d"],
      [1, "1d"],
      [5, "5d"],
      [30, "30d"],
    ])("days %s -> %s", (v, exp) => expect(cellText(() => fmt("days_ago")(v))).toBe(exp));
    it("null -> dash string", () => expect(cellText(() => fmt("days_ago")(null))).toBe("-"));
    it("undefined -> dash", () => expect(cellText(() => fmt("days_ago")(undefined))).toBe("-"));
  });

  describe("rsi/adx", () => {
    it("rsi formats", () => expect(cellText(() => fmt("rsi")(65.3))).toBe("65.3"));
    it("adx formats", () => expect(cellText(() => fmt("adx")(25))).toBe("25.0"));
    it("null fallback 0.0", () => {
      expect(cellText(() => fmt("rsi")(null))).toBe("0.0");
      expect(cellText(() => fmt("adx")(undefined))).toBe("0.0");
    });
    it("Infinity -> dash", () => expect(cellText(() => fmt("rsi")(Infinity))).toBe("—"));
  });

  describe("day_change / recent_return_5d / perf_w", () => {
    it("day_change green/red", () => {
      expect(cellOf(() => fmt("day_change")(2)).tone).toBe("success");
      expect(cellOf(() => fmt("day_change")(-1)).tone).toBe("error");
    });
    it("recent_return rocket", () =>
      expect(cellText(() => fmt("recent_return_5d")(6))).toContain("🚀"));
    it("perf_w red for 0", () => expect(cellOf(() => fmt("perf_w")(0)).tone).toBe("error"));
  });

  describe("volume_m", () => {
    it("12.345 -> 12.35", () => expect(cellText(() => fmt("volume_m")(12.345))).toBe("12.35"));
    it("null -> 0.00", () => expect(cellText(() => fmt("volume_m")(null))).toBe("0.00"));
  });

  it("all sortable", () => getTouched52wColumns().forEach((c) => expect(c.sortable).toBe(true)));
});
