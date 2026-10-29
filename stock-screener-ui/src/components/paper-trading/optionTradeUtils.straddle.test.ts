import { describe, expect, it } from "vitest";
import {
  buildPayoffSeries,
  computeTradePayoffSeries,
  isOptionTrade,
  optionBreakeven,
  parseOptionSymbol,
  resolveUnderlyingSymbol,
} from "./optionTradeUtils";

const STRADDLE = "NIFTY 2026-10-19 22850STRADDLE";

describe("structured option symbols (STRADDLE)", () => {
  it("parses a straddle and resolves the chartable underlying", () => {
    const c = parseOptionSymbol(STRADDLE);
    expect(c).not.toBeNull();
    expect(c?.underlying).toBe("NIFTY");
    expect(c?.optionType).toBe("STRADDLE");
    expect(c?.strike).toBe(22850);
    expect(c?.expiry).toBe("2026-10-19");
    expect(resolveUnderlyingSymbol(STRADDLE)).toBe("NIFTY");
    expect(resolveUnderlyingSymbol(STRADDLE)).not.toContain(" ");
  });

  it("classifies a straddle as an option trade", () => {
    expect(isOptionTrade({ symbol: STRADDLE, source: "options_paper_agent" })).toBe(true);
    expect(isOptionTrade({ symbol: STRADDLE })).toBe(true);
  });

  it("prices a long straddle: worst at the strike, wins at the wings", () => {
    const series = buildPayoffSeries({
      optionType: "STRADDLE",
      strike: 22850,
      side: "BUY",
      premium: 74.2,
      qty: 65,
    });
    const atStrike = series.find((p) => p.underlying === 22850);
    expect(atStrike?.pnl).toBeCloseTo(-74.2 * 65, 0);
    const left = series[0];
    const right = series[series.length - 1];
    expect(left.pnl).toBeGreaterThan(atStrike!.pnl);
    expect(right.pnl).toBeGreaterThan(atStrike!.pnl);
  });

  it("flips the straddle payoff for a SELL", () => {
    const long = buildPayoffSeries({
      optionType: "STRADDLE", strike: 22850, side: "BUY", premium: 74.2, qty: 65,
    });
    const short = buildPayoffSeries({
      optionType: "STRADDLE", strike: 22850, side: "SELL", premium: 74.2, qty: 65,
    });
    expect(short[0].pnl).toBeCloseTo(-long[0].pnl, 6);
  });

  it("does not invent a single breakeven for a straddle", () => {
    expect(optionBreakeven("STRADDLE", 22850, 74.2)).toBeNull();
  });

  it("computes a straddle series from a trade row", () => {
    const s = computeTradePayoffSeries({
      symbol: STRADDLE, side: "BUY", quantity: 65, entry_price: 74.2,
    });
    expect(s).not.toBeNull();
    expect(s!.length).toBeGreaterThan(10);
  });

  it("still returns null for a plain equity symbol", () => {
    expect(computeTradePayoffSeries({
      symbol: "KARURVYSYA", side: "BUY", quantity: 10, entry_price: 200,
    })).toBeNull();
  });
});
