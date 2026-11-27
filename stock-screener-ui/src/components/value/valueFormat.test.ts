import { describe, expect, it } from "vitest";
import type { ValueRow } from "../../api/valueScan";
import {
  VALUE_NA,
  formatValueMcap,
  formatValueMedian,
  formatValueNum,
  formatValuePct,
  formatValuePrice,
  formatValueScore,
  subscorePercent,
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

describe("subscorePercent", () => {
  it("maps the 0–25 subscore range onto a full bar", () => {
    expect(subscorePercent(0)).toBe(0);
    expect(subscorePercent(12.5)).toBe(50);
    expect(subscorePercent(25)).toBe(100);
  });

  it("clamps out-of-range and malformed values", () => {
    expect(subscorePercent(-1)).toBe(0);
    expect(subscorePercent(999)).toBe(100);
    expect(subscorePercent(Number.NaN)).toBe(0);
    expect(subscorePercent(undefined)).toBe(0);
    expect(subscorePercent(null)).toBe(0);
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

  it("prints a dash for NaN/Infinity instead of leaking the literal 'NaN'", () => {
    // TradingView emits NaN for unsupported columns — it is missing, not zero.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formatValuePct(bad), "pct").toBe("–");
      expect(formatValueNum(bad), "num").toBe("–");
      expect(formatValueMedian(bad), "median").toBe("n/a");
      expect(formatValueScore(bad), "score").toBe("n/a");
      expect(formatValuePrice(row({ price: bad })), "price").toBe("–");
      expect(formatValueMcap(row({ mcap_bn: bad })), "mcap").toBe("–");
    }
  });
});

describe("formatValueScore", () => {
  it("rounds and clamps a 0-100 score", () => {
    expect(formatValueScore(0)).toBe("0");
    expect(formatValueScore(78.4)).toBe("78");
    expect(formatValueScore(78.6)).toBe("79");
    expect(formatValueScore(100)).toBe("100");
    expect(formatValueScore(-4)).toBe("0");
    expect(formatValueScore(140)).toBe("100");
  });
});
