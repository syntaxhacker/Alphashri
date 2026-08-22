import { describe, it, expect } from "vitest";
import { getMarketOpenGapColumns } from "./marketOpenGap";

function fmt(key: string) {
  const c = getMarketOpenGapColumns().find((x) => x.key === key);
  if (!c?.format) throw new Error(key);
  return c.format as any;
}

describe("marketOpenGap columns", () => {
  it("7 columns", () => expect(getMarketOpenGapColumns().length).toBe(7));
  it("symbol score sector positions", () => {
    const cols = getMarketOpenGapColumns();
    expect(cols[0].key).toBe("symbol");
    expect(cols[1].key).toBe("score");
    expect(cols[cols.length - 1].key).toBe("sector");
  });

  describe("gap_pct", () => {
    it.each([
      [2.5, "+2.50%", "green"],
      [-3.1, "-3.10%", "red"],
      [0, "+0.00%", "green"],
      [NaN, "NaN%", "red"],
      [Infinity, "+Infinity%", "green"],
    ])("gap %s -> %s %s", (v, ev, ec) => {
      const r: any = fmt("gap_pct")(v);
      expect(r.value).toBe(ev);
      expect(r.className).toBe(ec);
    });
  });

  describe("premarket_change", () => {
    it.each([
      [1.5, "+1.50%", "green"],
      [-0.5, "-0.50%", "red"],
      [0, "+0.00%", "green"],
    ])("premarket %s -> %s %s", (v, ev, ec) => {
      const r: any = fmt("premarket_change")(v);
      expect(r.value).toBe(ev);
      expect(r.className).toBe(ec);
    });
  });

  describe("day_change", () => {
    it("positive green negative red", () => {
      expect((fmt("day_change")(3.45) as any).className).toBe("green");
      expect((fmt("day_change")(-2.1) as any).className).toBe("red");
    });
    it("0 green", () => expect((fmt("day_change")(0) as any).className).toBe("green"));
  });

  describe("volume_m", () => {
    it("12.345 -> 12.35", () => expect(fmt("volume_m")(12.345)).toBe("12.35"));
    it("null -> 0.00", () => expect(fmt("volume_m")(null)).toBe("0.00"));
    it("undefined -> 0.00", () => expect(fmt("volume_m")(undefined)).toBe("0.00"));
    it("Infinity not throw", () => expect(() => fmt("volume_m")(Infinity)).not.toThrow());
  });

  it("all sortable", () => getMarketOpenGapColumns().forEach((c) => expect(c.sortable).toBe(true)));

  describe("gap % table-driven typical stock", () => {
    const gapPct = (open: number, prevClose: number) => ((open - prevClose) / prevClose) * 100;
    it.each([
      [102, 100, 2.0],
      [98, 100, -2.0],
      [100, 100, 0],
      [0, 100, -100],
    ])("open %s prevClose %s gap %s", (open, prev, exp) => {
      expect(gapPct(open, prev)).toBeCloseTo(exp, 5);
    });
    it("handles prevClose 0 -> Infinity", () => expect(!isFinite(gapPct(100, 0))).toBe(true));
  });
});
