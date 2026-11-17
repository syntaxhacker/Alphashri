import { describe, expect, it } from "vitest";
import type { ValueRow } from "../../api/valueScan";
import {
  VALUE_NA,
  formatValueMcap,
  formatValueMedian,
  formatValueNum,
  formatValuePct,
  formatValuePrice,
} from "./valueFormat";

function row(overrides: Partial<ValueRow> = {}): ValueRow {
  return {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    exchange: "NSE",
    currency: "INR",
    price: 2450.5,
    mcap_bn: 331.0,
    ...overrides,
  } as ValueRow;
}

describe("formatValuePrice", () => {
  it("prefixes an INR row with ₹ and keeps en-US grouping", () => {
    expect(formatValuePrice(row())).toBe("₹2,450.50");
  });

  it("prefixes a USD row with $", () => {
    expect(formatValuePrice(row({ currency: "USD" }))).toBe("$2,450.50");
  });

  it("falls back to INR for an unrecognised or missing row currency", () => {
    expect(formatValuePrice(row({ currency: "GBP" }))).toBe("₹2,450.50");
    expect(formatValuePrice(row({ currency: "" }))).toBe("₹2,450.50");
  });
});

describe("formatValueMcap", () => {
  it("reads the prefix from the row's currency and keeps the B suffix", () => {
    expect(formatValueMcap(row())).toBe("₹331.0B");
    expect(formatValueMcap(row({ currency: "USD" }))).toBe("$331.0B");
    expect(formatValueMcap(row({ currency: null as unknown as string }))).toBe("₹331.0B");
  });
});

describe("value number helpers", () => {
  it("signs percentages and honours the caller's dash", () => {
    expect(formatValuePct(1.25)).toBe("+1.3%");
    expect(formatValuePct(-0.8)).toBe("-0.8%");
    expect(formatValuePct(null)).toBe("–");
    expect(formatValuePct(undefined, 1, VALUE_NA)).toBe("n/a");
  });

  it("formats fixed decimals and medians with their glyphs", () => {
    expect(formatValueNum(12.34)).toBe("12.3");
    expect(formatValueNum(null)).toBe("–");
    expect(formatValueMedian(11.25, "x")).toBe("11.3x");
    expect(formatValueMedian(undefined, "", 1, VALUE_NA)).toBe("n/a");
  });
});
