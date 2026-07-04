import { describe, expect, it } from "vitest";
import { parseTimeframeMinutes, calculateOrCandleCount } from "./timeframeUtils";

describe("timeframeUtils", () => {
  it("parses minute timeframes", () => {
    expect(parseTimeframeMinutes("1min")).toBe(1);
    expect(parseTimeframeMinutes("5min")).toBe(5);
    expect(parseTimeframeMinutes("15min")).toBe(15);
    expect(parseTimeframeMinutes("30min")).toBe(30);
  });

  it("parses hour timeframes", () => {
    expect(parseTimeframeMinutes("1hour")).toBe(60);
    expect(parseTimeframeMinutes("2hour")).toBe(120);
    expect(parseTimeframeMinutes("4hour")).toBe(240);
    expect(parseTimeframeMinutes("12hour")).toBe(720);
  });

  it("parses day timeframe", () => {
    expect(parseTimeframeMinutes("1day")).toBe(1440);
  });

  it("falls back to 5 for unknown", () => {
    expect(parseTimeframeMinutes("xyz")).toBe(5);
  });

  it("calculates OR candle counts", () => {
    expect(calculateOrCandleCount(45, 1)).toBe(45);   // 1min
    expect(calculateOrCandleCount(45, 5)).toBe(9);    // 5min
    expect(calculateOrCandleCount(45, 15)).toBe(3);   // 15min
    expect(calculateOrCandleCount(45, 30)).toBe(1);   // 30min
    expect(calculateOrCandleCount(45, 60)).toBe(1);   // 1hour
    expect(calculateOrCandleCount(0, 5)).toBe(1);     // edge: 0 OR minutes
    expect(calculateOrCandleCount(3, 5)).toBe(1);     // edge: < 1 candle
  });
});
