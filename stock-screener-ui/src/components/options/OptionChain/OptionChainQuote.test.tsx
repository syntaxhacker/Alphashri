import { describe, it, expect } from "vitest";
import { formatQuoteLine } from "./OptionChainTable";

describe("formatQuoteLine", () => {
  it("formats bid/ask prices with quantities", () => {
    expect(
      formatQuoteLine({
        ltp: 100, volume: 1000, oi: 5000,
        bid_price: 99, ask_price: 101, prev_oi: 4000,
        bid_qty: 1125, ask_qty: 2150,
      } as any),
    ).toBe("Bid: 99 x 1125 | Ask: 101 x 2150");
  });

  it("defaults missing quantities to 0 for old payloads", () => {
    expect(
      formatQuoteLine({
        ltp: 100, volume: 1000, oi: 5000,
        bid_price: 99, ask_price: 101, prev_oi: 4000,
      } as any),
    ).toBe("Bid: 99 x 0 | Ask: 101 x 0");
  });

  it("handles undefined market data", () => {
    expect(formatQuoteLine(undefined)).toBe("Bid: 0 x 0 | Ask: 0 x 0");
  });
});
