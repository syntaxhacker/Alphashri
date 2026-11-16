// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import "@testing-library/jest-dom/vitest";
import { buildMarketColumns } from "./marketColumns";
import type { PatternSummaryItem } from "./usePatternSummary";
import type { MarketRow } from "../../types/marketScreener";
import * as palette from "@/ui/palette";

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

const cellArgs = (row: MarketRow, column: ReturnType<typeof buildMarketColumns>[number]) => ({
  row: { original: row, index: 0, isExpanded: () => false, toggle: () => {} },
  column,
});

function renderMcap(marketCapCr: number | null): void {
  const column = buildMarketColumns().find((candidate) => candidate.id === "market_cap_cr");
  if (!column?.cell) throw new Error("market_cap_cr column has no cell renderer");

  render(() => column.cell!(cellArgs({ ...ROW, marketCapCr }, column)));
}

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

  test("symbol body is in-app; ↗ is the TradingView link and neither bubbles to the row", async () => {
    const onSymbolOpen = vi.fn();
    const symbolColumn = buildMarketColumns({ onSymbolOpen }).find((column) => column.id === "symbol");
    const cell = symbolColumn?.cell;
    if (!cell) throw new Error("symbol column has no cell renderer");

    render(() =>
      cell({ row: { original: ROW, index: 0, isExpanded: () => false, toggle: () => {} }, column: symbolColumn }),
    );

    const text = screen.getByTestId("market-symbol-RELIANCE");
    expect(text.tagName).toBe("BUTTON");
    await fireEvent.click(text);
    expect(onSymbolOpen).toHaveBeenCalledTimes(1);

    const external = screen.getByTestId("symbol-tv-RELIANCE");
    expect(external).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NSE%3ARELIANCE",
    );
    expect(external).toHaveAttribute("target", "_blank");
    expect(external).toHaveAttribute("rel", "noopener noreferrer");
    expect(external).toHaveAccessibleName("Open RELIANCE on TradingView");
    await fireEvent.click(external);
    expect(onSymbolOpen).toHaveBeenCalledTimes(1);
  });

  test("mcap cell reads as lakh crore above 1e5", () => {
    renderMcap(1812819);
    const cell = screen.getByTestId("market-mcap-RELIANCE");
    expect(cell).toHaveTextContent("18.1L");
    expect(cell.closest("span")).toHaveAttribute("aria-label", "₹18,12,819 Cr");
    expect(cell).not.toHaveAttribute("title");
  });

  test("mcap cell reads as thousands between 1e3 and 1e5", () => {
    renderMcap(54236);
    const cell = screen.getByTestId("market-mcap-RELIANCE");
    expect(cell).toHaveTextContent("54.2k");
    expect(cell.closest("span")).toHaveAttribute("aria-label", "₹54,236 Cr");
  });

  test("mcap keeps a plain integer below 1e3", () => {
    renderMcap(999);
    const cell = screen.getByTestId("market-mcap-RELIANCE");
    expect(cell).toHaveTextContent("999");
    expect(cell.closest("span")).toHaveAttribute("aria-label", "₹999 Cr");
  });

  test("hovering the mcap cell shows the exact grouped value", async () => {
    renderMcap(1812819);
    fireEvent.mouseEnter(screen.getByTestId("market-mcap-RELIANCE").closest("span")!);

    expect(await screen.findByRole("tooltip")).toHaveTextContent("₹18,12,819 Cr");
  });

  test("null mcap keeps the shared dash", () => {
    renderMcap(null);
    expect(screen.getByTestId("market-dash-RELIANCE-mcap")).toHaveTextContent("–");
    expect(screen.queryByTestId("market-mcap-RELIANCE")).toBeNull();
  });

  test("sorting still uses the numeric value, not the compact label", () => {
    const column = buildMarketColumns().find((candidate) => candidate.id === "market_cap_cr");
    if (!column?.accessorFn) throw new Error("market_cap_cr has no numeric accessor");

    expect(column.accessorFn(ROW)).toBe(1955000);
  });
});

function pattern(
  patch: Partial<PatternSummaryItem["patterns"][number]> = {},
): PatternSummaryItem["patterns"][number] {
  return {
    pattern_id: "bull_flag",
    name: "Bull Flag",
    direction: "bullish",
    status: "confirmed",
    quality: "strong",
    confidence: 80,
    bars_ago: 2,
    ...patch,
  };
}

function renderPatterns(
  item: PatternSummaryItem | undefined,
  symbol = "RELIANCE",
): void {
  const patternsFor = vi.fn(() => item);
  const column = buildMarketColumns({ patternsFor }).find(
    (candidate) => candidate.id === "patterns",
  );
  if (!column?.cell) throw new Error("patterns column has no cell renderer");

  render(() => column.cell!(cellArgs({ ...ROW, symbol }, column)));
}

describe("PATTERNS column", () => {
  test("a bullish set renders the count with an up glyph and the success tone", () => {
    renderPatterns({ count: 2, patterns: [pattern(), pattern({ pattern_id: "cup_handle" })] });

    const badge = screen.getByTestId("market-patterns-RELIANCE");
    expect(badge).toHaveTextContent("2▲");
    // Tone derives from the palette anchor — a re-theme moves both together.
    expect(badge.style.color).toBe(palette.POSITIVE_COLOR);
  });

  test("a bearish set renders the down glyph in the negative tone", () => {
    renderPatterns({
      count: 1,
      patterns: [pattern({ pattern_id: "double_top", name: "Double Top", direction: "bearish" })],
    });

    const badge = screen.getByTestId("market-patterns-RELIANCE");
    expect(badge).toHaveTextContent("1▼");
    expect(badge.style.color).toBe(palette.NEGATIVE_COLOR);
  });

  test("mixed directions show the count alone in the neutral tone", () => {
    renderPatterns({
      count: 2,
      patterns: [pattern(), pattern({ pattern_id: "double_top", direction: "bearish" })],
    });

    const badge = screen.getByTestId("market-patterns-RELIANCE");
    expect(badge).toHaveTextContent(/^2$/);
    expect(badge.style.color).toBe(palette.TEXT_MUTED);
  });

  test("the tooltip lists every pattern name with its confidence", async () => {
    renderPatterns({
      count: 3,
      patterns: [
        pattern(),
        pattern({ pattern_id: "cup_handle", name: "Cup & Handle", confidence: 55.4 }),
        pattern({ pattern_id: "wedge", name: "Rising Wedge", confidence: null }),
      ],
    });

    // The hover handler lives on the Tooltip's wrapper, not on the badge.
    fireEvent.mouseEnter(screen.getByTestId("market-patterns-RELIANCE").parentElement!);

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Bull Flag · 80");
    expect(tooltip).toHaveTextContent("Cup & Handle · 55");
    // No confidence travels → no trailing separator.
    expect(tooltip).toHaveTextContent("Rising Wedge");
    expect(tooltip.textContent).not.toContain("Rising Wedge ·");
  });

  test("a symbol with no stored hit renders the shared dash", () => {
    renderPatterns(undefined);

    expect(screen.getByTestId("market-dash-RELIANCE-patterns")).toHaveTextContent("–");
    expect(screen.queryByTestId("market-patterns-RELIANCE")).toBeNull();
  });

  test("the cell does not call patternsFor when the column is not rendered", () => {
    const patternsFor = vi.fn(() => undefined);
    buildMarketColumns({ patternsFor, hideSector: true });

    // Building the list is not a lookup: the map must be read by cells only.
    expect(patternsFor).not.toHaveBeenCalled();
  });

  test("the column cannot be sorted, so no header arrow can mislead", () => {
    const column = buildMarketColumns({ patternsFor: () => ({ count: 3, patterns: [pattern()] }) })
      .find((c) => c.id === "patterns");

    expect(column?.accessorFn).toBeUndefined();
    expect(column?.enableSorting).toBe(false);
  });

  test("the column is sized and centred like every other badge column", () => {
    const column = buildMarketColumns().find((c) => c.id === "patterns");

    expect(column?.header).toBe("PATTERNS");
    expect(column?.size).toBe(104);
    expect(column?.meta?.align).toBe("center");
  });
});
