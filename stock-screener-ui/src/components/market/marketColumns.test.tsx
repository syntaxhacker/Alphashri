// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { buildMarketColumns } from "./marketColumns";
import type { MarketRow } from "../../types/marketScreener";

function row(symbol: string, fno: boolean, exchange: string): MarketRow {
  return {
    symbol,
    name: `${symbol} Ltd`,
    sector: null,
    exchange,
    close: 100,
    change: 1,
    relativeVolume: 1,
    marketCapCr: 1000,
    capTier: null,
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
    fno,
    etf: false,
  };
}

function renderSymbolCell(marketRow: MarketRow) {
  const column = buildMarketColumns().find((candidate) => candidate.id === "symbol");
  if (!column?.cell) throw new Error("symbol column has no cell renderer");
  render(() =>
    column.cell!({
      row: { original: marketRow, index: 0, isExpanded: () => false, toggle: () => {} },
      column,
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("market symbol cell — options icon eligibility", () => {
  test("F&O NSE row shows the options chain icon", () => {
    renderSymbolCell(row("RELIANCE", true, "NSE"));
    expect(screen.getByTestId("symbol-options-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("market-chart-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("symbol-tv-RELIANCE")).toBeInTheDocument();
  });

  test("a decorated exchange symbol exposes copy under the bare ticker", () => {
    renderSymbolCell(row("BSE:TATA", false, "BSE"));
    const copy = screen.getByTestId("symbol-copy-TATA");
    expect(copy.tagName).toBe("BUTTON");
    expect(copy).toHaveAccessibleName("Copy TATA");
  });

  test("a copy click does not bubble to the row", async () => {
    const rowClick = vi.fn();
    const column = buildMarketColumns().find((candidate) => candidate.id === "symbol");
    if (!column?.cell) throw new Error("symbol column has no cell renderer");
    const marketRow = row("RELIANCE", true, "NSE");

    render(() => (
      <div onClick={rowClick}>
        {column.cell!({
          row: { original: marketRow, index: 0, isExpanded: () => false, toggle: () => {} },
          column,
        })}
      </div>
    ));

    await fireEvent.click(screen.getByTestId("symbol-copy-RELIANCE"));
    expect(rowClick).not.toHaveBeenCalled();
  });

  test("non-F&O NSE row hides the options chain icon but keeps chart and TV links", () => {
    renderSymbolCell(row("INFY", false, "NSE"));
    expect(screen.queryByTestId("symbol-options-INFY")).toBeNull();
    expect(screen.getByTestId("market-chart-INFY")).toBeInTheDocument();
    expect(screen.getByTestId("symbol-tv-INFY")).toBeInTheDocument();
  });

  test("F&O NSE ETF hides the options icon and F&O badge but keeps the ETF badge", () => {
    const etfRow = { ...row("NIFTYBEES", true, "NSE"), etf: true };
    renderSymbolCell(etfRow);
    expect(screen.queryByTestId("symbol-options-NIFTYBEES")).toBeNull();
    expect(screen.queryByTestId("market-fno-NIFTYBEES")).toBeNull();
    expect(screen.getByTestId("market-etf-NIFTYBEES")).toBeInTheDocument();
    expect(screen.getByTestId("market-chart-NIFTYBEES")).toBeInTheDocument();
  });

  test("F&O US row hides the options chain icon but keeps chart and TV links", () => {
    renderSymbolCell(row("AAPL", true, "NASDAQ"));
    expect(screen.queryByTestId("symbol-options-AAPL")).toBeNull();
    expect(screen.getByTestId("market-chart-AAPL")).toBeInTheDocument();
    expect(screen.getByTestId("symbol-tv-AAPL")).toBeInTheDocument();
  });

  test("a decorated feed symbol shows as a bare ticker while TV keeps its exchange", () => {
    renderSymbolCell(row("BSE:TATA", false, "BSE"));
    const text = screen.getByTestId("market-symbol-BSE:TATA");
    expect(text).toHaveTextContent("TATA");
    expect(text).not.toHaveTextContent("BSE:");
    expect(screen.getByTestId("symbol-tv-TATA")).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=BSE%3ATATA",
    );
  });
});
