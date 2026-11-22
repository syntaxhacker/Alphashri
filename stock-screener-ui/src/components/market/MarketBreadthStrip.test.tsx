// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, test } from "vitest";
import type { MarketRow } from "../../types/marketScreener";
import { formatTimeOnly } from "@/utils/ui-helpers";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { BREADTH_MIN_COVERAGE } from "./marketBreadth";
import { MarketBreadthStrip } from "./MarketBreadthStrip";

const AS_OF = "2026-11-22T09:41:00+05:30";

function row(symbol: string, overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    symbol,
    name: symbol,
    sector: "IT",
    exchange: "NSE",
    close: 100,
    change: 1,
    relativeVolume: 1,
    marketCapCr: 1000,
    capTier: "mid",
    rsi: 50,
    adx: 20,
    sma20: 90,
    sma50: 85,
    sma200: 70,
    perfW: 1,
    perf1m: 2,
    high52w: 120,
    low52w: 80,
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
    volume: 1200,
    avgVolume: 1000,
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
  row("AAA", { change: 2, close: 130, volume: 2000 }),
  row("BBB", { change: -1, close: 75, low52w: 75, volume: 1500 }),
  row("CCC", { change: 0 }),
  row("ETF", { etf: true, change: 9, close: 200 }),
];

afterEach(cleanup);

describe("MarketBreadthStrip", () => {
  test("renders the loaded-row breadth stats with the snapshot as-of time", () => {
    renderWithProviders(() => (
      <MarketBreadthStrip rows={ROWS} asOf={AS_OF} isLoading={false} />
    ));

    const strip = screen.getByTestId("market-breadth");
    expect(strip).toBeInTheDocument();
    expect(screen.getByTestId("market-breadth-advances")).toHaveTextContent("1");
    expect(screen.getByTestId("market-breadth-declines")).toHaveTextContent("1");
    expect(screen.getByTestId("market-breadth-unchanged")).toHaveTextContent("1");
    expect(screen.getByTestId("market-breadth-new-highs")).toHaveTextContent("1");
    expect(screen.getByTestId("market-breadth-new-lows")).toHaveTextContent("1");
    expect(screen.getByTestId("market-breadth-up-volume")).toHaveTextContent("1");
    expect(screen.getByTestId("market-breadth-down-volume")).toHaveTextContent("1");
    expect(screen.getByTestId("market-breadth-avg")).toHaveTextContent("+0.33%");
    expect(screen.getByTestId("market-breadth-median")).toHaveTextContent("+0.00%");
    expect(screen.getByTestId("market-breadth-rows")).toHaveTextContent("4 (1 ETF excluded)");
    expect(screen.getByTestId("market-breadth-as-of")).toHaveTextContent(
      `as of ${formatTimeOnly(AS_OF)}`,
    );
    // The snapshot has no index row, so there is no Nifty chip to render.
    expect(screen.queryByTestId("market-breadth-index")).not.toBeInTheDocument();
  });

  test("a bare load shows only the loading state", () => {
    renderWithProviders(() => (
      <MarketBreadthStrip rows={[]} asOf={null} isLoading />
    ));
    expect(screen.getByTestId("market-breadth-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("market-breadth-advances")).not.toBeInTheDocument();
    expect(screen.queryByTestId("market-breadth-empty")).not.toBeInTheDocument();
  });

  test("an empty snapshot shows a dash-style empty state, not zeroes", () => {
    renderWithProviders(() => (
      <MarketBreadthStrip rows={[]} asOf={null} isLoading={false} />
    ));
    expect(screen.getByTestId("market-breadth-empty-text")).toHaveTextContent(
      "No rows loaded — breadth unavailable",
    );
    expect(screen.queryByTestId("market-breadth-advances")).not.toBeInTheDocument();
  });

  test("poor field coverage shows dashes and an explicit coverage note", () => {
    const thin = ROWS.map((item) =>
      row(item.symbol, {
        ...item,
        high52w: null,
        low52w: null,
        to52wHighPct: null,
        from52wLowPct: null,
        volume: null,
        avgVolume: null,
      }),
    );
    renderWithProviders(() => (
      <MarketBreadthStrip rows={thin} asOf={AS_OF} isLoading={false} />
    ));

    expect(screen.getByTestId("market-breadth-new-highs")).toHaveTextContent("—");
    expect(screen.getByTestId("market-breadth-new-lows")).toHaveTextContent("—");
    expect(screen.getByTestId("market-breadth-up-volume")).toHaveTextContent("—");
    expect(screen.getByTestId("market-breadth-down-volume")).toHaveTextContent("—");
    const note = screen.getByTestId("market-breadth-coverage");
    expect(note).toHaveTextContent(`need ≥${Math.round(BREADTH_MIN_COVERAGE * 100)}%`);
    expect(note).toHaveTextContent("52W highs");
    expect(note).toHaveTextContent("volume");
  });

  test("keeps one compact scrolling strip with no page-level overflow", () => {
    renderWithProviders(() => (
      <MarketBreadthStrip rows={ROWS} asOf={AS_OF} isLoading={false} />
    ));
    const strip = screen.getByTestId("market-breadth");
    expect(strip).toHaveClass("flex-shrink-0");
    expect(strip).toHaveClass("min-w-0");
    const scroller = strip.querySelector(".overflow-x-auto");
    expect(scroller).not.toBeNull();
    expect(scroller).toHaveClass("whitespace-nowrap");
  });

  test("a missing as-of timestamp is shown as a dash, never Invalid Date", () => {
    renderWithProviders(() => (
      <MarketBreadthStrip rows={ROWS} asOf={null} isLoading={false} />
    ));
    const asOf = screen.getByTestId("market-breadth-as-of");
    expect(asOf).toHaveTextContent("as of —");
    expect(asOf).not.toHaveTextContent("Invalid");
  });
});
