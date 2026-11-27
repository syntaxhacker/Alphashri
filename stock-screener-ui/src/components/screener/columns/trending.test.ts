import { describe, it, expect } from "vitest";
import { getTrendingColumns } from "./trending";
import { cellOf, cellText } from "./columnTestFixtures";

function fmt(key: string) {
  const col = getTrendingColumns().find((c) => c.key === key);
  if (!col?.format) throw new Error(key);
  return col.format as any;
}

describe("trending columns", () => {
  it("10 columns", () => expect(getTrendingColumns().length).toBe(10));
  it("symbol first sector last", () => {
    const cols = getTrendingColumns();
    expect(cols[0].key).toBe("symbol");
    expect(cols[cols.length - 1].key).toBe("sector");
  });

  describe("price columns", () => {
    it.each([
      ["tv_price", 2450.5, "₹2450.50"],
      ["upstox_price", 100, "₹100.00"],
      ["tv_price", 0, "₹0.00"],
    ])("%s %s -> %s", (key, val, exp) => expect(cellText(() => fmt(key)(val))).toBe(exp));
    it("handles Infinity without throw", () =>
      expect(() => cellText(() => fmt("tv_price")(Infinity))).not.toThrow());
  });

  describe("to_52w_high", () => {
    it.each([
      [-5.76, "-5.76%", "success"],
      [0.3, "+0.30%", ""],
      [0.51, "+0.51%", "error"],
      [0.5, "+0.50%", ""],
      [1.2, "+1.20%", "error"],
    ])("to_52w_high %s -> %s %s", (v, ev, ec) => {
      const cell = cellOf(() => fmt("to_52w_high")(v));
      expect(cell.text).toBe(ev);
      expect(cell.tone).toBe(ec);
    });
    it("NaN handled", () => expect(() => cellText(() => fmt("to_52w_high")(NaN))).not.toThrow());
    it("Infinity handled", () =>
      expect(() => cellText(() => fmt("to_52w_high")(Infinity))).not.toThrow());
  });

  describe("touched_52w", () => {
    it("false -> No", () => expect(cellText(() => fmt("touched_52w")(false, {}))).toBe("No"));
    it("true -> Yes", () => expect(cellText(() => fmt("touched_52w")(true, {}))).toBe("Yes"));
    it("true with last_touched -> badge with the age", () => {
      const iso = new Date(Date.now() - 86400000).toISOString();
      const cell = cellOf(() => fmt("touched_52w")(true, { last_touched: iso }));
      expect(cell.text).toContain("Yes");
      expect(cell.text).toContain("1d ago");
    });
  });

  describe("recent_return_5d / perf_w boundaries", () => {
    it.each([
      [8.5, "🚀"],
      [3, "🟢"],
      [-1, "🔴"],
      [0, "🔴"],
    ])("recent_return %s contains %s", (v, icon) => {
      expect(cellText(() => fmt("recent_return_5d")(v))).toContain(icon);
    });
    it.each([
      [2, "success"],
      [-1, "error"],
      [0, "error"],
    ])("perf_w %s -> %s", (v, ec) => expect(cellOf(() => fmt("perf_w")(v)).tone).toBe(ec));
  });

  describe("day_change", () => {
    it("+ green - red", () => {
      expect(cellOf(() => fmt("day_change")(1)).tone).toBe("success");
      expect(cellOf(() => fmt("day_change")(-1)).tone).toBe("error");
    });
    it("0 green", () => expect(cellOf(() => fmt("day_change")(0)).tone).toBe("success"));
  });

  it("handles NaN/0/empty volume edge via day_change not crash", () => {
    expect(() => cellText(() => fmt("day_change")(NaN))).not.toThrow();
  });
});
