// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import "@testing-library/jest-dom/vitest";
import { ScreenerTable } from "./ScreenerTable";
import { getColumnsForScreener } from "./columns";
import { UIProvider } from "@/ui";
import type { Stock } from "../../types";
import type { ColumnDef } from "./columns";
import type { SavedConfigTransport } from "../../state/savedConfig";
import type { UseTablePrefsResult } from "../common/useTablePrefs";

type Sorting = Array<{ id: string; desc: boolean }>;

const prefsMock = vi.hoisted(() => ({
  ids: [] as string[],
  calls: [] as Sorting[],
  read: null as (() => Sorting) | null,
  write: null as ((next: Sorting) => void) | null,
  useReal: false,
  transport: null as SavedConfigTransport | null,
  realApi: null as UseTablePrefsResult | null,
}));

vi.mock("../common/useTablePrefs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../common/useTablePrefs")>();
  const { createSignal } = await import("solid-js");
  const [get, set] = createSignal<Sorting>([]);
  prefsMock.read = get;
  prefsMock.write = set;
  return {
    ...actual,
    useTablePrefs: (tableId: string) => {
      // Integration tests flip this flag to exercise the real persistence hook
      // against a fake transport; every other test keeps the lightweight mock.
      if (prefsMock.useReal && prefsMock.transport) {
        const api = actual.useTablePrefs(tableId, { deps: { transport: prefsMock.transport } });
        prefsMock.realApi = api;
        return api;
      }
      prefsMock.ids.push(tableId);
      return {
        prefs: () => ({ sorting: get(), order: [], hidden: [] }),
        setSorting: (next: Sorting) => {
          prefsMock.calls.push(next);
          set(next);
        },
        status: () => "ready",
        error: () => null,
        hydrated: () => true,
        setColumnPrefs: () => {},
        retry: () => {},
      };
    },
  };
});

vi.mock("../../state", () => ({
  selectedSymbols: [],
  toggleSymbolSelection: vi.fn(),
  clearSelectedSymbols: vi.fn(),
  setSelectedSymbols: vi.fn(),
  subscribeToSelection: vi.fn(() => vi.fn()),
}));

const mockStock: Stock = {
  symbol: "RELIANCE",
  score: 85,
  tv_price: 2450.5,
  upstox_price: 2451.0,
  broker_diff: 0.02,
  high_52w: 2600,
  to_52w_high: -5.76,
  recent_return_5d: 3.2,
  perf_w: 1.5,
  sector: "Energy",
  touched_52w: false,
  day_change: 1.25,
  rsi: 65.3,
  stoch_k: 72.1,
  gap_pct: 0.5,
  premarket_change: 0.8,
  impact_score: 2.5,
  market_cap_b: 185.3,
  volume_m: 12.45,
};

const mockColumns: ColumnDef[] = [
  { key: "symbol", label: "Symbol", type: "string", sortable: true },
  { key: "score", label: "Score", type: "badge", sortable: true },
  { key: "tv_price", label: "Price", type: "number", sortable: true },
  { key: "day_change", label: "Change", type: "number", sortable: true },
  { key: "sector", label: "Sector", type: "string", sortable: true },
];

const mockStocks: Stock[] = [
  mockStock,
  { ...mockStock, symbol: "TCS", score: 75, sector: "Technology" },
  { ...mockStock, symbol: "INFY", score: 90, touched_52w: true, sector: "Technology" },
];

const defaultProps = {
  stocks: mockStocks,
  columns: mockColumns,
  touchedSymbols: new Set(["INFY"]),
  onSymbolClick: vi.fn(),
  onSymbolHover: vi.fn(),
};

describe("ScreenerTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders all stocks as rows", () => {
    render(() => (
      <UIProvider>
        <ScreenerTable {...defaultProps} />
      </UIProvider>
    ));
    expect(screen.getByTestId("stock-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("stock-row-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("stock-row-INFY")).toBeInTheDocument();
  });

  it("renders header text for each column", () => {
    render(() => (
      <UIProvider>
        <ScreenerTable {...defaultProps} />
      </UIProvider>
    ));
    mockColumns.forEach((col) => {
      expect(screen.getByText(col.label)).toBeInTheDocument();
    });
  });

  it("calls onSymbolClick when stock row is clicked", async () => {
    render(() => (
      <UIProvider>
        <ScreenerTable {...defaultProps} />
      </UIProvider>
    ));
    fireEvent.click(screen.getByTestId("stock-row-TCS"));
    expect(defaultProps.onSymbolClick).toHaveBeenCalledWith("TCS");
  });

  it("symbol body navigates in-app once; ↗ opens TradingView without navigating", async () => {
    render(() => (
      <UIProvider>
        <ScreenerTable {...defaultProps} />
      </UIProvider>
    ));

    const text = screen.getByTestId("symbol-link-RELIANCE");
    expect(text.tagName).toBe("BUTTON");
    await fireEvent.click(text);
    expect(defaultProps.onSymbolClick).toHaveBeenCalledTimes(1);
    expect(defaultProps.onSymbolClick).toHaveBeenCalledWith("RELIANCE");

    const external = screen.getByTestId("symbol-tv-RELIANCE");
    expect(external).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NSE%3ARELIANCE",
    );
    expect(external).toHaveAttribute("target", "_blank");
    expect(external).toHaveAttribute("rel", "noopener noreferrer");
    expect(external).toHaveAccessibleName("Open RELIANCE on TradingView");
    await fireEvent.click(external);
    expect(defaultProps.onSymbolClick).toHaveBeenCalledTimes(1);
  });

  it("does not render copy-all-symbols button when stocks array is empty", () => {
    render(() => (
      <UIProvider>
        <ScreenerTable {...defaultProps} stocks={[]} />
      </UIProvider>
    ));
    expect(screen.queryByTestId("copy-all-symbols-btn")).not.toBeInTheDocument();
  });

  it("renders correct number of columns in header", () => {
    render(() => (
      <UIProvider>
        <ScreenerTable {...defaultProps} />
      </UIProvider>
    ));
    const ths = document.querySelectorAll("thead tr th");
    expect(ths.length).toBe(mockColumns.length + 1);
  });

  it("renders correct number of body rows", () => {
    render(() => (
      <UIProvider>
        <ScreenerTable {...defaultProps} />
      </UIProvider>
    ));
    const rows = document.querySelectorAll("tbody tr");
    expect(rows.length).toBe(mockStocks.length);
  });

  it("handles empty stocks array gracefully", () => {
    render(() => (
      <UIProvider>
        <ScreenerTable {...defaultProps} stocks={[]} />
      </UIProvider>
    ));
    expect(screen.queryByTestId("stock-row-RELIANCE")).not.toBeInTheDocument();
  });

  it("handles single stock", () => {
    render(() => (
      <UIProvider>
        <ScreenerTable {...defaultProps} stocks={[mockStock]} />
      </UIProvider>
    ));
    expect(screen.getByTestId("stock-row-RELIANCE")).toBeInTheDocument();
    expect(screen.queryByTestId("stock-row-TCS")).not.toBeInTheDocument();
  });
});

describe("ScreenerTable market-tick updates", () => {
  const tickColumns: ColumnDef[] = [
    { key: "symbol", label: "Symbol", type: "string", sortable: true },
    {
      key: "day_change",
      label: "Change",
      type: "number",
      sortable: true,
      format: (value: number) => ({
        value: `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`,
        className: value >= 0 ? "success" : "error",
      }),
    },
  ];

  it("shows the FINAL value after 120 rapid market ticks (no stale intermediate renders)", async () => {
    const [stocks, setStocks] = createSignal<Stock[]>([{ ...mockStock, day_change: 1.0 }]);
    render(() => (
      <UIProvider>
        <ScreenerTable
          stocks={stocks()}
          columns={tickColumns}
          touchedSymbols={new Set()}
          onSymbolClick={vi.fn()}
          onSymbolHover={vi.fn()}
        />
      </UIProvider>
    ));
    expect(screen.getByTestId("stock-row-RELIANCE")).toHaveTextContent("+1.00%");
    for (let i = 1; i <= 120; i++) {
      setStocks([{ ...mockStock, day_change: 1.0 + i / 100 }]);
    }
    await waitFor(() => {
      expect(screen.getByTestId("stock-row-RELIANCE")).toHaveTextContent("+2.20%");
    });
    expect(screen.getByTestId("stock-row-RELIANCE")).not.toHaveTextContent("+1.00%");
  });
});

describe("ScreenerTable approach badges", () => {
  const badgeProps = {
    columns: mockColumns,
    touchedSymbols: new Set<string>(),
    onSymbolClick: vi.fn(),
    onSymbolHover: vi.fn(),
  };

  afterEach(() => {
    cleanup();
  });

  it("shows FRESH badge for fresh approaches", () => {
    render(() => (
      <UIProvider>
        <ScreenerTable
          {...badgeProps}
          stocks={[{ ...mockStock, approach_type: "fresh" as const }]}
        />
      </UIProvider>
    ));
    const badge = screen.getByTestId("approach-badge-RELIANCE");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("FRESH");
  });

  it("shows RETEST badge for retests", () => {
    render(() => (
      <UIProvider>
        <ScreenerTable
          {...badgeProps}
          stocks={[{ ...mockStock, symbol: "ZIMLAB", approach_type: "retest" as const }]}
        />
      </UIProvider>
    ));
    const badge = screen.getByTestId("approach-badge-ZIMLAB");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent("RETEST");
  });

  it("shows no badge without approach_type", () => {
    render(() => (
      <UIProvider>
        <ScreenerTable {...badgeProps} stocks={[mockStock]} />
      </UIProvider>
    ));
    expect(screen.queryByTestId("approach-badge-RELIANCE")).not.toBeInTheDocument();
  });
});

describe("ScreenerTable column kit", () => {
  it("renders numeric cells mono/tabular right and badges centred", () => {
    render(() => (
      <UIProvider>
        <ScreenerTable
          stocks={[mockStock]}
          columns={getColumnsForScreener("buyer_interest_enhanced")}
          touchedSymbols={new Set()}
          onSymbolClick={vi.fn()}
          onSymbolHover={vi.fn()}
        />
      </UIProvider>
    ));
    const row = screen.getByTestId("stock-row-RELIANCE");
    const headers = [...document.querySelectorAll("thead th")].map((th) => th.textContent!.trim());
    const cells = [...row.querySelectorAll("td")];

    for (const name of ["Day Change", "Volume (M)", "Return 5D"]) {
      const index = headers.indexOf(name);
      expect(index, `${name} header exists`).toBeGreaterThan(-1);
      expect(cells[index].style.textAlign, `${name} header`).toBe("right");
      const value = cells[index].firstElementChild as HTMLElement;
      expect(value.className, name).toContain("font-mono");
      expect(value.className, name).toContain("tabular-nums");
      expect(value.className, name).toContain("text-right");
    }

    const touchedIndex = headers.indexOf("Touched");
    expect(cells[touchedIndex].style.textAlign).toBe("center");
    expect(cells[touchedIndex].textContent).toBe("No");

    const sectorIndex = headers.indexOf("Sector");
    expect(cells[sectorIndex].style.textAlign).toBe("left");
    expect(cells[sectorIndex].textContent).toBe("Energy");
  });
});

describe("ScreenerTable persisted sorting", () => {
  const rowSymbols = () =>
    [...document.querySelectorAll('tbody tr[data-testid^="stock-row-"]')].map((el) =>
      el.getAttribute("data-testid")!.replace("stock-row-", ""),
    );

  beforeEach(() => {
    prefsMock.ids.length = 0;
    prefsMock.calls.length = 0;
    prefsMock.write?.([]);
  });

  it("falls back to screener.${testId} when no tableId is given", () => {
    render(() => (
      <UIProvider>
        <ScreenerTable {...defaultProps} testId="screener-table-approaching" />
      </UIProvider>
    ));
    expect(prefsMock.ids).toEqual(["screener.screener-table-approaching"]);
  });

  it("uses an explicit tableId", () => {
    render(() => (
      <UIProvider>
        <ScreenerTable {...defaultProps} tableId="screener.52w_high.approaching" />
      </UIProvider>
    ));
    expect(prefsMock.ids).toEqual(["screener.52w_high.approaching"]);
  });

  it("calls setSorting with the new array and reorders rows on a header click", () => {
    render(() => (
      <UIProvider>
        <ScreenerTable {...defaultProps} />
      </UIProvider>
    ));
    expect(rowSymbols()).toEqual(["RELIANCE", "TCS", "INFY"]);
    fireEvent.click(screen.getByText("Symbol"));
    expect(prefsMock.calls[0]).toEqual([{ id: "symbol", desc: false }]);
    expect(rowSymbols()).toEqual(["INFY", "RELIANCE", "TCS"]);
  });

  it("renders a saved sort on mount: first row and aria-sort", () => {
    prefsMock.write?.([{ id: "score", desc: true }]);
    render(() => (
      <UIProvider>
        <ScreenerTable {...defaultProps} />
      </UIProvider>
    ));
    expect(rowSymbols()[0]).toBe("INFY");
    expect(screen.getByText("Score").closest("th")).toHaveAttribute("aria-sort", "descending");
  });

  it("remounts prefs when tableId changes in place (profile switch)", () => {
    const [tableId, setTableId] = createSignal("screener.52w_high.approaching");
    prefsMock.write?.([{ id: "score", desc: true }]);
    render(() => (
      <UIProvider>
        <ScreenerTable {...defaultProps} tableId={tableId()} />
      </UIProvider>
    ));
    expect(rowSymbols()[0]).toBe("INFY");

    prefsMock.write?.([{ id: "symbol", desc: true }]);
    setTableId("screener.trending.approaching");
    expect(prefsMock.ids).toContain("screener.trending.approaching");
    expect(rowSymbols()[0]).toBe("TCS");
  });
});

describe("ScreenerTable controlled sorting with the real useTablePrefs", () => {
  const rowSymbols = () =>
    [...document.querySelectorAll('tbody tr[data-testid^="stock-row-"]')].map((el) =>
      el.getAttribute("data-testid")!.replace("stock-row-", ""),
    );
  const changeHeader = () => screen.getByText("Change").closest("th") as HTMLElement;

  // Distinct numeric values so a re-sort is observable in the DOM.
  const stocks: Stock[] = [
    { ...mockStock, symbol: "AAA", score: 10, day_change: 5 },
    { ...mockStock, symbol: "BBB", score: 30, day_change: -2 },
    { ...mockStock, symbol: "CCC", score: 20, day_change: 9 },
  ];
  const columns: ColumnDef[] = [
    { key: "symbol", label: "Symbol", type: "string", sortable: true },
    { key: "score", label: "Score", type: "badge", sortable: true },
    { key: "day_change", label: "Change", type: "number", sortable: true },
  ];

  function fakeTransport(status: 200 | 404) {
    const get = vi.fn(async (scope: string) => {
      if (status === 404) {
        throw Object.assign(new Error("not found"), { status: 404, code: "not_found" });
      }
      return {
        scope,
        version: 1,
        saved: false,
        updated_at: null,
        config: { sorting: [], order: [], hidden: [] },
      };
    });
    const put = vi.fn(async (scope: string, config: Record<string, unknown>) => ({
      scope,
      version: 1,
      saved: true,
      updated_at: "rev-1",
      config,
    }));
    const del = vi.fn(async (scope: string) => ({ scope, deleted: true }));
    return { transport: { get, put, del } as SavedConfigTransport, get, put, del };
  }

  function renderReal(tableId: string) {
    render(() => (
      <UIProvider>
        <ScreenerTable
          stocks={stocks}
          columns={columns}
          touchedSymbols={new Set()}
          onSymbolClick={vi.fn()}
          onSymbolHover={vi.fn()}
          tableId={tableId}
        />
      </UIProvider>
    ));
  }

  beforeEach(() => {
    prefsMock.useReal = false;
    prefsMock.transport = null;
    prefsMock.realApi = null;
  });

  afterEach(() => {
    cleanup();
    prefsMock.useReal = false;
    prefsMock.transport = null;
    prefsMock.realApi = null;
  });

  it("404 (disabled): a header click reorders rows and flips aria-sort synchronously, with no PUT", async () => {
    const fake = fakeTransport(404);
    prefsMock.transport = fake.transport;
    prefsMock.useReal = true;
    renderReal("integration-real-disabled");
    await waitFor(() => expect(prefsMock.realApi?.hydrated()).toBe(true));
    expect(prefsMock.realApi?.status()).toBe("disabled");

    expect(rowSymbols()).toEqual(["AAA", "BBB", "CCC"]);
    expect(changeHeader()).toHaveAttribute("aria-sort", "none");

    fireEvent.click(screen.getByText("Change"));

    // Same tick: no timer advanced, no await. The controlled `sorting` prop
    // follows prefs() because scheduleSave published the value synchronously.
    expect(rowSymbols()).toEqual(["CCC", "AAA", "BBB"]);
    expect(changeHeader()).toHaveAttribute("aria-sort", "descending");
    expect(fake.put).not.toHaveBeenCalled();
  });

  it("200 (hydrated): a header click also reorders rows and flips aria-sort synchronously", async () => {
    const fake = fakeTransport(200);
    prefsMock.transport = fake.transport;
    prefsMock.useReal = true;
    renderReal("integration-real-ready");
    await waitFor(() => expect(prefsMock.realApi?.hydrated()).toBe(true));
    expect(prefsMock.realApi?.status()).toBe("ready");

    expect(rowSymbols()).toEqual(["AAA", "BBB", "CCC"]);
    expect(changeHeader()).toHaveAttribute("aria-sort", "none");

    fireEvent.click(screen.getByText("Change"));

    expect(rowSymbols()).toEqual(["CCC", "AAA", "BBB"]);
    expect(changeHeader()).toHaveAttribute("aria-sort", "descending");
  });
});
