import { describe, expect, test } from "vitest";
import type { MarketUniverse } from "../types/marketScreener";
import { CURRENCIES } from "./currency";
import {
  MARKET_UNIVERSE_DESCRIPTORS,
  capTierLabel,
  descriptorForCurrency,
  formatMarketCap,
  formatPrice,
  marketCapLabel,
  marketCapOf,
  marketCapUnitLabel,
  marketUniverseDescriptor,
} from "./marketUniverses";

const india = marketUniverseDescriptor("nifty50");
const usa = marketUniverseDescriptor("us");

describe("MARKET_UNIVERSE_DESCRIPTORS", () => {
  test("covers every shipped universe with unique values and labels", () => {
    const values = MARKET_UNIVERSE_DESCRIPTORS.map((d) => d.value).sort();
    expect(values).toEqual(
      (
        [
          "all_equity",
          "nifty500",
          "nifty50",
          "nifty100",
          "nifty200",
          "nse_fo",
          "us",
          "banknifty",
          "sensex",
        ] as MarketUniverse[]
      ).sort(),
    );
    expect(new Set(MARKET_UNIVERSE_DESCRIPTORS.map((d) => d.value)).size).toBe(9);
    expect(new Set(MARKET_UNIVERSE_DESCRIPTORS.map((d) => d.label)).size).toBe(9);
  });

  test("frontend descriptor ids match the backend ALLOWED_UNIVERSES registry", () => {
    // Mirrors tests/api/test_market_screen.py::_frontend_descriptor_ids, which
    // parses this file and compares it to the backend's ALLOWED_UNIVERSES.
    const values = MARKET_UNIVERSE_DESCRIPTORS.map((d) => d.value).sort();
    const expected = [
      "all_equity",
      "banknifty",
      "nifty100",
      "nifty200",
      "nifty50",
      "nifty500",
      "nse_fo",
      "sensex",
      "us",
    ];
    expect(values).toEqual(expected);
  });

  test("nifty100 and nifty200 are labelled and reuse the India descriptor exactly", () => {
    const expectedLabels: Record<string, string> = {
      nifty100: "NIFTY 100",
      nifty200: "NIFTY 200",
    };
    for (const [value, label] of Object.entries(expectedLabels)) {
      const d = marketUniverseDescriptor(value);
      expect(d.value).toBe(value);
      expect(d.label).toBe(label);
      expect(d.currency).toBe(india.currency);
      expect(d.currencySymbol).toBe(india.currencySymbol);
      expect(d.capUnit).toBe(india.capUnit);
      expect(d.priceLocale).toBe(india.priceLocale);
      expect(d.mcapField).toBe(india.mcapField);
      expect(d.capTiers).toEqual(india.capTiers);
    }
  });

  test("banknifty and sensex are labelled and reuse the India descriptor exactly", () => {
    const expectedLabels: Record<string, string> = {
      banknifty: "Bank Nifty",
      sensex: "Sensex",
    };
    for (const [value, label] of Object.entries(expectedLabels)) {
      const d = marketUniverseDescriptor(value);
      expect(d.value).toBe(value);
      expect(d.label).toBe(label);
      expect(d.currency).toBe(india.currency);
      expect(d.currencySymbol).toBe(india.currencySymbol);
      expect(d.capUnit).toBe(india.capUnit);
      expect(d.priceLocale).toBe(india.priceLocale);
      expect(d.mcapField).toBe(india.mcapField);
      expect(d.capTiers).toEqual(india.capTiers);
    }
  });

  test("us is labelled USA and priced in USD", () => {
    expect(usa.value).toBe("us");
    expect(usa.label).toBe("USA");
    expect(usa.currency).toBe("USD");
    expect(usa.currencySymbol).toBe("$");
  });

  test("India descriptors share one INR/crore/rank-tier descriptor", () => {
    for (const value of [
      "all_equity", "nifty500", "nifty50", "nse_fo", "banknifty", "sensex",
    ] as const) {
      const d = marketUniverseDescriptor(value);
      expect(d.currency).toBe("INR");
      expect(d.currencySymbol).toBe("₹");
      expect(d.priceLocale).toBe("en-IN");
      expect(d.capUnit).toBe("Cr");
      expect(d.mcapField).toBe("marketCapCr");
      expect(Object.values(d.capTiers).every((r) => r.min === null && r.max === null)).toBe(true);
    }
  });

  test("US descriptor uses the USD mcap field and absolute cap thresholds", () => {
    expect(usa.currency).toBe("USD");
    expect(usa.currencySymbol).toBe("$");
    expect(usa.priceLocale).toBe("en-US");
    expect(usa.capUnit).toBe("B");
    expect(usa.mcapField).toBe("marketCapUsdB");
    expect(usa.capTiers.mega).toEqual({ min: 200, max: null });
    expect(usa.capTiers.large).toEqual({ min: 10, max: 200 });
    expect(usa.capTiers.mid).toEqual({ min: 2, max: 10 });
    expect(usa.capTiers.small).toEqual({ min: 0.3, max: 2 });
    expect(usa.capTiers.micro).toEqual({ min: null, max: 0.3 });
  });

  test("US cap tiers are contiguous with no gaps", () => {
    expect(usa.capTiers.mega!.min).toBe(usa.capTiers.large!.max);
    expect(usa.capTiers.large!.min).toBe(usa.capTiers.mid!.max);
    expect(usa.capTiers.mid!.min).toBe(usa.capTiers.small!.max);
    expect(usa.capTiers.small!.min).toBe(usa.capTiers.micro!.max);
  });

  test("symbol, locale and cap unit never drift from the currency registry", () => {
    for (const d of MARKET_UNIVERSE_DESCRIPTORS) {
      const spec = CURRENCIES[d.currency];
      expect(d.currencySymbol).toBe(spec.symbol);
      expect(d.priceLocale).toBe(spec.grouping);
      expect(d.capUnit).toBe(spec.mcapSuffix);
    }
  });
});

describe("descriptor resolution", () => {
  test("marketUniverseDescriptor falls back to the India default for unknown values", () => {
    expect(marketUniverseDescriptor("nifty500")).toBe(MARKET_UNIVERSE_DESCRIPTORS[1]);
    expect(marketUniverseDescriptor("legacy_universe")).toBe(MARKET_UNIVERSE_DESCRIPTORS[0]);
    expect(marketUniverseDescriptor(null)).toBe(MARKET_UNIVERSE_DESCRIPTORS[0]);
    expect(marketUniverseDescriptor(undefined)).toBe(MARKET_UNIVERSE_DESCRIPTORS[0]);
  });

  test("descriptorForCurrency maps USD to the US descriptor and everything else to India", () => {
    expect(descriptorForCurrency("USD")).toBe(usa);
    expect(descriptorForCurrency("INR")).toBe(MARKET_UNIVERSE_DESCRIPTORS[0]);
    expect(descriptorForCurrency(null)).toBe(MARKET_UNIVERSE_DESCRIPTORS[0]);
    expect(descriptorForCurrency(undefined)).toBe(MARKET_UNIVERSE_DESCRIPTORS[0]);
    expect(descriptorForCurrency("EUR")).toBe(MARKET_UNIVERSE_DESCRIPTORS[0]);
  });
});

describe("marketCapOf", () => {
  test("reads marketCapCr for an INR row", () => {
    expect(
      marketCapOf({ marketCapCr: 1812819, marketCapUsdB: null, currency: "INR" }),
    ).toBe(1812819);
  });

  test("reads marketCapUsdB for a USD row when no descriptor is passed", () => {
    expect(
      marketCapOf({ marketCapCr: null, marketCapUsdB: 12.3, currency: "USD" }),
    ).toBe(12.3);
  });

  test("an explicit descriptor overrides the row currency", () => {
    const row = { marketCapCr: 50, marketCapUsdB: 9, currency: "USD" };
    expect(marketCapOf(row, india)).toBe(50);
    expect(marketCapOf(row, usa)).toBe(9);
  });

  test("returns null for missing or non-finite cap values, but keeps zero", () => {
    expect(marketCapOf({ marketCapCr: null })).toBeNull();
    expect(marketCapOf({ marketCapCr: Number.NaN })).toBeNull();
    expect(marketCapOf({ marketCapCr: Number.POSITIVE_INFINITY })).toBeNull();
    expect(marketCapOf({ marketCapCr: 0 })).toBe(0);
    expect(marketCapOf({ marketCapCr: null, marketCapUsdB: null }, usa)).toBeNull();
  });
});

describe("market cap formatting", () => {
  test("formatMarketCap emits Indian lakh/k suffix and a dash for missing data", () => {
    expect(formatMarketCap(1812819, india)).toBe("18.1L");
    expect(formatMarketCap(1500, india)).toBe("1.5k");
    expect(formatMarketCap(999, india)).toBe("999");
    expect(formatMarketCap(null, india)).toBe("–");
  });

  test("formatMarketCap pins India's zero/negative/large edge cases", () => {
    expect(formatMarketCap(0, india)).toBe("0");
    expect(formatMarketCap(-1500, india)).toBe("-1500"); // no signed rung
    expect(formatMarketCap(1e7, india)).toBe("100.0L"); // no Cr rung
    expect(formatMarketCap(Number.NaN, india)).toBe("NaN");
  });

  test("formatMarketCap pins the US zero/negative/whole-number edge cases", () => {
    expect(formatMarketCap(0, usa)).toBe("$0B");
    expect(formatMarketCap(-12.3, usa)).toBe("$-12.3B");
    expect(formatMarketCap(12, usa)).toBe("$12B"); // no forced one-decimal
  });

  test("formatMarketCap keeps its table ladder distinct from CURRENCIES.compact", () => {
    expect(CURRENCIES.INR.compact(1e7)).toBe("1.0Cr");
    expect(formatMarketCap(1e7, india)).toBe("100.0L");
    expect(CURRENCIES.INR.compact(1e3)).toBe("1.0K");
    expect(formatMarketCap(1e3, india)).toBe("1.0k");
  });

  test("formatMarketCap emits a $-prefixed billion value for the US descriptor", () => {
    expect(formatMarketCap(12.3, usa)).toBe("$12.3B");
    expect(formatMarketCap(12345.67, usa)).toBe("$12,345.7B");
    expect(formatMarketCap(null, usa)).toBe("–");
  });

  test("marketCapLabel uses ₹…Cr for India and $…B for the US", () => {
    expect(marketCapLabel(1812819, india)).toBe("₹18,12,819 Cr");
    expect(marketCapLabel(12345.67, usa)).toBe("$12,345.7B");
  });

  test("marketCapUnitLabel is derived from the descriptor's cap unit", () => {
    expect(marketCapUnitLabel(india)).toBe(" Cr");
    expect(marketCapUnitLabel(usa)).toBe(" B");
  });

  test("capTierLabel keeps bare India names and annotates US thresholds", () => {
    expect(capTierLabel("large", india)).toBe("Large");
    expect(capTierLabel("mega", usa)).toBe("Mega ≥200B");
    expect(capTierLabel("large", usa)).toBe("Large 10–200B");
    expect(capTierLabel("mid", usa)).toBe("Mid 2–10B");
    expect(capTierLabel("small", usa)).toBe("Small 0.3–2B");
    expect(capTierLabel("micro", usa)).toBe("Micro <0.3B");
  });
});

describe("formatPrice", () => {
  test("groups by the descriptor's locale with two decimals", () => {
    expect(formatPrice(1234567.891, india)).toBe("12,34,567.89");
    expect(formatPrice(1234.5, usa)).toBe("1,234.50");
    expect(formatPrice(0, usa)).toBe("0.00");
  });
});
