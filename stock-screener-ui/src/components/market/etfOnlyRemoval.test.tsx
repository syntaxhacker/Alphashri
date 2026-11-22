// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { createComponent } from "solid-js";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import { MarketFilterRail } from "./MarketFilterRail";
import {
  defaultMarketFilters,
  filterMarketRows,
  type MarketFilterState,
} from "./marketFilters";
import {
  defaultMarketConfig,
  parseMarketConfig,
  serializeMarketConfig,
} from "./useMarketConfig";
import type { MarketRow } from "../../types/marketScreener";

afterEach(cleanup);

function row(symbol: string, etf: boolean, capTier = "mid"): MarketRow {
  return {
    symbol,
    name: `${symbol} Ltd`,
    sector: null,
    exchange: "NSE",
    close: 100,
    change: 1,
    relativeVolume: 1,
    marketCapCr: 1000,
    capTier,
    rsi: 50,
    adx: 20,
    sma20: 95,
    sma50: 90,
    sma200: 80,
    perfW: 1,
    perf1m: 2,
    high52w: 120,
    low52w: 60,
    pos52w: 50,
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
    etf,
  };
}

/** One visible rail control per narrowing key. `search` is a momentary lookup
 *  in the panel toolbar and `sort` is a view control, so neither lives here. */
const RAIL_CONTROL_FOR: Record<string, string> = {
  capTiers: "market-cap-etf",
  priceMin: "market-filter-price",
  priceMax: "market-filter-price",
  dayChangeMin: "market-filter-day",
  dayChangeMax: "market-filter-day",
  mcapMinCr: "market-filter-mcap",
  mcapMaxCr: "market-filter-mcap",
  rsiMin: "market-filter-rsi",
  rsiMax: "market-filter-rsi",
  relVolMin: "market-filter-relvol",
  relVolMax: "market-filter-relvol",
  aboveSma20: "market-filter-above-sma20",
  aboveSma50: "market-filter-above-sma50",
  aboveSma200: "market-filter-above-sma200",
  fnoOnly: "market-filter-fno",
  sectors: "market-filter-sector",
  // Value filters live inside the collapsed "Value" band; the test expands it
  // before asserting, so these ids must match the rail's own test ids.
  peMax: "market-filter-peMax",
  psMax: "market-filter-psMax",
  pbMax: "market-filter-pbMax",
  roeMin: "market-filter-roeMin",
  divYieldMin: "market-filter-divYieldMin",
  fcfYieldMin: "market-filter-fcfYieldMin",
  debtToEquityMax: "market-filter-debtToEquityMax",
  revYoyMin: "market-filter-revYoyMin",
  epsYoyMin: "market-filter-epsYoyMin",
  pePctMax: "market-filter-pePctMax",
  roePctMin: "market-filter-roePctMin",
  dePctMax: "market-filter-dePctMax",
  // Mover bounds live inside the collapsed "Mover presets" band; expand it too.
  gapMin: "market-filter-gapMin",
  gapMax: "market-filter-gapMax",
  rangeVsAtrMin: "market-filter-rangeVsAtrMin",
  to52wHighMin: "market-filter-to52wHighMin",
  to52wHighMax: "market-filter-to52wHighMax",
  from52wLowMin: "market-filter-from52wLowMin",
  from52wLowMax: "market-filter-from52wLowMax",
  volumeMin: "market-filter-volumeMin",
  valueTradedMin: "market-filter-valueTradedMin",
};

describe("etfOnly removal — no hidden ETF filter", () => {
  test("(a) a saved payload with etfOnly:true parses without the key and does not narrow the grid", () => {
    const wire = { ...serializeMarketConfig(defaultMarketConfig()), etfOnly: true };
    const parsed = parseMarketConfig(wire);
    expect(parsed).not.toBeNull();

    // The retired wire key must be dropped on read, not carried into state.
    expect("etfOnly" in parsed!.filters).toBe(false);

    // And it must not silently narrow: a plain equity survives the restored
    // filters even though the saved blob asked for ETF-only.
    const rows = [row("RELIANCE", false), row("NIFTYBEES", true, "etf")];
    expect(filterMarketRows(rows, parsed!.filters).map((r) => r.symbol).sort()).toEqual([
      "NIFTYBEES",
      "RELIANCE",
    ]);
  });

  test("(b) every row-narrowing filter key has a visible rail control", () => {
    const state: MarketFilterState = defaultMarketFilters();
    expect(Object.keys(state)).not.toContain("etfOnly");

    render(() =>
      createComponent(MarketFilterRail, {
        filters: state,
        onChange: () => {},
        sectors: [],
      }),
    );

    // Every mapped control is actually rendered.
    // The Value band is collapsed by default, so expand it first — otherwise
    // its nine controls legitimately are not in the document.
    fireEvent.click(screen.getByTestId("market-value-toggle"));
    fireEvent.click(screen.getByTestId("market-movers-toggle"));
    for (const [key, id] of Object.entries(RAIL_CONTROL_FOR)) {
      expect(screen.getByTestId(id), `no rail control for filter key ${key}`).toBeInTheDocument();
    }
    // Any narrowing state key with no mapped control is a hidden filter.
    for (const key of Object.keys(state)) {
      if (key === "search" || key === "sort") continue;
      expect(RAIL_CONTROL_FOR, `filter key ${key} has no visible rail control`).toHaveProperty(
        key,
      );
    }
    expect(screen.queryByTestId("market-filter-etf")).toBeNull();
  });

  test("(c) the etf cap tier still narrows the grid to ETF rows", () => {
    const etf = row("NIFTYBEES", true, "etf");
    const equity = row("RELIANCE", false);
    const filtered = filterMarketRows([etf, equity], {
      ...defaultMarketFilters(),
      capTiers: new Set(["etf"]),
    });
    expect(filtered.map((r) => r.symbol)).toEqual(["NIFTYBEES"]);
  });
});
