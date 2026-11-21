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

  test("chart icon uses onChartOpen while symbol text keeps the single-arg onSymbolOpen", () => {
    const onSymbolOpen = vi.fn();
    const onChartOpen = vi.fn();
    const symbolColumn = buildMarketColumns({ onSymbolOpen, onChartOpen }).find(
      (column) => column.id === "symbol",
    );
    const cell = symbolColumn?.cell;
    if (!cell) throw new Error("symbol column has no cell renderer");

    render(() => cell(cellArgs(ROW, symbolColumn)));

    fireEvent.click(screen.getByTestId("market-symbol-RELIANCE"));
    expect(onSymbolOpen).toHaveBeenCalledWith("RELIANCE");

    fireEvent.click(screen.getByTestId("market-chart-RELIANCE"));
    expect(onChartOpen).toHaveBeenCalledWith("RELIANCE", "NSE");
    expect(onSymbolOpen).toHaveBeenCalledTimes(1);
  });

  test("chart icon keeps the default dock when onChartOpen is absent", () => {
    const onSymbolOpen = vi.fn();
    const symbolColumn = buildMarketColumns({ onSymbolOpen }).find(
      (column) => column.id === "symbol",
    );
    const cell = symbolColumn?.cell;
    if (!cell) throw new Error("symbol column has no cell renderer");

    render(() => cell(cellArgs(ROW, symbolColumn)));

    // No onOpen override reaches SymbolLink, so its default dock handler renders
    // the chart icon and the symbol text still uses the one-arg callback.
    expect(screen.getByTestId("market-chart-RELIANCE")).toBeInTheDocument();
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

describe("numeric accessors — nulls stay null", () => {
  const byId = () => new Map(buildMarketColumns().map((column) => [column.id, column]));

  test("a missing field returns null, never a real zero", () => {
    const empty: MarketRow = {
      ...ROW,
      close: null,
      change: null,
      perfW: null,
      perf1m: null,
      pos52w: null,
      rsi: null,
      adx: null,
      relativeVolume: null,
      marketCapCr: null,
    };
    const columns = byId();
    for (const id of [
      "close",
      "day_change",
      "perf_w",
      "perf_1m",
      "pos_52w",
      "rsi",
      "adx",
      "relative_volume",
      "market_cap_cr",
    ]) {
      expect(columns.get(id)?.accessorFn?.(empty), id).toBeNull();
    }
  });

  test("a present field is returned raw so the comparator sees the real number", () => {
    const columns = byId();
    expect(columns.get("close")?.accessorFn?.(ROW)).toBe(2890.4);
    expect(columns.get("day_change")?.accessorFn?.(ROW)).toBe(1.25);
    expect(columns.get("perf_w")?.accessorFn?.(ROW)).toBe(2.1);
    expect(columns.get("rsi")?.accessorFn?.(ROW)).toBe(61.2);
    expect(columns.get("adx")?.accessorFn?.(ROW)).toBe(24.8);
  });

  test("the rendered dash is unchanged by the accessor switch", () => {
    const column = buildMarketColumns().find((candidate) => candidate.id === "rsi");
    if (!column?.cell) throw new Error("rsi column has no cell renderer");

    render(() => column.cell!(cellArgs({ ...ROW, rsi: null }, column)));
    expect(screen.getByTestId("market-dash-RELIANCE-rsi")).toHaveTextContent("–");
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

const US_ROW: MarketRow = {
  ...ROW,
  symbol: "NVDA",
  name: "NVIDIA Corp",
  exchange: "NASDAQ",
  close: 1234.5,
  currency: "USD",
  marketCapCr: null,
  marketCapUsdB: 12345.7,
  capTier: "large",
};

function renderUsCell(id: string, row: MarketRow = US_ROW): void {
  const column = buildMarketColumns({ universe: "us" }).find((candidate) => candidate.id === id);
  if (!column?.cell) throw new Error(`${id} column has no cell renderer`);
  render(() => column.cell!(cellArgs(row, column)));
}

describe("USD rows", () => {
  test("the LTP cell prefixes $ and groups with the US locale", () => {
    renderUsCell("close");
    expect(screen.getByTestId("market-close-NVDA")).toHaveTextContent("$1,234.50");
  });

  test("the MCAP header reads $B from the descriptor", () => {
    expect(
      buildMarketColumns({ universe: "us" }).find((column) => column.id === "market_cap_cr")?.header,
    ).toBe("MCAP $B");
  });

  test("the MCAP cell compacts $ billions and the tooltip keeps the full value", async () => {
    renderUsCell("market_cap_cr");
    const cell = screen.getByTestId("market-mcap-NVDA");
    expect(cell).toHaveTextContent("$12,345.7B");
    fireEvent.mouseEnter(cell.closest("span")!);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("$12,345.7B");
  });

  test("sorting still uses the dollar cap, not the null rupee field", () => {
    const column = buildMarketColumns({ universe: "us" }).find((c) => c.id === "market_cap_cr");
    expect(column?.accessorFn?.(US_ROW)).toBe(12345.7);
  });

  test("the 52W tooltip uses $ from the row, not ₹", () => {
    renderUsCell("pos_52w");
    const bar = screen.getByTestId("market-52w-NVDA");
    expect(bar.getAttribute("aria-label")).toContain("52W range $2,210–$3,020");
    expect(bar.getAttribute("aria-label")).not.toContain("₹");
  });

  test("India keeps the original header, ₹ price and ₹ lakh-crore cell", () => {
    expect(buildMarketColumns().find((c) => c.id === "market_cap_cr")?.header).toBe("MCAP ₹Cr");
    renderMcap(1812819);
    expect(screen.getByTestId("market-mcap-RELIANCE")).toHaveTextContent("18.1L");
    expect(screen.getByTestId("market-mcap-RELIANCE").closest("span")).toHaveAttribute(
      "aria-label",
      "₹18,12,819 Cr",
    );
  });
});

function renderSymbolCell(row: MarketRow): void {
  const column = buildMarketColumns().find((candidate) => candidate.id === "symbol");
  if (!column?.cell) throw new Error("symbol column has no cell renderer");
  render(() => column.cell!(cellArgs(row, column)));
}

describe("F&O affordances follow the row's exchange", () => {
  test("an NSE row keeps the F&O badge and the options-chain icon", () => {
    renderSymbolCell(ROW);
    expect(screen.getByTestId("market-fno-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("symbol-options-RELIANCE")).toBeInTheDocument();
  });

  test("a US row hides both even when the snapshot carries a stale fno flag", () => {
    renderSymbolCell({ ...US_ROW, fno: true });
    expect(screen.queryByTestId("market-fno-NVDA")).toBeNull();
    expect(screen.queryByTestId("symbol-options-NVDA")).toBeNull();
    // The chart icon is not an F&O affordance and must survive.
    expect(screen.getByTestId("market-chart-NVDA")).toBeInTheDocument();
  });

  test("the row's exchange wins over the active screen", () => {
    renderSymbolCell({ ...US_ROW, exchange: "NSE", fno: true });
    expect(screen.getByTestId("market-fno-NVDA")).toBeInTheDocument();
    expect(screen.getByTestId("symbol-options-NVDA")).toBeInTheDocument();
  });

  test("a BSE row is treated as Indian too", () => {
    renderSymbolCell({ ...ROW, symbol: "TATA", exchange: "BSE" });
    expect(screen.getByTestId("market-fno-TATA")).toBeInTheDocument();
    expect(screen.getByTestId("symbol-options-TATA")).toBeInTheDocument();
  });
});
