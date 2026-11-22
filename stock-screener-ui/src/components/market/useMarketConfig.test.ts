// @vitest-environment happy-dom
import { describe, expect, test, vi } from "vitest";
import {
  MARKET_CONFIG_SCOPE,
  MARKET_CONFIG_VERSION,
  defaultMarketConfig,
  marketConfigScope,
  parseMarketConfig,
  serializeMarketConfig,
} from "./useMarketConfig";
import { SCOPES } from "../../state/savedConfig";
import { DEFAULT_MARKET_UNIVERSE } from "../../api/marketScreener";
import * as marketFiltersModule from "./marketFilters";
import { DEEP_VALUE_PRESET, defaultMarketFilters } from "./marketFilters";

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
      colorBy: "change_pct",
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

describe("map sizing metric (stored on the colorBy wire field)", () => {
  test("defaults to day change", () => {
    expect(defaultMarketConfig().colorBy).toBe("change_pct");
    expect(serializeMarketConfig(defaultMarketConfig()).colorBy).toBe("change_pct");
  });

  test.each(["change_pct", "relative_volume", "rsi", "pos_52w", "market_cap"] as const)(
    "%s persists through serialize -> parse",
    (metric) => {
      const value = defaultMarketConfig({ view: "vis", colorBy: metric });
      const wire = JSON.parse(JSON.stringify(serializeMarketConfig(value)));
      expect(wire.colorBy).toBe(metric);
      const parsed = parseMarketConfig(wire)!;
      expect(parsed.colorBy).toBe(metric);
      expect(parsed.view).toBe("vis");
    },
  );

  // Regression: this assertion used to claim `pe_ratio` was rejected because
  // it was not a metric when the test was written. P/E (and the other six
  // fundamental/trend fields) are now real, user-selectable size metrics, so
  // the payload must restore them, not fall back to day change.
  test.each(["adx", "perf_w", "perf_1m", "pe_ratio", "pb_ratio", "roe", "dividend_yield"] as const)(
    "%s is a valid sizing metric and restores through parse",
    (metric) => {
      const parsed = parseMarketConfig(payload({ colorBy: metric, rsiMin: 55 }))!;
      expect(parsed.colorBy, `${metric} was rejected`).toBe(metric);
      expect(parsed.filters.rsiMin).toBe(55);
    },
  );

  test("a genuinely unknown sizing metric falls back to day change without losing filters", () => {
    const parsed = parseMarketConfig(payload({ colorBy: "not_a_metric", rsiMin: 55 }))!;
    expect(parsed.colorBy).toBe("change_pct");
    expect(parsed.filters.rsiMin).toBe(55);
  });

  test("a sizing metric inside the nested sketch restores too", () => {
    const nested = payload({ colorBy: "pos_52w" });
    const parsed = parseMarketConfig({ universe: "nifty500", filters: nested })!;
    expect(parsed.colorBy).toBe("pos_52w");
  });
});

describe("us universe", () => {
  test("the saved-config parser accepts universe=us", () => {
    const parsed = parseMarketConfig(payload({ universe: "us" }));
    expect(parsed?.universe).toBe("us");
    expect(parseMarketConfig(payload({ universe: "nasdaq" }))).toBeNull();
  });

  test("a US config round-trips through the v1 flat wire payload", () => {
    const value = defaultMarketConfig({ universe: "us", view: "vis" });
    value.filters = {
      ...value.filters,
      capTiers: new Set(["large", "mid"]),
      sectors: ["Semiconductors"],
      mcapMinCr: 2,
      mcapMaxCr: 100,
      priceMin: 50,
      sort: "rsi_desc",
    };
    const parsed = parseMarketConfig(JSON.parse(JSON.stringify(serializeMarketConfig(value))))!;
    expect(parsed.universe).toBe("us");
    expect(parsed.view).toBe("vis");
    expect(parsed.filters.mcapMinCr).toBe(2);
    expect(parsed.filters.mcapMaxCr).toBe(100);
    expect(parsed.filters.priceMin).toBe(50);
    expect([...parsed.filters.capTiers].sort()).toEqual(["large", "mid"]);
    expect(parsed.filters.sectors).toEqual(["Semiconductors"]);
    expect(parsed.filters.sort).toBe("rsi_desc");
  });

  test("US defaults are the same unit-neutral baseline with no India F&O tags", () => {
    const config = defaultMarketConfig({ universe: "us" });
    expect(config.filters).toEqual(defaultMarketFilters("us"));
    expect(config.filters.fnoOnly).toBe(false);
    expect(config.filters.sectors).toEqual([]);
    expect(config.filters.mcapMinCr).toBeNull();
  });
});

describe("restore passes the saved universe into default filters", () => {
  test("a saved us config builds its filters with the US universe, not an India-only default", () => {
    const expected = defaultMarketFilters("us");
    const spy = vi.spyOn(marketFiltersModule, "defaultMarketFilters");
    try {
      const parsed = parseMarketConfig(payload({ universe: "us", rsiMin: 55 }))!;
      expect(parsed.universe).toBe("us");
      expect(spy).toHaveBeenCalledWith("us");
      expect(parsed.filters.rsiMin).toBe(55);
      expect(parsed.filters.fnoOnly).toBe(false);
      expect(parsed.filters).toEqual({ ...expected, rsiMin: 55 });
    } finally {
      spy.mockRestore();
    }
  });

  test("a saved India config still restores with its own universe and filters", () => {
    const expected = defaultMarketFilters("nifty500");
    const spy = vi.spyOn(marketFiltersModule, "defaultMarketFilters");
    try {
      const parsed = parseMarketConfig(payload({ universe: "nifty500", mcapMinCr: 500 }))!;
      expect(parsed.universe).toBe("nifty500");
      expect(spy).toHaveBeenCalledWith("nifty500");
      expect(parsed.filters.mcapMinCr).toBe(500);
      expect(parsed.filters).toEqual({ ...expected, mcapMinCr: 500 });
    } finally {
      spy.mockRestore();
    }
  });

  test("a config missing universe falls back to the default and still restores filters", () => {
    const { universe: _omitted, ...withoutUniverse } = payload({ rsiMin: 42, fnoOnly: true });
    const spy = vi.spyOn(marketFiltersModule, "defaultMarketFilters");
    try {
      const parsed = parseMarketConfig(withoutUniverse)!;
      expect(parsed.universe).toBe(DEFAULT_MARKET_UNIVERSE);
      expect(spy).toHaveBeenCalledWith(DEFAULT_MARKET_UNIVERSE);
      expect(parsed.filters.rsiMin).toBe(42);
      expect(parsed.filters.fnoOnly).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  test("an unknown universe is rejected before any filters are built", () => {
    const raw = payload({ universe: "nasdaq" });
    const spy = vi.spyOn(marketFiltersModule, "defaultMarketFilters");
    try {
      expect(parseMarketConfig(raw)).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("value view", () => {
  test("view=value round-trips through the saved-config allowlist", () => {
    const value = defaultMarketConfig({ view: "value" });
    const wire = serializeMarketConfig(value);
    expect(wire.view).toBe("value");
    expect(parseMarketConfig(JSON.parse(JSON.stringify(wire)))?.view).toBe("value");
  });

  test("an unknown view falls back to table", () => {
    expect(parseMarketConfig(payload({ view: "bogus" }))?.view).toBe("table");
  });

  test("a saved legacy view=map hydrates to vis, and serialize never writes map back", () => {
    const parsed = parseMarketConfig(payload({ view: "map", rsiMin: 55 }))!;
    expect(parsed.view).toBe("vis");
    expect(parsed.filters.rsiMin).toBe(55);
    expect(serializeMarketConfig(parsed).view).toBe("vis");
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
      "sectors",
      "sort",
      "view",
      "colorBy",
    ]) {
      expect(wire).toHaveProperty(key);
    }
  });

  test("a full value survives a serialize -> parse round-trip", () => {
    const value = defaultMarketConfig({ universe: "nse_fo", view: "vis" });
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
    expect(parsed.view).toBe("vis");
    expect([...parsed.filters.capTiers].sort()).toEqual(["large", "small"]);
    expect(parsed.filters.sectors).toEqual(["IT", "Energy"]);
    expect(parsed.filters.mcapMaxCr).toBe(90000);
    expect(parsed.filters.relVolMax).toBe(8);
    expect(parsed.filters.aboveSma200).toBe(true);
    expect(parsed.filters.sort).toBe("relvol_desc");
    expect(parsed.filters.search).toBe("");
  });
});

describe("sector-percentile filter persistence", () => {
  test("the Deep value preset survives a serialize -> parse round-trip", () => {
    const value = defaultMarketConfig();
    value.filters = { ...value.filters, ...DEEP_VALUE_PRESET };

    const wire = JSON.parse(JSON.stringify(serializeMarketConfig(value)));
    expect(wire.pePctMax).toBe(0.35);
    expect(wire.roePctMin).toBe(0.45);
    expect(wire.dePctMax).toBe(0.3);

    const parsed = parseMarketConfig(wire)!;
    expect(parsed.filters.pePctMax).toBe(DEEP_VALUE_PRESET.pePctMax);
    expect(parsed.filters.roePctMin).toBe(DEEP_VALUE_PRESET.roePctMin);
    expect(parsed.filters.dePctMax).toBe(DEEP_VALUE_PRESET.dePctMax);
  });

  test("percentile bounds are clamped to 0..1 on read", () => {
    const parsed = parseMarketConfig(
      payload({ pePctMax: 2, roePctMin: -0.1, dePctMax: 1.5 }),
    )!;
    expect(parsed.filters.pePctMax).toBeNull();
    expect(parsed.filters.roePctMin).toBeNull();
    expect(parsed.filters.dePctMax).toBeNull();

    const edges = parseMarketConfig(payload({ pePctMax: 1, roePctMin: 0, dePctMax: 1 }))!;
    expect(edges.filters.pePctMax).toBe(1);
    expect(edges.filters.roePctMin).toBe(0);
    expect(edges.filters.dePctMax).toBe(1);
  });

  test("a saved percentile bound is present in the wire payload", () => {
    const wire = serializeMarketConfig(defaultMarketConfig());
    for (const key of ["pePctMax", "roePctMin", "dePctMax"]) {
      expect(wire).toHaveProperty(key);
    }
  });
});
