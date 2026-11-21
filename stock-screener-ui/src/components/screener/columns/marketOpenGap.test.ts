import { describe, it, expect } from "vitest";
import { getMarketOpenGapColumns } from "./marketOpenGap";
import { cellOf, cellText, fmtOf } from "./columnTestFixtures";

const fmt = (key: string) => fmtOf(getMarketOpenGapColumns, key);

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
      [2.5, "+2.50%", "success"],
      [-3.1, "-3.10%", "error"],
      [0, "+0.00%", "success"],
      [Infinity, "—", ""],
      [NaN, "—", ""],
    ])("gap %s -> %s tone %s", (v, ev, ec) => {
      const cell = cellOf(() => fmt("gap_pct")(v));
      expect(cell.text).toBe(ev);
      expect(cell.tone).toBe(ec);
    });
    it("numbers are mono tabular right aligned", () => {
      const cell = cellOf(() => fmt("gap_pct")(2.5));
      expect(cell.className).toContain("font-mono");
      expect(cell.className).toContain("tabular-nums");
      expect(cell.className).toContain("text-right");
    });
  });

  describe("premarket_change", () => {
    it.each([
      [1.5, "+1.50%", "success"],
      [-0.5, "-0.50%", "error"],
      [0, "+0.00%", "success"],
    ])("premarket %s -> %s %s", (v, ev, ec) => {
      const cell = cellOf(() => fmt("premarket_change")(v));
      expect(cell.text).toBe(ev);
      expect(cell.tone).toBe(ec);
    });
  });

  describe("day_change", () => {
    it("positive green negative red", () => {
      expect(cellOf(() => fmt("day_change")(3.45)).tone).toBe("success");
      expect(cellOf(() => fmt("day_change")(-2.1)).tone).toBe("error");
    });
    it("0 green", () => expect(cellOf(() => fmt("day_change")(0)).tone).toBe("success"));
  });

  describe("volume_m", () => {
    it("12.345 -> 12.35", () => {
      expect(cellText(() => fmt("volume_m")(12.345))).toBe("12.35");
    });
    it("null -> 0.00", () => {
      expect(cellText(() => fmt("volume_m")(null))).toBe("0.00");
    });
    it("undefined -> 0.00", () => expect(cellText(() => fmt("volume_m")(undefined))).toBe("0.00"));
    it("Infinity -> dash", () => expect(cellText(() => fmt("volume_m")(Infinity))).toBe("—"));
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
