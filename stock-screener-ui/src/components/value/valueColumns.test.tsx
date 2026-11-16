// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import { buildValueColumns, isInAppChartExchange } from "./valueColumns";
import type { ValueRow } from "../../api/valueScan";

function row(overrides: Partial<ValueRow> = {}): ValueRow {
  return {
    symbol: "RELIANCE",
    name: "Reliance Industries",
    exchange: "NSE",
    currency: "INR",
    price: 2450.5,
    change: 1.25,
    mcap_bn: 331.0,
    rev_bn: 102.4,
    pe: 9.1,
    ps: 1.2,
    pb: 1.8,
    fcf_yield: 5.4,
    div_yield: 1.1,
    roe: 14.2,
    gross_margin: 32.0,
    op_margin: 18.5,
    rev_yoy: 8.3,
    eps_yoy: 6.1,
    debt_to_equity: 0.4,
    current_ratio: 1.6,
    rsi: 42.0,
    vs_200dma: 3.2,
    off_52w_high: -14.0,
    score: 78,
    subscores: { value: 80, quality: 75, growth: 70, health: 82 },
    peer: { bucket: "Refining", pe_median: 11.2, roe_median: 12.0, fcf_yield_median: 4.1 },
    flags: ["LOW_PE"],
    derived: {
      fcf_yield: 5.4,
      earnings_yield: 11.0,
      vs_200dma: 3.2,
      off_52w_high: -14.0,
      distorted_pe: false,
    },
    ...overrides,
  };
}

function nameAccessor(): (r: ValueRow) => unknown {
  const col = buildValueColumns().find((c) => c.id === "name");
  expect(col?.accessorFn).toBeTypeOf("function");
  return col!.accessorFn!;
}

describe("buildValueColumns NAME accessor", () => {
  it("returns the company name, falling back to the symbol", () => {
    const accessor = nameAccessor();
    expect(accessor(row({ symbol: "RELIANCE", name: "Reliance Industries" }))).toBe(
      "Reliance Industries",
    );
    const nameless = row({ symbol: "ACME" });
    expect(accessor({ ...nameless, name: undefined as unknown as string })).toBe("ACME");
  });

  it("sorts rows by name ascending and descending via the accessor", () => {
    const accessor = nameAccessor();
    const rows = [
      row({ symbol: "ZOMATO", name: "Zomato Ltd" }),
      row({ symbol: "ABB", name: "ABB India" }),
    ];
    const asc = [...rows].sort((a, b) =>
      String(accessor(a)).localeCompare(String(accessor(b))),
    );
    expect(asc.map((r) => r.symbol)).toEqual(["ABB", "ZOMATO"]);
    const desc = [...rows].sort((a, b) =>
      String(accessor(b)).localeCompare(String(accessor(a))),
    );
    expect(desc.map((r) => r.symbol)).toEqual(["ZOMATO", "ABB"]);
  });
});

describe("buildValueColumns symbol cell — in-app text / TV ↗ inversion", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderNameCell(
    onSymbolClick?: (symbol: string) => void,
    rowClick = vi.fn(),
    rowOverrides: Partial<ValueRow> = {},
  ) {
    const col = buildValueColumns(onSymbolClick).find((c) => c.id === "name")!;
    const original = row(rowOverrides);
    const rowCtx = {
      original,
      index: 0,
      isExpanded: () => false,
      toggle: () => {},
    };
    render(() => (
      <UIProvider>
        <div onClick={rowClick}>{col.cell!({ row: rowCtx, column: col })}</div>
      </UIProvider>
    ));
    return rowClick;
  }

  it("body click calls onSymbolClick and never window.open", async () => {
    const onSymbolClick = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const rowClick = renderNameCell(onSymbolClick);

    const text = screen.getByTestId("value-name-RELIANCE");
    expect(text.tagName).toBe("BUTTON");
    expect(text).toHaveTextContent("RELIANCE");
    await fireEvent.click(text);

    expect(onSymbolClick).toHaveBeenCalledTimes(1);
    expect(onSymbolClick).toHaveBeenCalledWith("RELIANCE");
    expect(openSpy).not.toHaveBeenCalled();
    expect(rowClick).not.toHaveBeenCalled();
  });

  it("↗ is a TradingView anchor and does not call onSymbolClick", async () => {
    const onSymbolClick = vi.fn();
    renderNameCell(onSymbolClick);

    const external = screen.getByTestId("symbol-tv-RELIANCE");
    expect(external.tagName).toBe("A");
    expect(external).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NSE%3ARELIANCE",
    );
    expect(external).toHaveAttribute("target", "_blank");
    expect(external.getAttribute("rel")).toContain("noopener");
    await fireEvent.click(external);
    expect(onSymbolClick).not.toHaveBeenCalled();
  });

  it("a NASDAQ row keeps the TV link and never wires the in-app chart handler", async () => {
    const onSymbolClick = vi.fn();
    renderNameCell(onSymbolClick, vi.fn(), {
      symbol: "AAPL",
      name: "Apple Inc",
      exchange: "NASDAQ",
    });

    const text = screen.getByTestId("value-name-AAPL");
    expect(text.tagName).toBe("A");
    expect(text).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NASDAQ%3AAAPL",
    );
    await fireEvent.click(text);
    expect(onSymbolClick).not.toHaveBeenCalled();

    const external = screen.getByTestId("symbol-tv-AAPL");
    expect(external.tagName).toBe("A");
    expect(external).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NASDAQ%3AAAPL",
    );
    expect(external).toHaveAttribute("target", "_blank");
    expect(external.getAttribute("rel")).toContain("noopener");
  });

  it("no handler leaves the body as a TV link, not an in-app button", () => {
    renderNameCell(undefined, vi.fn());
    const text = screen.getByTestId("value-name-RELIANCE");
    expect(text.tagName).toBe("A");
    expect(screen.getByTestId("symbol-tv-RELIANCE")).toBeInTheDocument();
  });
});

describe("isInAppChartExchange", () => {
  it("accepts NSE/BSE/NSI case-insensitively and rejects other markets", () => {
    expect(isInAppChartExchange("NSE")).toBe(true);
    expect(isInAppChartExchange(" bse ")).toBe(true);
    expect(isInAppChartExchange("NSI")).toBe(true);
    expect(isInAppChartExchange("NASDAQ")).toBe(false);
    expect(isInAppChartExchange("NYSE")).toBe(false);
    expect(isInAppChartExchange("LON")).toBe(false);
    expect(isInAppChartExchange(undefined)).toBe(false);
  });
});
