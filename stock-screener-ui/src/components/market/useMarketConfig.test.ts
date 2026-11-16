// @vitest-environment happy-dom
import { describe, expect, test } from "vitest";
import {
  MARKET_CONFIG_SCOPE,
  MARKET_CONFIG_VERSION,
  defaultMarketConfig,
  marketConfigScope,
  parseMarketConfig,
  serializeMarketConfig,
} from "./useMarketConfig";
import { SCOPES } from "../../state/savedConfig";
import { defaultMarketFilters } from "./marketFilters";

function payload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...serializeMarketConfig(defaultMarketConfig()), ...overrides };
}

describe("market.filters registry entry", () => {
  test("is registered with version 1 and defaults matching the panel", () => {
    expect(MARKET_CONFIG_SCOPE).toBe("market.filters");
    expect(marketConfigScope.version).toBe(MARKET_CONFIG_VERSION);
    expect(MARKET_CONFIG_VERSION).toBe(1);
    // Registration is by import: adding a screen is one row here, no new store
    // and no new endpoint.
    expect(SCOPES["market.filters"]).toBe(marketConfigScope);
    expect(marketConfigScope.defaults()).toEqual({
      universe: "all_equity",
      filters: defaultMarketFilters(),
      view: "table",
    });
  });
});

describe("capTiers Set <-> array", () => {
  test("round-trips through the wire payload", () => {
    const value = defaultMarketConfig();
    value.filters.capTiers = new Set(["large", "micro"]);

    const wire = serializeMarketConfig(value);
    // `JSON.stringify(new Set())` is "{}" — the array is the whole point.
    expect(wire.capTiers).toEqual(["large", "micro"]);
    expect(JSON.parse(JSON.stringify(wire)).capTiers).toEqual(["large", "micro"]);

    const parsed = parseMarketConfig(JSON.parse(JSON.stringify(wire)));
    expect(parsed?.filters.capTiers).toBeInstanceOf(Set);
    expect([...parsed!.filters.capTiers]).toEqual(["large", "micro"]);
  });

  test("an unknown tier is dropped without losing the valid ones", () => {
    const parsed = parseMarketConfig(payload({ capTiers: ["large", "huge", "mid"] }));
    expect([...parsed!.filters.capTiers].sort()).toEqual(["large", "mid"]);
  });

  test("a non-array capTiers degrades to the empty (all tiers) set", () => {
    expect(parseMarketConfig(payload({ capTiers: "large" }))!.filters.capTiers.size).toBe(0);
  });
});

describe("parse — tolerance and rejection", () => {
  test("an unknown key is ignored", () => {
    const parsed = parseMarketConfig(payload({ nope: 1, rsiMin: 50 }));
    expect(parsed!.filters.rsiMin).toBe(50);
    expect(JSON.stringify(parsed)).not.toContain("nope");
  });

  test("a stale sector and a stale sort fall back without losing the rest", () => {
    const parsed = parseMarketConfig(
      payload({ sectors: ["Retired Sector", "IT"], sort: "bogus_desc", fnoOnly: true }),
    );
    // The user's sector is not the app's to drop.
    expect(parsed!.filters.sectors).toEqual(["Retired Sector", "IT"]);
    expect(parsed!.filters.sort).toBe("mcap_desc");
    expect(parsed!.filters.fnoOnly).toBe(true);
  });

  test("out-of-range and non-numeric bounds read as unset, not as NaN", () => {
    const parsed = parseMarketConfig(
      payload({ rsiMin: 500, priceMax: "abc", relVolMax: 4, mcapMaxCr: -5 }),
    );
    expect(parsed!.filters.rsiMin).toBeNull();
    expect(parsed!.filters.priceMax).toBeNull();
    expect(parsed!.filters.mcapMaxCr).toBeNull();
    expect(parsed!.filters.relVolMax).toBe(4);
  });

  test("an unknown universe rejects the whole payload", () => {
    expect(parseMarketConfig(payload({ universe: "nasdaq" }))).toBeNull();
  });

  test("a non-object payload rejects", () => {
    expect(parseMarketConfig(null)).toBeNull();
    expect(parseMarketConfig("{}")).toBeNull();
    expect(parseMarketConfig([])).toBeNull();
  });

  test("the nested {universe, filters} sketch still restores", () => {
    const parsed = parseMarketConfig({
      universe: "nifty500",
      filters: payload({ sectors: ["IT"] }),
    });
    expect(parsed!.universe).toBe("nifty500");
    expect(parsed!.filters.sectors).toEqual(["IT"]);
  });
});

describe("serialize", () => {
  test("never emits search or a view outside the known modes", () => {
    const value = defaultMarketConfig();
    value.filters.search = "reliance";
    const wire = serializeMarketConfig(value);

    expect(wire).not.toHaveProperty("search");
    expect(JSON.stringify(wire)).not.toContain("reliance");
    expect(wire.view).toBe("table");
  });

  test("every persisted filter field is present in the payload", () => {
    const wire = serializeMarketConfig(defaultMarketConfig());
    for (const key of [
      "universe",
      "capTiers",
      "priceMin",
      "priceMax",
      "dayChangeMin",
      "dayChangeMax",
      "mcapMinCr",
      "mcapMaxCr",
      "rsiMin",
      "rsiMax",
      "relVolMin",
      "relVolMax",
      "aboveSma20",
      "aboveSma50",
      "aboveSma200",
      "fnoOnly",
      "etfOnly",
      "sectors",
      "sort",
      "view",
    ]) {
      expect(wire).toHaveProperty(key);
    }
  });

  test("a full value survives a serialize -> parse round-trip", () => {
    const value = defaultMarketConfig({ universe: "nse_fo", view: "map" });
    value.filters = {
      ...value.filters,
      capTiers: new Set(["large", "small"]),
      sectors: ["IT", "Energy"],
      priceMin: 100,
      priceMax: 5000,
      dayChangeMin: -2,
      dayChangeMax: 9,
      mcapMinCr: 1000,
      mcapMaxCr: 90000,
      rsiMin: 40,
      rsiMax: 70,
      relVolMin: 1.2,
      relVolMax: 8,
      aboveSma200: true,
      fnoOnly: true,
      sort: "relvol_desc",
    };

    const parsed = parseMarketConfig(serializeMarketConfig(value))!;
    expect(parsed.universe).toBe("nse_fo");
    expect(parsed.view).toBe("map");
    expect([...parsed.filters.capTiers].sort()).toEqual(["large", "small"]);
    expect(parsed.filters.sectors).toEqual(["IT", "Energy"]);
    expect(parsed.filters.mcapMaxCr).toBe(90000);
    expect(parsed.filters.relVolMax).toBe(8);
    expect(parsed.filters.aboveSma200).toBe(true);
    expect(parsed.filters.sort).toBe("relvol_desc");
    expect(parsed.filters.search).toBe("");
  });
});
