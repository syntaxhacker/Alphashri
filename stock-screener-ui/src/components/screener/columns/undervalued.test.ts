import { describe, it, expect } from "vitest";
import { getUndervaluedColumns } from "./undervalued";

function fmt(key: string) {
  const c = getUndervaluedColumns().find((x) => x.key === key);
  if (!c?.format) throw new Error(key);
  return c.format as any;
}

describe("undervalued columns", () => {
  it("11 columns symbol first sector last", () => {
    const cols = getUndervaluedColumns();
    expect(cols.length).toBe(11);
    expect(cols[0].key).toBe("symbol");
    expect(cols[cols.length - 1].key).toBe("sector");
  });

  describe("tv_price", () => {
    it.each([
      [100, "₹100.00"],
      [0, "₹0.00"],
      [null, "₹0.00"],
      [undefined, "₹0.00"],
    ])("tv_price %s -> %s", (v, exp) => expect(fmt("tv_price")(v)).toBe(exp));
    it("NaN -> ₹NaN? fallback 0", () => expect(() => fmt("tv_price")(NaN)).not.toThrow());
  });

  describe("pe/pb/roe/de", () => {
    it("pe 12.345 -> 12.3", () => expect(fmt("pe")(12.345)).toBe("12.3"));
    it("pb 1.234 -> 1.23", () => expect(fmt("pb")(1.234)).toBe("1.23"));
    it("roe 15.567 -> 15.6%", () => expect(fmt("roe")(15.567)).toBe("15.6%"));
    it("de 0.456 -> 0.46", () => expect(fmt("de")(0.456)).toBe("0.46"));
    it.each([
      ["pe", "0.0"],
      ["pb", "0.00"],
      ["roe", "0.0%"],
      ["de", "0.00"],
    ])("null fallback for %s -> %s", (key, exp) => {
      expect(() => fmt(key)(null)).not.toThrow();
      expect(fmt(key)(null)).toBe(exp);
    });
    it("handles Infinity", () => expect(() => fmt("pe")(Infinity)).not.toThrow());
  });

  describe("div_yield", () => {
    it("2.5 -> 2.5%", () => expect(fmt("div_yield")(2.5)).toBe("2.5%"));
    it("0 -> empty string", () => expect(fmt("div_yield")(0)).toBe(""));
    it("null -> empty", () => expect(fmt("div_yield")(null)).toBe(""));
    it("undefined -> empty", () => expect(fmt("div_yield")(undefined)).toBe(""));
    it("negative -> empty (falsy >0 check)", () => expect(fmt("div_yield")(-1)).toBe(""));
  });

  describe("market_cap_b", () => {
    it("185.3 -> ₹185.3B", () => expect(fmt("market_cap_b")(185.3)).toBe("₹185.3B"));
    it("0 -> ₹0.0B", () => expect(fmt("market_cap_b")(0)).toBe("₹0.0B"));
    it("null -> ₹0.0B", () => expect(fmt("market_cap_b")(null)).toBe("₹0.0B"));
  });

  describe("day_change", () => {
    it("green/red", () => {
      expect((fmt("day_change")(2) as any).className).toBe("green");
      expect((fmt("day_change")(-2) as any).className).toBe("red");
    });
  });

  it("all sortable", () => getUndervaluedColumns().forEach((c) => expect(c.sortable).toBe(true)));

  describe("edge: empty array stock handling not needed but ensure columns defined", () => {
    it("columns cover valuation metrics", () => {
      const keys = getUndervaluedColumns().map((c) => c.key);
      expect(keys).toEqual(expect.arrayContaining(["pe","pb","roe","de","div_yield","market_cap_b"]));
    });
  });
});
