// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within, fireEvent } from "@solidjs/testing-library";
import { createSignal, type JSX } from "solid-js";
import { UIProvider } from "@/ui";
import { ValuePanel } from "./ValuePanel";
import { PRESET_IDS, valueScan } from "../../api/valueScan";
import type { ValueMarket, ValueRow, ValueScanResponse } from "../../api/valueScan";
import { MOVER_PRESETS } from "../market/marketFilters";

vi.mock("../../api/valueScan", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../api/valueScan")>();
  return { ...actual, valueScan: vi.fn() };
});

const routerMocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@solidjs/router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => routerMocks.navigate };
});

const mockValueScan = vi.mocked(valueScan);

function r(jsx: JSX.Element) {
  return render(() => (<UIProvider>{jsx}</UIProvider>));
}

afterEach(cleanup);

function row(symbol: string, overrides: Partial<ValueRow> = {}): ValueRow {
  return {
    symbol,
    name: `${symbol} Ltd`,
    exchange: "NSE",
    currency: "INR",
    price: 100,
    change: 0.5,
    mcap_bn: 10,
    rev_bn: 5,
    pe: 9.1,
    ps: 1.1,
    pb: 1.4,
    fcf_yield: 5.0,
    div_yield: 1.0,
    roe: 15.0,
    gross_margin: 30,
    op_margin: 15,
    rev_yoy: 7,
    eps_yoy: 6,
    debt_to_equity: 0.3,
    current_ratio: 1.5,
    rsi: 45,
    vs_200dma: 2.0,
    off_52w_high: -12.0,
    score: 78,
    subscores: { value: 20, quality: 19, growth: 17, health: 22 },
    peer: { bucket: "Banks", pe_median: 11.2, roe_median: 12.0, fcf_yield_median: 4.1 },
    flags: ["LOW_PE"],
    derived: {
      fcf_yield: 5.0,
      earnings_yield: 11.0,
      vs_200dma: 2.0,
      off_52w_high: -12.0,
      distorted_pe: false,
    },
    ...overrides,
  };
}

function response(rows: ValueRow[], market = "india"): ValueScanResponse {
  const usa = market === "usa";
  return {
    market,
    currency: usa ? "USD" : "INR",
    as_of: "2026-10-21T10:00:00+05:30",
    scanned: 500,
    matched: rows.length,
    fields_complete: true,
    filters_applied: {},
    warnings: [],
    rows,
    sectors: [{ name: "Banks", count: rows.length, avg_score: 78 }],
  };
}

const INDIA_ROWS = (): ValueRow[] => [row("RELIANCE"), row("TCS")];
const USA_ROWS = (): ValueRow[] => [
  row("AAPL", {
    name: "Apple Inc",
    exchange: "NASDAQ",
    currency: "USD",
    price: 190,
  }),
  row("MSFT", {
    name: "Microsoft Corp",
    exchange: "NASDAQ",
    currency: "USD",
    price: 410,
  }),
];

// The real endpoint echoes the requested market, so a fixture that always
// answers "india" cannot expose a cross-market render.
function byMarket(filters?: { market?: string }): ValueScanResponse {
  return filters?.market === "usa"
    ? response(USA_ROWS(), "usa")
    : response(INDIA_ROWS(), "india");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockValueScan.mockImplementation(async (filters) => byMarket(filters));
});

describe("ValuePanel", () => {
  test("the preset selector has an accessible name", async () => {
    r(<ValuePanel />);
    expect(screen.getByLabelText("Value preset")).toBeInTheDocument();
  });

  test("shows loading state, then renders rows from the mock response", async () => {
    r(<ValuePanel />);
    expect(screen.getByTestId("value-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("value-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("value-row-TCS")).toBeInTheDocument();
    expect(screen.getByTestId("value-summary")).toHaveTextContent("2 of 2 matches");
    expect(screen.getByTestId("value-sectors")).toHaveTextContent("Banks (2)");
    expect(screen.getByTestId("value-as-of")).toHaveTextContent("21 Oct");
    expect(screen.getByTestId("value-as-of")).not.toHaveTextContent("2026-10-21T");
  });

  test("humanises API warning codes instead of printing machine names", async () => {
    mockValueScan.mockResolvedValueOnce({
      ...response(INDIA_ROWS()),
      warnings: ["cache_unavailable"],
    });
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    expect(screen.getByTestId("value-warnings")).toHaveTextContent(
      "Price cache unavailable — live scan",
    );
    expect(screen.getByTestId("value-warnings")).not.toHaveTextContent("cache_unavailable");
  });

  test("switching market tabs sends the new market to the client", async () => {
        r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    expect(mockValueScan).toHaveBeenLastCalledWith(
      expect.objectContaining({ market: "india" }),
      expect.anything(),
    );
    await fireEvent.click(screen.getByTestId("value-market-tab-usa"));
    await waitFor(
      () => {
        expect(mockValueScan).toHaveBeenLastCalledWith(
          expect.objectContaining({ market: "usa" }),
          expect.anything(),
        );
      },
      { timeout: 3000 },
    );
  });

  test("applying a preset sends it to the client", async () => {
        r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    fireEvent.input(
      within(screen.getByTestId("value-preset-select")).getByRole("combobox"),
      { target: { value: "DEEP" } },
    );
    await waitFor(
      () => {
        expect(mockValueScan).toHaveBeenLastCalledWith(
          expect.objectContaining({ preset: "DEEP" }),
          expect.anything(),
        );
      },
      { timeout: 3000 },
    );
  });

  test("refresh button refetches", async () => {
        r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    const calls = mockValueScan.mock.calls.length;
    await fireEvent.click(screen.getByTestId("value-refresh"));
    await waitFor(() => expect(mockValueScan.mock.calls.length).toBeGreaterThan(calls));
  });

  test("shows the empty state when no rows match", async () => {
    mockValueScan.mockResolvedValue(response([]));
    r(<ValuePanel />);
    expect(await screen.findByTestId("value-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("value-table")).not.toBeInTheDocument();
  });

  test("shows the error state on failure", async () => {
    mockValueScan.mockRejectedValue(new Error("network down"));
    r(<ValuePanel />);
    const err = await screen.findByTestId("value-error");
    expect(err).toHaveTextContent("network down");
  });

  test("loading, no-data and failed states are mutually exclusive and worded differently", async () => {
    let resolveScan: ((value: ValueScanResponse) => void) | undefined;
    mockValueScan.mockImplementation(
      () =>
        new Promise<ValueScanResponse>((resolve) => {
          resolveScan = resolve;
        }),
    );
    r(<ValuePanel />);

    const loading = screen.getByTestId("value-loading");
    expect(loading).toHaveTextContent("Scanning for deep value");
    expect(screen.queryByTestId("value-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("value-error")).not.toBeInTheDocument();

    await waitFor(() => expect(resolveScan).toBeDefined(), { timeout: 3000 });
    resolveScan?.(response([]));
    const empty = await screen.findByTestId("value-empty");
    expect(empty).toHaveTextContent("No deep-value matches");
    expect(screen.queryByTestId("value-loading")).not.toBeInTheDocument();
    expect(screen.queryByTestId("value-error")).not.toBeInTheDocument();

    mockValueScan.mockRejectedValue(new Error("Value scan failed (HTTP 500)"));
    await fireEvent.click(screen.getByTestId("value-refresh"));
    const failed = await screen.findByTestId("value-error");
    expect(failed).toHaveTextContent("Value scan failed (HTTP 500)");
    expect(screen.queryByTestId("value-empty")).not.toBeInTheDocument();
    expect(screen.queryByText("No deep-value matches for these filters")).not.toBeInTheDocument();
    expect(screen.queryByTestId("value-loading")).not.toBeInTheDocument();
  });

  test("surfaces a partial-fundamentals note when fields_complete is false", async () => {
    mockValueScan.mockResolvedValue({ ...response([row("RELIANCE")]), fields_complete: false });
    r(<ValuePanel />);
    const note = await screen.findByTestId("value-fields-partial");
    expect(note).toHaveTextContent("Partial fundamentals");
    expect(note).toHaveTextContent("not zero");
    expect(screen.getByTestId("value-row-RELIANCE")).toBeInTheDocument();
  });

  test("omits the partial-fundamentals note when fields are complete", async () => {
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    expect(screen.queryByTestId("value-fields-partial")).not.toBeInTheDocument();
  });

  test("all generated presets render and each selection round-trips to the request", async () => {
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    const select = within(screen.getByTestId("value-preset-select")).getByRole(
      "combobox",
    ) as HTMLSelectElement;
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.value);
    for (const id of PRESET_IDS) expect(options, id).toContain(id);

    for (const id of PRESET_IDS) {
      fireEvent.input(select, { target: { value: id } });
      await waitFor(
        () =>
          expect(mockValueScan).toHaveBeenLastCalledWith(
            expect.objectContaining({ preset: id }),
            expect.anything(),
          ),
        { timeout: 3000 },
      );
      expect(select.value, id).toBe(id);
    }
  });

  test("CSV export produces a blob download", async () => {
        const createObjectURL = vi.fn((_blob: Blob): string => "blob:csv");
    const revokeObjectURL = vi.fn();
    (URL as unknown as Record<string, unknown>).createObjectURL = createObjectURL;
    (URL as unknown as Record<string, unknown>).revokeObjectURL = revokeObjectURL;
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    await fireEvent.click(screen.getByTestId("value-export-csv"));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const firstCall = createObjectURL.mock.calls[0];
    expect(firstCall).toBeDefined();
    const blob = firstCall?.[0] as unknown as Blob;
    expect(blob.type).toBe("text/csv");
    const text = await blob.text();
    expect(text.split("\n")[0]).toContain("symbol");
    expect(text).toContain("RELIANCE");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:csv");
  });

  test("clicking the symbol navigates once to the chart route", async () => {
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");

    const symbol = screen.getByTestId("value-name-RELIANCE");
    expect(symbol.tagName).toBe("BUTTON");
    await fireEvent.click(symbol);

    expect(routerMocks.navigate).toHaveBeenCalledTimes(1);
    expect(routerMocks.navigate).toHaveBeenCalledWith("/chart/RELIANCE");

    const tv = screen.getByTestId("symbol-tv-RELIANCE");
    expect(tv.tagName).toBe("A");
    expect(tv).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NSE%3ARELIANCE",
    );
    expect(tv).toHaveAttribute("target", "_blank");
  });

  test("a US symbol navigates to the in-app chart with market=usa", async () => {
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    await fireEvent.click(screen.getByTestId("value-market-tab-usa"));
    const symbol = await screen.findByTestId("value-name-AAPL", {}, { timeout: 3000 });

    expect(symbol.tagName).toBe("BUTTON");
    await fireEvent.click(symbol);
    expect(routerMocks.navigate).toHaveBeenCalledTimes(1);
    expect(routerMocks.navigate).toHaveBeenCalledWith("/chart/AAPL?market=usa");

    // TradingView stays available as the secondary ↗ action.
    const tv = screen.getByTestId("symbol-tv-AAPL");
    expect(tv.tagName).toBe("A");
    expect(tv).toHaveAttribute(
      "href",
      "https://www.tradingview.com/chart/?symbol=NASDAQ%3AAAPL",
    );
    expect(tv).toHaveAttribute("target", "_blank");
    expect(tv.getAttribute("rel")).toContain("noopener");
  });

  test("a US symbol keeps its dotted class symbol in the chart route", async () => {
    mockValueScan.mockResolvedValue(
      response([row("BRK.B", { name: "Berkshire Hathaway", exchange: "NYSE", currency: "USD" })], "usa"),
    );
    r(<ValuePanel initialFilters={{ market: "usa" }} />);
    const symbol = await screen.findByTestId("value-name-BRK.B");

    expect(symbol.tagName).toBe("BUTTON");
    await fireEvent.click(symbol);
    expect(routerMocks.navigate).toHaveBeenCalledTimes(1);
    expect(routerMocks.navigate).toHaveBeenCalledWith("/chart/BRK.B?market=usa");
  });

  test("a NASDAQ row still opens the detail drawer on row click", async () => {
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    await fireEvent.click(screen.getByTestId("value-market-tab-usa"));
    await screen.findByTestId("value-row-AAPL", {}, { timeout: 3000 });

    await fireEvent.click(screen.getByTestId("value-row-AAPL"));
    expect(screen.getByTestId("value-detail-AAPL")).toBeInTheDocument();
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  test("clicking a row opens the detail drawer", async () => {
        const onRowClick = vi.fn();
    r(<ValuePanel onRowClick={onRowClick} />);
    await screen.findByTestId("value-row-RELIANCE");
    await fireEvent.click(screen.getByTestId("value-row-RELIANCE"));
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ symbol: "RELIANCE" }));
    expect(screen.getByTestId("value-detail-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("value-detail-sub-RELIANCE-value")).toBeInTheDocument();
  });

  test("the standalone tab works with no dock provider: row click still opens the drawer", async () => {
    // No SymbolDockProvider — exactly how the Deep Value tab mounts it. Even a
    // mistakenly supplied host opener must be ignored outside embedded mode.
    const onRowClick = vi.fn();
    const onOpenSymbol = vi.fn();
    r(<ValuePanel onRowClick={onRowClick} onOpenSymbol={onOpenSymbol} />);
    await screen.findByTestId("value-row-RELIANCE");
    fireEvent.click(screen.getByTestId("value-row-RELIANCE"));
    expect(onRowClick).toHaveBeenCalledWith(expect.objectContaining({ symbol: "RELIANCE" }));
    expect(onOpenSymbol).not.toHaveBeenCalled();
    expect(screen.getByTestId("value-detail-RELIANCE")).toBeInTheDocument();
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  test("an embedded chart-eligible row hands its symbol to the host instead of the drawer", async () => {
    const onOpenSymbol = vi.fn();
    r(<ValuePanel embedded market="india" onOpenSymbol={onOpenSymbol} />);
    await screen.findByTestId("value-row-RELIANCE");

    fireEvent.click(screen.getByTestId("value-row-RELIANCE"));

    expect(onOpenSymbol).toHaveBeenCalledTimes(1);
    expect(onOpenSymbol).toHaveBeenCalledWith("RELIANCE");
    expect(screen.queryByTestId("value-detail-RELIANCE")).not.toBeInTheDocument();
  });

  test("an embedded row without an in-app chart keeps the detail drawer", async () => {
    mockValueScan.mockResolvedValue(response([row("VOD", { exchange: "LSE" })]));
    const onOpenSymbol = vi.fn();
    r(<ValuePanel embedded market="india" onOpenSymbol={onOpenSymbol} />);
    await screen.findByTestId("value-row-VOD");

    fireEvent.click(screen.getByTestId("value-row-VOD"));

    expect(onOpenSymbol).not.toHaveBeenCalled();
    expect(screen.getByTestId("value-detail-VOD")).toBeInTheDocument();
  });

  test("an embedded chart-eligible symbol link uses the host opener, not navigation", async () => {
    const onOpenSymbol = vi.fn();
    r(<ValuePanel embedded market="india" onOpenSymbol={onOpenSymbol} />);
    await screen.findByTestId("value-row-RELIANCE");

    fireEvent.click(screen.getByTestId("value-name-RELIANCE"));

    expect(onOpenSymbol).toHaveBeenCalledWith("RELIANCE");
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });

  test("a successful market switch renders the new market's rows only", async () => {
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    await fireEvent.click(screen.getByTestId("value-market-tab-usa"));
    expect(await screen.findByTestId("value-row-AAPL", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByTestId("value-row-MSFT")).toBeInTheDocument();
    expect(screen.queryByTestId("value-row-RELIANCE")).not.toBeInTheDocument();
    expect(screen.queryByTestId("value-error")).not.toBeInTheDocument();
  });

  test("a failed market switch shows the error and never the old market's rows", async () => {
    mockValueScan.mockImplementation(async (filters) => {
      if (filters?.market === "usa") throw new Error("scan down");
      return byMarket(filters);
    });
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    await fireEvent.click(screen.getByTestId("value-market-tab-usa"));

    const err = await screen.findByTestId("value-error", {}, { timeout: 3000 });
    expect(err).toHaveTextContent("scan down");
    expect(screen.queryByTestId("value-row-RELIANCE")).not.toBeInTheDocument();
    expect(screen.queryByTestId("value-row-TCS")).not.toBeInTheDocument();

    mockValueScan.mockImplementation(async (filters) => byMarket(filters));
    await fireEvent.click(screen.getByTestId("value-retry"));
    expect(await screen.findByTestId("value-row-AAPL", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(mockValueScan).toHaveBeenLastCalledWith(
      expect.objectContaining({ market: "usa" }),
      expect.anything(),
    );
    expect(screen.queryByTestId("value-error")).not.toBeInTheDocument();
  });

  test("switching market mid-flight clears the old rows and blocks export", async () => {
    let resolveUsa: ((value: ValueScanResponse) => void) | undefined;
    mockValueScan.mockImplementation(async (filters) => {
      if (filters?.market === "usa") {
        return new Promise<ValueScanResponse>((resolve) => {
          resolveUsa = resolve;
        });
      }
      return byMarket(filters);
    });
    const downloads = captureDownloads();
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");

    await fireEvent.click(screen.getByTestId("value-market-tab-usa"));
    expect(await screen.findByTestId("value-loading", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByTestId("value-row-RELIANCE")).not.toBeInTheDocument();
    const exportBtn = screen.getByTestId("value-export-csv");
    expect(exportBtn).toBeDisabled();
    await fireEvent.click(exportBtn);
    expect(downloads()).toEqual([]);

    await waitFor(() => expect(resolveUsa).toBeDefined(), { timeout: 3000 });
    resolveUsa?.(response(USA_ROWS(), "usa"));
    expect(await screen.findByTestId("value-row-AAPL", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByTestId("value-export-csv")).not.toBeDisabled();
    downloads.restore();
  });

  test("a payload from another market is never presented as the requested one", async () => {
    // Only a misrouting proxy/cache can produce this shape; the API echoes the
    // requested market. The panel must still name the universe it is showing.
    mockValueScan.mockImplementation(async (filters) =>
      filters?.market === "usa"
        ? response(INDIA_ROWS(), "india")
        : byMarket(filters),
    );
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    await fireEvent.click(screen.getByTestId("value-market-tab-usa"));

    const mismatch = await screen.findByTestId("value-market-mismatch", {}, { timeout: 3000 });
    expect(mismatch).toHaveTextContent("Showing INDIA");
    expect(screen.getByTestId("value-export-csv")).toBeDisabled();
  });

  test("export names the file after the payload's market", async () => {
    const downloads = captureDownloads();
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    await fireEvent.click(screen.getByTestId("value-market-tab-usa"));
    await screen.findByTestId("value-row-AAPL", {}, { timeout: 3000 });

    await fireEvent.click(screen.getByTestId("value-export-csv"));
    expect(downloads()).toEqual(["deep-value-usa.csv"]);
    const text = await downloads.blobText();
    expect(text).toContain("AAPL");
    expect(text).not.toContain("RELIANCE");
    downloads.restore();
  });

  test("embedded mode hides the market selector and follows the controlled market", async () => {
    r(<ValuePanel embedded market="usa" />);
    expect(screen.queryByTestId("value-market-tabs")).not.toBeInTheDocument();
    expect(await screen.findByTestId("value-row-AAPL", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByTestId("value-row-RELIANCE")).not.toBeInTheDocument();
    expect(mockValueScan).toHaveBeenCalledWith(
      expect.objectContaining({ market: "usa" }),
      expect.anything(),
    );
  });

  test("hideMarketSelect hides only the selector and keeps the default market", async () => {
    r(<ValuePanel hideMarketSelect />);
    expect(screen.queryByTestId("value-market-tabs")).not.toBeInTheDocument();
    expect(await screen.findByTestId("value-row-RELIANCE")).toBeInTheDocument();
    expect(mockValueScan).toHaveBeenCalledWith(
      expect.objectContaining({ market: "india" }),
      expect.anything(),
    );
  });

  test("standalone mode still shows the market selector and its tabs work", async () => {
    r(<ValuePanel />);
    expect(screen.getByTestId("value-market-tabs")).toBeInTheDocument();
    await screen.findByTestId("value-row-RELIANCE");
    await fireEvent.click(screen.getByTestId("value-market-tab-usa"));
    expect(await screen.findByTestId("value-row-AAPL", {}, { timeout: 3000 })).toBeInTheDocument();
  });

  test("a controlled market change refetches without a selector", async () => {
    const [market, setMarket] = createSignal<ValueMarket>("india");
    r(<ValuePanel embedded market={market()} />);
    await screen.findByTestId("value-row-RELIANCE");

    setMarket("usa");
    await waitFor(
      () =>
        expect(mockValueScan).toHaveBeenCalledWith(
          expect.objectContaining({ market: "usa" }),
          expect.anything(),
        ),
      { timeout: 3000 },
    );
    expect(await screen.findByTestId("value-row-AAPL", {}, { timeout: 3000 })).toBeInTheDocument();
  });
});

describe("ValuePanel — preset gallery entry", () => {
  test("the gallery opens value-first with no market-only Deep card or bounds", async () => {
    r(<ValuePanel onApplyMarketPreset={vi.fn()} />);
    await screen.findByTestId("value-row-RELIANCE");
    const entry = screen.getByTestId("value-preset-gallery");
    expect(entry).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(entry);

    expect(screen.getByTestId("market-preset-gallery")).toBeInTheDocument();
    expect(screen.getByTestId("value-preset-gallery-list")).toBeInTheDocument();
    expect(screen.getByTestId("value-preset-gallery-list").style.scrollMarginTop).toBe("5rem");
    expect(screen.getByTestId("market-movers-list").style.scrollMarginTop).toBe("5rem");
    const cards = screen.getAllByTestId(/^value-preset-card-/);
    expect(cards.map((card) => card.getAttribute("data-testid"))).toEqual(
      PRESET_IDS.map((id) => `value-preset-card-${id}`),
    );
    expect(screen.queryByTestId("market-value-fields")).toBeNull();
    expect(screen.queryByTestId("market-value-preset")).toBeNull();
    expect(screen.queryByTestId("market-filter-peMax")).toBeNull();
    expect(screen.queryByTestId("market-mover-gapUp")).toBeNull();

    fireEvent.click(screen.getByTestId("preset-movers-toggle"));
    for (const preset of MOVER_PRESETS) {
      expect(screen.getByTestId(`preset-card-${preset.id}`)).toBeInTheDocument();
    }
  });

  test("an unselected gallery starts on a visible No preset option, not Serious", async () => {
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    const select = within(screen.getByTestId("value-preset-select")).getByRole(
      "combobox",
    ) as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(select.selectedOptions[0]?.textContent).toBe("No preset");
    expect(screen.queryByTestId("value-preset-current")).toBeNull();
    expect(mockValueScan.mock.calls.at(-1)?.[0]?.preset).toBeUndefined();
  });

  test("applying Deep from the gallery selects the scan preset and shows Active", async () => {
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    fireEvent.click(screen.getByTestId("value-preset-gallery"));

    const calls = mockValueScan.mock.calls.length;
    fireEvent.click(screen.getByTestId("value-preset-apply-DEEP"));
    await waitFor(
      () =>
        expect(mockValueScan.mock.calls.length).toBeGreaterThan(calls) &&
        expect(mockValueScan).toHaveBeenLastCalledWith(
          expect.objectContaining({ preset: "DEEP" }),
          expect.anything(),
        ),
      { timeout: 3000 },
    );
    expect(screen.queryByTestId("market-preset-gallery")).toBeNull();
    const select = within(screen.getByTestId("value-preset-select")).getByRole(
      "combobox",
    ) as HTMLSelectElement;
    expect(screen.getByTestId("value-preset-current")).toHaveTextContent("Deep");
    await waitFor(() => expect(select.value).toBe("DEEP"));
    expect(select.selectedOptions[0]?.textContent).toBe("Deep");
    expect(screen.getByTestId("value-preset-current")).toHaveTextContent("Deep");

    fireEvent.click(screen.getByTestId("value-preset-gallery"));
    expect(screen.getByTestId("value-preset-active-DEEP")).toHaveTextContent("Active");
    const clear = screen.getByTestId("value-preset-clear-DEEP");
    expect(clear).toBeEnabled();
    fireEvent.click(clear);
    await waitFor(
      () => expect(mockValueScan.mock.calls.at(-1)?.[0]?.preset).toBeUndefined(),
      { timeout: 3000 },
    );
    await waitFor(() => expect(select.value).toBe(""));
    expect(select.selectedOptions[0]?.textContent).toBe("No preset");
    expect(screen.queryByTestId("value-preset-current")).toBeNull();
  });

  test("a value preset applies and clears from the gallery", async () => {
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    fireEvent.click(screen.getByTestId("value-preset-gallery"));

    fireEvent.click(screen.getByTestId("value-preset-apply-YIELD"));
    await waitFor(
      () =>
        expect(mockValueScan).toHaveBeenLastCalledWith(
          expect.objectContaining({ preset: "YIELD" }),
          expect.anything(),
        ),
      { timeout: 3000 },
    );
    expect(screen.queryByTestId("market-preset-gallery")).toBeNull();
    fireEvent.click(screen.getByTestId("value-preset-gallery"));
    fireEvent.click(screen.getByTestId("value-preset-clear-YIELD"));
    await waitFor(
      () => expect(mockValueScan.mock.calls.at(-1)?.[0]?.preset).toBeUndefined(),
      { timeout: 3000 },
    );
  });

  test("manual gallery bounds are the real value-scan filters", async () => {
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    fireEvent.click(screen.getByTestId("value-preset-gallery"));

    expect(screen.queryByTestId("market-filter-peMax-input")).toBeNull();
    const pe = screen.getByTestId("value-filter-max_pe-input");
    fireEvent.input(pe, { target: { value: "15" } });
    await waitFor(
      () => expect(mockValueScan.mock.calls.at(-1)?.[0]?.max_pe).toBe(15),
      { timeout: 3000 },
    );

    const roe = screen.getByTestId("value-filter-min_roe-input");
    fireEvent.input(roe, { target: { value: "18" } });
    await waitFor(
      () => expect(mockValueScan.mock.calls.at(-1)?.[0]?.min_roe).toBe(18),
      { timeout: 3000 },
    );

    fireEvent.input(pe, { target: { value: "" } });
    await waitFor(
      () => expect(mockValueScan.mock.calls.at(-1)?.[0]?.max_pe).toBeNull(),
      { timeout: 3000 },
    );
  });

  test("value gate chips are human copy, not internal API keys", async () => {
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    fireEvent.click(screen.getByTestId("value-preset-gallery"));

    const deep = screen.getByTestId("value-preset-card-DEEP");
    for (const label of [
      "P/E percentile ≤ 15%",
      "P/B percentile ≤ 30%",
      "ROE percentile ≥ 70%",
      "FCF yield percentile ≥ 80%",
      "Min mcap ₹0.5B",
      "D/E ≤ 0.8",
    ]) {
      expect(within(deep).getByText(label)).toBeInTheDocument();
    }
    expect(deep).not.toHaveTextContent("PE PCT MAX");
    expect(deep).not.toHaveTextContent("MIN MCAP BN");
    expect(deep).not.toHaveTextContent("ABOVE 200DMA ON");
  });

  test("mover presets are handed to the host once and never mutate value filters", async () => {
    const onApplyMarketPreset = vi.fn();
    r(<ValuePanel onApplyMarketPreset={onApplyMarketPreset} />);
    await screen.findByTestId("value-row-RELIANCE");
    fireEvent.click(screen.getByTestId("value-preset-gallery"));
    fireEvent.click(screen.getByTestId("preset-movers-toggle"));
    const calls = mockValueScan.mock.calls.length;

    fireEvent.click(screen.getByTestId("market-mover-gapUp"));
    expect(onApplyMarketPreset).toHaveBeenCalledTimes(1);
    expect(onApplyMarketPreset).toHaveBeenCalledWith({ mcapMinCr: 500, gapMin: 3, sort: "gap_desc" });
    expect(mockValueScan.mock.calls.length).toBe(calls);
    expect(screen.queryByTestId("market-preset-gallery")).toBeNull();
  });

  test("search count is announced and no-match stays inside each section", async () => {
    r(<ValuePanel onApplyMarketPreset={vi.fn()} />);
    await screen.findByTestId("value-row-RELIANCE");
    fireEvent.click(screen.getByTestId("value-preset-gallery"));
    const count = screen.getByTestId("preset-match-count");
    expect(count).toHaveAttribute("aria-live", "polite");

    fireEvent.input(screen.getByTestId("market-preset-search"), {
      target: { value: "dividend" },
    });
    expect(count).toHaveTextContent("1 matching preset");
    expect(screen.getByTestId("value-preset-card-YIELD")).toBeInTheDocument();
    expect(screen.getByTestId("preset-no-matches-movers")).toHaveTextContent(
      "No mover presets match",
    );
    expect(screen.queryByTestId("preset-no-matches-value")).toBeNull();

    fireEvent.input(screen.getByTestId("market-preset-search"), {
      target: { value: "gap down" },
    });
    expect(count).toHaveTextContent("1 matching preset");
    expect(screen.getByTestId("preset-card-gapDown")).toBeInTheDocument();
    expect(screen.getByTestId("preset-no-matches-value")).toHaveTextContent(
      "No value presets match",
    );

    fireEvent.input(screen.getByTestId("market-preset-search"), {
      target: { value: "zzzz" },
    });
    expect(count).toHaveTextContent("0 matching presets");
    expect(screen.getByTestId("preset-no-matches-value")).toBeInTheDocument();
    expect(screen.getByTestId("preset-no-matches-movers")).toBeInTheDocument();
  });

  test("↑↓ walk value presets immediately on open and stay in the value band", async () => {
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    fireEvent.click(screen.getByTestId("value-preset-gallery"));
    const search = screen.getByTestId("market-preset-search");
    await waitFor(() => expect(document.activeElement).toBe(search));

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("value-preset-apply-SERIOUS"));
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("value-preset-apply-DEEP"));
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByTestId("value-preset-apply-SERIOUS"));
  });

  test("clearing the search restores the list and returns focus to search", async () => {
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    fireEvent.click(screen.getByTestId("value-preset-gallery"));
    fireEvent.input(screen.getByTestId("market-preset-search"), {
      target: { value: "dividend" },
    });
    expect(screen.queryByTestId("value-preset-card-DEEP")).toBeNull();
    fireEvent.click(screen.getByTestId("market-preset-search-clear"));
    expect(screen.getByTestId("value-preset-card-DEEP")).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId("market-preset-search"));
  });

  test("a filtered-out active preset shows no Active state", async () => {
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    const select = within(screen.getByTestId("value-preset-select")).getByRole(
      "combobox",
    ) as HTMLSelectElement;
    fireEvent.input(select, { target: { value: "DEEP" } });
    await waitFor(
      () =>
        expect(mockValueScan).toHaveBeenLastCalledWith(
          expect.objectContaining({ preset: "DEEP" }),
          expect.anything(),
        ),
      { timeout: 3000 },
    );

    fireEvent.click(screen.getByTestId("value-preset-gallery"));
    fireEvent.input(screen.getByTestId("market-preset-search"), {
      target: { value: "dividend" },
    });
    expect(screen.queryByTestId("value-preset-active-DEEP")).toBeNull();
    expect(within(screen.getByTestId("value-preset-gallery-list")).queryByText("Active")).toBeNull();
  });

  test("Escape closes the gallery and returns focus to the Value tab entry", async () => {
    r(<ValuePanel />);
    await screen.findByTestId("value-row-RELIANCE");
    const entry = screen.getByTestId("value-preset-gallery");
    entry.focus();
    fireEvent.click(entry);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("market-preset-gallery")).toBeNull();
    expect(document.activeElement).toBe(entry);
  });
});

function captureDownloads(): (() => string[]) & {
  restore: () => void;
  blobText: () => Promise<string>;
} {
  const names: string[] = [];
  const blobs: Blob[] = [];
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(function (this: HTMLAnchorElement) {
      names.push(this.download);
    });
  const createObjectURL = vi.fn((blob: Blob): string => {
    blobs.push(blob);
    return "blob:csv";
  });
  const revokeObjectURL = vi.fn();
  const origCreate = URL.createObjectURL;
  const origRevoke = URL.revokeObjectURL;
  (URL as unknown as Record<string, unknown>).createObjectURL = createObjectURL;
  (URL as unknown as Record<string, unknown>).revokeObjectURL = revokeObjectURL;

  const read = () => names;
  return Object.assign(read, {
    restore: () => {
      click.mockRestore();
      (URL as unknown as Record<string, unknown>).createObjectURL = origCreate;
      (URL as unknown as Record<string, unknown>).revokeObjectURL = origRevoke;
    },
    blobText: async () => (blobs[0] ? blobs[0].text() : ""),
  });
}

