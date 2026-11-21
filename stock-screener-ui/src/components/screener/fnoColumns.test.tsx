// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@solidjs/testing-library";
import { UIProvider } from "@/ui";
import type { TableColumnDef } from "../common/TanStackTable";
import { SymbolDockContext } from "../common/symbolDockContext";
import { buildFnoColumns } from "./fnoColumns";
import type { FnoScreenerRow } from "../../api/fnoScreener";

const dockOpen = vi.fn();
const dockClose = vi.fn();

const EXPECTED_DATA_COLUMNS = [
  "symbol",
  "setup",
  "call",
  "spot",
  "d1",
  "d5",
  "vol_ratio",
  "otm_pct",
  "premium",
  "cost_lot",
  "pop",
  "delta",
  "gamma",
  "theta",
  "vega",
  "iv",
  "oi",
  "spread_pct",
  "move_2pct_est",
] as const;

const sampleRow: FnoScreenerRow = {
  symbol: "RELIANCE",
  spot: 2946,
  d1: 1.25,
  d5: 4.6,
  vol_ratio: 1.4,
  above20: 1,
  setup: "BREAKOUT",
  call: "CE",
  strike: 3000,
  otm_pct: 1.83,
  premium: 45.5,
  cost_lot: 9100,
  breakeven: 3045.5,
  pop: 62,
  delta: 0.55,
  gamma: 0.012,
  theta: -18.5,
  vega: 0.42,
  iv: 22.5,
  oi: 125000,
  volume: 45000,
  spread_pct: 0.8,
  move_2pct_est: 3.4,
};

type Accessor = (row: FnoScreenerRow) => unknown;

function accessorOf(columns: TableColumnDef<FnoScreenerRow>[], id: string): Accessor {
  const col = columns.find((c) => c.id === id);
  expect(col).toBeDefined();
  return col!.accessorFn as Accessor;
}

describe("buildFnoColumns", () => {
  // Build once, reuse across assertions.
  const columns = buildFnoColumns();

  it("exposes every expected data column plus the expander", () => {
    const ids = columns.map((c) => c.id);
    EXPECTED_DATA_COLUMNS.forEach((id) => expect(ids).toContain(id));
    expect(ids).toContain("expand");
    expect(columns.length).toBe(EXPECTED_DATA_COLUMNS.length + 1);
  });

  it("every data column has a callable accessorFn", () => {
    columns.forEach((col) => {
      if (col.id === "expand") return;
      expect(col.accessorFn).toBeTypeOf("function");
      expect(() => accessorOf(columns, col.id)(sampleRow)).not.toThrow();
    });
  });

  it("accessorFn returns the correct value from a sample row", () => {
    expect(accessorOf(columns, "premium")(sampleRow)).toBe(45.5);
    expect(accessorOf(columns, "pop")(sampleRow)).toBe(62);
    expect(accessorOf(columns, "move_2pct_est")(sampleRow)).toBe(3.4);
  });

  it("expander column has no accessorFn and sorting disabled", () => {
    const expand = columns.find((c) => c.id === "expand");
    expect(expand).toBeDefined();
    expect(expand?.accessorFn).toBeUndefined();
    expect(expand?.enableSorting).toBe(false);
  });

  it("every accessor maps to its matching row field", () => {
    const fieldById: Record<string, keyof FnoScreenerRow> = {
      symbol: "symbol",
      call: "strike",
      spot: "spot",
      d1: "d1",
      d5: "d5",
      vol_ratio: "vol_ratio",
      otm_pct: "otm_pct",
      premium: "premium",
      cost_lot: "cost_lot",
      pop: "pop",
      delta: "delta",
      gamma: "gamma",
      theta: "theta",
      vega: "vega",
      iv: "iv",
      oi: "oi",
      spread_pct: "spread_pct",
      move_2pct_est: "move_2pct_est",
    };
    EXPECTED_DATA_COLUMNS.forEach((id) => {
      if (id === "setup") return; // ranked for meaningful sort — asserted separately below
      expect(accessorOf(columns, id)(sampleRow)).toBe(sampleRow[fieldById[id]]);
    });
  });

  it("CALL accessor uses the numeric strike, not the formatted label", () => {
    const call = accessorOf(columns, "call");
    expect(call(sampleRow)).toBe(3000);
    const low = { ...sampleRow, symbol: "LOW", strike: 250, call: "250 CE" };
    const high = { ...sampleRow, symbol: "HIGH", strike: 1000, call: "1000 CE" };
    // Ascending numeric sort: 1000 > 250. A lexicographic sort on "call"
    // ("1000 CE" < "250 CE") would reverse this — the exact regression.
    const asc = [high, low].sort((a, b) => (call(a) as number) - (call(b) as number));
    expect(asc.map((r) => r.symbol)).toEqual(["LOW", "HIGH"]);
    const desc = [low, high].sort((a, b) => (call(b) as number) - (call(a) as number));
    expect(desc.map((r) => r.symbol)).toEqual(["HIGH", "LOW"]);
  });

  it("SETUP accessor ranks BREAKOUT first and WEAK last", () => {
    const setup = accessorOf(columns, "setup");
    const ranked = [
      { ...sampleRow, symbol: "WEAK", setup: "WEAK" as const },
      { ...sampleRow, symbol: "BASE", setup: "BASE" as const },
      { ...sampleRow, symbol: "BREAKOUT", setup: "BREAKOUT" as const },
      { ...sampleRow, symbol: "EXTENDED", setup: "EXTENDED" as const },
      { ...sampleRow, symbol: "NEAR", setup: "NEAR HIGH" as const },
      { ...sampleRow, symbol: "WATCH", setup: "WATCH" as const },
    ].sort((a, b) => (setup(a) as number) - (setup(b) as number));
    expect(ranked.map((r) => r.symbol)).toEqual([
      "BREAKOUT", "NEAR", "WATCH", "BASE", "EXTENDED", "WEAK",
    ]);
  });

  it("declares an alignment that matches the rendered cell", () => {
    const numbers = [
      "spot",
      "d1",
      "d5",
      "vol_ratio",
      "otm_pct",
      "premium",
      "cost_lot",
      "pop",
      "delta",
      "gamma",
      "theta",
      "vega",
      "iv",
      "oi",
      "spread_pct",
      "move_2pct_est",
    ];
    const alignOf = (id: string) =>
      (columns.find((c) => c.id === id)?.meta as { align?: string })?.align;
    numbers.forEach((id) => expect(alignOf(id), `${id} is numeric`).toBe("right"));
    expect(alignOf("symbol")).toBe("left");
    expect(alignOf("call")).toBe("left");
    expect(alignOf("setup")).toBe("center");
    expect(alignOf("expand")).toBe("center");
    for (const col of columns) {
      expect((col.meta as { align?: string } | undefined)?.align).toBeTruthy();
    }
  });
});

describe("buildFnoColumns symbol cell — in-app text / TV ↗ inversion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function renderSymbolCell(onSymbolClick?: (symbol: string) => void, rowClick = vi.fn()) {
    const col = buildFnoColumns(onSymbolClick).find((c) => c.id === "symbol")!;
    const row = {
      original: sampleRow,
      index: 0,
      isExpanded: () => false,
      toggle: () => {},
    };
    render(() => (
      <UIProvider>
        <SymbolDockContext.Provider
          value={{
            open: dockOpen,
            close: dockClose,
            preview: vi.fn(),
            endPreview: vi.fn(),
            pinned: false,
            setOutlet: vi.fn(),
          }}
        >
          <div onClick={rowClick}>{col.cell!({ row, column: col })}</div>
        </SymbolDockContext.Provider>
      </UIProvider>
    ));
    return rowClick;
  }

  it("body click calls onSymbolClick and never window.open", async () => {
    const onSymbolClick = vi.fn();
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const rowClick = renderSymbolCell(onSymbolClick);

    const text = screen.getByTestId("fno-cell-symbol-RELIANCE");
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
    renderSymbolCell(onSymbolClick);

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

  it("renders an options-chain action that opens the dock in options mode", async () => {
    renderSymbolCell();

    const options = screen.getByTestId("symbol-options-RELIANCE");
    expect(options.tagName).toBe("BUTTON");
    await fireEvent.click(options);

    expect(dockOpen).toHaveBeenCalledTimes(1);
    expect(dockOpen).toHaveBeenCalledWith("RELIANCE", "options");
  });

  it("keeps the chart icon hidden and the TV ↗ anchor intact with showChart=false", () => {
    renderSymbolCell();

    expect(screen.queryByTestId("symbol-chart-RELIANCE")).not.toBeInTheDocument();
    const external = screen.getByTestId("symbol-tv-RELIANCE");
    expect(external.tagName).toBe("A");
  });

  it("options click does not call onSymbolClick or bubble to the row", async () => {
    const onSymbolClick = vi.fn();
    const rowClick = renderSymbolCell(onSymbolClick);

    await fireEvent.click(screen.getByTestId("symbol-options-RELIANCE"));

    expect(onSymbolClick).not.toHaveBeenCalled();
    expect(rowClick).not.toHaveBeenCalled();
  });
});
