// @vitest-environment node
import { describe, expect, test } from "vitest";
import {
  buildPayoffSeries,
  computeTradePayoffSeries,
  isOptionTrade,
  optionBreakeven,
  optionPayoffAt,
  parseOptionSymbol,
  resolveUnderlyingSymbol,
} from "./optionTradeUtils";
import { mockTrade } from "./testFixtures";

describe("parseOptionSymbol", () => {
  test("parses the spaced ISO format", () => {
    expect(parseOptionSymbol("NIFTY 2026-10-19 22900CE")).toEqual({
      underlying: "NIFTY",
      expiry: "2026-10-19",
      strike: 22900,
      optionType: "CE",
    });
  });

  test("parses the compact monthly format", () => {
    expect(parseOptionSymbol("NIFTY26OCT23000PE")).toEqual({
      underlying: "NIFTY",
      expiry: "2026-10",
      strike: 23000,
      optionType: "PE",
    });
  });

  test("parses a stock monthly option", () => {
    expect(parseOptionSymbol("RELIANCE26OCT3000CE")).toEqual({
      underlying: "RELIANCE",
      expiry: "2026-10",
      strike: 3000,
      optionType: "CE",
    });
  });

  test("parses the compact weekly format", () => {
    expect(parseOptionSymbol("NIFTY25O0924000CE")).toEqual({
      underlying: "NIFTY",
      strike: 24000,
      optionType: "CE",
    });
  });

  test("returns null for plain equity symbols", () => {
    expect(parseOptionSymbol("RELIANCE")).toBeNull();
    expect(parseOptionSymbol("NIFTY")).toBeNull();
  });

  test("returns null for empty/garbage input", () => {
    expect(parseOptionSymbol("")).toBeNull();
    expect(parseOptionSymbol("   ")).toBeNull();
    expect(parseOptionSymbol("2026-10-19 22900CE")).toBeNull();
    expect(parseOptionSymbol("NIFTY 22900CE")).toBeNull();
    expect(parseOptionSymbol("NIFTY26OCTXYZPE")).toBeNull();
  });
});

describe("resolveUnderlyingSymbol", () => {
  test("maps spaced option symbol to underlying", () => {
    expect(resolveUnderlyingSymbol("NIFTY 2026-10-19 22900CE")).toBe("NIFTY");
  });

  test("maps compact option symbol to underlying", () => {
    expect(resolveUnderlyingSymbol("NIFTY26OCT23000PE")).toBe("NIFTY");
  });

  test("maps stock option symbol to underlying", () => {
    expect(resolveUnderlyingSymbol("RELIANCE26OCT3000CE")).toBe("RELIANCE");
  });

  test("leaves plain equity symbols unchanged", () => {
    expect(resolveUnderlyingSymbol("RELIANCE")).toBe("RELIANCE");
  });

  test("never returns spaces (safe for chart URLs)", () => {
    expect(resolveUnderlyingSymbol("NIFTY 2026-10-19 22900CE")).not.toContain(" ");
    expect(resolveUnderlyingSymbol("  RELIANCE  ")).toBe("RELIANCE");
  });

  test("returns empty string for empty input", () => {
    expect(resolveUnderlyingSymbol("")).toBe("");
  });
});

describe("isOptionTrade", () => {
  test("options_paper* sources are option trades", () => {
    expect(isOptionTrade({ symbol: "RELIANCE", source: "options_paper" })).toBe(true);
    expect(isOptionTrade({ symbol: "NIFTY", source: "options_paper_nifty" })).toBe(true);
  });

  test("non-options_paper sources are equity", () => {
    expect(isOptionTrade({ symbol: "RELIANCE", source: "equity_paper" })).toBe(false);
    expect(isOptionTrade({ symbol: "TCS", source: "" })).toBe(false);
  });

  test("falls back to symbol parsing when source is missing", () => {
    expect(isOptionTrade({ symbol: "NIFTY26OCT23000PE", source: undefined })).toBe(true);
    expect(isOptionTrade({ symbol: "NIFTY 2026-10-19 22900CE" })).toBe(true);
    expect(isOptionTrade({ symbol: "RELIANCE", source: undefined })).toBe(false);
  });
});

describe("optionPayoffAt", () => {
  const longCE = { optionType: "CE" as const, strike: 100, side: "BUY", premium: 5, qty: 1 };
  const longPE = { optionType: "PE" as const, strike: 100, side: "BUY", premium: 5, qty: 1 };

  test("long CE: (max(S-K,0)-prem)*qty", () => {
    expect(optionPayoffAt(longCE, 110)).toBe(5); // (10-5)*1
    expect(optionPayoffAt(longCE, 105)).toBe(0); // (5-5)*1
    expect(optionPayoffAt(longCE, 90)).toBe(-5); // (0-5)*1
  });

  test("long PE: (max(K-S,0)-prem)*qty", () => {
    expect(optionPayoffAt(longPE, 90)).toBe(5); // (10-5)*1
    expect(optionPayoffAt(longPE, 95)).toBe(0); // (5-5)*1
    expect(optionPayoffAt(longPE, 110)).toBe(-5); // (0-5)*1
  });

  test("short negates the long payoff", () => {
    const shortCE = { ...longCE, side: "SELL", qty: 2 };
    expect(optionPayoffAt(shortCE, 110)).toBe(-10); // -((10-5)*2)
    expect(optionPayoffAt(shortCE, 90)).toBe(10); // -((0-5)*2)
  });

  test("qty scales the payoff", () => {
    expect(optionPayoffAt({ ...longCE, qty: 75 }, 110)).toBe(375);
  });
});

describe("buildPayoffSeries", () => {
  test("default grid: strike ±3% in 50-point steps, step-aligned", () => {
    const series = buildPayoffSeries({
      optionType: "CE",
      strike: 22900,
      side: "BUY",
      premium: 120.5,
      qty: 75,
    });
    // lo = 22213 -> first 50-multiple is 22250; hi = 23587 -> last is 23550
    expect(series[0].underlying).toBe(22250);
    expect(series[series.length - 1].underlying).toBe(23550);
    expect(series.length).toBe(27);
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i].underlying - series[i - 1].underlying).toBe(50);
    }
  });

  test("long CE math across the grid", () => {
    const series = buildPayoffSeries({
      optionType: "CE",
      strike: 100,
      side: "BUY",
      premium: 5,
      qty: 2,
      step: 5,
      pctRange: 10,
    });
    const at = (s: number) => series.find((p) => p.underlying === s)!.pnl;
    expect(at(90)).toBe(-10); // (0-5)*2
    expect(at(105)).toBe(0); // (5-5)*2
    expect(at(110)).toBe(10); // (10-5)*2
  });

  test("long PE math across the grid", () => {
    const series = buildPayoffSeries({
      optionType: "PE",
      strike: 100,
      side: "BUY",
      premium: 5,
      qty: 1,
      step: 5,
      pctRange: 10,
    });
    const at = (s: number) => series.find((p) => p.underlying === s)!.pnl;
    expect(at(90)).toBe(5); // (10-5)*1
    expect(at(95)).toBe(0); // (5-5)*1
    expect(at(110)).toBe(-5); // (0-5)*1
  });

  test("short side negates the series", () => {
    const long = buildPayoffSeries({
      optionType: "CE",
      strike: 100,
      side: "BUY",
      premium: 5,
      qty: 1,
      step: 5,
      pctRange: 10,
    });
    const short = buildPayoffSeries({
      optionType: "CE",
      strike: 100,
      side: "SELL",
      premium: 5,
      qty: 1,
      step: 5,
      pctRange: 10,
    });
    short.forEach((p, i) => expect(p.pnl).toBe(-long[i].pnl));
  });

  test("falls back to a uniform grid when the range is narrower than one step", () => {
    const series = buildPayoffSeries({
      optionType: "CE",
      strike: 50,
      side: "BUY",
      premium: 1,
      qty: 1,
    });
    expect(series.length).toBe(21);
    expect(series[0].underlying).toBeCloseTo(48.5, 6);
    expect(series[series.length - 1].underlying).toBeCloseTo(51.5, 6);
  });

  test("returns [] for invalid inputs", () => {
    expect(buildPayoffSeries({ optionType: "CE", strike: 0, side: "BUY", premium: 5, qty: 1 })).toEqual([]);
    expect(
      buildPayoffSeries({ optionType: "CE", strike: 100, side: "BUY", premium: NaN, qty: 1 }),
    ).toEqual([]);
  });
});

describe("optionBreakeven", () => {
  test("CE breakeven is strike + premium", () => {
    expect(optionBreakeven("CE", 22900, 120.5)).toBe(23020.5);
  });

  test("PE breakeven is strike - premium", () => {
    expect(optionBreakeven("PE", 23000, 130)).toBe(22870);
  });

  test("returns null for invalid strike", () => {
    expect(optionBreakeven("CE", 0, 10)).toBeNull();
  });
});

describe("computeTradePayoffSeries", () => {
  test("builds a series from an option trade", () => {
    const trade = mockTrade({
      symbol: "NIFTY 2026-10-19 22900CE",
      side: "BUY",
      quantity: 75,
      entry_price: 120.5,
      source: "options_paper",
    });
    const series = computeTradePayoffSeries(trade);
    expect(series).not.toBeNull();
    expect(series!.length).toBe(27);
    const at = (s: number) => series!.find((p) => p.underlying === s)!.pnl;
    // (23000 - 22900 - 120.5) * 75
    expect(at(23000)).toBeCloseTo(-1537.5, 6);
    // (23500 - 22900 - 120.5) * 75
    expect(at(23500)).toBeCloseTo(35962.5, 6);
  });

  test("returns null for an equity trade", () => {
    expect(computeTradePayoffSeries(mockTrade())).toBeNull();
  });
});
