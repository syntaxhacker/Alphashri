import { describe, expect, test } from "vitest";
import {
  DEFAULT_MARKET_SIZE_METRIC,
  MARKET_METRICS,
  MAX_STOCKS_PER_SECTOR,
  MAX_STOCKS_PER_SECTOR_NARROW,
  MIN_LABEL_WIDTH_PX,
  NARROW_SYMBOL_MAX_CHARS,
  NARROW_TREEMAP_MAX_WIDTH,
  UNCLASSIFIED_SECTOR,
  buildSectorTreemapOption,
  estimatedTileWidthPx,
  isNarrowTreemap,
  maxStocksPerSector,
  otherLabel,
  sectorOf,
  shortTreemapSymbol,
  stockTileLabelVisible,
  suppressTinyFlatLabels,
  MARKET_SIZE_METRICS,
  MARKET_SIZE_METRIC_VALUES,
  isMarketSizeMetric,
  marketColorDomain,
  marketColorRampCss,
  marketLerpRgb,
  marketMetricOptions,
  marketSignedMetricColor,
  marketSizeMetrics,
  marketTileColor,
  marketTileTextColor,
  marketTreemapMetrics,
  usableSizeMetrics,
  robustColorBounds,
  toTreemapRow,
} from "./marketTreemap";
import { currencyFor } from "@/config/currency";
import {
  BG,
  SURFACE,
  CIVIDIS_STOPS,
  MARKET_RAMP_NEUTRAL,
  MARKET_RAMP_STRONG_GREEN,
  MARKET_RAMP_STRONG_RED,
  SCALE_BLUE,
  TEXT_ON_ACCENT,
} from "@/ui/palette";
import { buildStockTreemapOption, getStockMetricRange, safeFmt } from "@/components/heatmap/stockTreemap";
import {
  getMetricValue,
  getMetricColor,
  getHeatmapMetricColor,
  getSignedMetricColor,
} from "@/components/heatmap/heatmapUtils";
import { contrastRatio, pickTextColor, relativeLuminance } from "@/utils/contrast";
import type { HeatmapStock } from "@/api/heatmap";
import type { MarketRow } from "@/types/marketScreener";

const base: MarketRow = {
  symbol: "RELIANCE",
  name: "Reliance Industries",
  sector: "Energy",
  exchange: "NSE",
  close: 1339.7,
  change: 1.25,
  relativeVolume: 1.4,
  marketCapCr: 1805376,
  capTier: "large",
  rsi: 58.2,
  adx: 31.4,
  sma20: 1300,
  sma50: 1280,
  sma200: 1200,
  perfW: 2.1,
  perf1m: 4.6,
  high52w: 1600,
  low52w: 1100,
  pos52w: 48.2,
  peRatio: 22.1,
  pbRatio: 1.92,
  dividendYield: 0.35,
  roe: 9.01,
  fno: true,
  etf: false,
};

/** The shape that blanked the screener: a name TV has no fundamentals for. */
const noFundamentals: MarketRow = {
  ...base,
  symbol: "NOFUND",
  peRatio: null,
  pbRatio: null,
  dividendYield: null,
  roe: null,
  rsi: null,
  adx: null,
  pos52w: null,
  perfW: null,
  perf1m: null,
  relativeVolume: null,
  close: null,
  change: null,
  marketCapCr: null,
};

const STYLE = {
  borderDark: "#000",
  borderLight: "#fff",
  label: { fontSize: 11, fontWeight: 600 as const, lineHeight: 1 },
  changePositive: "#0f0",
  changeNegative: "#f00",
  sortTilesByValueDesc: true,
};

const tilesFor = (rows: HeatmapStock[], metric: string) =>
  buildStockTreemapOption(rows, metric, MARKET_SIZE_METRICS, true, STYLE, "metric").series[0]
    .data as Array<{ name: string; value: number; metricNumeric: number; change: number }>;

describe("toTreemapRow", () => {
  test("converts ₹ crore market cap to rupees for the treemap formatter", () => {
    expect(toTreemapRow(base).market_cap).toBeCloseTo(1805376 * 1e7, 0);
  });

  test("maps the live metrics the heatmap rows do not carry", () => {
    const out = toTreemapRow(base);
    expect(out.rsi).toBe(58.2);
    expect(out.adx).toBe(31.4);
    expect(out.relative_volume).toBe(1.4);
    expect(out.pos_52w).toBe(48.2);
    expect(out.perf_w).toBe(2.1);
    expect(out.perf_1m).toBe(4.6);
  });

  test("does not pass the 1-month return off as 1-year", () => {
    expect(toTreemapRow(base).perf_1y).toBeNull();
  });

  test("carries the fundamentals the market snapshot now returns", () => {
    const out = toTreemapRow(base);
    expect(out.pe_ratio).toBe(22.1);
    expect(out.pb_ratio).toBe(1.92);
    expect(out.dividend_yield).toBe(0.35);
    expect(out.roe).toBe(9.01);
  });

  test("keeps a missing sector renderable", () => {
    expect(toTreemapRow({ ...base, sector: null }).sector).toBe("—");
  });
});

describe("a row with no fundamentals must never crash the map", () => {
  test("every metric resolves to a finite number", () => {
    const row = toTreemapRow(noFundamentals);
    for (const metric of MARKET_METRICS) {
      const value = getMetricValue(row as HeatmapStock, metric.value);
      expect(Number.isFinite(value), `${metric.value} was ${value}`).toBe(true);
    }
  });

  test("every metric formats to a string, never throws", () => {
    const row = toTreemapRow(noFundamentals);
    for (const metric of MARKET_METRICS) {
      const value = getMetricValue(row as HeatmapStock, metric.value);
      expect(() => safeFmt(metric, value), metric.value).not.toThrow();
      expect(typeof safeFmt(metric, value)).toBe("string");
    }
  });

  test("safeFmt renders a dash for undefined and NaN", () => {
    const metric = MARKET_METRICS.find((m) => m.value === "pe_ratio")!;
    expect(safeFmt(metric, undefined)).toBe("—");
    expect(safeFmt(metric, Number.NaN)).toBe("—");
    expect(safeFmt(metric, Number.POSITIVE_INFINITY)).toBe("—");
  });

  test("safeFmt still formats a real number", () => {
    const metric = MARKET_METRICS.find((m) => m.value === "pe_ratio")!;
    expect(safeFmt(metric, 22.14)).toBe("22.1");
  });

  test("safeFmt survives a formatter that throws", () => {
    const angry = { value: "x", label: "X", fmt: () => { throw new Error("boom"); } };
    expect(safeFmt(angry, 5)).toBe("—");
  });

  test("the metric range is finite even when every row lacks the value", () => {
    const rows = [toTreemapRow(noFundamentals), toTreemapRow({ ...noFundamentals, symbol: "B" })];
    const { min, max } = getStockMetricRange(rows as HeatmapStock[], "pe_ratio");
    expect(Number.isFinite(min)).toBe(true);
    expect(Number.isFinite(max)).toBe(true);
    expect(max).toBeGreaterThanOrEqual(min);
  });

  test("building the whole treemap option for a mixed universe does not throw", () => {
    const rows = [
      toTreemapRow(base),
      toTreemapRow(noFundamentals),
      toTreemapRow({ ...base, symbol: "MID", peRatio: null, rsi: 40 }),
    ] as HeatmapStock[];
    for (const metric of MARKET_METRICS) {
      expect(() =>
        buildStockTreemapOption(rows, metric.value, MARKET_METRICS, true, {
          borderDark: "#000",
          borderLight: "#fff",
          label: { fontSize: 11, fontWeight: 600, lineHeight: 1 },
          changePositive: "#0f0",
          changeNegative: "#f00",
        }),
        metric.value,
      ).not.toThrow();
    }
  });

  test("colouring a missing value stays within the ramp instead of returning NaN", () => {
    const row = toTreemapRow(noFundamentals);
    for (const metric of MARKET_METRICS) {
      const value = getMetricValue(row as HeatmapStock, metric.value);
      const colour = getHeatmapMetricColor(metric.value, value, 0, 100);
      expect(colour, metric.value).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    }
  });
});

/**
 * The crash that blanked the screener: a metric that reaches the treemap with a
 * null/undefined field produced `Math.abs(undefined) === NaN` as a tile area.
 * Pin all twelve metrics — especially the seven newly-selectable fields — to a
 * finite, positive weight (the ZERO_TILE_AREA_RATIO floor in stockTreemap.ts).
 */
describe("every size metric yields a finite area when its field is null", () => {
  // Which MarketRow field feeds each treemap metric. A real row is always kept
  // alongside the nulled one so the test never passes vacuously with zero tiles.
  const NULL_FIELD: Record<string, Partial<MarketRow>> = {
    change_pct: { change: null },
    relative_volume: { relativeVolume: null },
    rsi: { rsi: null },
    adx: { adx: null },
    pos_52w: { pos52w: null },
    perf_w: { perfW: null },
    perf_1m: { perf1m: null },
    market_cap: { marketCapCr: null },
    pe_ratio: { peRatio: null },
    pb_ratio: { pbRatio: null },
    roe: { roe: null },
    dividend_yield: { dividendYield: null },
  };

  const tilesForAll = (rows: HeatmapStock[], metric: string) =>
    buildStockTreemapOption(rows, metric, MARKET_METRICS, true, STYLE, "metric").series[0]
      .data as Array<{ name: string; value: number }>;

  test.each(MARKET_SIZE_METRIC_VALUES)(
    "%s: a null field never produces a NaN/Infinity tile area",
    (metric) => {
      const real = toTreemapRow(base);
      const missing = toTreemapRow({ ...base, symbol: "MISSING", ...NULL_FIELD[metric] });
      const data = tilesForAll([real, missing] as HeatmapStock[], metric);
      expect(data.length, `${metric} produced no tiles at all`).toBeGreaterThan(0);
      for (const tile of data) {
        expect(Number.isFinite(tile.value), `${metric} / ${tile.name} had area ${tile.value}`).toBe(
          true,
        );
        expect(tile.value, `${metric} / ${tile.name} was not positive`).toBeGreaterThan(0);
      }
      // Math.abs(undefined) -> NaN must never reach the treemap `value`.
      expect(data.some((tile) => Number.isNaN(tile.value)), metric).toBe(false);
      // The nulled row is either dropped or floored, never handed a NaN area.
      const missingTile = data.find((tile) => tile.name === "MISSING");
      if (missingTile) expect(Number.isFinite(missingTile.value), metric).toBe(true);
    },
  );

  test("all seven newly-selectable fields are carried from MarketRow into the treemap row", () => {
    const mapped = toTreemapRow(base) as unknown as HeatmapStock & Record<string, unknown>;
    expect(mapped.adx).toBe(31.4);
    expect(mapped.perf_w).toBe(2.1);
    expect(mapped.perf_1m).toBe(4.6);
    expect(mapped.pe_ratio).toBe(22.1);
    expect(mapped.pb_ratio).toBe(1.92);
    expect(mapped.roe).toBe(9.01);
    expect(mapped.dividend_yield).toBe(0.35);
  });
});

describe("MARKET_METRICS", () => {
  test("offers both live technicals and fundamentals", () => {
    const values = MARKET_METRICS.map((m) => m.value);
    expect(values).toEqual(
      expect.arrayContaining(["change_pct", "rsi", "pos_52w", "pe_ratio", "roe"]),
    );
  });
});

describe("52W Position formatter convention", () => {
  const fmt = MARKET_METRICS.find((m) => m.value === "pos_52w")!.fmt;

  // api/market_screen/snapshot.py:417 shapes this as
  // `(close - low) / (high - low) * 100` — a 0–100 percentage, the same unit
  // the table's Week52Bar clamps to [0,100] before printing a `%`.
  test("renders a 0–100 position as a percentage, not a fraction", () => {
    expect(fmt(81)).toBe("81%");
    expect(fmt(18)).toBe("18%");
    // A 0–1 value is NOT rescaled here: multiplying by 100 would turn a real
    // 81 into 8100%. The table renders a 0–1 value the same way ("1%").
    expect(fmt(0.81)).toBe("1%");
  });

  test("clamps out-of-range values the same way the table's 52W bar does", () => {
    expect(fmt(-5)).toBe("0%");
    expect(fmt(150)).toBe("100%");
  });
});

describe("the single Size by selector", () => {
  test("defaults to day change and offers all twelve selectable MarketRow metrics", () => {
    expect(DEFAULT_MARKET_SIZE_METRIC).toBe("change_pct");
    expect([...MARKET_SIZE_METRIC_VALUES]).toEqual([
      // The original five keep their order; the seven newly-selectable fields
      // are appended. Order matters only for the type/order list, not the menu.
      "change_pct",
      "relative_volume",
      "rsi",
      "pos_52w",
      "market_cap",
      "adx",
      "perf_w",
      "perf_1m",
      "pe_ratio",
      "pb_ratio",
      "roe",
      "dividend_yield",
    ]);
    const mapped = toTreemapRow(base);
    for (const metric of MARKET_SIZE_METRICS) {
      expect(isMarketSizeMetric(metric.value), metric.value).toBe(true);
      expect(Number.isFinite(getMetricValue(mapped as HeatmapStock, metric.value)), metric.value).toBe(
        true,
      );
    }
    // P/E is a real, user-selectable field now — `pe_ratio` must be accepted.
    expect(isMarketSizeMetric("pe_ratio")).toBe(true);
  });

  test("isMarketSizeMetric accepts every one of the twelve values and rejects only a truly unknown string", () => {
    // Explicit literals (not the constant under test): a regression that trims
    // the allowlist back to five must fail this test.
    const allTwelve = [
      "change_pct", "relative_volume", "rsi", "pos_52w", "market_cap",
      "adx", "perf_w", "perf_1m", "pe_ratio", "pb_ratio", "roe", "dividend_yield",
    ];
    expect(MARKET_SIZE_METRIC_VALUES).toHaveLength(allTwelve.length);
    for (const value of allTwelve) {
      expect(isMarketSizeMetric(value), `${value} was rejected`).toBe(true);
    }
    expect(isMarketSizeMetric("not_a_metric")).toBe(false);
    expect(isMarketSizeMetric(undefined)).toBe(false);
    expect(isMarketSizeMetric(42)).toBe(false);
  });

  test("no dropdown option is disabled — every one of the twelve is selectable", () => {
    const options = marketMetricOptions();
    expect(options).toHaveLength(12);
    expect(options.filter((option) => option.disabled)).toEqual([]);
    expect(options.every((option) => !option.disabled)).toBe(true);
  });

  test("market cap stays in the list but is no longer the default driver", () => {
    expect(MARKET_SIZE_METRIC_VALUES).toContain("market_cap");
    expect(DEFAULT_MARKET_SIZE_METRIC).not.toBe("market_cap");
  });

  test("a metric with no finite non-zero value is disabled for size; negatives still size", () => {
    const stock = {
      ...toTreemapRow(base),
      change_pct: -3,
      rsi: 0,
      perf_w: null,
    } as HeatmapStock;
    const sized = usableSizeMetrics([stock], marketMetricOptions());
    expect(sized.find((o) => o.value === "change_pct")?.disabled).toBeFalsy();
    expect(sized.find((o) => o.value === "rsi")?.disabled).toBe(true);
    expect(sized.find((o) => o.value === "perf_w")?.disabled).toBe(true);
    expect(usableSizeMetrics([], marketMetricOptions()).every((o) => !o.disabled)).toBe(true);
  });

  test("accepts currency-specific cap metrics without changing the option list", () => {
    const us = marketSizeMetrics("USD");
    expect(us.map((m) => m.value)).toEqual([...MARKET_SIZE_METRIC_VALUES]);
    expect(us.find((m) => m.value === "market_cap")!.fmt(2.5e9)).toBe("$2.5B");
  });
});

describe("tile area and emitted order follow the selected metric", () => {
  const rows = [
    toTreemapRow({ ...base, symbol: "SMALL", marketCapCr: 12_000, rsi: 91, change: -2 }),
    toTreemapRow({ ...base, symbol: "HUGE", marketCapCr: 1_805_376, rsi: 21, change: 5 }),
  ] as HeatmapStock[];

  test.each([
    ["change_pct", [5, 2]],
    ["relative_volume", [1.4, 1.4]],
    ["rsi", [91, 21]],
    ["pos_52w", [48.2, 48.2]],
    ["market_cap", [1_805_376 * 1e7, 12_000 * 1e7]],
  ] as const)("%s area is |metric| and tiles are emitted largest-first", (metric, expected) => {
    const data = tilesFor(rows, metric);
    expect(data.map((d) => d.value)).toEqual([...expected]);
    expect(data[0]!.value).toBe(Math.max(...data.map((d) => d.value)));
    for (const tile of data) {
      expect(tile.value).toBe(
        Math.abs(getMetricValue(rows.find((r) => r.symbol === tile.name)!, metric)),
      );
    }
  });

  test("a −5% mover gets exactly the area of a +5% mover", () => {
    const mixed = [
      toTreemapRow({ ...base, symbol: "DOWN", change: -5, marketCapCr: 10_000 }),
      toTreemapRow({ ...base, symbol: "UP", change: 5, marketCapCr: 500_000 }),
    ] as HeatmapStock[];
    const data = tilesFor(mixed, "change_pct");
    expect(data.find((d) => d.name === "DOWN")!.value).toBe(5);
    expect(data.find((d) => d.name === "UP")!.value).toBe(5);
  });

  test("a real zero stays visible while a missing value is dropped", () => {
    const mixed = [
      toTreemapRow({ ...base, symbol: "BIG", change: 4 }),
      toTreemapRow({ ...base, symbol: "FLAT", change: 0 }),
      toTreemapRow({ ...base, symbol: "NAN", change: Number.NaN }),
    ] as HeatmapStock[];
    const data = tilesFor(mixed, "change_pct");
    expect(data.map((d) => d.name)).toEqual(["BIG", "FLAT"]);
    const flat = data.find((d) => d.name === "FLAT")!;
    expect(flat.value).toBeGreaterThan(0);
    expect(flat.value).toBeCloseTo(0.04, 10);
  });
});

describe("every metric paints with the cividis ramp, never a new hue", () => {
  const ranges: Array<[string, number, number, number]> = [
    ["bounded sub-1 range", 0.5, 0.2, 0.9],
    ["0..1 range", 0.5, 0, 1],
    ["equal min/max", 0.5, 0.4, 0.4],
    ["all NaN", Number.NaN, Number.NaN, Number.NaN],
    ["infinite value", Number.POSITIVE_INFINITY, 0, 1],
    ["inverted range", 0.5, 0.9, 0.2],
  ];
  const COLOR = /^(#[0-9a-fA-F]{6}|rgb\(\d+,\d+,\d+\))$/;
  const INK = /^#[0-9a-fA-F]{6}$/;

  test.each(MARKET_SIZE_METRIC_VALUES)(
    "%s stays inside the cividis ramp for hostile ranges",
    (metric) => {
      for (const [label, value, min, max] of ranges) {
        const fill = marketTileColor(metric, value, min, max);
        expect(fill, `${metric} / ${label}`).toMatch(COLOR);
        expect(fill, `${metric} / ${label}`).not.toMatch(/NaN|undefined/);
        expect(SCALE_BLUE, `${metric} / ${label} emitted an off-ramp blue stop`).not.toContain(fill);
        expect(marketTileTextColor(metric, value, min, max), `${metric} / ${label}`).toMatch(INK);
      }
    },
  );

  test("tile label ink is picked from the tile's own fill", () => {
    for (const [label, value, min, max] of ranges) {
      expect(marketTileTextColor(value, min, max), label).toBe(
        pickTextColor(marketTileColor(value, min, max), TEXT_ON_ACCENT),
      );
    }
  });

  test("a loss and a gain of equal size get opposite ramp colours", () => {
    const loss = marketTileColor(-5, -5, 5);
    const gain = marketTileColor(5, -5, 5);
    expect(loss).not.toBe(gain);
    expect(loss).toBe(marketSignedMetricColor(-5, -5, 5));
    expect(gain).toBe(marketSignedMetricColor(5, -5, 5));
  });

  test("the legend gradient is the 17-stop cividis ramp", () => {
    const css = marketColorRampCss();
    for (const stop of CIVIDIS_STOPS) expect(css, `${stop} missing from the legend`).toContain(stop);
    for (const stop of [MARKET_RAMP_STRONG_RED, MARKET_RAMP_NEUTRAL, MARKET_RAMP_STRONG_GREEN]) {
      expect(css).not.toContain(stop);
    }
    for (const stop of SCALE_BLUE) expect(css).not.toContain(stop);
  });
});

describe("currency-aware treemap caps", () => {
  const usRow: MarketRow = {
    ...base,
    currency: "USD",
    marketCapCr: null,
    marketCapUsdB: 1805.376,
  };

  test("India keeps its crore scale by default", () => {
    expect(toTreemapRow(base).market_cap).toBeCloseTo(
      1805376 * currencyFor("INR").mcapScale,
      0,
    );
  });

  test("USD uses the descriptor scale and the row's own cap field", () => {
    expect(toTreemapRow(usRow, "USD").market_cap).toBeCloseTo(
      1805.376 * currencyFor("USD").mcapScale,
      0,
    );
  });

  test("the cap metric carries the currency's symbol and suffix", () => {
    const india = MARKET_METRICS.find((m) => m.value === "market_cap")!;
    const usd = marketTreemapMetrics("USD").find((m) => m.value === "market_cap")!;
    expect(india.fmt(2.5e9)).toBe("₹2.5B");
    expect(usd.fmt(2.5e9)).toBe("$2.5B");
    expect(usd.fmt(1.2e10)).toBe("$12.0B");
  });
});

/**
 * Frozen before grouping: `sizeBy`/`colorBy` are persisted wire fields, so a
 * renamed value would silently reset a user's saved choice on the next load.
 */
const ORIGINAL_METRIC_VALUES = [
  "market_cap", "change_pct", "pos_52w", "relative_volume", "rsi",
  "adx", "perf_w", "perf_1m", "pe_ratio", "pb_ratio", "roe", "dividend_yield",
] as const;
const ORIGINAL_SIZE_VALUES = [
  "change_pct", "relative_volume", "rsi", "pos_52w", "market_cap",
] as const;

describe("grouped Size by metrics", () => {
  test("every persisted value string survives grouping byte-identically", () => {
    // The dropdown's wire values must be the same 12 strings, never renamed —
    // reordering/regrouping is fine, a rename resets a user's saved choice.
    expect(marketMetricOptions().map((o) => o.value).sort()).toEqual(
      [...ORIGINAL_METRIC_VALUES].sort(),
    );
    expect(marketTreemapMetrics().map((m) => m.value).sort()).toEqual(
      [...ORIGINAL_METRIC_VALUES].sort(),
    );
    for (const value of ORIGINAL_SIZE_VALUES) {
      expect(MARKET_SIZE_METRIC_VALUES, `${value} dropped from the persisted set`).toContain(value);
    }
  });

  test("the Select data carries all five groups in the requested order", () => {
    expect(marketMetricOptions().map((o) => o.group)).toEqual([
      "Momentum", "Momentum", "Momentum",
      "Trend", "Trend",
      "Performance", "Performance",
      "Size",
      "Valuation", "Valuation", "Valuation", "Valuation",
    ]);
  });

  test("each option keeps its original value with its expected label and group", () => {
    const expected: Record<string, { label: string; group: string }> = {
      change_pct: { label: "Day Change", group: "Momentum" },
      relative_volume: { label: "Rel Volume", group: "Momentum" },
      rsi: { label: "RSI", group: "Momentum" },
      adx: { label: "ADX", group: "Trend" },
      pos_52w: { label: "52W Position", group: "Trend" },
      perf_w: { label: "1W Return", group: "Performance" },
      perf_1m: { label: "1M Return", group: "Performance" },
      market_cap: { label: "Market Cap", group: "Size" },
      pe_ratio: { label: "P/E", group: "Valuation" },
      pb_ratio: { label: "P/B", group: "Valuation" },
      roe: { label: "ROE", group: "Valuation" },
      dividend_yield: { label: "Div Yield", group: "Valuation" },
    };
    const options = marketMetricOptions();
    expect(new Set(options.map((o) => o.value)).size).toBe(Object.keys(expected).length);
    for (const option of options) {
      expect(
        { value: option.value, label: option.label, group: option.group },
        option.value,
      ).toEqual({ value: option.value, ...expected[option.value] });
    }
  });

  test("the default stays Day Change even though the option order changes", () => {
    expect(DEFAULT_MARKET_SIZE_METRIC).toBe("change_pct");
    expect(marketMetricOptions()[0]!.value).toBe("change_pct");
    expect(marketMetricOptions()[0]!.label).toBe("Day Change");
    expect(marketMetricOptions()[0]!.group).toBe("Momentum");
  });
});

describe("nested sector → stocks treemap", () => {
  const stockRow = (symbol: string, sector: string | null, change: number): MarketRow => ({
    ...base,
    symbol,
    name: symbol,
    sector,
    change,
  });
  const build = (rows: MarketRow[], width?: number, height?: number) =>
    buildSectorTreemapOption(
      rows.map((r) => toTreemapRow(r)),
      "change_pct",
      MARKET_SIZE_METRICS,
      true,
      { ...STYLE, sortTilesByValueDesc: false },
      width === undefined ? undefined : { width, height },
    );

  test("emits sector parents whose children are the stocks in that sector", () => {
    const { option, stockCount, sectorCount } = build([
      stockRow("A1", "Energy", 4),
      stockRow("A2", "Energy", 2),
      stockRow("B1", "IT", 6),
      stockRow("B2", "IT", 1),
    ]);
    const parents = option.series[0].data;
    expect(parents).toHaveLength(2);
    expect(parents.every((p) => p.sectorParent === true)).toBe(true);
    expect(parents.map((p) => p.name)).toEqual(["IT", "Energy"]); // biggest sector first
    expect(parents.map((p) => p.stockCount)).toEqual([2, 2]);
    const energy = parents.find((p) => p.name === "Energy")!;
    expect(energy.children?.map((c) => c.name)).toEqual(["A1", "A2"]);
    expect(energy.value).toBe(6); // 4 + 2 — sector area is the sum of its stocks
    expect(stockCount).toBe(4);
    expect(sectorCount).toBe(2);
  });

  test("aggregates the tail into one Other (n) child that preserves the sector's total area", () => {
    const extra = 3;
    const rows = Array.from({ length: MAX_STOCKS_PER_SECTOR + extra }, (_, i) =>
      stockRow(`S${i}`, "Energy", i + 1),
    );
    const { option, stockCount, otherBlockCount } = build(rows);
    const children = option.series[0].data[0]!.children!;
    expect(children).toHaveLength(MAX_STOCKS_PER_SECTOR + 1); // top N + one rollup
    expect(children.slice(0, MAX_STOCKS_PER_SECTOR).map((c) => c.name)).toEqual(
      rows
        .slice(-MAX_STOCKS_PER_SECTOR)
        .reverse()
        .map((r) => r.symbol),
    );
    const other = children[children.length - 1]!;
    expect(other.name).toBe(otherLabel(extra));
    expect(other.isOther).toBe(true);
    expect(other.value).toBe(1 + 2 + 3); // the dropped tail's sizes
    expect(children.reduce((sum, c) => sum + c.value, 0)).toBe(option.series[0].data[0]!.value);
    expect(stockCount).toBe(MAX_STOCKS_PER_SECTOR + extra); // no name silently lost
    expect(otherBlockCount).toBe(1);
  });

  test("null, blank and em-dash sectors land in Unclassified, never a phantom sector", () => {
    const { option } = build([
      stockRow("NULLSEC", null, 5),
      stockRow("EMPTYSEC", "", 3),
      stockRow("DASHSEC", "—", 2),
      stockRow("REAL", "IT", 9),
    ]);
    const names = option.series[0].data.map((p) => p.name);
    expect(names).toContain(UNCLASSIFIED_SECTOR);
    expect(names).not.toContain("—");
    expect(names).not.toContain("");
    const unclassified = option.series[0].data.find((p) => p.name === UNCLASSIFIED_SECTOR)!;
    expect(unclassified.children?.map((c) => c.name).sort()).toEqual(["DASHSEC", "EMPTYSEC", "NULLSEC"]);
    expect(sectorOf(null)).toBe(UNCLASSIFIED_SECTOR);
    expect(sectorOf("  ")).toBe(UNCLASSIFIED_SECTOR);
    expect(sectorOf(" Energy ")).toBe("Energy");
  });

  test("nesting lives in the wrapper — the shared flat builder's output is unchanged", () => {
    // The nested function calls buildStockTreemapOption unchanged. The shared
    // builder still emits flat tiles: sector grouping exists only in the new
    // wrapper, so the NSE and sector heatmaps (which call it directly) are
    // unaffected. Their exact byte-for-byte guards live in stockTreemap.test.ts.
    const stocks = [stockRow("A", "Energy", 2), stockRow("B", "IT", 1)].map((r) => toTreemapRow(r));
    const flat = () =>
      JSON.stringify(
        buildStockTreemapOption(stocks, "change_pct", MARKET_SIZE_METRICS, true, STYLE, "metric"),
      );
    const before = flat();
    const nested = buildSectorTreemapOption(stocks, "change_pct", MARKET_SIZE_METRICS, true, {
      ...STYLE,
      sortTilesByValueDesc: false,
    });
    expect(flat()).toBe(before);
    expect(nested.option.series[0].data[0]!.children).toBeDefined();
    const tiles = JSON.parse(before).series[0].data as Array<Record<string, unknown>>;
    expect(tiles.map((d) => d.name)).toEqual(["A", "B"]);
    expect(tiles.every((d) => d.children === undefined && d.sectorParent === undefined)).toBe(true);
  });

  test("the Other (n) tail renders a short +n badge that survives a tiny tile", () => {
    const extra = 3;
    const rows = Array.from({ length: MAX_STOCKS_PER_SECTOR + extra }, (_, i) =>
      stockRow(`S${i}`, "Energy", i + 1),
    );
    const { option } = build(rows);
    const other = option.series[0].data[0]!.children!.find((c: any) => c.isOther)! as {
      name: string;
      value: number;
      label: Record<string, unknown>;
      itemStyle: Record<string, unknown>;
    };
    // The full name stays on the datum so the tooltip can still explain the rollup.
    expect(other.name).toBe(otherLabel(extra));
    // ECharts ellipsises according to pixel width, which a formatter cannot read.
    // The only truncation-safe label is a short aggregate marker; assert the
    // marker text (not pixels) for both a generous and a deliberately tiny tile.
    const formatter: unknown = other.label?.formatter;
    expect(typeof formatter).toBe("function");
    const render = formatter as (params: { name: string; value: number }) => string;
    const wide = render({ name: other.name, value: other.value });
    const tiny = render({ name: "S", value: 0.00001 });
    expect(wide).toBe("+3");
    expect(tiny).toBe("+3");
    expect(tiny).not.toMatch(/…|\.\.\./);
    expect(tiny).not.toBe("S…");
    expect(tiny.length).toBeLessThanOrEqual(4);
    // Distinct aggregate treatment: neutral fill, italic, dashed hairline.
    expect(other.label?.fontStyle).toBe("italic");
    expect(other.itemStyle?.borderType).toBe("dashed");
  });

  test("sector and stock order is size-desc then name-identical at 1600 and 390", () => {
    const rows = [
      stockRow("Z1", "Zeta", 5),
      stockRow("A1", "Alpha", 5),
      stockRow("m1", "Beta", 2),
      stockRow("b1", "Beta", 2),
    ];
    const wide = build(rows, 1600);
    const narrow = build(rows, 390);
    const order = (result: typeof wide) => result.option.series[0].data.map((p) => p.name);
    expect(order(narrow)).toEqual(order(wide));
    // Zeta & Alpha tie on size: the tiebreak must be name, not insertion order.
    expect(order(wide)).toEqual(["Alpha", "Zeta", "Beta"]);
    const beta = wide.option.series[0].data.find((p) => p.name === "Beta")!;
    expect(beta.children!.map((c) => c.name)).toEqual(["b1", "m1"]);
  });

  test("sector upper labels show at wide widths and hide at 390px", () => {
    const levelsOf = (width: number) =>
      (build([stockRow("A", "Energy", 3)], width).option.series[0].levels as any[])[1];
    expect(levelsOf(1600)?.upperLabel?.show).toBe(true);
    expect(levelsOf(390)?.upperLabel?.show).toBe(false);
  });

  test("at 390px each sector caps stock tiles and rolls the rest into the +n tail", () => {
    const total = MAX_STOCKS_PER_SECTOR + 6;
    const rows = Array.from({ length: total }, (_, i) => stockRow(`S${i}`, "Energy", i + 1));
    const wide = build(rows, 1600);
    const narrow = build(rows, NARROW_TREEMAP_MAX_WIDTH - 1);
    const wideChildren = wide.option.series[0].data[0]!.children!;
    const narrowChildren = narrow.option.series[0].data[0]!.children!;

    // The 1600 path is unchanged: twelve tiles + one tail.
    expect(wideChildren.filter((c: any) => !c.isOther)).toHaveLength(MAX_STOCKS_PER_SECTOR);

    // The 390 path bounds the tile count and still accounts for every name.
    const stocks = narrowChildren.filter((c: any) => !c.isOther);
    const other = narrowChildren.find((c: any) => c.isOther)!;
    expect(stocks).toHaveLength(MAX_STOCKS_PER_SECTOR_NARROW);
    expect(narrowChildren).toHaveLength(MAX_STOCKS_PER_SECTOR_NARROW + 1);
    const tailCount = total - MAX_STOCKS_PER_SECTOR_NARROW;
    expect(other.name).toBe(otherLabel(tailCount));
    // Tail sizes are the smallest `tailCount` values (1..tailCount), so their
    // sum is n(n+1)/2 — no name's area is lost when it folds into the badge.
    expect(other.value).toBe((tailCount * (tailCount + 1)) / 2);
    expect(narrowChildren.reduce((sum, c) => sum + c.value, 0)).toBe(
      narrow.option.series[0].data[0]!.value,
    );
    expect(narrow.stockCount).toBe(total);
    expect(narrow.otherBlockCount).toBe(1);

    expect(maxStocksPerSector(undefined)).toBe(MAX_STOCKS_PER_SECTOR);
    expect(maxStocksPerSector(NARROW_TREEMAP_MAX_WIDTH - 1)).toBe(MAX_STOCKS_PER_SECTOR_NARROW);
    expect(isNarrowTreemap(NARROW_TREEMAP_MAX_WIDTH - 1)).toBe(true);
    expect(isNarrowTreemap(NARROW_TREEMAP_MAX_WIDTH)).toBe(false);
  });

  test("narrow stock labels use a short symbol formatter, never a bare S…", () => {
    const rows = Array.from({ length: 6 }, (_, i) => stockRow(`RELIANCE${i}`, "Energy", i + 1));
    const wide = build(rows, 1600);
    const narrow = build(rows, NARROW_TREEMAP_MAX_WIDTH - 1);
    const wideStocks = wide.option.series[0].data[0]!.children!.filter((c: any) => !c.isOther);
    const narrowStocks = narrow.option.series[0].data[0]!.children!.filter((c: any) => !c.isOther);
    expect(wideStocks.length).toBeGreaterThan(0);
    expect(narrowStocks.length).toBeGreaterThan(0);

    for (const tile of narrowStocks) {
      const fmt = (tile as any).label?.formatter;
      expect(typeof fmt, `${tile.name} had no narrow label formatter`).toBe("function");
      const text = (fmt as (p: any) => string)({ name: tile.name });
      expect(text).toBe(shortTreemapSymbol(tile.name));
      expect(text).not.toMatch(/…|\.\.\./);
      expect(text.length).toBeGreaterThan(1);
      expect(text.length).toBeLessThanOrEqual(NARROW_SYMBOL_MAX_CHARS);
    }
    // Wide tiles keep the inherited two-line formatter — no per-leaf override.
    expect((wideStocks[0] as any).label?.formatter).toBeUndefined();
    // The full symbol stays on the datum for the tooltip, not the short label.
    expect(narrowStocks[0]!.name).toMatch(/^RELIANCE/);
    expect(shortTreemapSymbol("  SBIN  ")).toBe("SBIN");
  });

  describe("sliver tiles must not paint an unreadable S… label", () => {
    const slivers = () => [
      stockRow("HUGE", "Energy", 1000),
      stockRow("TINY", "Energy", 0.2),
    ];

    test("the width proxy is √(value share × chart area), independent of nesting", () => {
      // A quarter of a 100×100 chart has area 2500 -> width 50.
      expect(estimatedTileWidthPx(25, 100, 100, 100)).toBe(50);
      // Same share of a differently-shaped chart gives the same estimate.
      expect(estimatedTileWidthPx(25, 100, 200, 50)).toBe(50);
      expect(MIN_LABEL_WIDTH_PX).toBeGreaterThanOrEqual(34);
      expect(MIN_LABEL_WIDTH_PX).toBeLessThanOrEqual(40);
    });

    test("(a) a tile narrower than MIN_LABEL_WIDTH_PX hides the whole label block", () => {
      const { option } = build(slivers(), 1600, 900);
      const children = option.series[0].data[0]!.children!;
      const tiny = children.find((c: any) => c.name === "TINY") as any;
      const width = estimatedTileWidthPx(0.2, 1000.2, 1600, 900);
      expect(width).toBeLessThan(MIN_LABEL_WIDTH_PX); // ≈17px — ECharts would print "S…"
      expect(stockTileLabelVisible(0.2, 1000.2, 1600, 900)).toBe(false);
      // Both lines live on ONE ECharts label object: show:false removes the
      // symbol and the value together, and no per-line formatter revives one.
      expect(tiny.label.show).toBe(false);
      expect(tiny.label.formatter).toBeUndefined();
    });

    test("(b) a tile above the threshold keeps the full SYMBOL + value label", () => {
      const { option } = build(slivers(), 1600, 900);
      const children = option.series[0].data[0]!.children!;
      const huge = children.find((c: any) => c.name === "HUGE") as any;
      expect(estimatedTileWidthPx(1000, 1000.2, 1600, 900)).toBeGreaterThanOrEqual(
        MIN_LABEL_WIDTH_PX,
      );
      expect(stockTileLabelVisible(1000, 1000.2, 1600, 900)).toBe(true);
      expect(huge.label.show).toBe(true);
      expect(huge.label.formatter).toBeUndefined(); // inherits the two-line formatter
      const seriesLabel = (option.series[0] as any).label;
      expect(seriesLabel.formatter({ name: "HUGE", data: { metricValue: "+1000.0%" } })).toBe(
        "HUGE\n+1000.0%",
      );
    });

    test("(c) the +n aggregate badge is never suppressed", () => {
      const rows = Array.from({ length: MAX_STOCKS_PER_SECTOR + 2 }, (_, i) =>
        stockRow(`S${i}`, "Energy", i + 1),
      );
      for (const [width, height] of [[1600, 900], [1, 1]] as const) {
        const { option } = build(rows, width, height);
        const other = option.series[0].data[0]!.children!.find((c: any) => c.isOther)! as any;
        expect(other.label.show, `${width}px`).toBe(true);
        expect(typeof other.label.formatter, `${width}px`).toBe("function");
      }
    });

    test("(d) sector upperLabel threshold at 480px is unchanged", () => {
      const upper = (width: number) =>
        (build([stockRow("A", "Energy", 3)], width).option.series[0].levels as any[])[1]
          ?.upperLabel?.show;
      expect(upper(480)).toBe(true);
      expect(upper(479)).toBe(false);
      expect(upper(1600)).toBe(true);
      expect(upper(390)).toBe(false);
    });
  });
});

/**
 * Regression: the map labelled and sized tiles by the selected metric but
 * painted them by day change. A +29.3% 1M tile with a negative day therefore
 * read as a loss. Colour, size and label must all describe ONE metric.
 */
describe("colour follows the selected metric", () => {
  const COLOR = /^rgb\(\d+,\d+,\d+\)$/;

  /** The single sequential mapping: linear position in [min,max], low → high. */
  const unsigned = (value: number, min: number, max: number) =>
    marketLerpRgb(Math.min(Math.max((value - min) / (max - min), 0), 1) * 100);

  test("(a) perf_1m uses its own sequential ramp — +29.3% yellow, −12.9% blue", () => {
    const min = -12.9;
    const max = 29.3;
    const gain = marketTileColor("perf_1m", 29.3, min, max);
    const loss = marketTileColor("perf_1m", -12.9, min, max);
    expect(gain).toBe(marketSignedMetricColor(29.3, min, max));
    expect(loss).toBe(marketSignedMetricColor(-12.9, min, max));
    // The tile is up on the month but down on the day: the old code painted
    // both from the day change, so the gain read as a loss.
    expect(gain).not.toBe(loss);
    expect(gain).not.toBe(getHeatmapMetricColor("change_pct", -4.8, -20, 5));
    expect(loss).not.toBe(getHeatmapMetricColor("change_pct", 4.6, -20, 5));
  });

  test("(b) signed intensity scales with magnitude, not binary", () => {
    const min = -20;
    const max = 29.3;
    const small = marketTileColor("perf_1m", -4.8, min, max);
    const large = marketTileColor("perf_1m", -20, min, max);
    expect(small).toBe(marketSignedMetricColor(-4.8, min, max));
    expect(large).toBe(marketSignedMetricColor(-20, min, max));
    expect(small).not.toBe(large);
    // A bigger loss is DARKER on a sequential ramp: −20 is further toward the
    // low (blue) end than −4.8, so its relative luminance falls.
    expect(relativeLuminance(large)).toBeLessThan(relativeLuminance(small));
  });

  test("(c) an unsigned metric (RSI) maps low→dark blue, high→yellow without undefined", () => {
    const low = marketTileColor("rsi", 15, 15, 45);
    const high = marketTileColor("rsi", 45, 15, 45);
    expect(low).toBe(unsigned(15, 15, 45));
    expect(high).toBe(unsigned(45, 15, 45));
    expect(low).not.toBe(high);
    for (const color of [low, high]) {
      expect(color).toMatch(COLOR);
      expect(color).not.toMatch(/NaN|undefined/);
    }
  });

  test("(d) a sub-1 range (rel vol 0.3..0.9) returns a valid, varying colour", () => {
    const low = marketTileColor("relative_volume", 0.3, 0.3, 0.9);
    const mid = marketTileColor("relative_volume", 0.6, 0.3, 0.9);
    const high = marketTileColor("relative_volume", 0.9, 0.3, 0.9);
    for (const color of [low, mid, high]) {
      expect(color, `got ${color}`).toMatch(COLOR);
      expect(color).not.toMatch(/NaN|undefined/);
    }
    expect(low).toBe(unsigned(0.3, 0.3, 0.9));
    expect(mid).toBe(unsigned(0.6, 0.3, 0.9));
    expect(high).toBe(unsigned(0.9, 0.3, 0.9));
    expect(low).not.toBe(high);
  });

  test("(f) every metric routes through one total colour function, never a constant day-change fill", () => {
    // The canvas overrides in MarketMapView and MarketSectorTreemap must call
    // the same total helper with the selected metric, never with day change.
    for (const metric of MARKET_SIZE_METRIC_VALUES) {
      const low = marketTileColor(metric, 0.3, 0.3, 0.9);
      const high = marketTileColor(metric, 0.9, 0.3, 0.9);
      expect(low, metric).toMatch(COLOR);
      expect(high, metric).toMatch(COLOR);
      expect(low, metric).not.toMatch(/NaN|undefined/);
      expect(high, metric).not.toMatch(/NaN|undefined/);
      // Both signed and unsigned metrics traverse the same sequential ramp;
      // a constant fill means the metric was ignored.
      expect(high, `${metric} produced a constant fill`).not.toBe(low);
    }
  });
});

/**
 * One bad print (+12026% is almost certainly a corporate action) used to set
 * the raw extent, so a normal ±5% tile got t=sqrt(5/12026)≈0.02 — every tile
 * the same colour. The domain is now a robust median/MAD window clamped inside
 * the raw min/max: clamping happens only when a genuine outlier is present.
 */
describe("robust colour domain — one bad print cannot flatten the ramp", () => {
  const SAMPLE = [-43, -5, 0, 5, 12026];
  const CLEAN = [-8, -5, -2, 0, 2, 5, 8];
  const asStocks = (values: number[], metric = "perf_1m"): HeatmapStock[] =>
    values.map((v, i) => ({ symbol: `S${i}`, [metric]: v } as unknown as HeatmapStock));

  test("(a) a 5% move is visibly lighter/darker, not the flat raw ±12026 domain", () => {
    const domain = marketColorDomain(asStocks(SAMPLE), "perf_1m");
    const up = marketTileColor("perf_1m", 5, domain.min, domain.max);
    const down = marketTileColor("perf_1m", -5, domain.min, domain.max);
    const mid = marketLerpRgb(50);
    expect(relativeLuminance(up), `up ${up} vs mid ${mid}`).toBeGreaterThan(relativeLuminance(mid));
    expect(relativeLuminance(down), `down ${down} vs mid ${mid}`).toBeLessThan(relativeLuminance(mid));
    expect(relativeLuminance(up) - relativeLuminance(down)).toBeGreaterThan(0.1);
    // The raw domain crushed ±5% into nearly the same dark-blue fill.
    const crushedUp = marketTileColor("perf_1m", 5, -43, 12026);
    const crushedDown = marketTileColor("perf_1m", -5, -43, 12026);
    expect(Math.abs(relativeLuminance(crushedUp) - relativeLuminance(crushedDown))).toBeLessThan(0.02);
  });

  test("(b) the absurd print saturates at the yellow end and the data is untouched", () => {
    const domain = marketColorDomain(asStocks(SAMPLE), "perf_1m");
    expect(marketTileColor("perf_1m", 12026, domain.min, domain.max)).toBe(marketLerpRgb(100));
    expect(domain.clampedHigh).toBe(true);
    expect(domain.max).toBeLessThan(100); // the legend cannot print +12026.5%
    const row = toTreemapRow({ ...base, symbol: "BAD", perf1m: 12026 });
    expect(row.perf_1m).toBe(12026); // colour saturates, the numeric datum is not rewritten
  });

  test("(c) with no outliers the domain is the raw min/max and old fills are byte-identical", () => {
    const domain = marketColorDomain(asStocks(CLEAN), "perf_1m");
    expect(domain.min).toBe(-8);
    expect(domain.max).toBe(8);
    expect(domain.clampedLow).toBe(false);
    expect(domain.clampedHigh).toBe(false);
    for (const value of CLEAN) {
      expect(marketTileColor("perf_1m", value, domain.min, domain.max)).toBe(
        marketSignedMetricColor(value, -8, 8),
      );
    }
  });

  test("robust bounds are symmetric about zero for a signed metric", () => {
    const bounds = robustColorBounds(SAMPLE, true);
    expect(bounds.low).toBeCloseTo(-bounds.high, 8);
    expect(bounds.high).toBeGreaterThan(5); // a ±5 move stays inside the ramp
    expect(bounds.high).toBeLessThan(43); // the -43 loss is beyond it
  });

  test("a distribution with >50% identical values falls back to a finite spread", () => {
    const bounds = robustColorBounds([1, 1, 1, 1, 1, 100], false);
    expect(Number.isFinite(bounds.low)).toBe(true);
    expect(Number.isFinite(bounds.high)).toBe(true);
    expect(bounds.high).toBeGreaterThan(bounds.low);
    const domain = marketColorDomain(asStocks([1, 1, 1, 1, 1, 100]), "perf_1m");
    expect(Number.isFinite(domain.min)).toBe(true);
    expect(Number.isFinite(domain.max)).toBe(true);
    expect(domain.clampedHigh).toBe(true);
  });

  test("an empty or non-finite universe yields a safe domain", () => {
    const bounds = robustColorBounds([], true);
    expect(bounds.high).toBeGreaterThan(bounds.low); // unbounded = do not clamp
    const domain = marketColorDomain([], "perf_1m");
    expect(domain.min).toBe(0);
    expect(domain.max).toBe(1);
    expect(domain.clampedLow).toBe(false);
    expect(domain.clampedHigh).toBe(false);
    const bad = marketColorDomain(asStocks([Number.NaN, Number.POSITIVE_INFINITY]), "perf_1m");
    expect(bad.max).toBeGreaterThanOrEqual(bad.min);
  });
});

/**
 * The shared ramp was a hump: luminance rose from neutral to about ±20% and
 * then FELL toward the "strong" ends, so a −43% crash read quieter than −20%.
 * These guards pin the market map to a true monotonic intensity scale.
 */
describe("market ramp — intensity grows with magnitude", () => {
  const fill = (v: number, metric = "perf_1m", min = -43, max = 43) =>
    marketTileColor(metric, v, min, max);
  const lum = (v: number, metric = "perf_1m", min = -43, max = 43) =>
    relativeLuminance(fill(v, metric, min, max));

  test("(a) signed: luminance rises strictly from −43 through 0 to +43", () => {
    // Cividis is sequential, so the whole domain is one monotone ladder —
    // there is no diverging midpoint where both directions brighten.
    const series = [-43, -20, -5, 0, 5, 20, 43];
    expect(series.every((v) => /rgb\(\d+,\d+,\d+\)/.test(fill(v)))).toBe(true);
    for (let i = 1; i < series.length; i++) {
      expect(lum(series[i]!), `${series[i - 1]} ${fill(series[i - 1]!)} → ${series[i]} ${fill(series[i]!)}`).toBeGreaterThan(
        lum(series[i - 1]!),
      );
    }
  });

  test("(b) unsigned: a higher value is always a brighter fill", () => {
    const L = (v: number) => lum(v, "rsi", 0, 100);
    for (const [lower, higher] of [[0, 10], [10, 25], [25, 40], [40, 50], [50, 60], [60, 75], [75, 90], [90, 100]] as const) {
      expect(L(higher), `rsi ${lower} → ${higher}: ${fill(lower, "rsi", 0, 100)} → ${fill(higher, "rsi", 0, 100)}`).toBeGreaterThan(L(lower));
    }
  });

  test("(c) the neutral fill clears 3:1 against both BG and SURFACE", () => {
    const neutral = fill(0);
    expect(neutral).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    expect(contrastRatio(neutral, BG), `${neutral} vs BG`).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(neutral, SURFACE), `${neutral} vs SURFACE`).toBeGreaterThanOrEqual(3);
  });

  test("(d) every fill's label ink clears 4.5:1 against that fill", () => {
    for (const [metric, min, max, step] of [["perf_1m", -43, 43, 1], ["rsi", 0, 100, 2]] as const) {
      for (let v = min; v <= max; v += step) {
        const bg = marketTileColor(metric, v, min, max);
        const ink = marketTileTextColor(metric, v, min, max);
        const ratio = contrastRatio(ink, bg);
        expect(ratio, `${metric} ${v}: ${ink} on ${bg} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("(e) benchmark — the shared ramp still has the hump this ramp fixes", () => {
    // The shared ramp is byte-pinned by the NSE/sector snapshot guard, so it
    // keeps the defect: the strong ends are DARKER than their mids. This is
    // why the market map owns a separate ramp instead of retuning RAMP_*.
    const shared = (v: number) => relativeLuminance(getSignedMetricColor(v, -43, 43));
    expect(shared(-43), `shared −43 ${getSignedMetricColor(-43, -43, 43)} vs −20 ${getSignedMetricColor(-20, -43, 43)}`).toBeLessThan(shared(-20));
    expect(shared(43), `shared +43 ${getSignedMetricColor(43, -43, 43)} vs +20 ${getSignedMetricColor(20, -43, 43)}`).toBeLessThan(shared(20));
  });
});

/**
 * The measured cividis spec: matplotlib `cm.cividis(i/16)` for i=0..16, with
 * stop 8 substituted (see palette.ts for the measured contrast). Kept as
 * literals here so the ramp cannot drift from the gallery without a deliberate
 * edit to this spec — the old green/red ramp must fail every test below.
 */
const CIVIDIS_SPEC = [
  "#00224e", "#002e6a", "#1a386f", "#32436d", "#434e6c", "#535a6d", "#61656f", "#6f7073",
  "#797674",
  "#8c8878", "#9b9476", "#aba072", "#bcae6c", "#cdbb63", "#dec958", "#f0d846", "#fee838",
] as const;

const specRgb = (hex: string): string => {
  const h = hex.replace("#", "");
  return `rgb(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)})`;
};

describe("cividis market ramp — measured spec", () => {
  test("(a) relative luminance rises strictly at every one of the 17 anchors", () => {
    const anchors = CIVIDIS_SPEC.map((_, i) => marketLerpRgb((i * 100) / 16));
    expect(anchors).toEqual(CIVIDIS_SPEC.map(specRgb));
    const lightness = anchors.map(relativeLuminance);
    for (let i = 1; i < lightness.length; i++) {
      expect(lightness[i], `stop ${i - 1} ${anchors[i - 1]} → stop ${i} ${anchors[i]}`).toBeGreaterThan(
        lightness[i - 1]!,
      );
    }
    // The same monotonicity must hold through the public colour function, not
    // just the raw ramp — sample the signed domain at each anchor.
    const min = -43;
    const max = 43;
    const throughTile = CIVIDIS_SPEC.map((_, i) =>
      relativeLuminance(marketTileColor("perf_1m", min + (i / 16) * (max - min), min, max)),
    );
    for (let i = 1; i < throughTile.length; i++) {
      expect(throughTile[i], `value anchor ${i} went down or flat`).toBeGreaterThan(throughTile[i - 1]!);
    }
  });

  test("(b) every stop gets a label ink at >= 4.5:1 — stop 8 clears with BOTH inks", () => {
    for (let i = 0; i < CIVIDIS_SPEC.length; i++) {
      // Use the ramp the app actually emits, not the frozen spec literals.
      const fill = marketLerpRgb((i * 100) / 16);
      const ink = pickTextColor(fill, TEXT_ON_ACCENT);
      const ratio = contrastRatio(ink, fill);
      expect(ratio, `stop ${i} ${fill}: ${ink} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
    // The substituted stop must clear with either ink, so the crossover no
    // longer depends on which one pickTextColor happens to choose.
    expect(marketLerpRgb(50), "ramp midpoint must be the substituted stop 8").toBe(specRgb("#797674"));
    const fixed = specRgb(CIVIDIS_SPEC[8]!);
    expect(contrastRatio(TEXT_ON_ACCENT, fixed), `white on ${fixed}`).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(BG, fixed), `black on ${fixed}`).toBeGreaterThanOrEqual(4.5);
    // matplotlib's exact mid is the reason for the substitution.
    expect(contrastRatio(TEXT_ON_ACCENT, "rgb(125,124,120)")).toBeLessThan(4.5);
  });

  test("signed and unsigned metrics use the SAME sequential position → ramp mapping", () => {
    const signedMin = -43;
    const signedMax = 43;
    for (let i = 0; i < CIVIDIS_SPEC.length; i++) {
      const value = signedMin + (i / 16) * (signedMax - signedMin);
      expect(marketTileColor("perf_1m", value, signedMin, signedMax), `signed anchor ${i}`).toBe(
        marketLerpRgb((i * 100) / 16),
      );
    }
    // An unsigned metric maps its own [min,max] onto the identical ramp: low →
    // dark blue, high → yellow. Zero is no longer a neutral anchor.
    for (let i = 0; i < CIVIDIS_SPEC.length; i++) {
      const value = 10 + (i / 16) * 90;
      expect(marketTileColor("rsi", value, 10, 100), `unsigned anchor ${i}`).toBe(
        marketLerpRgb((i * 100) / 16),
      );
    }
    expect(marketTileColor("rsi", 10, 10, 100)).toBe(marketTileColor("change_pct", -43, -43, 43));
  });

  test("(d) a +12026 outlier saturates at the yellow end without flattening the rest", () => {
    const values = [-43, -5, 0, 5, 12026];
    const stocks = values.map((v, i) => ({ symbol: `S${i}`, perf_1m: v } as unknown as HeatmapStock));
    const domain = marketColorDomain(stocks, "perf_1m");
    expect(marketTileColor("perf_1m", 12026, domain.min, domain.max)).toBe(specRgb("#fee838"));
    expect(domain.clampedHigh).toBe(true);
    expect(domain.max).toBeLessThan(100);
    const lum = (v: number) => relativeLuminance(marketTileColor("perf_1m", v, domain.min, domain.max));
    expect(lum(-5)).toBeLessThan(lum(0));
    expect(lum(5)).toBeGreaterThan(lum(0));
    expect(lum(5) - lum(0)).toBeGreaterThan(0.02);
  });

  test("(f) the NSE and sector heatmaps keep their green/red fills byte-for-byte", () => {
    // Frozen from the shared builder's snapshot guard; these must NOT move when
    // the market map changes ramp. The market ramp is local for this reason.
    expect(getSignedMetricColor(-2.5, -2.5, 1.25)).toBe("rgb(168,41,50)");
    expect(getSignedMetricColor(1.25, -2.5, 1.25)).toBe("rgb(24,155,95)");
    expect(getMetricColor(0.5, 0, 1)).not.toBe(specRgb("#fee838"));
    // ...while the MARKET ramp has moved off that green/red pair entirely.
    expect(marketTileColor("perf_1m", 43, -43, 43)).toBe(specRgb("#fee838"));
  });
});

/** The flat map had no gate at all while the nested map had one. */
describe("flat heatmap uses the sector label gate", () => {
  const tiles = () => [
    { name: "HUGE", value: 1000, label: { color: "ink" } },
    { name: "TINY", value: 0.2, label: { color: "paper" } },
  ];

  test("(b) a flat sliver hides its whole label block at 740x765", () => {
    const out = suppressTinyFlatLabels(tiles(), 740, 765);
    const tiny = out.find((tile) => tile.name === "TINY")!;
    expect(stockTileLabelVisible(0.2, 1000.2, 740, 765)).toBe(false);
    expect((tiny.label as Record<string, unknown>).show).toBe(false);
    expect((tiny.label as Record<string, unknown>).formatter).toBeUndefined();
    expect(tiny.name).toBe("TINY"); // full identity for tooltip + click
    expect(tiny.label.color).toBe("paper"); // recolour survived as well
  });

  test("(c) a flat tile above MIN_LABEL_WIDTH_PX keeps its label on", () => {
    const out = suppressTinyFlatLabels(tiles(), 740, 765);
    const huge = out.find((tile) => tile.name === "HUGE")!;
    expect(stockTileLabelVisible(1000, 1000.2, 740, 765)).toBe(true);
    expect((huge.label as Record<string, unknown>).show).toBe(true);
    expect((huge.label as Record<string, unknown>).formatter).toBeUndefined(); // inherited full-symbol formatter
  });
});
