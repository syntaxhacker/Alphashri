// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { VIZ_DOWN, VIZ_MUTED, VIZ_UP } from "@/ui/palette";
import type { MarketRow } from "@/types/marketScreener";
import type { VisRenderProps } from "./MarketMapView";
import {
  TREND_ROW_LIMIT,
  TREND_ROW_MAX,
  TrendAlignmentView,
  filterTrendRows,
  formatTrendChange,
  maState,
  sortTrendRows,
  toAlignmentRow,
  type TrendAlignmentRow,
} from "./TrendAlignmentView";

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
    sma20: null,
    sma50: null,
    sma200: null,
    perfW: null,
    perf1m: null,
    high52w: null,
    low52w: null,
    pos52w: null,
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

/** 3/3, two 2/3 (change breaks the tie), a 1/3 with a null MA, and 0/3. */
const ROWS: MarketRow[] = [
  row("AAA", { close: 130, sma20: 120, sma50: 110, sma200: 100, change: 2 }),
  row("BBB", { close: 105, sma20: 110, sma50: 100, sma200: 90, change: 3 }),
  row("FFF", { close: 200, sma20: 190, sma50: 195, sma200: 210, change: 0.5 }),
  row("DDD", { close: 100, sma20: null, sma50: 95, sma200: 110, change: -2 }),
  row("CCC", { close: 60, sma20: 70, sma50: 80, sma200: 90, change: -1 }),
  // No MA data at all: excluded from every view, including "All".
  row("EEE", { close: 100, sma20: null, sma50: null, sma200: null, change: 9 }),
];

function renderView(rows: MarketRow[], onSymbolClick?: (symbol: string) => void) {
  const props: VisRenderProps = { rows, onSymbolClick };
  renderWithProviders(() => <TrendAlignmentView {...props} />);
}

const domRows = () => screen.getAllByTestId("trend-row");
const findRow = (symbol: string) =>
  domRows().find((item) => item.getAttribute("data-symbol") === symbol)!;
const dots = (symbol: string) => within(findRow(symbol)).getAllByTestId("trend-dot");

function normColor(value: string): string {
  const text = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{6})$/.exec(text);
  if (!hex) return text;
  const n = Number.parseInt(hex[1], 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

afterEach(cleanup);

describe("TrendAlignmentView", () => {
  test("renders correct dot states, labels and 1D changes including a null MA", () => {
    renderView(ROWS);

    expect(domRows()).toHaveLength(5);
    expect(screen.queryByText("EEE")).not.toBeInTheDocument();

    expect(dots("AAA").map((dot) => dot.dataset.state)).toEqual(["above", "above", "above"]);
    dots("AAA").forEach((dot) =>
      expect(normColor(dot.style.backgroundColor)).toBe(normColor(VIZ_UP)),
    );
    expect(within(findRow("AAA")).getByTestId("trend-count")).toHaveTextContent("3/3");
    expect(within(findRow("AAA")).getByTestId("trend-change")).toHaveTextContent("+2.00%");

    expect(dots("BBB").map((dot) => dot.dataset.state)).toEqual(["below", "above", "above"]);
    expect(normColor(dots("BBB")[0].style.backgroundColor)).toBe(normColor(VIZ_DOWN));
    expect(within(findRow("BBB")).getByTestId("trend-count")).toHaveTextContent("2/3");

    expect(dots("FFF").map((dot) => dot.dataset.state)).toEqual(["above", "above", "below"]);
    expect(within(findRow("FFF")).getByTestId("trend-count")).toHaveTextContent("2/3");

    expect(dots("DDD").map((dot) => dot.dataset.state)).toEqual(["null", "above", "below"]);
    expect(normColor(dots("DDD")[0].style.backgroundColor)).toBe(normColor(VIZ_MUTED));
    expect(within(findRow("DDD")).getByTestId("trend-count")).toHaveTextContent("1/3");

    expect(dots("CCC").map((dot) => dot.dataset.state)).toEqual(["below", "below", "below"]);
    expect(within(findRow("CCC")).getByTestId("trend-count")).toHaveTextContent("0/3");
    expect(within(findRow("CCC")).getByTestId("trend-change")).toHaveTextContent("-1.00%");
  });

  test("sorts by alignment count desc, then 1D change desc", () => {
    renderView(ROWS);
    expect(domRows().map((item) => item.getAttribute("data-symbol"))).toEqual([
      "AAA",
      "BBB",
      "FFF",
      "DDD",
      "CCC",
    ]);
  });

  test("filter chips change the visible rows and the showing counter", () => {
    renderView(ROWS);
    expect(screen.getByTestId("trend-showing")).toHaveTextContent("showing 5 of 5");

    fireEvent.click(screen.getByTestId("trend-filter-3/3"));
    expect(domRows().map((item) => item.getAttribute("data-symbol"))).toEqual(["AAA"]);
    expect(screen.getByTestId("trend-showing")).toHaveTextContent("showing 1 of 5");
    expect(screen.getByTestId("trend-filter-3/3")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("trend-filter-2+"));
    expect(domRows().map((item) => item.getAttribute("data-symbol"))).toEqual(["AAA", "BBB", "FFF"]);
    expect(screen.getByTestId("trend-showing")).toHaveTextContent("showing 3 of 5");

    fireEvent.click(screen.getByTestId("trend-filter-below200"));
    expect(domRows().map((item) => item.getAttribute("data-symbol"))).toEqual(["FFF", "DDD", "CCC"]);
    expect(screen.getByTestId("trend-showing")).toHaveTextContent("showing 3 of 5");

    fireEvent.click(screen.getByTestId("trend-filter-all"));
    expect(domRows()).toHaveLength(5);
    expect(screen.getByTestId("trend-showing")).toHaveTextContent("showing 5 of 5");
  });

  test("clicking a row calls onSymbolClick with its symbol", () => {
    const onClick = vi.fn();
    renderView(ROWS, onClick);
    fireEvent.click(findRow("DDD"));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick).toHaveBeenCalledWith("DDD");
  });

  test("shows the empty state when no row carries moving-average data", () => {
    renderView([row("NO_MA"), row("ALSO_NO_MA", { close: null })]);
    expect(screen.getByTestId("trend-empty")).toHaveTextContent("No moving-average data.");
    expect(screen.queryAllByTestId("trend-row")).toHaveLength(0);
  });

  test("an empty input also shows the empty state", () => {
    renderView([]);
    expect(screen.getByTestId("trend-empty")).toHaveTextContent("No moving-average data.");
  });

  test("limits the scrollable list to 150 rows and reports the total", () => {
    const many = Array.from({ length: 160 }, (_, index) =>
      row(`S${String(index).padStart(3, "0")}`, {
        close: 100,
        sma20: 90,
        sma50: 80,
        sma200: 70,
        change: index,
      }),
    );
    renderView(many);
    expect(TREND_ROW_LIMIT).toBe(150);
    expect(domRows()).toHaveLength(150);
    const count = screen.getByTestId("trend-showing");
    expect(count).toHaveTextContent("showing 150 of 160");
    expect(count.textContent?.toLowerCase()).not.toContain("load more");
    expect(count.getAttribute("title") ?? "").toContain("visible cap 150");
    expect(screen.getByTestId("trend-load-more")).toBeInTheDocument();
    expect(screen.getByTestId("trend-scroll")).toHaveClass("overflow-y-auto");
  });

  test("toolbar never clips the filters and the count sits in its own band", () => {
    renderView(ROWS);
    const toolbar = screen.getByTestId("trend-toolbar");
    expect(toolbar).not.toHaveClass("overflow-hidden");
    expect(toolbar).toHaveClass("flex-wrap");
    expect(screen.getByTestId("trend-filters")).toHaveClass("overflow-x-auto");

    const count = screen.getByTestId("trend-showing");
    expect(count).toBeInTheDocument();
    expect(count.closest("[data-testid='trend-footer']")).not.toBeNull();
  });

  test("the scroll container is full width and never sets its own intrinsic width", () => {
    renderView(ROWS);
    const scroller = screen.getByTestId("trend-scroll");
    expect(scroller).toHaveClass("w-full");
    expect(scroller).toHaveClass("min-w-0");
    expect(scroller).toHaveClass("flex-1");
    expect(scroller).toHaveClass("overflow-y-auto");
    // An intrinsic width or a min-content track is what collapsed the 390px
    // panel to an ~80px strip in the original defect.
    expect(scroller.className).not.toMatch(/(^|\s)w-\[/);
    expect(scroller).not.toHaveClass("min-w-max");
    expect(scroller).toHaveClass("overflow-x-auto");

    const view = screen.getByTestId("trend-alignment-view");
    expect(view).toHaveClass("w-full");
    expect(view).toHaveClass("min-w-0");
    expect(screen.getByTestId("trend-head")).toHaveClass("w-full");
    expect(domRows().every((item) => item.classList.contains("w-full") && item.classList.contains("min-w-0"))).toBe(true);
  });

  test("the symbol cell is bounded instead of a nowrap cell with unbounded width", () => {
    renderView(ROWS);
    const symbol = within(findRow("AAA")).getByTestId("trend-symbol");
    expect(symbol).toHaveClass("min-w-0");
    expect(symbol).toHaveClass("flex-1");
    expect(symbol).toHaveClass("truncate");
    expect(symbol.className).not.toMatch(/(^|\s)w-\[/);
    expect(symbol).not.toHaveClass("min-w-max");

    // Fixed columns must not be squeezed by a greedy symbol cell.
    for (const testid of ["trend-count", "trend-change"]) {
      const cell = within(findRow("AAA")).getByTestId(testid);
      expect(cell).toHaveClass("shrink-0");
    }
  });

  test("Load more renders its complete label and no ancestor clips it without a scroll cue", () => {
    const many = Array.from({ length: 160 }, (_, index) =>
      row(`S${String(index).padStart(3, "0")}`, {
        close: 100,
        sma20: 90,
        sma50: 80,
        sma200: 70,
        change: index,
      }),
    );
    renderView(many);
    const loadMore = screen.getByTestId("trend-load-more");
    expect(loadMore).toHaveTextContent("Load more");
    expect(loadMore.textContent).toBe("Load more");
    expect(loadMore).toHaveClass("shrink-0");
    expect(loadMore).toHaveClass("whitespace-nowrap");

    const view = screen.getByTestId("trend-alignment-view");
    let node: HTMLElement | null = loadMore;
    while (node && node !== view.parentElement) {
      const clipped = node.classList.contains("overflow-hidden");
      const scrollable = node.classList.contains("overflow-x-auto");
      expect(clipped && !scrollable, `${node.tagName}.${node.className} clips Load more`).toBe(false);
      node = node.parentElement;
    }
  });

  test("a 390px row exposes the symbol, N/3 alignment and 1D change together", () => {
    renderView(ROWS);
    const rowEl = findRow("AAA");
    const symbol = within(rowEl).getByTestId("trend-symbol");
    const count = within(rowEl).getByTestId("trend-count");
    const change = within(rowEl).getByTestId("trend-change");

    expect(symbol).toHaveTextContent("AAA");
    expect(count).toHaveTextContent("3/3");
    expect(change).toHaveTextContent("+2.00%");
    for (const cell of [symbol, count, change]) {
      expect(cell).not.toHaveClass("hidden");
      expect(cell).not.toHaveClass("invisible");
      expect(cell.className).not.toMatch(/(^|\s)w-\[/);
    }
    // The row itself stays inside the panel's 358px content box.
    expect(rowEl).toHaveClass("w-full");
    expect(rowEl).toHaveClass("min-w-0");
  });

  test("Load more raises the cap by 150 and disappears at the 600 ceiling", () => {
    const many = Array.from({ length: 700 }, (_, index) =>
      row(`S${String(index).padStart(3, "0")}`, {
        close: 100,
        sma20: 90,
        sma50: 80,
        sma200: 70,
        change: index,
      }),
    );
    renderView(many);

    expect(TREND_ROW_MAX).toBe(600);
    expect(domRows()).toHaveLength(150);
    const count = screen.getByTestId("trend-showing");
    expect(count).toHaveTextContent("showing 150 of 700");
    expect(count.textContent?.toLowerCase()).not.toContain("load more");
    expect(count.getAttribute("title") ?? "").toContain("visible cap 150");
    const loadMore = screen.getByTestId("trend-load-more");
    expect(loadMore).toBeInTheDocument();

    for (const total of [300, 450, 600]) {
      fireEvent.click(loadMore);
      expect(domRows()).toHaveLength(total);
      expect(count).toHaveTextContent(`showing ${total} of 700`);
      expect(count.textContent?.toLowerCase()).not.toContain("load more");
      expect(count.getAttribute("title") ?? "").toContain(`visible cap ${total}`);
    }
    expect(screen.queryByTestId("trend-load-more")).not.toBeInTheDocument();
    expect(count.textContent?.toLowerCase()).not.toContain("load more");
  });

  test("changing a filter resets the incremental reveal cap", () => {
    const many = Array.from({ length: 400 }, (_, index) =>
      row(`S${String(index).padStart(3, "0")}`, {
        close: 100,
        sma20: 90,
        sma50: 80,
        sma200: 70,
        change: index,
      }),
    );
    renderView(many);
    fireEvent.click(screen.getByTestId("trend-load-more"));
    expect(domRows()).toHaveLength(300);

    fireEvent.click(screen.getByTestId("trend-filter-all"));
    expect(domRows()).toHaveLength(150);
  });

  test("row buttons contain no <p> elements", () => {
    renderView(ROWS);
    const view = screen.getByTestId("trend-alignment-view");
    expect(domRows().length).toBeGreaterThan(0);
    expect(view.querySelectorAll("button p")).toHaveLength(0);
  });

  test("legend wraps and hides the sort hint below sm", () => {
    renderView(ROWS);
    const legend = screen.getByTestId("trend-legend");
    expect(legend).toHaveClass("flex-wrap");
    expect(legend).toHaveClass("gap-2");

    const hint = within(legend).getByText("sorted by alignment, then 1D");
    expect(hint).toHaveClass("hidden");
    expect(hint).toHaveClass("sm:block");
    expect(hint).toHaveAttribute("title", "sorted by alignment, then 1D");
  });
});

describe("trend alignment helpers", () => {
  const aligned = (symbol: string, count: number, change: number | null): TrendAlignmentRow => ({
    symbol,
    change,
    count,
    label: `${count}/3`,
    states: ["above", "below", "below"],
    hasData: true,
  });

  test("maState treats null/non-finite operands as no data and equality as below", () => {
    expect(maState(100, 90)).toBe("above");
    expect(maState(90, 100)).toBe("below");
    expect(maState(100, 100)).toBe("below");
    expect(maState(100, null)).toBe("null");
    expect(maState(null, 100)).toBe("null");
    expect(maState(Number.NaN, 100)).toBe("null");
  });

  test("toAlignmentRow counts above MAs, keeps nulls muted and flags empty rows", () => {
    const withNull = toAlignmentRow(
      row("X", { close: 100, sma20: null, sma50: 90, sma200: 110, change: Number.NaN }),
    );
    expect(withNull.states).toEqual(["null", "above", "below"]);
    expect(withNull.count).toBe(1);
    expect(withNull.label).toBe("1/3");
    expect(withNull.hasData).toBe(true);
    expect(withNull.change).toBeNull();
    expect(toAlignmentRow(row("Y", {})).hasData).toBe(false);
  });

  test("pure sort/filter helpers agree with the rendered result", () => {
    const rows = [aligned("LOW", 0, 5), aligned("MID", 2, 1), aligned("TOP", 2, 3)];
    expect(sortTrendRows(rows).map((item) => item.symbol)).toEqual(["TOP", "MID", "LOW"]);
    expect(filterTrendRows(rows, "3/3")).toEqual([]);
    expect(filterTrendRows(rows, "2+").map((item) => item.symbol)).toEqual(["MID", "TOP"]);
    expect(filterTrendRows(rows, "below200")).toHaveLength(3);
  });

  test("change formatting has no -0.00% and dashes for missing quotes", () => {
    expect(formatTrendChange(null)).toBe("—");
    expect(formatTrendChange(-0.0001)).toBe("0.00%");
    expect(formatTrendChange(-1.25)).toBe("-1.25%");
    expect(formatTrendChange(1.25)).toBe("+1.25%");
  });
});
