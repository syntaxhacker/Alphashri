// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test } from "vitest";
import {
  buildMarketFilterChips,
  countActiveMarketFilters,
  countByCapTier,
  defaultMarketFilters,
  filterMarketRows,
  filterOnlyMarketRows,
  marketSectors,
  sortMarketRows,
  MARKET_SORT_OPTIONS,
  type MarketFilterState,
} from "./marketFilters";
import type { MarketRow } from "../../types/marketScreener";

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
    // empty set = no filtering
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
    // null price excluded when a bound is set
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

  test("F&O and ETF switches", () => {
    expect(symbols(filterMarketRows(ROWS, filters({ fnoOnly: true })))).toEqual([
      "LARGECO",
      "MIDCO",
    ]);
    expect(symbols(filterMarketRows(ROWS, filters({ etfOnly: true })))).toEqual(["ETFCO"]);
    expect(symbols(filterMarketRows(ROWS, filters({ fnoOnly: true, etfOnly: true })))).toEqual(
      [],
    );
  });

  test("sector select is an exact match", () => {
    expect(symbols(filterMarketRows(ROWS, filters({ sector: "IT" })))).toEqual(["MIDCO"]);
    expect(filterMarketRows(ROWS, filters({ sector: "Energy" }))).toHaveLength(1);
    expect(filterMarketRows(ROWS, filters({ sector: "Banking" }))).toEqual([]);
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
        etfOnly: true,
        sector: "Energy",
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
      "etf",
      "sector",
    ]);
    expect(countActiveMarketFilters(filters({ rsiMin: 30, fnoOnly: true }))).toBe(2);
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
