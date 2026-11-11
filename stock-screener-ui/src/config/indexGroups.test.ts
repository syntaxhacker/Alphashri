import { describe, expect, test } from "vitest";
import { filterByIndexGroup, hasIndexMembers, indexGroupOf } from "./indexGroups";

describe("index groups", () => {
  test("classifies broad indices as big", () => {
    for (const symbol of [
      "NIFTY",
      "BANKNIFTY",
      "FINNIFTY",
      "MIDCPNIFTY",
      "NIFTYNXT50",
      "NIFTY100",
      "NIFTY200",
      "NIFTY500",
      "SENSEX",
      "BANKEX",
    ]) {
      expect(indexGroupOf(symbol)).toBe("big");
    }
  });

  test("classifies sectoral and thematic indices as others", () => {
    expect(indexGroupOf("NIFTYIT")).toBe("others");
    expect(indexGroupOf("NIFTYAUTO")).toBe("others");
    expect(indexGroupOf("NIFTYDEFENCE")).toBe("others");
    expect(indexGroupOf("INDIAVIX")).toBe("others");
  });

  test("offers members for every stock index except India VIX", () => {
    for (const symbol of [
      "NIFTY",
      "BANKNIFTY",
      "NIFTYIT",
      "NIFTYCEMENT",
      "NIFTYINTERNET",
      "SENSEX",
      "BANKEX",
    ]) {
      expect(hasIndexMembers(symbol)).toBe(true);
    }
    expect(hasIndexMembers("INDIAVIX")).toBe(false);
    expect(hasIndexMembers("RELIANCE")).toBe(false);
  });

  test("filters rows by group", () => {
    const rows = [{ symbol: "NIFTY" }, { symbol: "NIFTYIT" }, { symbol: "SENSEX" }];
    expect(filterByIndexGroup(rows, "all")).toBe(rows);
    expect(filterByIndexGroup(rows, "big").map((row) => row.symbol)).toEqual([
      "NIFTY",
      "SENSEX",
    ]);
    expect(filterByIndexGroup(rows, "others").map((row) => row.symbol)).toEqual(["NIFTYIT"]);
  });
});
