import { describe, expect, test } from "bun:test";
import { detectAddedSymbols, getTradingList } from "./runtime_utils";

describe("runtime utils", () => {
  test("detectAddedSymbols finds new symbols only when context unchanged", () => {
    const prev = {
      provider: "upstox",
      mode: "historical",
      screener: "market_open_gap",
      approaching: [{ symbol: "A" }, { symbol: "B" }],
      touched: [{ symbol: "X" }],
    };
    const next = {
      provider: "upstox",
      mode: "historical",
      screener: "market_open_gap",
      approaching: [{ symbol: "A" }, { symbol: "B" }, { symbol: "C" }],
      touched: [{ symbol: "X" }, { symbol: "Y" }],
    };
    const diff = detectAddedSymbols(prev, next);
    expect(diff.addedPrimary).toEqual(["C"]);
    expect(diff.addedSecondary).toEqual(["Y"]);
  });

  test("detectAddedSymbols ignores changes when screener/provider/mode differ", () => {
    const prev = {
      provider: "upstox",
      mode: "historical",
      screener: "gap",
      approaching: [{ symbol: "A" }],
      touched: [],
    };
    const next = {
      provider: "indmoney",
      mode: "historical",
      screener: "gap",
      approaching: [{ symbol: "A" }, { symbol: "B" }],
      touched: [],
    };
    const diff = detectAddedSymbols(prev, next);
    expect(diff.addedPrimary).toEqual([]);
    expect(diff.addedSecondary).toEqual([]);
  });

  test("getTradingList deduplicates symbols preserving first-seen order", () => {
    const list = getTradingList([{ symbol: "ABC" }, { symbol: "XYZ" }, { symbol: "ABC" }]);
    expect(list).toBe("ABC,XYZ");
  });
});
