// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, screen, within } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { renderWithProviders } from "@/test-utils/renderWithProviders";
import { VIZ_SCALE_PNL } from "@/ui/palette";
import type { MarketRow } from "@/types/marketScreener";
import {
  dotOffsetPct,
  formatPct,
  pnlScaleColor,
  Range52View,
  sortRangeRows,
  toHighText,
} from "./Range52View";

function row(symbol: string, overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    symbol,
    name: `${symbol} Full Name`,
    sector: "Technology",
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
    volume: 1000,
    avgVolume: 1000,
    gap: null,
    atr: null,
    high: null,
    low: null,
    valueTraded: null,
    to52wHighPct: -16.666666666666664,
    from52wLowPct: 25,
    rangeVsAtr: null,
    fno: false,
    etf: false,
    ...overrides,
  };
}

const ROWS: MarketRow[] = [
  row("AAA", {
    low52w: 100,
    high52w: 200,
    close: 150,
    pos52w: 50,
    to52wHighPct: -25,
    change: 2,
  }),
  row("BBB", {
    low52w: 50,
    high52w: 100,
    close: 98,
    pos52w: 96,
    to52wHighPct: -2,
    change: -1,
  }),
  row("CCC", {
    low52w: 80,
    high52w: 120,
    close: 124,
    pos52w: 100,
    to52wHighPct: ((124 - 120) / 120) * 100,
    change: 4,
  }),
  row("NUL", {
    low52w: null,
    high52w: null,
    close: null,
    pos52w: null,
    to52wHighPct: null,
    change: null,
  }),
];

const rowKeys = () =>
  Array.from(screen.getByTestId("range52-list").querySelectorAll("[data-row-key]"))
    .map((node) => node.getAttribute("data-row-key") ?? "")
    .map((key) => key.slice(key.indexOf("-") + 1));

function clickFilter(value: string) {
  const selector = screen.getByTestId("range52-filter-selector");
  const button = selector.querySelector(`button[data-value="${value}"]`);
  if (!button) throw new Error(`No range52 filter for ${value}`);
  fireEvent.click(button);
}

/** happy-dom has no layout engine; feed the overflow read explicit metrics. */
function setScrollMetrics(
  el: HTMLElement,
  scrollWidth: number,
  clientWidth: number,
  scrollLeft = 0,
) {
  Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  Object.defineProperty(el, "scrollLeft", {
    configurable: true,
    writable: true,
    value: scrollLeft,
  });
  window.dispatchEvent(new Event("resize"));
}

function manyRows(count: number): MarketRow[] {
  return Array.from({ length: count }, (_, index) =>
    row(`S${index}`, {
      symbol: `S${index}`,
      low52w: 100,
      high52w: 200,
      close: 200 - (index % 150),
      pos52w: 100 - (index % 150) / 2,
      to52wHighPct: -(index % 150),
    }),
  );
}

afterEach(cleanup);

describe("Range52View", () => {
  test("tracks are proportional to (close − low) / (high − low) and the list sorts closest-to-high first", () => {
    renderWithProviders(() => <Range52View rows={ROWS} />);

    expect(rowKeys()).toEqual(["CCC", "BBB", "AAA", "NUL"]);
    expect(dotOffsetPct(ROWS[0])).toBe(50);
    expect(dotOffsetPct(ROWS[1])).toBe(96);
    expect(screen.getByTestId("range52-dot-AAA")).toHaveAttribute("data-dot-pct", "50.000");
    expect(screen.getByTestId("range52-dot-AAA")).toHaveStyle({ left: "50.000%" });
    expect(screen.getByTestId("range52-dot-BBB")).toHaveAttribute("data-dot-pct", "96.000");
    // A close above the 52W high is pinned to the end of the rail, never drawn past it.
    expect(screen.getByTestId("range52-dot-CCC")).toHaveAttribute("data-dot-pct", "110.000");
    expect(screen.getByTestId("range52-dot-CCC")).toHaveStyle({ left: "100.000%" });
    expect(sortRangeRows(ROWS).map((item) => item.symbol)).toEqual(["CCC", "BBB", "AAA", "NUL"]);
  });

  test("the within-2% chip filters client-side on to52wHighPct", () => {
    renderWithProviders(() => <Range52View rows={ROWS} />);
    expect(screen.getByTestId("range52-count")).toHaveTextContent("showing 4 of 4");

    clickFilter("2");

    expect(screen.getByTestId("range52-row-BBB")).toBeInTheDocument();
    expect(screen.queryByTestId("range52-row-AAA")).not.toBeInTheDocument();
    expect(screen.queryByTestId("range52-row-CCC")).not.toBeInTheDocument();
    expect(screen.queryByTestId("range52-row-NUL")).not.toBeInTheDocument();
    expect(screen.getByTestId("range52-count")).toHaveTextContent("showing 1 of 1");

    clickFilter("all");
    expect(rowKeys()).toEqual(["CCC", "BBB", "AAA", "NUL"]);
  });

  test("null-range rows read n/a and are excluded from the position histogram", () => {
    renderWithProviders(() => <Range52View rows={ROWS} />);

    expect(screen.getByTestId("range52-row-NUL")).toHaveTextContent("n/a");
    expect(screen.queryByTestId("range52-dot-NUL")).not.toBeInTheDocument();
    expect(screen.getByTestId("range52-histogram-bar-5")).toHaveAttribute("data-count", "1");
    expect(screen.getByTestId("range52-histogram-bar-9")).toHaveAttribute("data-count", "2");
    expect(screen.getByTestId("range52-histogram-count")).toHaveTextContent("3 stocks");
    expect(screen.getByTestId("range52-histogram-median")).toHaveAttribute("data-median", "96.00");
  });

  test("a row click calls onSymbolClick with its symbol", () => {
    const onSymbolClick = vi.fn();
    renderWithProviders(() => <Range52View rows={ROWS} onSymbolClick={onSymbolClick} />);

    fireEvent.click(screen.getByTestId("range52-row-AAA"));

    expect(onSymbolClick).toHaveBeenCalledTimes(1);
    expect(onSymbolClick).toHaveBeenCalledWith("AAA");
  });

  test("dot colour follows the P&L ramp, not the inverted RdBu scale", () => {
    expect(pnlScaleColor(-5, 5)).toBe(VIZ_SCALE_PNL[0]);
    expect(pnlScaleColor(0, 5)).toBe(VIZ_SCALE_PNL[4]);
    expect(pnlScaleColor(5, 5)).toBe(VIZ_SCALE_PNL[8]);
    renderWithProviders(() => <Range52View rows={ROWS} />);
    expect(screen.getByTestId("range52-dot-AAA")).toHaveAttribute(
      "data-dot-color",
      pnlScaleColor(2, 4),
    );
    expect(screen.getByTestId("range52-dot-BBB")).toHaveAttribute(
      "data-dot-color",
      pnlScaleColor(-1, 4),
    );
  });

  test("the list caps at 150 rows and reports the full match count", () => {
    const many = Array.from({ length: 160 }, (_, index) =>
      row(`S${index}`, {
        symbol: `S${index}`,
        low52w: 100,
        high52w: 200,
        close: 200 - index,
        pos52w: 100 - index / 2,
        to52wHighPct: -index,
      }),
    );
    renderWithProviders(() => <Range52View rows={many} />);

    expect(screen.getByTestId("range52-count")).toHaveTextContent("showing 150 of 160");
    expect(screen.getByTestId("range52-list").querySelectorAll("[data-row-key]")).toHaveLength(150);
  });

  test("empty rows and a filter with no matches show the empty state", () => {
    const { unmount } = renderWithProviders(() => <Range52View rows={[]} />);
    expect(screen.getByTestId("range52-empty")).toHaveTextContent(
      "No 52-week data in the current filter.",
    );
    unmount();

    renderWithProviders(() => (
      <Range52View rows={[row("FAR", { to52wHighPct: -40, close: 120, pos52w: 40 })]} />
    ));
    clickFilter("2");
    expect(screen.getByTestId("range52-empty")).toHaveTextContent(
      "No 52-week data in the current filter.",
    );
  });

  test("the count discloses hidden rows while the button is the only load-more affordance", () => {
    renderWithProviders(() => <Range52View rows={manyRows(400)} />);

    const count = screen.getByTestId("range52-count");
    expect(count).toHaveTextContent("showing 150 of 400");
    expect(count.textContent?.toLowerCase()).not.toContain("load more");
    expect(count.getAttribute("title") ?? "").toContain("visible cap 150");
    expect(count.getAttribute("title") ?? "").toContain("Use Load more");
    const loadMore = screen.getByTestId("range52-load-more");
    expect(loadMore).toBeEnabled();
    expect(rowKeys()).toHaveLength(150);

    fireEvent.click(loadMore);
    expect(rowKeys()).toHaveLength(300);
    expect(count).toHaveTextContent("showing 300 of 400");
    expect(count.textContent?.toLowerCase()).not.toContain("load more");
    expect(count.getAttribute("title") ?? "").toContain("visible cap 300");

    fireEvent.click(loadMore);
    expect(rowKeys()).toHaveLength(400);
    expect(count).toHaveTextContent("showing 400 of 400");
    expect(count.textContent?.toLowerCase()).not.toContain("load more");
    expect(screen.queryByTestId("range52-load-more")).not.toBeInTheDocument();
  });

  test("Load more stops at the 600-row ceiling and says why", () => {
    renderWithProviders(() => <Range52View rows={manyRows(700)} />);
    const loadMore = screen.getByTestId("range52-load-more");

    for (const expected of [300, 450, 600]) {
      fireEvent.click(loadMore);
      expect(rowKeys()).toHaveLength(expected);
    }

    expect(loadMore).toBeDisabled();
    expect(screen.getByTestId("range52-count")).toHaveTextContent("showing 600 of 700");
    expect(screen.getByTestId("range52-count").getAttribute("title") ?? "").toContain(
      "600-row ceiling",
    );
  });

  test("the toolbar wraps without clipping and the proximity filter rail scrolls", () => {
    renderWithProviders(() => <Range52View rows={ROWS} />);

    const toolbar = screen.getByTestId("range52-toolbar");
    expect(toolbar).toHaveClass("flex-wrap");
    expect(toolbar).not.toHaveClass("flex-nowrap");
    expect(toolbar).not.toHaveClass("overflow-hidden");

    const selector = screen.getByTestId("range52-filter-selector");
    expect(selector).toHaveAttribute("role", "group");
    expect(selector.className).toContain("overflow-x-auto");
    expect(selector.className).not.toContain("overflow-hidden");
    expect(selector.querySelectorAll("button[data-value]")).toHaveLength(4);

    setScrollMetrics(selector, 400, 160);
    expect(screen.getByTestId("range52-filter-scroll")).toHaveAttribute(
      "aria-label",
      "Scroll proximity filters",
    );

    const footer = screen.getByTestId("range52-footer");
    expect(footer.className).toContain("w-full");
    expect(footer.className).toContain("sm:w-auto");
  });

  test("the symbol tooltip names both the visible token and the company", () => {
    renderWithProviders(() => <Range52View rows={ROWS} />);
    const symbol = within(screen.getByTestId("range52-row-AAA")).getByText("AAA");
    expect(symbol).toHaveAttribute("title", "AAA · AAA Full Name");
  });

  test("the 'of high' unit stays outside the scrollable filter cell at narrow widths (PIXEL F-02)", () => {
    renderWithProviders(() => <Range52View rows={ROWS} />);
    const ofHigh = screen.getByTestId("range52-of-high");
    expect(ofHigh).toHaveTextContent("of high");
    // Full width at narrow forces a separate wrapped line instead of sharing
    // the bounded, scrollable chip cell; wide viewports restore the inline unit.
    expect(ofHigh).toHaveClass("w-full", "shrink-0", "min-[900px]:w-auto");
    expect(ofHigh).not.toHaveClass("hidden", "truncate", "overflow-hidden");

    const selector = screen.getByTestId("range52-filter-selector");
    expect(selector).toHaveClass("overflow-x-auto");
    expect(selector.querySelectorAll("button[data-value]")).toHaveLength(4);
    expect(selector.contains(ofHigh)).toBe(false);
    expect(selector.getAttribute("aria-label") ?? "").toContain("of 52-week high");
    expect(
      screen.getByTestId("range52-toolbar").querySelector('[title*="of high"]'),
    ).not.toBeNull();
    expect(screen.getByTestId("range52-count")).toHaveTextContent("showing 4 of 4");
  });
});

describe("Range52View percentage formatting (no -0.0%, evidence rule §7.2)", () => {
  test("values that round to zero read 0.0% with no leading minus", () => {
    for (const value of [-0.04, -0.001, 0, -0, 0.04]) {
      expect(formatPct(value)).toBe("0.0%");
    }
  });

  test("a genuine small negative keeps its sign at one decimal", () => {
    expect(formatPct(-0.44)).toBe("-0.4%");
    expect(formatPct(-4)).toBe("-4.0%");
    expect(formatPct(0.44)).toBe("0.4%");
  });

  test("the zero-decimal and two-decimal formatters also suppress negative zero", () => {
    expect(formatPct(-0.04, 0)).toBe("0%");
    expect(formatPct(-0.001, 2)).toBe("0.00%");
    expect(formatPct(-0.016, 2)).toBe("-0.02%");
  });

  test("a name sitting at its 52W high renders 0.0% to high, never -0.0%", () => {
    const atHigh = row("HIGH", {
      close: 120,
      high52w: 120,
      low52w: 80,
      pos52w: 100,
      to52wHighPct: -0.04,
      change: -0.001,
    });
    const nearHigh = row("NEAR", {
      close: 119.9,
      high52w: 120,
      low52w: 80,
      pos52w: 99.75,
      to52wHighPct: -0.44,
    });
    expect(toHighText(atHigh)).toBe("0.0% to high");
    expect(toHighText(nearHigh)).toBe("-0.4% to high");

    renderWithProviders(() => <Range52View rows={[atHigh, nearHigh]} />);
    expect(screen.getByTestId("range52-row-HIGH").textContent).not.toContain("-0.0%");
    expect(screen.getByTestId("range52-row-HIGH")).toHaveTextContent("0.0% to high");
    expect(screen.getByTestId("range52-row-NEAR")).toHaveTextContent("-0.4% to high");
    expect(screen.getByTestId("range52-row-HIGH").getAttribute("title") ?? "").not.toContain(
      "-0.00%",
    );
    expect(screen.getByTestId("range52-row-HIGH").getAttribute("title") ?? "").toContain(
      "change 0.00%",
    );
  });
});
