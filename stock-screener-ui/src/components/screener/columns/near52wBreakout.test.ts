import { describe, it, expect } from "vitest";
import { getNear52wBreakoutColumns } from "./near52wBreakout";

function fmt(key: string) {
  const cols = getNear52wBreakoutColumns();
  const c = cols.find((x) => x.key === key);
  if (!c?.format) throw new Error(key);
  return c.format as any;
}

describe("near52wBreakout columns", () => {
  it("returns 9 columns symbol first sector last", () => {
    const cols = getNear52wBreakoutColumns();
    expect(cols.length).toBe(9);
    expect(cols[0].key).toBe("symbol");
    expect(cols[cols.length - 1].key).toBe("sector");
  });

  describe("to_52w_high gap %", () => {
    const f = () => fmt("to_52w_high");
    it.each([
      [-2, "-2.00%", "green"],
      [0, "0.00%", ""],
      [1.5, "+1.50%", ""],
      [2.01, "+2.01%", "red"],
      [5, "+5.00%", "red"],
    ])("val %s -> %s %s", (v, ev, ec) => {
      const r: any = f()(v);
      expect(r.value).toBe(ev);
      expect(r.className).toBe(ec);
    });
    it("handles NaN/Infinity", () => {
      expect(() => f()(NaN)).not.toThrow();
      expect(() => f()(Infinity)).not.toThrow();
      expect(() => f()(0)).not.toThrow();
    });
    it("boundary 2 exactly -> no red", () => {
      const r: any = f()(2);
      expect(r.className).toBe("");
    });
  });

  describe("rsi/adx formatting", () => {
    it("rsi 65.3 -> 65.3", () => expect(fmt("rsi")(65.3)).toBe("65.3"));
    it("adx 30 -> 30.0", () => expect(fmt("adx")(30)).toBe("30.0"));
    it("rsi null -> 0.0", () => expect(fmt("rsi")(null)).toBe("0.0"));
    it("adx undefined -> 0.0", () => expect(fmt("adx")(undefined)).toBe("0.0"));
    it("handles NaN", () => expect(() => fmt("rsi")(NaN)).not.toThrow());
  });

  describe("day_change", () => {
    it.each([
      [2.5, "+2.50%", "green"],
      [-1, "-1.00%", "red"],
    ])("day_change %s", (v, ev, ec) => {
      const r: any = fmt("day_change")(v);
      expect(r.value).toBe(ev);
      expect(r.className).toBe(ec);
    });
  });

  describe("recent_return_5d / perf_w", () => {
    it("rocket >5", () => {
      const r: any = fmt("recent_return_5d")(8);
      expect(r.value).toContain("🚀");
    });
    it("perf_w green/red", () => {
      expect((fmt("perf_w")(2) as any).className).toBe("green");
      expect((fmt("perf_w")(-1) as any).className).toBe("red");
    });
  });

  it("all sortable", () => getNear52wBreakoutColumns().forEach((c) => expect(c.sortable).toBe(true)));
});
