// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { buildMarketColumns } from "./marketColumns";
import type { MarketRow } from "../../types/marketScreener";

const ROW: MarketRow = {
  symbol: "RELIANCE",
  name: "Reliance Industries",
  sector: "Oil & Gas",
  exchange: "NSE",
  close: 2890.4,
  change: 1.25,
  relativeVolume: 1.4,
  marketCapCr: 1955000,
  capTier: "large",
  rsi: 61.2,
  adx: 24.8,
  sma20: 2850,
  sma50: 2800,
  sma200: 2700,
  perfW: 2.1,
  perf1m: -1.4,
  high52w: 3020,
  low52w: 2210,
  pos52w: 84,
  peRatio: 24.1,
  pbRatio: 2.2,
  dividendYield: 0.4,
  roe: 9.1,
  fno: true,
  etf: false,
};

const ids = (columns: ReturnType<typeof buildMarketColumns>) => columns.map((column) => column.id);

afterEach(() => cleanup());

describe("buildMarketColumns", () => {
  test("keeps the sector column by default", () => {
    expect(ids(buildMarketColumns())).toContain("sector");
  });

  test("drops only sector when hideSector is set", () => {
    const full = ids(buildMarketColumns());
    const without = ids(buildMarketColumns({ hideSector: true }));

    expect(without).toEqual(full.filter((id) => id !== "sector"));
    expect(without).toEqual(expect.arrayContaining(["symbol", "name", "close", "change", "market_cap_cr"]));
  });

  test("symbol cell still opens the in-app chart", () => {
    const onSymbolOpen = vi.fn();
    const symbolColumn = buildMarketColumns({ onSymbolOpen, hideSector: true }).find(
      (column) => column.id === "symbol",
    );
    const cell = symbolColumn?.cell;
    if (!cell) throw new Error("symbol column has no cell renderer");

    render(() =>
      cell({
        row: { original: ROW, index: 0, isExpanded: () => false, toggle: () => {} },
        column: symbolColumn,
      }),
    );

    fireEvent.click(screen.getByTestId("market-symbol-RELIANCE"));
    expect(onSymbolOpen).toHaveBeenCalledWith("RELIANCE");
  });
});
