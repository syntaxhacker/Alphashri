import { describe, it, expect } from "vitest";
import { getRsiReversalColumns } from "./rsiReversal";

function fmt(key: string) {
  const c = getRsiReversalColumns().find((x) => x.key === key);
  if (!c?.format) throw new Error(key);
  return c.format as any;
}

describe("rsiReversal columns", () => {
  it("7 columns symbol first sector last", () => {
    const cols = getRsiReversalColumns();
    expect(cols.length).toBe(7);
    expect(cols[0].key).toBe("symbol");
    expect(cols[cols.length - 1].key).toBe("sector");
  });

  describe("rsi", () => {
    it.each([
      [65.3, "65.3"],
      [100, "100.0"],
      [0, "0.0"],
      [null, "0.0"],
      [undefined, "0.0"],
    ])("rsi %s -> %s", (v, exp) => expect(fmt("rsi")(v)).toBe(exp));
    it("NaN -> NaN", () => expect(fmt("rsi")(NaN)).toBe("NaN"));
    it("Infinity -> Infinity", () => expect(fmt("rsi")(Infinity)).toBe("Infinity"));
    it("handles negative", () => expect(fmt("rsi")(-5)).toBe("-5.0"));
  });

  describe("stoch_k", () => {
    it.each([
      [72.1, "72.1"],
      [0, "0.0"],
      [null, "0.0"],
      [undefined, "0.0"],
    ])("stoch_k %s -> %s", (v, exp) => expect(fmt("stoch_k")(v)).toBe(exp));
    it("NaN handling", () => expect(fmt("stoch_k")(NaN)).toBe("NaN"));
  });

  describe("day_change", () => {
    it.each([
      [1.25, "+1.25%", "green"],
      [-0.5, "-0.50%", "red"],
      [0, "+0.00%", "green"],
    ])("day_change %s -> %s %s", (v, ev, ec) => {
      const r: any = fmt("day_change")(v);
      expect(r.value).toBe(ev);
      expect(r.className).toBe(ec);
    });
  });

  describe("volume_m", () => {
    it("5.678 -> 5.68", () => expect(fmt("volume_m")(5.678)).toBe("5.68"));
    it("null -> 0.00", () => expect(fmt("volume_m")(null)).toBe("0.00"));
  });

  it("all sortable", () => getRsiReversalColumns().forEach((c) => expect(c.sortable).toBe(true)));

  describe("boundary RSI NaN, volume 0, price null edge", () => {
    it("rsi NaN does not throw and is displayable", () => expect(() => fmt("rsi")(NaN)).not.toThrow());
    it("stoch NaN -> NaN string", () => expect(fmt("stoch_k")(NaN)).toBe("NaN"));
    it("volume 0 -> 0.00", () => expect(fmt("volume_m")(0)).toBe("0.00"));
  });
});
