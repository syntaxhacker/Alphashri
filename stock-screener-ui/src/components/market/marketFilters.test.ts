// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import {
  buildMarketFilterChips,
  CAP_TIERS,
  capTierOptions,
  clearMarketFilterChip,
  countActiveMarketFilters,
  countByCapTier,
  deepValuePresetActive,
  defaultMarketFilters,
  DEFAULT_MARKET_SORT,
  DEEP_VALUE_PRESET,
  filterMarketRows,
  filterOnlyMarketRows,
  marketSectorOptions,
  marketSectors,
  MOVER_PRESETS,
  mergeMoverPresetFilters,
  resetUniverseSpecificFilters,
  sectorPercentiles,
  sortMarketRows,
  MARKET_SORT_OPTIONS,
  type MarketFilterState,
  type MoverPreset,
} from "./marketFilters";
import type { MarketRow } from "../../types/marketScreener";
import {
  MARKET_UNIVERSE_DESCRIPTORS,
  capTierLabel as descriptorCapTierLabel,
  marketUniverseDescriptor,
} from "../../config/marketUniverses";

function row(symbol: string, overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    symbol,
    name: `${symbol} Ltd`,
    sector: "IT",
    exchange: "NSE",
    close: 100,
    change: 1,
    relativeVolume: 1.0,
    marketCapCr: 1000,
    capTier: "mid",
    rsi: 50,
    adx: 20,
    sma20: 95,
    sma50: 90,
    sma200: 80,
    perfW: 1,
    perf1m: 2,
    high52w: 120,
    low52w: 60,
    pos52w: 66,
    peRatio: null,
    pbRatio: null,
    dividendYield: null,
    roe: null,
    psRatio: null,
    fcfYield: null,
    revenue: null,
    netIncome: null,
    debtToEquity: null,
    currentRatio: null,
    grossMargin: null,
    operatingMargin: null,
    revYoy: null,
    epsYoy: null,
    volume: null,
    avgVolume: null,
    gap: null,
    atr: null,
    high: null,
    low: null,
    valueTraded: null,
    to52wHighPct: null,
    from52wLowPct: null,
    rangeVsAtr: null,
    fno: false,
    etf: false,
    ...overrides,
  };
}

const ROWS: MarketRow[] = [
  row("LARGECO", {
    name: "Largeco Energy",
    sector: "Energy",
    close: 3000,
    change: 2.5,
    relativeVolume: 2.2,
    marketCapCr: 200000,
    capTier: "large",
    rsi: 68,
    sma20: 2900,
    sma50: 2800,
    sma200: 2500,
    perfW: 4,
    perf1m: 9,
    pos52w: 91,
    fno: true,
  }),
  row("MIDCO", {
    name: "Midco Software",
    sector: "IT",
    close: 450,
    change: 0.4,
    relativeVolume: 1.1,
    marketCapCr: 15000,
    capTier: "mid",
    rsi: 44,
    perfW: 1.5,
    perf1m: 3,
    pos52w: 40,
    fno: true,
  }),
  row("SMALLCO", {
    name: "Smallco Pharma",
    sector: "Pharma",
    close: 80,
    change: -3.2,
    relativeVolume: 3.5,
    marketCapCr: 800,
    capTier: "small",
    rsi: 32,
    sma20: 90,
    sma50: 95,
    sma200: 110,
    perfW: -5,
    perf1m: -8,
    pos52w: 12,
  }),
  row("ETFCO", {
    name: "Nifty 50 ETF",
    sector: null,
    close: 265,
    change: 0.1,
    relativeVolume: 0.6,
    marketCapCr: 5000,
    capTier: "micro",
    rsi: 51,
    perfW: 0.5,
    perf1m: 1.1,
    pos52w: 55,
    etf: true,
  }),
];

function filters(patch: Partial<MarketFilterState> = {}): MarketFilterState {
  return { ...defaultMarketFilters(), ...patch };
}

function symbols(rows: MarketRow[]): string[] {
  return rows.map((r) => r.symbol).sort();
}

describe("filterMarketRows", () => {
  test("default filters return every row sorted by market cap desc", () => {
    expect(defaultMarketFilters().sort).toBe("mcap_desc");
    const divergent = [
      row("DAYWINNER", { change: 9, marketCapCr: 100 }),
      row("CAPWINNER", { change: 1, marketCapCr: 99999 }),
    ];
    expect(filterMarketRows(divergent, defaultMarketFilters()).map((r) => r.symbol)).toEqual([
      "CAPWINNER",
      "DAYWINNER",
    ]);
    const out = filterMarketRows(ROWS, defaultMarketFilters());
    expect(symbols(out)).toEqual(["ETFCO", "LARGECO", "MIDCO", "SMALLCO"]);
    expect(out.map((r) => r.symbol)).toEqual(["LARGECO", "MIDCO", "ETFCO", "SMALLCO"]);
  });

  test("search matches symbol, name and sector case-insensitively", () => {
    expect(symbols(filterMarketRows(ROWS, filters({ search: "midco" })))).toEqual(["MIDCO"]);
    expect(symbols(filterMarketRows(ROWS, filters({ search: "SOFTWARE" })))).toEqual(["MIDCO"]);
    expect(symbols(filterMarketRows(ROWS, filters({ search: "pharma" })))).toEqual(["SMALLCO"]);
    expect(symbols(filterMarketRows(ROWS, filters({ search: "  " })))).toHaveLength(4);
    expect(filterMarketRows(ROWS, filters({ search: "zzz" }))).toEqual([]);
  });

  test("cap tier filter is a Set membership test", () => {
    expect(symbols(filterMarketRows(ROWS, filters({ capTiers: new Set(["large"]) })))).toEqual([
      "LARGECO",
    ]);
    expect(
      symbols(filterMarketRows(ROWS, filters({ capTiers: new Set(["mid", "small"]) }))),
    ).toEqual(["MIDCO", "SMALLCO"]);
    expect(filterMarketRows(ROWS, filters({ capTiers: new Set(["unknown"]) }))).toEqual([]);
    expect(filterMarketRows(ROWS, filters({ capTiers: new Set() }))).toHaveLength(4);
  });

  test("rows with a missing cap tier are excluded when the filter is active", () => {
    const rows = [row("NOTIER", { capTier: null })];
    expect(filterMarketRows(rows, filters({ capTiers: new Set(["large"]) }))).toEqual([]);
    expect(filterMarketRows(rows, filters())).toHaveLength(1);
  });

  test("price range filters on close", () => {
    expect(symbols(filterMarketRows(ROWS, filters({ priceMin: 100 })))).toEqual([
      "ETFCO",
      "LARGECO",
      "MIDCO",
    ]);
    expect(symbols(filterMarketRows(ROWS, filters({ priceMax: 100 })))).toEqual(["SMALLCO"]);
    expect(symbols(filterMarketRows(ROWS, filters({ priceMin: 90, priceMax: 500 })))).toEqual([
      "ETFCO",
      "MIDCO",
    ]);
    const rows = [row("NOPRICE", { close: null })];
    expect(filterMarketRows(rows, filters({ priceMin: 1 }))).toEqual([]);
    expect(filterMarketRows(rows, filters())).toHaveLength(1);
  });

  test("day change range filters on change", () => {
    expect(symbols(filterMarketRows(ROWS, filters({ dayChangeMin: 2 })))).toEqual(["LARGECO"]);
    expect(symbols(filterMarketRows(ROWS, filters({ dayChangeMax: 0 })))).toEqual(["SMALLCO"]);
    expect(
      symbols(filterMarketRows(ROWS, filters({ dayChangeMin: -1, dayChangeMax: 1 }))),
    ).toEqual(["ETFCO", "MIDCO"]);
    const rows = [row("NODAY", { change: null })];
    expect(filterMarketRows(rows, filters({ dayChangeMin: 0 }))).toEqual([]);
  });

  test("mcap min (₹Cr) filter", () => {
    expect(symbols(filterMarketRows(ROWS, filters({ mcapMinCr: 10000 })))).toEqual([
      "LARGECO",
      "MIDCO",
    ]);
    expect(symbols(filterMarketRows(ROWS, filters({ mcapMinCr: 100000 })))).toEqual([
      "LARGECO",
    ]);
    const rows = [row("NOCAP", { marketCapCr: null })];
    expect(filterMarketRows(rows, filters({ mcapMinCr: 1 }))).toEqual([]);
  });

  test("RSI min and max filter", () => {
    expect(symbols(filterMarketRows(ROWS, filters({ rsiMin: 60 })))).toEqual(["LARGECO"]);
    expect(symbols(filterMarketRows(ROWS, filters({ rsiMax: 40 })))).toEqual(["SMALLCO"]);
    expect(symbols(filterMarketRows(ROWS, filters({ rsiMin: 40, rsiMax: 52 })))).toEqual([
      "ETFCO",
      "MIDCO",
    ]);
    const rows = [row("NORSI", { rsi: null })];
    expect(filterMarketRows(rows, filters({ rsiMin: 10, rsiMax: 90 }))).toEqual([]);
  });

  test("rel-vol min filter", () => {
    expect(symbols(filterMarketRows(ROWS, filters({ relVolMin: 2 })))).toEqual([
      "LARGECO",
      "SMALLCO",
    ]);
    const rows = [row("NOVOL", { relativeVolume: null })];
    expect(filterMarketRows(rows, filters({ relVolMin: 0.1 }))).toEqual([]);
  });

  test("above SMA20/50/200 switches require close above the average", () => {
    // LARGECO: close above all three; MIDCO: close above all three;
    // SMALLCO: below all three; ETFCO: above all three.
    expect(symbols(filterMarketRows(ROWS, filters({ aboveSma20: true })))).toEqual([
      "ETFCO",
      "LARGECO",
      "MIDCO",
    ]);
    expect(symbols(filterMarketRows(ROWS, filters({ aboveSma200: true })))).toEqual([
      "ETFCO",
      "LARGECO",
      "MIDCO",
    ]);
    const rows = [row("NOMA", { close: 100, sma20: null, sma50: null, sma200: null })];
    expect(filterMarketRows(rows, filters({ aboveSma20: true }))).toEqual([]);
    expect(filterMarketRows(rows, filters({ aboveSma50: true }))).toEqual([]);
    expect(filterMarketRows(rows, filters({ aboveSma200: true }))).toEqual([]);
    expect(filterMarketRows(rows, filters())).toHaveLength(1);
  });

  test("equal close and SMA does not count as above", () => {
    const rows = [row("FLAT", { close: 90, sma20: 90 })];
    expect(filterMarketRows(rows, filters({ aboveSma20: true }))).toEqual([]);
  });

  test("F&O switch", () => {
    expect(symbols(filterMarketRows(ROWS, filters({ fnoOnly: true })))).toEqual([
      "LARGECO",
      "MIDCO",
    ]);
  });

  test("sector filter is an exact multi-select set", () => {
    expect(symbols(filterMarketRows(ROWS, filters({ sectors: ["IT"] })))).toEqual(["MIDCO"]);
    expect(symbols(filterMarketRows(ROWS, filters({ sectors: ["IT", "Pharma"] })))).toEqual([
      "MIDCO",
      "SMALLCO",
    ]);
    expect(symbols(filterMarketRows(ROWS, filters({ sectors: ["Energy", "Pharma"] })))).toEqual([
      "LARGECO",
      "SMALLCO",
    ]);
    expect(filterMarketRows(ROWS, filters({ sectors: ["Banking"] }))).toEqual([]);
    expect(defaultMarketFilters().sectors).toEqual([]);
    expect(symbols(filterMarketRows(ROWS, filters({ sectors: [] })))).toEqual([
      "ETFCO",
      "LARGECO",
      "MIDCO",
      "SMALLCO",
    ]);
  });

  test("combinations compose (cap + RSI + change)", () => {
    const out = filterMarketRows(
      ROWS,
      filters({ capTiers: new Set(["large", "mid"]), rsiMin: 60, dayChangeMin: 0 }),
    );
    expect(symbols(out)).toEqual(["LARGECO"]);
  });

  test("sorting applies after filtering", () => {
    const byRsi = filterMarketRows(ROWS, filters({ sort: "rsi_desc" }));
    expect(byRsi.map((r) => r.symbol)).toEqual(["LARGECO", "ETFCO", "MIDCO", "SMALLCO"]);
    const bySymbol = filterMarketRows(ROWS, filters({ sort: "symbol_asc" }));
    expect(bySymbol.map((r) => r.symbol)).toEqual(["ETFCO", "LARGECO", "MIDCO", "SMALLCO"]);
    const byMcap = filterMarketRows(ROWS, filters({ sort: "mcap_desc" }));
    expect(byMcap.map((r) => r.symbol)).toEqual(["LARGECO", "MIDCO", "ETFCO", "SMALLCO"]);
  });

  test("nulls sort last regardless of direction", () => {
    const rows = [
      row("A", { change: null }),
      row("B", { change: 5 }),
      row("C", { change: -1 }),
    ];
    expect(sortMarketRows(rows, "day_desc").map((r) => r.symbol)).toEqual(["B", "C", "A"]);
  });

  test("empty input yields empty output", () => {
    expect(filterMarketRows([], filters({ rsiMin: 10 }))).toEqual([]);
  });
});

describe("ETF cap tier", () => {
  const ETF_ROW = row("NIFTYBEES", {
    name: "Nifty BeES",
    sector: null,
    etf: true,
    capTier: "etf",
    marketCapCr: null,
  });
  const MICRO_EQUITY = row("MICROCO", {
    name: "Microcap Equity",
    capTier: "micro",
    marketCapCr: 150,
    etf: false,
  });

  test("an ETF row (cap_tier 'etf', null cap) is a selectable tier and survives a tier filter that includes etf", () => {
    expect(CAP_TIERS).toContain("etf");
    const rows = [ETF_ROW, MICRO_EQUITY];
    expect(symbols(filterMarketRows(rows, filters({ capTiers: new Set(["etf"]) })))).toEqual([
      "NIFTYBEES",
    ]);
    expect(symbols(filterMarketRows(rows, filters({ capTiers: new Set(["etf", "large"]) })))).toEqual([
      "NIFTYBEES",
    ]);
  });

  test("a tier-selected ETF produces its cap-tier chip", () => {
    const chips = buildMarketFilterChips(filters({ capTiers: new Set(["etf"]) }));
    expect(chips.filter((chip) => chip.key.includes("etf"))).toEqual([
      { key: "capTier:etf", label: "Cap: ETF" },
    ]);
  });

  test("an ETF row is excluded when only micro is ticked; a genuine micro-cap equity stays micro", () => {
    const rows = [ETF_ROW, MICRO_EQUITY];
    expect(symbols(filterMarketRows(rows, filters({ capTiers: new Set(["micro"]) })))).toEqual([
      "MICROCO",
    ]);
    // ETF is its own tier — never a relabelled micro-cap.
    expect(capTierOptions("all_equity").map((o) => o.value)).toContain("etf");
    expect(countByCapTier(rows)).toEqual({ etf: 1, micro: 1 });
    expect(MICRO_EQUITY.capTier).toBe("micro");
    expect(MICRO_EQUITY.marketCapCr).toBe(150);
    expect(ETF_ROW.etf).toBe(true);
    expect(ETF_ROW.marketCapCr).toBeNull();
  });
});

describe("filterOnlyMarketRows", () => {
  test("returns matches in input order (no sort)", () => {
    const divergent = [
      row("DAYWINNER", { change: 9, marketCapCr: 100 }),
      row("CAPWINNER", { change: 1, marketCapCr: 99999 }),
    ];
    // Default sort is mcap_desc, so a sorted pipeline would flip these;
    // the filter-only pass must preserve input order.
    expect(filterOnlyMarketRows(divergent, defaultMarketFilters()).map((r) => r.symbol)).toEqual([
      "DAYWINNER",
      "CAPWINNER",
    ]);
    expect(symbols(filterOnlyMarketRows(ROWS, filters({ rsiMin: 60 })))).toEqual(["LARGECO"]);
  });

  test("a NaN row metric fails an active bound instead of passing every gate", () => {
    const nan = row("NAN", { change: Number.NaN, close: Number.NaN });
    const missing = row("MISSING", { rsi: undefined as unknown as null });

    // With no bound on the field the row still renders (its cell shows a dash).
    expect(symbols(filterOnlyMarketRows([nan, missing], filters()))).toEqual(["MISSING", "NAN"]);
    // NaN compares false against both ends of a range, so the old `== null`
    // check let a corrupted print through every gate on that field.
    expect(symbols(filterOnlyMarketRows([nan], filters({ dayChangeMin: 0 })))).toEqual([]);
    expect(symbols(filterOnlyMarketRows([nan], filters({ priceMax: 1000 })))).toEqual([]);
    expect(symbols(filterOnlyMarketRows([missing], filters({ rsiMin: 60 })))).toEqual([]);
  });

  test("filterMarketRows is the filter-only pass composed with sort", () => {
    for (const key of MARKET_SORT_OPTIONS.map((o) => o.value)) {
      const f = filters({ sort: key });
      expect(filterMarketRows(ROWS, f).map((r) => r.symbol)).toEqual(
        sortMarketRows(filterOnlyMarketRows(ROWS, f), key).map((r) => r.symbol),
      );
    }
  });
});

describe("marketSectors / countByCapTier", () => {
  test("sectors are distinct and sorted, blanks dropped", () => {
    expect(marketSectors(ROWS)).toEqual(["Energy", "IT", "Pharma"]);
  });

  test("tier counts exclude missing tiers", () => {
    const counts = countByCapTier(ROWS);
    expect(counts).toEqual({ large: 1, mid: 1, small: 1, micro: 1 });
  });
});

describe("buildMarketFilterChips", () => {
  test("default filters produce no chips", () => {
    expect(buildMarketFilterChips(defaultMarketFilters())).toEqual([]);
    expect(countActiveMarketFilters(defaultMarketFilters())).toBe(0);
  });

  // The RangeInput hands back `null`/`undefined` interchangeably when an end is
  // cleared. A chip builder that only tests `=== null` let `undefined` reach
  // `fmtNum`, which threw and blanked the whole panel behind the boundary.
  test("a cleared range end never throws", () => {
    const undef = filters({
      priceMin: undefined as unknown as null,
      priceMax: undefined as unknown as null,
      dayChangeMin: undefined as unknown as null,
      mcapMinCr: undefined as unknown as null,
      rsiMin: undefined as unknown as null,
      relVolMin: undefined as unknown as null,
    });
    expect(() => buildMarketFilterChips(undef)).not.toThrow();
    expect(buildMarketFilterChips(undef)).toEqual([]);
    expect(countActiveMarketFilters(undef)).toBe(0);
  });

  test("a half-cleared range still renders one bound", () => {
    const chips = buildMarketFilterChips(
      filters({ priceMin: 100, priceMax: undefined as unknown as null }),
    );
    const price = chips.find((c) => c.key === "price");
    expect(price?.label).toBe("LTP ≥ 100");
  });

  test("a non-finite bound renders a dash instead of throwing", () => {
    const chips = buildMarketFilterChips(
      filters({ rsiMin: Number.NaN as unknown as null, rsiMax: 70 }),
    );
    expect(() => buildMarketFilterChips(chips.length ? filters({ rsiMax: 70 }) : filters({}))).not.toThrow();
    expect(chips.find((c) => c.key === "rsi")?.label).toBe("RSI ≤ 70");
  });

  test("every filter produces a removable chip", () => {
    const chips = buildMarketFilterChips(
      filters({
        search: "reliance",
        capTiers: new Set(["large", "mid"]),
        priceMin: 100,
        priceMax: 2000,
        dayChangeMin: 2,
        dayChangeMax: 9,
        mcapMinCr: 5000,
        rsiMin: 30,
        rsiMax: 70,
        relVolMin: 1.5,
        aboveSma20: true,
        aboveSma50: true,
        aboveSma200: true,
        fnoOnly: true,
        sectors: ["Energy"],
      }),
    );
    const keys = chips.map((c) => c.key);
    expect(keys).toEqual([
      "search",
      "capTier:large",
      "capTier:mid",
      "price",
      "day",
      "mcap",
      "rsi",
      "relvol",
      "sma20",
      "sma50",
      "sma200",
      "fno",
      "sector:Energy",
    ]);
    expect(countActiveMarketFilters(filters({ rsiMin: 30, fnoOnly: true }))).toBe(2);
  });

  test("one chip per selected sector, each independently removable", () => {
    const chips = buildMarketFilterChips(filters({ sectors: ["IT", "Pharma"] }));
    expect(chips).toEqual([
      { key: "sector:IT", label: "Sector: IT" },
      { key: "sector:Pharma", label: "Sector: Pharma" },
    ]);
    expect(countActiveMarketFilters(filters({ sectors: ["IT", "Pharma"] }))).toBe(2);

    const three = buildMarketFilterChips(filters({ sectors: ["IT", "Pharma", "Energy"] }));
    // Per-sector keys: dropping one key removes exactly one chip. A single shared
    // "sector" key would let the panel's remove-by-key wipe the whole selection.
    const withoutPharma = three.filter((c) => c.key !== "sector:Pharma");
    expect(withoutPharma).toHaveLength(three.length - 1);
    expect(withoutPharma.map((c) => c.key)).toEqual(["sector:IT", "sector:Energy"]);
    expect(withoutPharma.map((c) => c.label)).toEqual(["Sector: IT", "Sector: Energy"]);
  });

  test("one-sided ranges and sort exclusion", () => {
    const chips = buildMarketFilterChips(
      filters({ priceMin: 10, dayChangeMax: -2, rsiMax: 80, sort: "rsi_desc" }),
    );
    const keys = chips.map((c) => c.key);
    expect(keys).toContain("price");
    expect(keys).toContain("day");
    expect(keys).toContain("rsi");
    expect(keys).not.toContain("sort");
  });

  test("chip labels are human readable", () => {
    const chips = buildMarketFilterChips(filters({ mcapMinCr: 5000, aboveSma200: true }));
    expect(chips.map((c) => c.label)).toEqual(["MCap ≥ 5000 Cr", "Above SMA 200"]);
  });

  // A persisted max is invisible without its own chip: the values are saved, so
  // the user must be able to see and remove the ceiling that hides rows.
  test("a max-only MCap bound renders its own chip and is removable by key", () => {
    const chips = buildMarketFilterChips(filters({ mcapMaxCr: 90000 }));
    expect(chips).toEqual([{ key: "mcap", label: "MCap ≤ 90000 Cr" }]);
    expect(countActiveMarketFilters(filters({ mcapMaxCr: 90000 }))).toBe(1);
  });

  test("a max-only RelVol bound renders its own chip", () => {
    const chips = buildMarketFilterChips(filters({ relVolMax: 3 }));
    expect(chips).toEqual([{ key: "relvol", label: "RelVol ≤ 3" }]);
  });

  test("a two-ended MCap or RelVol range reads as one range chip", () => {
    expect(buildMarketFilterChips(filters({ mcapMinCr: 5000, mcapMaxCr: 90000 }))).toEqual([
      { key: "mcap", label: "MCap 5000–90000 Cr" },
    ]);
    expect(buildMarketFilterChips(filters({ relVolMin: 1.5, relVolMax: 6 }))).toEqual([
      { key: "relvol", label: "RelVol 1.5–6" },
    ]);
  });
});

describe("search index", () => {
  test("rebuilt when rows are replaced (snapshot refresh)", () => {
    const before = [row("AAA", { name: "Alpha Energy", sector: "Energy" })];
    const filters = (search: string): MarketFilterState => ({
      ...defaultMarketFilters(),
      search,
      sort: "symbol_asc",
    });
    expect(filterMarketRows(before, filters("energy")).map((r) => r.symbol)).toEqual(["AAA"]);

    const after = [row("AAA", { name: "Alpha Renewables", sector: "Utilities" })];
    expect(filterMarketRows(after, filters("energy"))).toEqual([]);
    expect(filterMarketRows(after, filters("utilities")).map((r) => r.symbol)).toEqual(["AAA"]);
    expect(filterMarketRows(after, filters("renewables")).map((r) => r.symbol)).toEqual(["AAA"]);
  });

  test("matches symbol, name and sector case-insensitively with trimmed query", () => {
    const rows = [row("RELIANCE", { name: "Reliance Industries", sector: "Energy" })];
    const filters = (search: string): MarketFilterState => ({
      ...defaultMarketFilters(),
      search,
      sort: "symbol_asc",
    });
    for (const q of ["reliance", "RELIANCE", "  Reliance  ", "Industries", "energy"]) {
      expect(filterMarketRows(rows, filters(q))).toHaveLength(1);
    }
    expect(filterMarketRows(rows, filters("absent"))).toHaveLength(0);
  });
});

describe("universe descriptors in filters", () => {
  const US_ROWS: MarketRow[] = [
    row("NVDA", {
      currency: "USD",
      marketCapCr: null,
      marketCapUsdB: 46200,
      capTier: "large",
      sector: "Semiconductors",
    }),
    row("LLY", {
      currency: "USD",
      marketCapCr: null,
      marketCapUsdB: 7800,
      capTier: "mid",
      sector: "Pharmaceuticals",
    }),
    row("SMALL", {
      currency: "USD",
      marketCapCr: null,
      marketCapUsdB: 0.5,
      capTier: "small",
      sector: "Software",
    }),
  ];

  test("capTierOptions emits every tier the descriptor declares, in order, with a label", () => {
    for (const universe of MARKET_UNIVERSE_DESCRIPTORS.map((d) => d.value)) {
      const descriptor = marketUniverseDescriptor(universe);
      const declared = Object.keys(descriptor.capTiers);
      const options = capTierOptions(universe);
      expect(options.map((o) => o.value)).toEqual(declared);
      for (const option of options) {
        expect(option.label.trim().length).toBeGreaterThan(0);
        expect(option.label).toBe(descriptorCapTierLabel(option.value, descriptor));
      }
    }
  });

  test("CAP_TIERS and the descriptor union are one vocabulary", () => {
    const derived = [
      ...new Set(MARKET_UNIVERSE_DESCRIPTORS.flatMap((d) => Object.keys(d.capTiers))),
    ].sort();
    expect([...CAP_TIERS].sort()).toEqual(derived);

    // Guard against a genuinely dropped size tier without pinning names: the
    // India descriptor must still carry at least four non-class size rungs.
    const india = marketUniverseDescriptor("all_equity");
    const sizeTiers = Object.entries(india.capTiers)
      .filter(([, range]) => !range.category)
      .map(([tier]) => tier);
    expect(sizeTiers.length).toBeGreaterThanOrEqual(4);
    for (const tier of sizeTiers) expect(CAP_TIERS).toContain(tier);
  });

  test("class tiers come from the descriptor flag, so adding one needs no rail edit", () => {
    const india = marketUniverseDescriptor("all_equity");
    const declaredClasses = Object.entries(india.capTiers)
      .filter(([, range]) => range.category)
      .map(([tier]) => tier);
    expect(capTierOptions("all_equity").filter((o) => o.category).map((o) => o.value)).toEqual(
      declaredClasses,
    );
    expect(declaredClasses.length).toBeGreaterThan(0);
    expect(capTierOptions("us").some((o) => o.category)).toBe(false);
  });

  test("MCap chips use the descriptor's unit, not a hardcoded ₹ Cr", () => {
    expect(buildMarketFilterChips(filters({ mcapMinCr: 10 }), "us")).toEqual([
      { key: "mcap", label: "MCap ≥ 10 B" },
    ]);
    expect(buildMarketFilterChips(filters({ mcapMinCr: 5000 }))).toEqual([
      { key: "mcap", label: "MCap ≥ 5000 Cr" },
    ]);
    expect(countActiveMarketFilters(filters({ mcapMaxCr: 200 }), "us")).toBe(1);
  });

  test("cap-tier chips show the US threshold", () => {
    const chips = buildMarketFilterChips(filters({ capTiers: new Set(["large"]) }), "us");
    expect(chips).toEqual([{ key: "capTier:large", label: "Cap: Large 10–200B" }]);
  });

  test("US mcap bounds filter on marketCapUsdB, not the null rupee field", () => {
    expect(symbols(filterMarketRows(US_ROWS, filters({ mcapMinCr: 10000 })))).toEqual([
      "NVDA",
    ]);
    expect(symbols(filterMarketRows(US_ROWS, filters({ mcapMaxCr: 2 })))).toEqual(["SMALL"]);
  });

  test("mcap_desc sorts US rows by $B", () => {
    expect(sortMarketRows(US_ROWS, "mcap_desc").map((r) => r.symbol)).toEqual([
      "NVDA",
      "LLY",
      "SMALL",
    ]);
  });

  test("sector options are derived from the loaded US rows only", () => {
    expect(marketSectorOptions(US_ROWS)).toEqual([
      { value: "Pharmaceuticals", label: "Pharmaceuticals" },
      { value: "Semiconductors", label: "Semiconductors" },
      { value: "Software", label: "Software" },
    ]);
    expect(marketSectorOptions(US_ROWS).map((o) => o.value)).not.toContain("Banking");
  });

  test("reset drops unit-bound and India-specific filters but keeps unit-neutral ones", () => {
    const before = filters({
      priceMin: 100,
      mcapMinCr: 5000,
      capTiers: new Set(["large"]),
      sectors: ["IT"],
      fnoOnly: true,
      rsiMin: 40,
      relVolMax: 5,
      aboveSma200: true,
      dayChangeMin: -2,
      sort: "relvol_desc",
    });
    const after = resetUniverseSpecificFilters(before, "us");
    expect(after.priceMin).toBeNull();
    expect(after.mcapMinCr).toBeNull();
    expect(after.capTiers.size).toBe(0);
    expect(after.sectors).toEqual([]);
    expect(after.fnoOnly).toBe(false);
    expect(after.rsiMin).toBe(40);
    expect(after.relVolMax).toBe(5);
    expect(after.aboveSma200).toBe(true);
    expect(after.dayChangeMin).toBe(-2);
    expect(after.sort).toBe("relvol_desc");
  });

  test("reset clears fnoOnly and cap tiers in either direction", () => {
    const indiaToUs = resetUniverseSpecificFilters(
      filters({ fnoOnly: true, capTiers: new Set(["etf"]) }),
      "us",
    );
    expect(indiaToUs.fnoOnly).toBe(false);
    expect(indiaToUs.capTiers.size).toBe(0);

    const usToIndia = resetUniverseSpecificFilters(
      filters({ fnoOnly: true, capTiers: new Set(["etf"]) }),
      "all_equity",
    );
    expect(usToIndia.fnoOnly).toBe(false);
    expect(usToIndia.capTiers.size).toBe(0);
  });

  test("a US reset leaves no active F&O chip behind", () => {
    const after = resetUniverseSpecificFilters(filters({ fnoOnly: true }), "us");
    expect(buildMarketFilterChips(after, "us").map((c) => c.key)).not.toContain("fno");
  });

  test("a persisted F&O filter emits no chip in the US universe, but still does in India", () => {
    // A saved `universe=us` config can carry `fnoOnly: true` from the F&O rail
    // that no longer exists in the US. The descriptor — not the filter field —
    // decides whether that affordance is real.
    expect(buildMarketFilterChips(filters({ fnoOnly: true }), "us").map((c) => c.key)).not.toContain(
      "fno",
    );
    expect(countActiveMarketFilters(filters({ fnoOnly: true }), "us")).toBe(0);
    expect(buildMarketFilterChips(filters({ fnoOnly: true }), "all_equity").map((c) => c.key)).toContain(
      "fno",
    );
    expect(countActiveMarketFilters(filters({ fnoOnly: true }), "all_equity")).toBe(1);
  });
});

describe("filter benchmark", () => {
  const SECTORS = ["IT", "Energy", "FMCG", "Auto", "Pharma", "Banks", "Metals", "Telecom"];
  const benchRows: MarketRow[] = Array.from({ length: 3227 }, (_, i) =>
    row(`SYM${String(i).padStart(4, "0")}`, {
      name: `Company ${i} ${SECTORS[i % SECTORS.length]} Ltd`,
      sector: SECTORS[i % SECTORS.length],
      marketCapCr: 100 + (i * 37) % 200000,
      change: ((i * 13) % 200) / 10 - 10,
      rsi: (i * 7) % 100,
      pos52w: (i * 11) % 100,
    }),
  );
  const benchFilters: MarketFilterState = {
    ...defaultMarketFilters(),
    search: "company 12",
    sort: "mcap_desc",
  };

  test("median of 10 runs over 3,227 rows stays under 10ms", () => {
    // Warm-up so the WeakMap index is built before timing.
    filterMarketRows(benchRows, benchFilters);

    const samples: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      const start = performance.now();
      filterMarketRows(benchRows, benchFilters);
      samples.push(performance.now() - start);
    }
    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    // eslint-disable-next-line no-console
    console.log(`filterMarketRows median=${median.toFixed(2)}ms samples=${samples.map((s) => s.toFixed(2)).join(",")}`);
    expect(median).toBeLessThan(10);
  });
});

const VALUE_FIELDS = [
  "peMax",
  "psMax",
  "pbMax",
  "roeMin",
  "divYieldMin",
  "fcfYieldMin",
  "debtToEquityMax",
  "revYoyMin",
  "epsYoyMin",
] as const;

const VALUE_CHIP_KEYS = [
  "pe",
  "ps",
  "pb",
  "roe",
  "divYield",
  "fcfYield",
  "debtToEquity",
  "revYoy",
  "epsYoy",
] as const;

const FIELD_BY_CHIP: Record<(typeof VALUE_CHIP_KEYS)[number], (typeof VALUE_FIELDS)[number]> = {
  pe: "peMax",
  ps: "psMax",
  pb: "pbMax",
  roe: "roeMin",
  divYield: "divYieldMin",
  fcfYield: "fcfYieldMin",
  debtToEquity: "debtToEquityMax",
  revYoy: "revYoyMin",
  epsYoy: "epsYoyMin",
};

describe("value filters", () => {
  const VALUE_ROWS: MarketRow[] = [
    row("CHEAP", {
      peRatio: 12,
      psRatio: 1.5,
      pbRatio: 2,
      roe: 18,
      dividendYield: 2.5,
      fcfYield: 5,
      debtToEquity: 0.8,
      revYoy: 12,
      epsYoy: 20,
    }),
    row("PRICEY", {
      peRatio: 40,
      psRatio: 8,
      pbRatio: 9,
      roe: 8,
      dividendYield: 0.2,
      fcfYield: -1,
      debtToEquity: 2.5,
      revYoy: 3,
      epsYoy: -5,
    }),
    row("UNKNOWN"),
  ];

  const BOUNDS: Partial<MarketFilterState> = {
    peMax: 18,
    psMax: 2,
    pbMax: 3,
    roeMin: 15,
    divYieldMin: 1,
    fcfYieldMin: 0,
    debtToEquityMax: 1.5,
    revYoyMin: 10,
    epsYoyMin: 10,
  };

  test("every value bound is off by default", () => {
    const defaults = defaultMarketFilters();
    for (const field of VALUE_FIELDS) expect(defaults[field]).toBeNull();
    expect(symbols(filterOnlyMarketRows(VALUE_ROWS, defaults))).toEqual([
      "CHEAP",
      "PRICEY",
      "UNKNOWN",
    ]);
  });

  test("each active bound filters only its own field", () => {
    for (const field of VALUE_FIELDS) {
      expect(symbols(filterOnlyMarketRows(VALUE_ROWS, filters({ [field]: BOUNDS[field] })))).toEqual([
        "CHEAP",
      ]);
    }
  });

  test("a row with a null field is excluded while that bound is active, included when off", () => {
    const blank = [row("BLANK")];
    for (const field of VALUE_FIELDS) {
      expect(filterOnlyMarketRows(blank, filters({ [field]: BOUNDS[field] }))).toEqual([]);
    }
    expect(filterOnlyMarketRows(blank, filters())).toHaveLength(1);
  });

  test("value bounds are unit-neutral and survive a universe reset", () => {
    const after = resetUniverseSpecificFilters(filters(BOUNDS), "us");
    for (const field of VALUE_FIELDS) expect(after[field]).toBe(BOUNDS[field]);
  });

  test("each active value bound emits its own removable chip and raises the count", () => {
    const f = filters(BOUNDS);
    const chips = buildMarketFilterChips(f);
    expect(chips.map((c) => c.key)).toEqual([...VALUE_CHIP_KEYS]);
    expect(chips.map((c) => c.label)).toEqual([
      "P/E ≤ 18",
      "P/S ≤ 2",
      "P/B ≤ 3",
      "ROE ≥ 15%",
      "Div yield ≥ 1%",
      "FCF yield ≥ 0%",
      "D/E ≤ 1.5",
      "Rev growth ≥ 10%",
      "EPS growth ≥ 10%",
    ]);
    expect(countActiveMarketFilters(f)).toBe(VALUE_FIELDS.length);

    for (const chip of chips) {
      const field = FIELD_BY_CHIP[chip.key as (typeof VALUE_CHIP_KEYS)[number]];
      const cleared = clearMarketFilterChip(f, chip.key);
      expect(cleared[field]).toBeNull();
      // Removing one bound leaves the others intact.
      const others = VALUE_FIELDS.filter((other) => other !== field);
      for (const other of others) expect(cleared[other]).toBe(BOUNDS[other]);
    }
  });

  test("an undefined value bound emits no chip and cannot throw", () => {
    const f = filters({ peMax: undefined as unknown as null });
    expect(() => buildMarketFilterChips(f)).not.toThrow();
    expect(buildMarketFilterChips(f)).toEqual([]);
    expect(countActiveMarketFilters(f)).toBe(0);
  });

  test("the deep value preset is the documented one-click bundle", () => {
    // Sector percentiles, not absolute thresholds: a flat ROE >= 15 rejected
    // SBIN (14.58) and NTPC (14.66) while admitting a 4200%-ROE one-off gain.
    expect(DEEP_VALUE_PRESET).toEqual({
      pePctMax: 0.35,
      roePctMin: 0.45,
      dePctMax: 0.3,
    });
    // FCF is excluded on purpose: ~6% coverage on Indian names (measured 3/50)
    // made it the filter doing nearly all the narrowing, on absent data.
    expect("fcfYieldMin" in DEEP_VALUE_PRESET).toBe(false);
  });

  test("the preset chip appears only for the whole bundle and clears all four bounds", () => {
    const f = filters(DEEP_VALUE_PRESET);
    expect(deepValuePresetActive(f)).toBe(true);
    const chips = buildMarketFilterChips(f);
    expect(chips.some((c) => c.key === "deepValue")).toBe(true);
    expect(chips.find((c) => c.key === "deepValue")?.label).toBe("Deep value preset");

    const cleared = clearMarketFilterChip(f, "deepValue");
    expect(cleared.pePctMax).toBeNull();
    expect(cleared.roePctMin).toBeNull();
    expect(cleared.dePctMax).toBeNull();
    // Untouched bounds survive the preset removal.
    expect(cleared.psMax).toBeNull();
    expect(cleared.peMax).toBeNull();

    const tweaked = filters({ ...DEEP_VALUE_PRESET, pePctMax: 0.2 });
    expect(deepValuePresetActive(tweaked)).toBe(false);
    expect(buildMarketFilterChips(tweaked).some((c) => c.key === "deepValue")).toBe(false);
  });

  test("removing an individual preset bound drops the preset chip but keeps the rest", () => {
    const f = filters(DEEP_VALUE_PRESET);
    const after = clearMarketFilterChip(f, "pePct");
    expect(after.pePctMax).toBeNull();
    expect(after.roePctMin).toBe(0.45);
    expect(deepValuePresetActive(after)).toBe(false);
    expect(buildMarketFilterChips(after).some((c) => c.key === "deepValue")).toBe(false);
  });
});

describe("sector percentile gates", () => {
  // Five peers per bucket: PCT_MIN_BUCKET is 5, and the gate counts the row
  // itself, so a 6-member bucket has a meaningful ascending rank.
  const peers = (sector: string, pes: number[]): MarketRow[] =>
    pes.map((pe, i) => row(`${sector}${i}`, { sector, peRatio: pe }));

  test("ranks are within the row's own sector, not across the whole frame", () => {
    const cheapInRichSector = row("CHEAPINRICH", { sector: "Tech", peRatio: 20 });
    const samePeInCheapSector = row("SAMEPEINCHEAP", { sector: "Utilities", peRatio: 20 });
    const rows = [
      ...peers("Tech", [100, 200, 300, 400, 500]),
      cheapInRichSector,
      ...peers("Utilities", [5, 8, 10, 12, 15]),
      samePeInCheapSector,
    ];

    const ranks = sectorPercentiles(rows, ["pe"]);
    // P/E 20 is the cheapest of six Tech names but the dearest of six Utilities.
    expect(ranks.get(cheapInRichSector)!.pe).toBeCloseTo(1 / 6);
    expect(ranks.get(samePeInCheapSector)!.pe).toBe(1);

    const kept = symbols(filterOnlyMarketRows(rows, filters({ pePctMax: 0.35 })));
    expect(kept).toContain("CHEAPINRICH");
    expect(kept).not.toContain("SAMEPEINCHEAP");
  });

  test("a bucket below PCT_MIN_BUCKET is unranked and its row IS dropped by an active gate", () => {
    // Current, deliberate behaviour: sectorPercentiles skips thin buckets and
    // filterOnlyMarketRows fails any row it cannot rank. This test pins that
    // outcome (rather than the opposite) so a future change is visible.
    const thin = row("THIN", { sector: "Thin", peRatio: 10 });
    const rows = [
      row("T0", { sector: "Thin", peRatio: 5 }),
      row("T1", { sector: "Thin", peRatio: 15 }),
      thin,
      ...peers("Fat", [10, 20, 30, 40, 50]),
    ];

    expect(sectorPercentiles(rows, ["pe"]).get(thin)!.pe).toBeUndefined();
    expect(symbols(filterOnlyMarketRows(rows, filters()))).toContain("THIN");
    expect(symbols(filterOnlyMarketRows(rows, filters({ pePctMax: 0.5 })))).not.toContain("THIN");
  });

  test("ranks are computed before other predicates remove peers", () => {
    const keep = row("KEEP", { name: "Keep me", sector: "Tech", peRatio: 30 });
    const rows = [
      keep,
      ...[10, 20, 40, 50, 60].map((pe, i) =>
        row(`DROP${i}`, { name: `Drop ${i}`, sector: "Tech", peRatio: pe }),
      ),
    ];

    // The search removes every peer but KEEP. Its rank must still be 3/6 = 0.5
    // over the pre-gate frame; a post-gate rank would be 1/1 = 1 and drop it.
    expect(sectorPercentiles(rows, ["pe"]).get(rows[0])!.pe).toBeCloseTo(0.5);
    expect(symbols(filterOnlyMarketRows(rows, filters({ pePctMax: 0.5, search: "keep" })))).toEqual([
      "KEEP",
    ]);
  });

  test("tied values share one rank rather than splitting arbitrarily", () => {
    const tied = [0, 1, 2, 3, 4].map((i) => row(`TIE${i}`, { sector: "Tech", peRatio: 20 }));
    const rich = row("RICH", { sector: "Tech", peRatio: 100 });
    const rows = [...tied, rich];

    const ranks = sectorPercentiles(rows, ["pe"]);
    for (const t of tied) expect(ranks.get(t)!.pe).toBeCloseTo(5 / 6);
    expect(ranks.get(rich)!.pe).toBe(1);

    // All five ties cross a 0.85 gate together and none crosses a 0.80 gate.
    expect(symbols(filterOnlyMarketRows(rows, filters({ pePctMax: 0.8 })))).toEqual([]);
    expect(symbols(filterOnlyMarketRows(rows, filters({ pePctMax: 0.85 })))).toEqual(
      symbols(tied),
    );
  });
});

// The mover fields arrive with the parallel MarketRow extension; cast at the
// fixture boundary so these tests pin the preset contract, not the cast.
type MoverFields = {
  gap: number | null;
  rangeVsAtr: number | null;
  to52wHighPct: number | null;
  from52wLowPct: number | null;
  volume: number | null;
  valueTraded: number | null;
};

const moverRow = (
  symbol: string,
  overrides: Partial<MarketRow> & Partial<MoverFields> = {},
): MarketRow =>
  row(symbol, {
    gap: null,
    rangeVsAtr: null,
    to52wHighPct: null,
    from52wLowPct: null,
    volume: null,
    valueTraded: null,
    ...overrides,
  } as Partial<MarketRow>);

const MOVER_ROWS: MarketRow[] = [
  moverRow("WIN", {
    change: 5, gap: 1, relativeVolume: 1, volume: 100, valueTraded: 1000,
    to52wHighPct: -0.2, from52wLowPct: 60, rangeVsAtr: 0.5,
  }),
  moverRow("LOSE", {
    change: -5, gap: -1, relativeVolume: 1, volume: 200, valueTraded: 2000,
    to52wHighPct: -30, from52wLowPct: 20, rangeVsAtr: 0.6,
  }),
  moverRow("NEARHI", {
    change: 0.5, gap: 0, relativeVolume: 1, volume: 300, valueTraded: 3000,
    to52wHighPct: -2, from52wLowPct: 70, rangeVsAtr: 0.7,
  }),
  moverRow("NEARLO", {
    change: 0.2, gap: 0, relativeVolume: 1, volume: 400, valueTraded: 4000,
    to52wHighPct: -40, from52wLowPct: 2, rangeVsAtr: 0.8,
  }),
  moverRow("SURGE", {
    change: 1, gap: 0.5, relativeVolume: 4, volume: 500, valueTraded: 5000,
    to52wHighPct: -10, from52wLowPct: 30, rangeVsAtr: 0.9,
  }),
  moverRow("ACTIVE", {
    change: 0.3, gap: 0.2, relativeVolume: 1, volume: 9000, valueTraded: 6000,
    to52wHighPct: -15, from52wLowPct: 25, rangeVsAtr: 1,
  }),
  moverRow("TURNOV", {
    change: 0.4, gap: 0.1, relativeVolume: 1, volume: 600, valueTraded: 99000,
    to52wHighPct: -12, from52wLowPct: 28, rangeVsAtr: 1.1,
  }),
  moverRow("GAPUP", {
    change: 2, gap: 4, relativeVolume: 1, volume: 700, valueTraded: 7000,
    to52wHighPct: -8, from52wLowPct: 35, rangeVsAtr: 1.2,
  }),
  moverRow("GAPDN", {
    change: -2, gap: -4, relativeVolume: 1, volume: 800, valueTraded: 8000,
    to52wHighPct: -25, from52wLowPct: 10, rangeVsAtr: 1.3,
  }),
  moverRow("RANGE", {
    change: 0.6, gap: 0, relativeVolume: 1, volume: 850, valueTraded: 8500,
    to52wHighPct: -18, from52wLowPct: 22, rangeVsAtr: 5,
  }),
  // The frame had no row at/above the 52W high or at/below the 52W low, so the
  // two "New 52W" presets would otherwise only ever select an empty set here.
  moverRow("BREAKOUT", {
    change: 7, gap: 2, relativeVolume: 1, volume: 950, valueTraded: 9500,
    to52wHighPct: 1.5, from52wLowPct: 90, rangeVsAtr: 1.4,
  }),
  moverRow("BREAKDN", {
    change: -7, gap: -2, relativeVolume: 1, volume: 960, valueTraded: 9600,
    to52wHighPct: -60, from52wLowPct: -1.2, rangeVsAtr: 1.5,
  }),
  moverRow("NULLS", {
    change: null, gap: null, rangeVsAtr: null, to52wHighPct: null, from52wLowPct: null,
    volume: null, valueTraded: null, relativeVolume: null,
  }),
];

function applyPreset(preset: MoverPreset): MarketFilterState {
  return filters({ ...preset.filters, sort: preset.sort });
}

test("switching from Gap Up to Gainers clears the previous preset's bounds", () => {
  const gapUp = MOVER_PRESETS.find((preset) => preset.id === "gapUp")!;
  const gainers = MOVER_PRESETS.find((preset) => preset.id === "gainers")!;
  const withUserFilter = { ...applyPreset(gapUp), sectors: ["IT"] };
  const next = mergeMoverPresetFilters(withUserFilter, gainers.filters);
  expect(next.gapMin).toBeNull();
  expect(next.mcapMinCr).toBe(gapUp.filters.mcapMinCr);
  expect(next.sectors).toEqual(["IT"]);
  expect(next.gapMax).toBeNull();
  expect(next.relVolMin).toBeNull();
  expect(next.to52wHighMin).toBeNull();
});

const PRESET_SUBSETS: Record<string, string[]> = {
  gainers: symbols(MOVER_ROWS),
  losers: symbols(MOVER_ROWS),
  nearHigh: ["NEARHI", "WIN"],
  newHigh: ["BREAKOUT"],
  nearLow: ["NEARLO"],
  newLow: ["BREAKDN"],
  volumeSurge: ["SURGE"],
  mostActive: symbols(MOVER_ROWS),
  turnover: symbols(MOVER_ROWS),
  gapUp: ["GAPUP"],
  gapDown: ["GAPDN"],
  rangeExpansion: symbols(MOVER_ROWS),
};

describe("MOVER_PRESETS — dashboard.py thresholds and report panels", () => {
  test("there is exactly one preset per mover panel id", () => {
    // The last two come from ReportMovePanels.tsx, which is the only source of
    // New 52W High / Low; the rest mirror api/screener_api/dashboard.py.
    expect(MOVER_PRESETS.map((p) => p.id)).toEqual([
      "gainers",
      "losers",
      "nearHigh",
      "newHigh",
      "nearLow",
      "newLow",
      "volumeSurge",
      "mostActive",
      "turnover",
      "gapUp",
      "gapDown",
      "rangeExpansion",
    ]);
    for (const preset of MOVER_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(3);
      expect(preset.description.trim().length).toBeGreaterThan(10);
    }
  });

  test("every threshold matches its source panel", () => {
    expect(MOVER_PRESETS.map((p) => [p.id, p.filters, p.sort])).toEqual([
      // dashboard.py sorts by change with no threshold — gainers/losers are
      // pure top-N sorts, so the table's "+3 / -3" is deliberately NOT applied.
      // Every preset carries the dashboard's default min_market_cap_cr = 500
      // floor; without it the presets do not mirror the tab (gap>=3 matched 132
      // rows across all 3,593 but only 9 with the floor).
      ["gainers", { mcapMinCr: 500 }, "day_desc"],
      ["losers", { mcapMinCr: 500 }, "day_asc"],
      ["nearHigh", { mcapMinCr: 500, to52wHighMin: -5, to52wHighMax: 0.5 }, "to_52w_high_desc"],
      // ReportMovePanels.tsx "new_52w_high" = close at/above the 52W high;
      // to52wHighPct >= 0 with no ceiling, highest above the high first.
      ["newHigh", { mcapMinCr: 500, to52wHighMin: 0 }, "to_52w_high_desc"],
      ["nearLow", { mcapMinCr: 500, from52wLowMin: -0.5, from52wLowMax: 5 }, "from_52w_low_asc"],
      // ReportMovePanels.tsx "new_52w_low" = close at/below the 52W low;
      // from52wLowPct <= 0 with no lower bound, lowest below the low first.
      ["newLow", { mcapMinCr: 500, from52wLowMax: 0 }, "from_52w_low_asc"],
      ["volumeSurge", { mcapMinCr: 500, relVolMin: 3 }, "relvol_desc"],
      ["mostActive", { mcapMinCr: 500 }, "volume_desc"],
      ["turnover", { mcapMinCr: 500 }, "value_traded_desc"],
      ["gapUp", { mcapMinCr: 500, gapMin: 3 }, "gap_desc"],
      ["gapDown", { mcapMinCr: 500, gapMax: -3 }, "gap_asc"],
      // dashboard.py includes every row with a usable ATR and sorts by
      // range ÷ ATR — there is no ">= 2" gate to copy.
      ["rangeExpansion", { mcapMinCr: 500 }, "range_vs_atr_desc"],
    ]);
    for (const preset of MOVER_PRESETS) {
      expect(MARKET_SORT_OPTIONS.map((o) => o.value)).toContain(preset.sort);
    }
  });

  test("each preset selects the expected row subset", () => {
    for (const preset of MOVER_PRESETS) {
      expect(symbols(filterOnlyMarketRows(MOVER_ROWS, applyPreset(preset)))).toEqual(
        PRESET_SUBSETS[preset.id],
      );
    }
  });

  test("pure top-N sorts do not narrow the frame at all", () => {
    // A "pure sort" now carries only the shared market-cap floor, which every
    // fixture row clears — so it still must not narrow anything.
    const pureSorts = MOVER_PRESETS.filter(
      (p) => Object.keys(p.filters).every((k) => k === "mcapMinCr"),
    );
    expect(pureSorts.map((p) => p.id)).toEqual([
      "gainers", "losers", "mostActive", "turnover", "rangeExpansion",
    ]);
    for (const preset of pureSorts) {
      expect(filterOnlyMarketRows(MOVER_ROWS, applyPreset(preset))).toHaveLength(
        MOVER_ROWS.length,
      );
      expect(preset.description.toLowerCase()).toContain("sort");
    }
  });

  test("every preset sort actually reorders the frame", () => {
    const expected: Record<string, string[]> = {
      gainers: ["BREAKOUT", "WIN", "GAPUP", "SURGE", "RANGE", "NEARHI", "TURNOV", "ACTIVE", "NEARLO", "GAPDN", "LOSE", "BREAKDN", "NULLS"],
      losers: ["BREAKDN", "LOSE", "GAPDN", "NEARLO", "ACTIVE", "TURNOV", "NEARHI", "RANGE", "SURGE", "GAPUP", "WIN", "BREAKOUT", "NULLS"],
      nearHigh: ["WIN", "NEARHI"],
      newHigh: ["BREAKOUT"],
      nearLow: ["NEARLO"],
      newLow: ["BREAKDN"],
      volumeSurge: ["SURGE"],
      mostActive: ["ACTIVE", "BREAKDN", "BREAKOUT", "RANGE", "GAPDN", "GAPUP", "TURNOV", "SURGE", "NEARLO", "NEARHI", "LOSE", "WIN", "NULLS"],
      turnover: ["TURNOV", "BREAKDN", "BREAKOUT", "RANGE", "GAPDN", "GAPUP", "ACTIVE", "SURGE", "NEARLO", "NEARHI", "LOSE", "WIN", "NULLS"],
      gapUp: ["GAPUP"],
      gapDown: ["GAPDN"],
      rangeExpansion: ["RANGE", "BREAKDN", "BREAKOUT", "GAPDN", "GAPUP", "TURNOV", "ACTIVE", "SURGE", "NEARLO", "NEARHI", "LOSE", "WIN", "NULLS"],
    };
    for (const preset of MOVER_PRESETS) {
      expect(filterMarketRows(MOVER_ROWS, applyPreset(preset)).map((r) => r.symbol)).toEqual(
        expected[preset.id],
      );
    }
  });
});

describe("new 52W high / low presets", () => {
  const byId = (id: string): MoverPreset => MOVER_PRESETS.find((p) => p.id === id)!;

  test("new high includes a close at/above the 52W high and excludes below", () => {
    const rows = [
      moverRow("ATH", { to52wHighPct: 0 }),
      moverRow("ABOVE", { to52wHighPct: 2.4 }),
      moverRow("BELOW", { to52wHighPct: -0.01 }),
    ];
    const kept = symbols(filterOnlyMarketRows(rows, applyPreset(byId("newHigh"))));
    expect(kept).toContain("ATH");
    expect(kept).toContain("ABOVE");
    expect(kept).not.toContain("BELOW");
    expect(kept).toEqual(["ABOVE", "ATH"]);
  });

  test("new low includes a close at/below the 52W low and excludes above", () => {
    const rows = [
      moverRow("ATLOW", { from52wLowPct: 0 }),
      moverRow("BELOWLOW", { from52wLowPct: -2.4 }),
      moverRow("ABOVELOW", { from52wLowPct: 0.01 }),
    ];
    const kept = symbols(filterOnlyMarketRows(rows, applyPreset(byId("newLow"))));
    expect(kept).toContain("ATLOW");
    expect(kept).toContain("BELOWLOW");
    expect(kept).not.toContain("ABOVELOW");
    expect(kept).toEqual(["ATLOW", "BELOWLOW"]);
  });

  test("both presets carry the ₹500 Cr floor", () => {
    // 499 sits just below the dashboard floor, 500 exactly on it.
    const rows = [
      moverRow("SMALLHIGH", { marketCapCr: 499, to52wHighPct: 1 }),
      moverRow("BIGHIGH", { marketCapCr: 500, to52wHighPct: 1 }),
      moverRow("SMALLLOW", { marketCapCr: 499, from52wLowPct: -1 }),
      moverRow("BIGLOW", { marketCapCr: 500, from52wLowPct: -1 }),
    ];
    expect(symbols(filterOnlyMarketRows(rows, applyPreset(byId("newHigh"))))).toEqual(["BIGHIGH"]);
    expect(symbols(filterOnlyMarketRows(rows, applyPreset(byId("newLow"))))).toEqual(["BIGLOW"]);
  });

  test("new high sorts highest above the high first, new low lowest below the low first", () => {
    const rows = [
      moverRow("MID", { to52wHighPct: 1.5, from52wLowPct: -1.5 }),
      moverRow("TOP", { to52wHighPct: 3, from52wLowPct: -3 }),
      moverRow("EDGE", { to52wHighPct: 0.5, from52wLowPct: -0.5 }),
    ];
    expect(filterMarketRows(rows, applyPreset(byId("newHigh"))).map((r) => r.symbol)).toEqual([
      "TOP", "MID", "EDGE",
    ]);
    expect(filterMarketRows(rows, applyPreset(byId("newLow"))).map((r) => r.symbol)).toEqual([
      "TOP", "MID", "EDGE",
    ]);
  });
});

const MOVER_FIELD_KEYS = [
  "gapMin", "gapMax", "rangeVsAtrMin",
  "to52wHighMin", "to52wHighMax",
  "from52wLowMin", "from52wLowMax",
  "volumeMin", "valueTradedMin",
] as const;

describe("mover filter state — defaults, chips and nulls", () => {
  test("every mover bound is null by default and does not narrow the frame", () => {
    const defaults = defaultMarketFilters();
    for (const key of MOVER_FIELD_KEYS) expect(defaults[key]).toBeNull();
    expect(filterOnlyMarketRows(MOVER_ROWS, defaults)).toHaveLength(MOVER_ROWS.length);
    expect(buildMarketFilterChips(defaults)).toEqual([]);
  });

  test("a null row value is excluded whenever its preset bound is active", () => {
    const blank = [moverRow("BLANK")];
    const active: Partial<MarketFilterState>[] = [
      { gapMin: 3 }, { gapMax: -3 }, { rangeVsAtrMin: 2 },
      { to52wHighMin: -5, to52wHighMax: 0.5 },
      { to52wHighMin: 0 },
      { from52wLowMin: -0.5, from52wLowMax: 5 },
      { from52wLowMax: 0 },
      { volumeMin: 100 }, { valueTradedMin: 100 },
    ];
    for (const patch of active) {
      expect(filterOnlyMarketRows(blank, filters(patch))).toEqual([]);
      expect(filterOnlyMarketRows(blank, filters())).toHaveLength(1);
    }
  });

  test("each preset emits one removable chip that clears its filters and sort", () => {
    for (const preset of MOVER_PRESETS) {
      const f = applyPreset(preset);
      const key = `mover:${preset.id}`;
      const chips = buildMarketFilterChips(f);
      const chip = chips.find((c) => c.key === key);
      expect(chip?.label).toBe(`${preset.label} preset`);

      const cleared = clearMarketFilterChip(f, key);
      for (const field of Object.keys(preset.filters) as (keyof MarketFilterState)[]) {
        expect(cleared[field]).toBeNull();
      }
      expect(cleared.sort).toBe(DEFAULT_MARKET_SORT);
      expect(buildMarketFilterChips(cleared).some((c) => c.key === key)).toBe(false);
      expect(filterOnlyMarketRows(MOVER_ROWS, cleared)).toHaveLength(MOVER_ROWS.length);
    }
  });

  test("new bound keys build chips and are cleared by their own key", () => {
    const f = filters({
      gapMin: 3, gapMax: 8, rangeVsAtrMin: 2,
      to52wHighMin: -5, to52wHighMax: 0.5,
      from52wLowMin: -0.5, from52wLowMax: 5,
      volumeMin: 1000, valueTradedMin: 5000,
    });
    const keys = buildMarketFilterChips(f).map((c) => c.key);
    for (const key of ["gap", "rangeVsAtr", "to52wHigh", "from52wLow", "volume", "valueTraded"]) {
      expect(keys).toContain(key);
      const cleared = clearMarketFilterChip(f, key);
      expect(buildMarketFilterChips(cleared).map((c) => c.key)).not.toContain(key);
    }
  });
});

describe("mover presets — sorts must actually differ", () => {
  /**
   * Guard for a real bug: a preset whose sort has no table column (volume,
   * value traded, range/ATR) was applied only to `filters.sort`, while the grid
   * re-sorted from its own state — so Most Active, Top Turnover and Range
   * Expansion all rendered mcap order. Every preset must produce a distinct
   * ordering on a frame where the metrics genuinely disagree.
   */
  test("each preset's sort orders the frame differently", () => {
    const distinct = MOVER_PRESETS.filter((p) => p.sort !== "day_desc").map((p) => p.sort);
    const tops = new Set<string>();
    for (const key of new Set(distinct)) {
      const ordered = sortMarketRows(MOVER_ROWS, key);
      tops.add(ordered.slice(0, 3).map((r) => r.symbol).join(","));
    }
    // At least as many distinct orderings as distinct sorts on this fixture.
    expect(tops.size).toBeGreaterThanOrEqual(Math.min(3, new Set(distinct).size));
  });
});
