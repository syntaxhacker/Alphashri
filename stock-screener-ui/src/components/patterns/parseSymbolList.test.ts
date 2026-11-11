import { describe, expect, it } from "vitest";
import { parseSymbolList } from "./parseSymbolList";

describe("parseSymbolList", () => {
  it("splits on commas, newlines, spaces and semicolons", () => {
    expect(parseSymbolList("ASIANPAINT, CIPLA\nLT;NTPC  ITC")).toEqual([
      "ASIANPAINT",
      "CIPLA",
      "LT",
      "NTPC",
      "ITC",
    ]);
  });

  it("uppercases and trims", () => {
    expect(parseSymbolList("  reliance , hdfcbank ")).toEqual(["RELIANCE", "HDFCBANK"]);
  });

  it("de-duplicates while preserving first occurrence", () => {
    expect(parseSymbolList("LT, CIPLA, lt, CIPLA")).toEqual(["LT", "CIPLA"]);
  });

  it("drops empty tokens", () => {
    expect(parseSymbolList(",,  ,\n\n,")).toEqual([]);
  });

  it("handles the CSV watchlist line", () => {
    const line =
      "ASIANPAINT,CIPLA,GODREJPROP,HINDZINC,ITC,LT,NTPC,BANKBARODA,POWERGRID,LUPIN,YESBANK,BDL";
    expect(parseSymbolList(line)).toHaveLength(12);
  });
});
