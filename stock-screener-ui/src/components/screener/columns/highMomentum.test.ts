import { describe, it, expect } from "vitest";
import { getHighMomentumColumns } from "./highMomentum";

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
    it("78.9 -> 78.9", () => expect(fmt("rsi")(78.9)).toBe("78.9"));
    it("null -> 0.0", () => expect(fmt("rsi")(null)).toBe("0.0"));
    it("NaN -> NaN", () => expect(fmt("rsi")(NaN)).toBe("NaN"));
    it("Infinity not throw", () => expect(() => fmt("rsi")(Infinity)).not.toThrow());
  });

  describe("day_change", () => {
    it("0 green", () => expect((fmt("day_change")(0) as any).className).toBe("success"));
    it("-1 red", () => expect((fmt("day_change")(-1) as any).className).toBe("error"));
  });

  describe("recent_return_5d", () => {
    it.each([
      [6.0, "🚀", "success"],
      [3.0, "🟢", "success"],
      [-4.5, "🔴", "error"],
      [0, "🔴", "error"],
    ])("return %s -> %s %s", (v, icon, ec) => {
      const r: any = fmt("recent_return_5d")(v);
      expect(r.value).toContain(icon);
      expect(r.className).toBe(ec);
    });
  });

  describe("perf_w", () => {
    it.each([
      [2.1, "success"],
      [-1.0, "error"],
      [0, "error"],
    ])("perf %s -> %s", (v, ec) => expect((fmt("perf_w")(v) as any).className).toBe(ec));
  });

  describe("volume_m", () => {
    it("null -> 0.00", () => expect(fmt("volume_m")(null)).toBe("0.00"));
    it("0 -> 0.00", () => expect(fmt("volume_m")(0)).toBe("0.00"));
  });

  it("all sortable", () => getHighMomentumColumns().forEach((c) => expect(c.sortable).toBe(true)));

  describe("edge: volume 0, price 0/NaN", () => {
    it("volume 0 displays", () => expect(fmt("volume_m")(0)).toBe("0.00"));
    it("rsi 0 displays 0.0", () => expect(fmt("rsi")(0)).toBe("0.0"));
  });
});
