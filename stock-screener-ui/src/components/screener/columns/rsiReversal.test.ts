import { describe, it, expect } from "vitest";
import { getRsiReversalColumns } from "./rsiReversal";
import { fmtOf, expectSymbolFirstSectorLast, expectPctClass } from "./columnTestFixtures";

const fmt = (key: string) => fmtOf(getRsiReversalColumns, key);

describe("rsiReversal columns", () => {
  it("7 columns symbol first sector last", () => {
    expectSymbolFirstSectorLast(getRsiReversalColumns(), 7);
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
      [1.25, "+1.25%", "success"],
      [-0.5, "-0.50%", "error"],
      [0, "+0.00%", "success"],
    ])("day_change %s -> %s %s", (v, ev, ec) => expectPctClass(fmt("day_change")(v), ev, ec));
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
