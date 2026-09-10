import { describe, it, expect } from "vitest";
import { getTrendingColumns } from "./trending";

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
    ])("%s %s -> %s", (key, val, exp) => expect(fmt(key)(val)).toBe(exp));
    it("handles Infinity without throw", () => expect(() => fmt("tv_price")(Infinity)).not.toThrow());
  });

  describe("to_52w_high", () => {
    it.each([
      [-5.76, "-5.76%", "success"],
      [0.3, "+0.30%", ""],
      [0.51, "+0.51%", "error"],
      [0.5, "+0.50%", ""],
      [1.2, "+1.20%", "error"],
    ])("to_52w_high %s -> %s %s", (v, ev, ec) => {
      const r: any = fmt("to_52w_high")(v);
      expect(r.value).toBe(ev);
      expect(r.className).toBe(ec);
    });
    it("NaN handled", () => expect(() => fmt("to_52w_high")(NaN)).not.toThrow());
    it("Infinity handled", () => expect(() => fmt("to_52w_high")(Infinity)).not.toThrow());
  });

  describe("touched_52w", () => {
    it("false -> No", () => expect(fmt("touched_52w")(false, {})).toBe("No"));
    it("true -> Yes", () => expect(fmt("touched_52w")(true, {})).toBe("Yes"));
    it("true with last_touched -> element", () => {
      const iso = new Date(Date.now() - 86400000).toISOString();
      const r: any = fmt("touched_52w")(true, { last_touched: iso });
      expect(r).toBeDefined();
      expect(r.props).toBeDefined();
    });
  });

  describe("recent_return_5d / perf_w boundaries", () => {
    it.each([
      [8.5, "🚀"],
      [3, "🟢"],
      [-1, "🔴"],
      [0, "🔴"],
    ])("recent_return %s contains %s", (v, icon) => {
      const r: any = fmt("recent_return_5d")(v);
      expect(r.value).toContain(icon);
    });
    it.each([
      [2, "success"],
      [-1, "error"],
      [0, "error"],
    ])("perf_w %s -> %s", (v, ec) => expect((fmt("perf_w")(v) as any).className).toBe(ec));
  });

  describe("day_change", () => {
    it("+ green - red", () => {
      expect((fmt("day_change")(1) as any).className).toBe("success");
      expect((fmt("day_change")(-1) as any).className).toBe("error");
    });
    it("0 green", () => expect((fmt("day_change")(0) as any).className).toBe("success"));
  });

  it("handles NaN/0/empty volume edge via day_change not crash", () => {
    expect(() => fmt("day_change")(NaN)).not.toThrow();
    expect(() => fmt("day_change")(0)).not.toThrow();
  });
});
