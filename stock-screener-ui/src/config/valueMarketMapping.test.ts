import { describe, expect, expectTypeOf, test } from "vitest";
import { marketUniverseToValueMarket } from "./valueMarketMapping";
import type { MappedValueMarket } from "./valueMarketMapping";
import type { ChartMarket } from "@/utils/chart/time";
import type { ValueMarket } from "@/api/valueScan";
import type { MarketUniverse } from "@/types/marketScreener";

const ALL_UNIVERSES: MarketUniverse[] = [
  "all_equity",
  "nifty500",
  "nifty50",
  "nse_fo",
  "us",
];

describe("marketUniverseToValueMarket", () => {
  test("maps all five Market universes to their v1 value market", () => {
    expect(ALL_UNIVERSES.map((u) => marketUniverseToValueMarket(u))).toEqual([
      "india",
      "india",
      "india",
      "india",
      "usa",
    ]);
  });

  test("never yields GLOBAL in v1", () => {
    for (const universe of ALL_UNIVERSES) {
      expect(marketUniverseToValueMarket(universe)).not.toBe("global");
    }
  });

  test("an unknown universe maps to null", () => {
    expect(marketUniverseToValueMarket("global" as MarketUniverse)).toBeNull();
  });
});

describe("market identity guards", () => {
  test("ChartMarket is the canonical india/usa union", () => {
    expectTypeOf<ChartMarket>().toEqualTypeOf<"india" | "usa">();
  });

  test("MappedValueMarket reuses ChartMarket instead of restating the union", () => {
    expectTypeOf<MappedValueMarket>().toEqualTypeOf<ChartMarket>();
  });

  test("a mapped market stays a valid value-scan market but never GLOBAL", () => {
    expectTypeOf<MappedValueMarket>().toMatchTypeOf<ValueMarket>();
    expectTypeOf<MappedValueMarket>().not.toEqualTypeOf<ValueMarket>();
  });
});
