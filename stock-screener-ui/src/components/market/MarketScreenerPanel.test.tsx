// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, cleanup, within, waitFor } from "@solidjs/testing-library";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { createMemo, createSignal, type JSX } from "solid-js";
import { UIProvider } from "@/ui";
import { MarketScreenerPanel, marketSortToSortEntry, sortEntryToMarketSort } from "./MarketScreenerPanel";
import { valueScan } from "../../api/valueScan";
import { useMarketSnapshotSolid } from "./useMarketSnapshotSolid";
import { fetchScreenerDashboard } from "../../api/screenerDashboard";
import { getUserConfig, putUserConfig, deleteUserConfig } from "../../api/userConfigs";
import * as marketFilters from "./marketFilters";
import { defaultMarketConfig, serializeMarketConfig } from "./useMarketConfig";
import type { MarketRow } from "../../types/marketScreener";
import { marketMetricOptions, NARROW_TREEMAP_MAX_WIDTH } from "./marketTreemap";
import { getPanelSpec } from "../window/panelRegistry";
import type { ValueRow, ValueScanResponse } from "../../api/valueScan";
import type { ScreenerDashboardResponse } from "../../types/screenerDashboard";
import { SymbolDockContext, type SymbolDockApi } from "../common/symbolDockContext";

// useNavigate needs a Router; the converted suites mock it at the module edge.
const routerMocks = vi.hoisted(() => ({ navigate: vi.fn() }));

vi.mock("@solidjs/router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => routerMocks.navigate };
});

vi.mock("./useMarketSnapshotSolid", () => ({
  useMarketSnapshotSolid: vi.fn(),
}));

vi.mock("../../api/screenerDashboard", () => ({
  fetchScreenerDashboard: vi.fn(),
}));

// The embedded Value view runs its own scan; keep it offline in this suite.
vi.mock("../../api/valueScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/valueScan")>();
  return { ...actual, valueScan: vi.fn() };
});

// The panel hydrates saved filters on mount; the real client would hit the
// network. Tests that care about the config path override these.
vi.mock("../../api/userConfigs", () => ({
  getUserConfig: vi.fn(),
  putUserConfig: vi.fn(),
  deleteUserConfig: vi.fn(),
  UserConfigError: class UserConfigError extends Error {
    status = 0;
    code = "";
    payload = undefined;
  },
}));

const mockFetchDashboard = vi.mocked(fetchScreenerDashboard);
const mockValueScan = vi.mocked(valueScan);
const mockGetUserConfig = vi.mocked(getUserConfig);
const mockPutUserConfig = vi.mocked(putUserConfig);
const mockDeleteUserConfig = vi.mocked(deleteUserConfig);

const mockUseMarketSnapshot = vi.mocked(useMarketSnapshotSolid);

const mockLookupPatterns = vi.hoisted(() => vi.fn());
vi.mock("../../api/patternLookup", () => ({
  PATTERN_LOOKUP_MAX_SYMBOLS: 500,
  lookupPatterns: mockLookupPatterns,
}));

// happy-dom has no 2D canvas context: the real treemap's async init can land
// after an unmount and then throws from zrender's dispose. The map's DOM is what
// these tests assert, so the renderer is stubbed out.
const echartsStub = vi.hoisted(() => ({
  chart: { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn() },
}));
vi.mock("../../utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({ init: vi.fn(() => echartsStub.chart) })),
}));

function row(symbol: string, overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    symbol,
    name: `${symbol} Ltd`,
    sector: "IT",
    exchange: "NSE",
    close: 100,
    change: 1,
    relativeVolume: 1.0,
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
    low52w: 60,
    pos52w: 66,
    peRatio: null,
    pbRatio: null,
    dividendYield: null,
    roe: null,
    fno: false,
    etf: false,
    ...overrides,
  };
}

const ROWS: MarketRow[] = [row("RELIANCE"), row("MPHASIS")];

type HookOverrides = {
  snapshot?: unknown;
  rows?: MarketRow[];
  total?: number;
  updateMode?: string | null;
  asOf?: string | null;
  isLoading?: boolean;
  error?: Error | null;
  refresh?: (force?: boolean) => void;
  lastUpdated?: string | null;
  stale?: boolean;
  ageSec?: number | null;
  warming?: boolean;
};

function hookResult(overrides: HookOverrides = {}) {
  const o = {
    snapshot: {
      asOf: new Date().toISOString(),
      universe: "all_equity",
      total: ROWS.length,
      updateMode: "streaming",
      rows: ROWS,
    } as unknown,
    rows: ROWS,
    total: ROWS.length,
    updateMode: "streaming" as string | null,
    asOf: new Date().toISOString() as string | null,
    isLoading: false,
    error: null as Error | null,
    refresh: vi.fn(),
    lastUpdated: new Date().toISOString() as string | null,
    stale: false,
    warming: false,
    ...overrides,
  };
  return {
    snapshot: () => o.snapshot as never,
    rows: () => o.rows,
    total: () => o.total,
    updateMode: () => o.updateMode,
    asOf: () => o.asOf,
    isLoading: () => o.isLoading,
    error: () => o.error,
    refresh: o.refresh,
    lastUpdated: () => o.lastUpdated,
    stale: () => o.stale,
    ageSec: () => o.ageSec ?? null,
    warming: () => o.warming,
  };
}

// Build the panel inside render's root so component onCleanup runs on cleanup.
// Passing an already-created JSX element leaves it ownerless, which keeps the
// ref-counted `useTablePrefs` store alive and leaks its debounced PUT across tests.
function r(jsx: () => JSX.Element) {
  return render(() => (<UIProvider>{jsx()}</UIProvider>));
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  // The panel reads `?wire=` once at setup; a leftover value would leak.
  window.history.replaceState({}, "", "/");
  mockUseMarketSnapshot.mockReturnValue(hookResult());
  mockLookupPatterns.mockResolvedValue({
    timeframe: "1D",
    session: "2026-11-16",
    source: "stored",
    data_through: "2026-11-14",
    items: [],
  });
  mockFetchDashboard.mockResolvedValue({
    sections: [],
    universe: "nifty500",
    as_of: new Date().toISOString(),
    total: 0,
  } as ScreenerDashboardResponse);

  mockValueScan.mockImplementation(async (filters) => ({
    market: filters?.market ?? "india",
    currency: filters?.market === "usa" ? "USD" : "INR",
    as_of: "2026-11-17T10:00:00+05:30",
    scanned: 500,
    matched: 0,
    fields_complete: true,
    filters_applied: {},
    warnings: [],
    rows: [],
    sectors: [],
  }));

  // Default: nothing saved. Individual tests override with a saved payload.
  mockGetUserConfig.mockResolvedValue({
    scope: "market.filters",
    version: 1,
    saved: false,
    updated_at: null,
    config: serializeMarketConfig(defaultMarketConfig()),
  });
  mockPutUserConfig.mockImplementation(async (_scope, config) => ({
    scope: "market.filters",
    version: 1,
    saved: true,
    updated_at: "2026-11-15T09:41:22.192Z",
    config,
  }));
  mockDeleteUserConfig.mockResolvedValue({ scope: "market.filters", deleted: true });
});

describe("MarketScreenerPanel — stale cache, warming hint, timeout", () => {
  test("shows rows with a Stale badge while serving the cached snapshot", () => {
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ stale: true, isLoading: true }),
    );
    r(() => <MarketScreenerPanel />);
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("market-stale-badge")).toBeInTheDocument();
    expect(screen.queryByTestId("market-warming-hint")).not.toBeInTheDocument();
  });

  test("a fresh snapshot clears the Stale badge", () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ stale: false }));
    r(() => <MarketScreenerPanel />);
    expect(screen.queryByTestId("market-stale-badge")).not.toBeInTheDocument();
  });

  test("warming hint is shown for All NSE while the skeleton is up", () => {
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ rows: [], total: 0, snapshot: null, isLoading: true, warming: true }),
    );
    r(() => <MarketScreenerPanel />);
    expect(screen.getByTestId("market-skeleton")).toBeInTheDocument();
    expect(screen.getByTestId("market-warming-hint")).toBeInTheDocument();
    expect(screen.getByTestId("market-warming-hint-text")).toHaveTextContent(
      "Still warming All NSE — switch to Nifty 500 for instant data",
    );
  });

  test("warming hint is hidden for Nifty 500", async () => {
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ rows: [], total: 0, snapshot: null, isLoading: true, warming: true }),
    );
    r(() => <MarketScreenerPanel />);
    expect(screen.getByTestId("market-warming-hint")).toBeInTheDocument();
    const combo = screen.getByTestId("market-universe-select").querySelector('[role="combobox"]') as HTMLInputElement;
    await fireEvent.focus(combo);
    await fireEvent.mouseDown(await screen.findByRole("option", { name: "Nifty 500" }));
    expect(screen.queryByTestId("market-warming-hint")).not.toBeInTheDocument();
    expect(mockUseMarketSnapshot.mock.calls.at(-1)?.[0]()).toBe("nifty500");
  });

  test("warming-hint switch button jumps to Nifty 500", async () => {
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ rows: [], total: 0, snapshot: null, isLoading: true, warming: true }),
    );
    r(() => <MarketScreenerPanel />);
        await fireEvent.click(screen.getByTestId("market-warming-switch"));
    expect(mockUseMarketSnapshot.mock.calls.at(-1)?.[0]()).toBe("nifty500");
  });

  test("timeout error with no rows shows the error panel", async () => {
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ rows: [], total: 0, snapshot: null, isLoading: false, error: new Error("Market snapshot timed out") }),
    );
    r(() => <MarketScreenerPanel />);
    await waitFor(() => expect(screen.getByTestId("market-error")).toBeInTheDocument());
    expect(screen.getByTestId("market-error-message")).toHaveTextContent("Market snapshot timed out");
    expect(screen.queryByTestId("market-skeleton")).not.toBeInTheDocument();
  });

  test("timeout error with cached rows keeps the grid and shows a retry banner", () => {
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ error: new Error("Market snapshot timed out"), isLoading: false }),
    );
    r(() => <MarketScreenerPanel />);
    expect(screen.getByTestId("market-grid")).toBeInTheDocument();
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("market-error-banner-message")).toHaveTextContent(
      "Market snapshot timed out",
    );
  });
});

describe("MarketScreenerPanel — stale badge decays with time", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("a snapshot ages past 15 minutes while the tab sits open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T09:30:00.000Z"));
    const asOf = new Date(Date.now()).toISOString();
    mockUseMarketSnapshot.mockReturnValue(hookResult({ asOf, stale: false }));

    r(() => <MarketScreenerPanel />);
    expect(screen.queryByTestId("market-stale-badge")).not.toBeInTheDocument();
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();

    vi.advanceTimersByTime(16 * 60 * 1000);
    expect(screen.getByTestId("market-stale-badge")).toBeInTheDocument();
  });

  test("a fresh snapshot never shows a badge, however long the tab stays open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-16T09:30:00.000Z"));
    const asOf = new Date(Date.now()).toISOString();
    mockUseMarketSnapshot.mockReturnValue(hookResult({ asOf, stale: false }));

    r(() => <MarketScreenerPanel />);
    vi.advanceTimersByTime(10 * 60 * 1000);
    expect(screen.queryByTestId("market-stale-badge")).not.toBeInTheDocument();
  });
});

describe("MarketScreenerPanel — narrow filter drawer keyboard parity", () => {
  function narrowViewport() {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width: 1023px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function openDrawer() {
    narrowViewport();
    r(() => <MarketScreenerPanel />);
    const toggle = screen.getByTestId("market-rail-toggle");
    fireEvent.click(toggle);
    return { toggle, drawer: screen.getByTestId("market-filter-drawer") };
  }

  test("opens as a modal dialog and moves focus into it", () => {
    const { toggle, drawer } = openDrawer();
    expect(drawer).toHaveAttribute("role", "dialog");
    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(drawer).toHaveAttribute("aria-label", "Filters");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(drawer.contains(document.activeElement)).toBe(true);
  });

  test("Escape closes the drawer and returns focus to the toggle", () => {
    const { toggle, drawer } = openDrawer();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("market-filter-drawer")).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(toggle);
    expect(drawer.isConnected).toBe(false);
  });

  test("Tab wraps inside the drawer instead of escaping to the page behind", () => {
    const { drawer } = openDrawer();
    const focusables = Array.from(
      drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    expect(focusables.length).toBeGreaterThan(1);

    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  test("the rail's close button is a second dismiss path", () => {
    const { toggle } = openDrawer();
    fireEvent.click(screen.getByTestId("market-rail-collapse"));
    expect(screen.queryByTestId("market-filter-drawer")).not.toBeInTheDocument();
    expect(document.activeElement).toBe(toggle);
  });

  test("ArrowDown inside the open drawer never re-points the table behind it", () => {
    openDrawer();
    const reliance = screen.getByTestId("market-row-RELIANCE");
    const base = reliance.style.backgroundColor;
    fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(reliance.style.backgroundColor).toBe(base);
  });
});

describe("MarketScreenerPanel — non-blocking filters", () => {
  function buildBenchRows(count: number): MarketRow[] {
    const rows: MarketRow[] = [];
    for (let i = 0; i < count; i += 1) {
      rows.push(
        row(`SYM${String(i).padStart(3, "0")}`, {
          close: i % 2 === 0 ? 100 : 50,
          sma200: 70,
        }),
      );
    }
    return rows;
  }

  test("chip + active-count update immediately; table data is deferred", async () => {
    const rows = buildBenchRows(496);
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows, total: rows.length }));
    r(() => <MarketScreenerPanel />);

    expect(screen.getByTestId("market-grid")).toBeInTheDocument();
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("496 / 496");
    // Zero active filters: the Indicator wrapper stays mounted (committed
    // @/ui contract), but the dot is absent.
    expect(screen.getByTestId("market-filter-count").querySelector(".absolute")).toBeNull();

    const sma200 = screen.getByTestId("market-filter-above-sma200");
    fireEvent.click(sma200);

    // Immediate path: chip and active-filter count reflect the click within the
    // same synchronous render — no waiting for a transition. The result count
    // is computed from the immediate filters too (filter-only, no sort), so it
    // is honest with the chips on the same commit instead of lagging the
    // deferred table by one transition. (RTL flushes pending scheduler work at
    // the end of `act`, so this harness cannot observe the pre-commit frame —
    // commit timing is asserted in the browser, not here.)
    expect(screen.getByTestId("market-filter-chip-sma200")).toBeInTheDocument();
    const badge = screen.getByTestId("market-filter-count");
    expect(badge.querySelector(".absolute")).not.toBeNull();
    expect(badge).toHaveTextContent("1");
    // Alternating close=100/50 vs sma200=70 → even indices pass → 248 match.
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("248 / 496");
    expect(screen.getByTestId("market-grid")).toBeInTheDocument();

    // `filterOnlyMarketRows` is not re-invoked by further non-filter interaction:
    // no synchronous 496-row filter pass blocks the UI. (The deferred render is
    // committed by React's scheduler in the browser; happy-dom does not process
    // that scheduler work, so the test covers the synchronous guarantee above.)
    const filterSpy = vi.spyOn(marketFilters, "filterOnlyMarketRows");
    fireEvent.click(screen.getByTestId("market-rail-toggle"));
    expect(filterSpy.mock.calls.length).toBe(0);
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("248 / 496");
  });

  test("non-filter interactions do not re-run the filter pipeline", () => {
    const rows = buildBenchRows(496);
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows, total: rows.length }));
    const filterSpy = vi.spyOn(marketFilters, "filterOnlyMarketRows");
    r(() => <MarketScreenerPanel />);

    const callsBefore = filterSpy.mock.calls.length;
    expect(callsBefore).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("market-rail-toggle"));

    expect(filterSpy.mock.calls.length).toBe(callsBefore);
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("496 / 496");
  });
});

describe("MarketScreenerPanel — the table owns sorting, the map only sizes", () => {
  test("the rail and the map both have no sort control; the Vis toolbar owns Size by", async () => {
    r(() => <MarketScreenerPanel />);
    const rail = screen.getByTestId("market-filter-rail");
    expect(within(rail).queryByTestId("market-filter-sort")).toBeNull();
    expect(within(rail).getByTestId("market-filter-sector")).toBeInTheDocument();

    await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Vis"));
    expect(screen.queryByTestId("market-map-sort")).toBeNull();
    expect(screen.getByTestId("market-map-toolbar").querySelectorAll("select")).toHaveLength(0);
    expect(screen.getByTestId("market-vis-toolbar")).toHaveTextContent("Size by");
    expect(screen.getByTestId("market-vis-toolbar").querySelectorAll("select")).toHaveLength(1);
    await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Table"));
  });

  test("changing the size metric never writes into the table's sort", async () => {
    const rows = [
      row("RELIANCE", { marketCapCr: 1_000_000, rsi: 20 }),
      row("MPHASIS", { marketCapCr: 10_000, rsi: 80 }),
    ];
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows, total: rows.length }));
    r(() => <MarketScreenerPanel />);
    const toggle = screen.getByTestId("market-view-toggle");
    await fireEvent.click(within(toggle).getByText("Vis"));

    const metric = () =>
      (screen.getByTestId("market-map-metric").querySelector("select") as HTMLSelectElement).value;
    expect(metric()).toBe("change_pct");

    fireEvent.input(screen.getByTestId("market-map-metric").querySelector("select")!, {
      target: { value: "rsi" },
    });
    expect(metric()).toBe("rsi");

    await fireEvent.click(within(toggle).getByText("Table"));
    // The table keeps its own persisted sort (market cap desc); the map's
    // single dropdown is local to the map and has no reverse bridge.
    expect(document.getElementById("paper-tanstack-header-market_cap_cr")).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
  });
});

describe("MarketScreenerPanel ↔ market heatmap — one metric control", () => {
  function HeatmapWindow() {
    const spec = getPanelSpec("market.heatmap")!;
    const ctx = () => ({ market: "india" }) as never;
    const data = createMemo(() => spec.data?.(ctx()));
    return <>{spec.mount(ctx(), { data, commands: spec.commands ?? {} })}</>;
  }

  const optionsOf = (select: HTMLSelectElement) =>
    Array.from(select.querySelectorAll("option")).map((o) => {
      const option = o as HTMLOptionElement;
      return { value: option.value, label: option.textContent, disabled: option.disabled };
    });

  it("both surfaces expose exactly one Size by control with the same shared-registry options", async () => {
    r(() => (
      <>
        <MarketScreenerPanel />
        <HeatmapWindow />
      </>
    ));
    await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Vis"));

    const pageToolbar = screen.getByTestId("market-vis-toolbar");
    // The desk panel is lazy: its component graph resolves after mount.
    const panel = await screen.findByTestId("market-heatmap-panel");
    // The page owns one dropdown; the panel owns one (plus its universe select).
    expect(pageToolbar.querySelectorAll("select")).toHaveLength(1);
    expect(panel.querySelectorAll("select")).toHaveLength(2);
    expect(screen.queryByTestId("market-heatmap-color-metric")).toBeNull();

    const pageSelect = screen
      .getByTestId("market-map-metric")
      .querySelector("select") as HTMLSelectElement;
    const panelSelect = screen
      .getByTestId("market-heatmap-metric")
      .querySelector("select") as HTMLSelectElement;
    const expected = marketMetricOptions("INR").map((option) => ({
      value: option.value,
      label: option.label,
      disabled: false,
    }));
    expect(optionsOf(pageSelect)).toEqual(expected);
    expect(optionsOf(panelSelect)).toEqual(expected);
  });
});

describe("MarketScreenerPanel — selected row affordance", () => {
  test("click and ArrowDown both tint the selected row", async () => {
    r(() => <MarketScreenerPanel />);
    const reliance = screen.getByTestId("market-row-RELIANCE");
    const mphasis = screen.getByTestId("market-row-MPHASIS");
    const base = reliance.style.backgroundColor;

    await fireEvent.click(reliance);
    expect(reliance.style.backgroundColor).not.toBe(base);

    await fireEvent.keyDown(document, { key: "ArrowDown" });
    expect(mphasis.style.backgroundColor).not.toBe(base);
  });
});

describe("MarketScreenerPanel — keyboard follows the table sort", () => {
  test("ArrowDown steps the header-sorted order, not filters.sort", async () => {
    r(() => <MarketScreenerPanel />);
    // NAME asc is MPHASIS → RELIANCE; the pre-table mcap order is RELIANCE →
    // MPHASIS, which is what the old stepping code used.
    await fireEvent.click(screen.getByText("NAME").closest("th")!);
    const first = await screen.findByTestId("market-row-MPHASIS");
    await fireEvent.click(first);
    const base = screen.getByTestId("market-row-RELIANCE").style.backgroundColor;

    await fireEvent.keyDown(document, { key: "ArrowDown" });

    expect(screen.getByTestId("market-row-RELIANCE").style.backgroundColor).not.toBe(base);
  });
});

describe("MarketScreenerPanel — Movers view", () => {
  test("switching to Movers renders the dashboard and hides market search + filter rail", async () => {
    r(() => <MarketScreenerPanel />);
    expect(screen.queryByTestId("screener-dashboard")).not.toBeInTheDocument();
    expect(screen.getByTestId("market-search")).toBeInTheDocument();
    expect(screen.getByTestId("market-filter-rail")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Movers" }));
    await screen.findByTestId("screener-dashboard");

    expect(screen.queryByTestId("market-search")).not.toBeInTheDocument();
    expect(screen.queryByTestId("market-filter-rail")).not.toBeInTheDocument();
  });

  test("onViewChange callback receives movers", async () => {
    const onViewChange = vi.fn();
    r(() => <MarketScreenerPanel onViewChange={onViewChange} />);
    expect(onViewChange).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole("button", { name: "Movers" }));
    expect(onViewChange).toHaveBeenCalledWith("movers");
    // Settle the lazy dashboard before cleanup disposes its Suspense.
    await screen.findByTestId("screener-dashboard");
  });

  test("initialView=movers starts in Movers", async () => {
    r(() => <MarketScreenerPanel initialView="movers" />);
    expect(await screen.findByTestId("screener-dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("market-search")).not.toBeInTheDocument();
    expect(screen.queryByTestId("market-filter-rail")).not.toBeInTheDocument();
    expect(screen.getByTestId("market-view-toggle")).toBeInTheDocument();
  });

  test("the Vis tab renders the registry default heatmap", async () => {
    r(() => <MarketScreenerPanel />);
    await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Vis"));
    expect(await screen.findByTestId("market-map-view")).toBeInTheDocument();
    expect(screen.getByTestId("market-map-canvas")).toBeInTheDocument();
  });

  test("the Vis selector reaches both registered visualizations", async () => {
    r(() => <MarketScreenerPanel />);
    await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Vis"));
    expect(await screen.findByTestId("market-vis-selector")).toBeInTheDocument();

    const selector = screen.getByTestId("market-vis-selector");
    expect(within(selector).getByText("Heatmap")).toHaveAttribute("aria-pressed", "true");
    expect(within(selector).getByText("Sector treemap")).toBeInTheDocument();

    fireEvent.click(within(selector).getByText("Sector treemap"));
    expect(await screen.findByTestId("market-sector-map-view")).toBeInTheDocument();
    expect(screen.queryByTestId("market-map-view")).not.toBeInTheDocument();
    expect(within(screen.getByTestId("market-vis-selector")).getByText("Sector treemap")).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(within(screen.getByTestId("market-vis-selector")).getByText("Heatmap"));
    expect(await screen.findByTestId("market-map-view")).toBeInTheDocument();
    expect(screen.queryByTestId("market-sector-map-view")).not.toBeInTheDocument();
  });

  test("switching to Movers clears the search; Table comes back empty", async () => {
    r(() => <MarketScreenerPanel />);
    const search = screen.getByTestId("market-search") as HTMLInputElement;
    fireEvent.input(search, { target: { value: "reliance" } });
    expect(search.value).toBe("reliance");

    await fireEvent.click(screen.getByRole("button", { name: "Movers" }));
    await screen.findByTestId("screener-dashboard");
    expect(screen.queryByTestId("market-search")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Table" }));
    expect((screen.getByTestId("market-search") as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();

    await fireEvent.click(screen.getByRole("button", { name: "Movers" }));
    expect(await screen.findByTestId("screener-dashboard")).toBeInTheDocument();
  });
});

describe("MarketScreenerPanel — active-filter row layout stability", () => {
  async function applySectorFilter() {
    const sectorSelect = screen.getByTestId("market-filter-sector");
    await fireEvent.focus(within(sectorSelect).getByRole("combobox"));
    const it = await screen.findByRole("option", { name: "IT" });
    await fireEvent.click(within(it).getByRole("checkbox"));
  }

  test("the chip row stays mounted at a fixed 24px height as filters come and go", async () => {
    r(() => <MarketScreenerPanel />);
    const row = screen.getByTestId("market-active-chips");
    expect(row).toHaveClass("h-6");
    expect(row).toHaveClass("overflow-x-auto");
    expect(row).toHaveClass("whitespace-nowrap");
    expect(row).not.toHaveClass("flex-wrap");
    expect(screen.getByTestId("market-active-chips-empty")).toHaveTextContent("No filters");

    await applySectorFilter();
    expect(screen.getByTestId("market-filter-chip-sector:IT")).toBeInTheDocument();
    expect(screen.getByTestId("market-active-chips")).toBe(row);
    expect(row).toHaveClass("h-6");
    expect(screen.queryByTestId("market-active-chips-empty")).not.toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("market-filter-chip-sector:IT"));
    expect(screen.getByTestId("market-active-chips")).toBe(row);
    expect(row).toHaveClass("h-6");
    expect(screen.getByTestId("market-active-chips-empty")).toBeInTheDocument();
  });

  test("the table region keeps flex-1 min-h-0 and is not remounted by filters", async () => {
    r(() => <MarketScreenerPanel />);
    const table = screen.getByTestId("market-table-region");
    const tableClasses = table.className;
    expect(tableClasses).toContain("flex-1");
    expect(tableClasses).toContain("min-h-0");

    await applySectorFilter();
    expect(screen.getByTestId("market-table-region")).toBe(table);
    expect(screen.getByTestId("market-table-region").className).toBe(tableClasses);

    await fireEvent.click(screen.getByTestId("market-filter-chip-sector:IT"));
    expect(screen.getByTestId("market-table-region")).toBe(table);
    expect(screen.getByTestId("market-table-region").className).toBe(tableClasses);
  });
});

describe("MarketScreenerPanel — symbol allowlist", () => {
  test("renders only allow-listed rows with a removable chip", () => {
    const onClear = vi.fn();
    r(() => <MarketScreenerPanel symbolAllowlist={["RELIANCE"]} onClearSymbolAllowlist={onClear} />);
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
    expect(screen.queryByTestId("market-row-MPHASIS")).not.toBeInTheDocument();
    const chip = screen.getByTestId("market-symbol-allowlist");
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveTextContent("Movers · 1 symbols ×");
    fireEvent.click(chip);
    expect(onClear).toHaveBeenCalled();
  });

  test("counts all allow-listed symbols in the chip", () => {
    r(() => <MarketScreenerPanel symbolAllowlist={["RELIANCE", "MPHASIS"]} />);
    expect(screen.getByTestId("market-symbol-allowlist")).toHaveTextContent(
      "Movers · 2 symbols ×",
    );
  });

  test("omits the chip when the list is empty or absent", () => {
    r(() => <MarketScreenerPanel />);
    expect(screen.queryByTestId("market-symbol-allowlist")).not.toBeInTheDocument();
    r(() => <MarketScreenerPanel symbolAllowlist={[]} />);
    expect(screen.queryByTestId("market-symbol-allowlist")).not.toBeInTheDocument();
  });

  test("changing the universe clears the symbol allowlist", async () => {
    const onClear = vi.fn();
    r(() => <MarketScreenerPanel symbolAllowlist={["RELIANCE"]} onClearSymbolAllowlist={onClear} />);
    const combo = screen.getByTestId("market-universe-select").querySelector(
      '[role="combobox"]',
    ) as HTMLInputElement;
    await fireEvent.focus(combo);
    await fireEvent.mouseDown(await screen.findByRole("option", { name: "Nifty 500" }));
    expect(onClear).toHaveBeenCalled();
  });

  test("keeps the table mounted across a Map round-trip", async () => {
    r(() => <MarketScreenerPanel />);
    const before = screen.getByTestId("market-grid");
    const toggle = screen.getByTestId("market-view-toggle");

    await fireEvent.click(within(toggle).getByText("Vis"));
    // Mounted but hidden: losing the node would reset TanStack's sort state.
    expect(screen.getByTestId("market-grid")).toBe(before);

    await fireEvent.click(within(toggle).getByText("Table"));
    expect(screen.getByTestId("market-grid")).toBe(before);
  });

  test("pinning a sector hides the SECTOR column; removing the chip restores it", async () => {
    r(() => <MarketScreenerPanel />);
    expect(screen.getByText("SECTOR")).toBeInTheDocument();

    const sectorSelect = screen.getByTestId("market-filter-sector");
    await fireEvent.focus(within(sectorSelect).getByRole("combobox"));
    const itOption = await screen.findByRole("option", { name: "IT" });
    await fireEvent.click(within(itOption).getByRole("checkbox"));

    // Every visible row is now IT, so the column carries no information.
    await waitFor(() => expect(screen.queryByText("SECTOR")).toBeNull());
    expect(screen.getByTestId("market-filter-chip-sector:IT")).toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("market-filter-chip-sector:IT"));
    await waitFor(() => expect(screen.getByText("SECTOR")).toBeInTheDocument());
  });

  test("two sectors keep their own chips and survive removing one", async () => {
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ rows: [row("RELIANCE", { sector: "IT" }), row("ONGC", { sector: "Energy" })] }),
    );
    r(() => <MarketScreenerPanel />);

    const sectorSelect = screen.getByTestId("market-filter-sector");
    await fireEvent.focus(within(sectorSelect).getByRole("combobox"));
    const it = await screen.findByRole("option", { name: "IT" });
    await fireEvent.click(within(it).getByRole("checkbox"));
    await fireEvent.focus(within(sectorSelect).getByRole("combobox"));
    const energy = await screen.findByRole("option", { name: "Energy" });
    await fireEvent.click(within(energy).getByRole("checkbox"));

    expect(screen.getByTestId("market-filter-chip-sector:IT")).toBeInTheDocument();
    expect(screen.getByTestId("market-filter-chip-sector:Energy")).toBeInTheDocument();

    await fireEvent.click(screen.getByTestId("market-filter-chip-sector:IT"));
    await waitFor(() =>
      expect(screen.queryByTestId("market-filter-chip-sector:IT")).toBeNull(),
    );
    expect(screen.getByTestId("market-filter-chip-sector:Energy")).toBeInTheDocument();
    expect(screen.queryByText("SECTOR")).toBeNull();
  });
});

describe("MarketScreenerPanel — PATTERNS column", () => {
  function storedLookup(symbols: string[]) {
    return {
      timeframe: "1D",
      session: "2026-11-16",
      source: "stored",
      data_through: "2026-11-14",
      items: symbols.map((symbol) => ({
        symbol,
        count: 1,
        patterns: [
          {
            pattern_id: "bull_flag",
            name: "Bull Flag",
            direction: "bullish",
            status: "confirmed",
            quality: "strong",
            confidence: 80,
            bars_ago: 2,
          },
        ],
      })),
    };
  }

  test("the column renders badges from the batched lookup", async () => {
    mockLookupPatterns.mockResolvedValue(storedLookup(["RELIANCE"]));

    r(() => <MarketScreenerPanel />);

    const badge = await screen.findByTestId("market-patterns-RELIANCE", {}, { timeout: 3000 });
    expect(badge).toHaveTextContent("1▲");
    // The symbol with no stored hit keeps the shared dash, not a "0" badge.
    expect(screen.getByTestId("market-dash-MPHASIS-patterns")).toHaveTextContent("–");
  });

  test("one request covers the whole visible window, never one per row", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(`SYM${i}`));
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows, total: rows.length }));
    mockLookupPatterns.mockResolvedValue(storedLookup([]));

    r(() => <MarketScreenerPanel />);
    await waitFor(() => expect(mockLookupPatterns).toHaveBeenCalled(), { timeout: 3000 });

    expect(mockLookupPatterns).toHaveBeenCalledTimes(1);
    const body = mockLookupPatterns.mock.calls[0][0] as { symbols: string[] };
    expect(body.symbols).toHaveLength(rows.length);
    expect(body.symbols).toContain("SYM0");
    expect(body.symbols).toContain("SYM11");
  });

  test("Table → Map → Table does not refetch while the window is unchanged", async () => {
    mockLookupPatterns.mockResolvedValue(storedLookup(["RELIANCE"]));
    r(() => <MarketScreenerPanel />);
    await waitFor(() => expect(mockLookupPatterns).toHaveBeenCalledTimes(1), { timeout: 3000 });

    const toggle = screen.getByTestId("market-view-toggle");
    await fireEvent.click(within(toggle).getByText("Vis"));
    await fireEvent.click(within(toggle).getByText("Table"));

    // The window is identical, so the cached answers are still current.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(mockLookupPatterns).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("market-patterns-RELIANCE")).toBeInTheDocument();
  });

  test("the loading flag is exposed once for the table, never per row", async () => {
    let release: (value: unknown) => void = () => {};
    mockLookupPatterns.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    r(() => <MarketScreenerPanel />);

    // While the batch lookup is in flight the container is marked busy, but no
    // row-level spinner appears (a per-row spinner would be 80 spinners).
    await waitFor(
      () =>
        expect(
          screen
            .getByTestId("market-grid")
            .closest('[data-patterns-loading="true"]'),
        ).not.toBeNull(),
      { timeout: 3000 },
    );
    expect(screen.queryByTestId("market-patterns-RELIANCE")).toBeNull();

    release({
      timeframe: "1D",
      session: "2026-11-16",
      source: "stored",
      data_through: "2026-11-14",
      items: [],
    });
    await waitFor(
      () =>
        expect(
          screen
            .getByTestId("market-grid")
            .closest('[data-patterns-loading="true"]'),
        ).toBeNull(),
      { timeout: 3000 },
    );
  });

  test("a failed lookup leaves dashes and never blanks the table", async () => {
    mockLookupPatterns.mockRejectedValue(new Error("HTTP 503"));
    r(() => <MarketScreenerPanel />);

    await waitFor(() => expect(mockLookupPatterns).toHaveBeenCalled(), { timeout: 3000 });
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("market-dash-RELIANCE-patterns")).toBeInTheDocument();
    expect(screen.queryByTestId("market-error-banner")).toBeNull();
  });
});

describe("MarketScreenerPanel — saved filters", () => {
  const SAVED_ROWS: MarketRow[] = [
    row("RELIANCE", { sector: "IT", rsi: 62, relativeVolume: 2.4 }),
    row("MPHASIS", { sector: "IT", rsi: 44, relativeVolume: 0.8 }),
    row("ONGC", { sector: "Energy", rsi: 71, relativeVolume: 1.6 }),
  ];

  function savedPayload(overrides: Record<string, unknown> = {}) {
    return {
      ...serializeMarketConfig({
        ...defaultMarketConfig({ universe: "nifty500" }),
        filters: {
          ...defaultMarketConfig().filters,
          sectors: ["IT"],
          rsiMin: 50,
          sort: "relvol_desc",
        },
      }),
      ...overrides,
    };
  }

  function withSaved(config: Record<string, unknown>, saved = true) {
    mockGetUserConfig.mockResolvedValue({
      scope: "market.filters",
      version: 1,
      saved,
      updated_at: saved ? "2026-11-15T09:41:22.192Z" : null,
      config,
    });
  }

  test("restores saved filters without letting the universe write reset them", async () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows: SAVED_ROWS, total: SAVED_ROWS.length }));
    withSaved(savedPayload());

    r(() => <MarketScreenerPanel />);

    // The reset effect (:194-205) must not fire for the hydration write: with
    // a saved universe of nifty500 both restored filters survive.
    await waitFor(() =>
      expect(screen.getByTestId("market-filter-chip-sector:IT")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("market-filter-chip-rsi")).toHaveTextContent("RSI ≥ 50");
    expect(screen.getByTestId("market-filter-count")).toHaveTextContent("2");
    // Only RELIANCE clears RSI 50 within IT, and it sorts first by rel-vol.
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
    expect(screen.queryByTestId("market-row-MPHASIS")).toBeNull();
    expect(screen.queryByTestId("market-row-ONGC")).toBeNull();
    // A restored sector still hides the constant SECTOR column.
    expect(screen.queryByText("SECTOR")).toBeNull();
    expect(mockUseMarketSnapshot.mock.calls.at(-1)?.[0]()).toBe("nifty500");
  });

  test("hydrates the layout from the saved view when the URL says nothing", async () => {
    withSaved(savedPayload({ view: "map" }));

    r(() => <MarketScreenerPanel />);

    await screen.findByTestId("market-map");
    expect(screen.getByTestId("market-filter-chip-sector:IT")).toBeInTheDocument();
    // Back to Table before cleanup: happy-dom has no 2D canvas context, and the
    // treemap's animation frame errors on unmount if it is still mounted.
    const toggle = screen.getByTestId("market-view-toggle");
    await fireEvent.click(within(toggle).getByText("Table"));
  });

  test("a ?view= from the URL beats the saved view; the saved filters still apply", async () => {
    withSaved(savedPayload({ view: "table" }));

    r(() => <MarketScreenerPanel initialView="vis" />);

    await waitFor(() =>
      expect(screen.getByTestId("market-filter-chip-sector:IT")).toBeInTheDocument(),
    );
    // `table` renders too (hidden), so assert the toggle's pressed state.
    const toggle = screen.getByTestId("market-view-toggle");
    expect(within(toggle).getByText("Vis").closest("button")?.getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  test("a cleared filter does not resurrect when a delayed GET lands", async () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows: SAVED_ROWS, total: SAVED_ROWS.length }));
    let resolveGet: ((value: unknown) => void) | null = null;
    mockGetUserConfig.mockReturnValue(
      new Promise((resolve) => {
        resolveGet = resolve;
      }) as never,
    );

    r(() => <MarketScreenerPanel />);

    // User mutates before the config GET answers: the latch closes.
    const sectorSelect = screen.getByTestId("market-filter-sector");
    await fireEvent.focus(within(sectorSelect).getByRole("combobox"));
    const energy = await screen.findByRole("option", { name: "Energy" });
    await fireEvent.click(within(energy).getByRole("checkbox"));
    expect(screen.getByTestId("market-filter-chip-sector:Energy")).toBeInTheDocument();

    resolveGet!({
      scope: "market.filters",
      version: 1,
      saved: true,
      updated_at: "2026-11-15T09:41:22.192Z",
      config: savedPayload(),
    });
    await waitFor(() => expect(mockPutUserConfig).not.toHaveBeenCalled());

    expect(screen.queryByTestId("market-filter-chip-sector:IT")).toBeNull();
    expect(screen.queryByTestId("market-filter-chip-rsi")).toBeNull();
    expect(screen.getByTestId("market-filter-chip-sector:Energy")).toBeInTheDocument();
  });

  test("a failed save shows the toolbar chip and leaves the table intact", async () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows: SAVED_ROWS, total: SAVED_ROWS.length }));
    mockPutUserConfig.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));

    r(() => <MarketScreenerPanel />);

    const sectorSelect = screen.getByTestId("market-filter-sector");
    await fireEvent.focus(within(sectorSelect).getByRole("combobox"));
    const it = await screen.findByRole("option", { name: "IT" });
    await fireEvent.click(within(it).getByRole("checkbox"));

    // The debounce is real time here (800ms); the chip is the only new chrome.
    const chip = await screen.findByTestId("saved-config-error", {}, { timeout: 4000 });
    expect(chip).toHaveTextContent(/^Filters not saved/);
    expect(screen.getByTestId("saved-config-retry")).toBeInTheDocument();
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("market-row-MPHASIS")).toBeInTheDocument();
    expect(screen.getByTestId("market-filter-chip-sector:IT")).toBeInTheDocument();
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("2 / 3");
  }, 10000);

  test("the failure chip lives in the toolbar next to the filter count", async () => {
    mockPutUserConfig.mockRejectedValue(Object.assign(new Error("boom"), { status: 422 }));
    r(() => <MarketScreenerPanel />);

    const sma20 = screen.getByTestId("market-filter-above-sma20");
    fireEvent.click(sma20);

    const chip = await screen.findByTestId("saved-config-error", {}, { timeout: 4000 });
    const toolbar = screen.getByTestId("market-toolbar");
    expect(toolbar).toContainElement(chip as HTMLElement);
    expect(toolbar).toContainElement(screen.getByTestId("market-filter-count"));
    await waitFor(() => expect(screen.getByTestId("saved-config-retry")).toBeInTheDocument());
  }, 10000);

  test("applying a saved value never writes it straight back", async () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows: SAVED_ROWS, total: SAVED_ROWS.length }));
    withSaved(savedPayload());

    r(() => <MarketScreenerPanel />);
    await waitFor(() =>
      expect(screen.getByTestId("market-filter-chip-sector:IT")).toBeInTheDocument(),
    );
    await new Promise((resolve) => setTimeout(resolve, 1200));

    // Reading a config is not an edit: no echoing PUT, no new revision.
    expect(mockPutUserConfig).not.toHaveBeenCalled();
  }, 10000);

  test("a reload restores what the previous mount saved", async () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows: SAVED_ROWS, total: SAVED_ROWS.length }));

    r(() => <MarketScreenerPanel />);
    const sectorSelect = screen.getByTestId("market-filter-sector");
    await fireEvent.focus(within(sectorSelect).getByRole("combobox"));
    const it = await screen.findByRole("option", { name: "IT" });
    await fireEvent.click(within(it).getByRole("checkbox"));

    // Wait for the debounce to reach the API, then make the GET answer with
    // exactly what the PUT carried — that is what a page reload sees.
    await waitFor(() => expect(mockPutUserConfig).toHaveBeenCalled(), { timeout: 4000 });
    const savedByPut = mockPutUserConfig.mock.calls.at(-1)![1] as Record<string, unknown>;

    cleanup();
    withSaved(savedByPut);
    r(() => <MarketScreenerPanel />);

    await waitFor(() =>
      expect(screen.getByTestId("market-filter-chip-sector:IT")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
    expect(screen.queryByTestId("market-row-ONGC")).toBeNull();
    expect(screen.queryByText("SECTOR")).toBeNull();
  }, 15000);

  /**
   * The table-prefs GET and the market.filters GET race on every mount. A saved
   * non-default table sort makes the map-sort mirror patch filters before the
   * saved market config lands; that write closes the store latch, so the saved
   * universe/filters are discarded and overwritten with mount defaults.
   */
  describe("with a saved non-default table sort (table prefs GET wins the race)", () => {
    const RACE_ROWS: MarketRow[] = [row("RELIANCE", { sector: "IT", rsi: 62 })];
    let resolveMarketGet: (value: unknown) => void;

    function savedConfig() {
      return {
        scope: "market.filters",
        version: 1,
        saved: true,
        updated_at: "2026-11-15T09:41:22.192Z",
        config: serializeMarketConfig({
          universe: "nifty50",
          filters: {
            ...defaultMarketConfig().filters,
            rsiMin: 60,
            aboveSma20: true,
            sort: "rsi_desc",
          },
          view: "table",
          colorBy: "change_pct",
        }),
      };
    }

    beforeEach(() => {
      mockUseMarketSnapshot.mockReturnValue(
        hookResult({ rows: RACE_ROWS, total: RACE_ROWS.length }),
      );
      let resolve!: (value: unknown) => void;
      const marketGet = new Promise((res) => {
        resolve = res;
      });
      resolveMarketGet = resolve;
      mockGetUserConfig.mockImplementation(async (scope: string) => {
        if (scope === "table.market.grid") {
          return {
            scope,
            version: 1,
            saved: true,
            updated_at: "2026-11-15T09:42:00.192Z",
            config: { sorting: [{ id: "rsi", desc: true }], order: [], hidden: [] },
          } as never;
        }
        return marketGet as never;
      });
    });

    /** Render, let the table-prefs mirror run, then let the saved GET land. */
    async function hydrateWithRace() {
      r(() => <MarketScreenerPanel />);
      await waitFor(() =>
        expect(document.getElementById("paper-tanstack-header-rsi")).toHaveAttribute(
          "aria-sort",
          "descending",
        ),
      );
      // One macrotask is enough for the mirror's `patchFilters` + autosave.
      await new Promise((resolve) => setTimeout(resolve, 10));
      resolveMarketGet(savedConfig());
      // Let the GET settle and the hydration batch flush into the panel.
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    test("the saved universe survives even when the table sort mirror lands first", async () => {
      await hydrateWithRace();

      // Fails on the buggy code: the mirror's pre-hydration write closes the
      // latch, so nifty50 is discarded and the snapshot stays on all_equity.
      expect(mockUseMarketSnapshot.mock.calls.at(-1)?.[0]()).toBe("nifty50");
      expect(
        within(screen.getByTestId("market-universe-select")).getByRole("combobox"),
      ).toHaveValue("Nifty 50");
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(
        mockPutUserConfig.mock.calls.some(
          ([scope, config]) =>
            scope === "market.filters" &&
            (config as Record<string, unknown>).universe === "all_equity",
        ),
      ).toBe(false);
    }, 10000);

    test("numeric bounds and SMA toggles survive the same pre-hydration write", async () => {
      await hydrateWithRace();

      // Both are persisted fields; neither may be replaced by mount defaults
      // just because the table's derived sort arrived before the GET did.
      expect(screen.getByTestId("market-filter-chip-rsi")).toHaveTextContent("RSI ≥ 60");
      expect(screen.getByTestId("market-filter-chip-sma20")).toBeInTheDocument();
      expect(screen.getByTestId("market-filter-count")).toHaveTextContent("2");
    });
  });

  test("a 401 disables the feature silently: no chip, defaults applied", async () => {
    mockGetUserConfig.mockRejectedValue(Object.assign(new Error("unauthorized"), { status: 401 }));

    r(() => <MarketScreenerPanel />);

    await waitFor(() => expect(mockGetUserConfig).toHaveBeenCalled());
    const sectorSelect = screen.getByTestId("market-filter-sector");
    await fireEvent.focus(within(sectorSelect).getByRole("combobox"));
    const it = await screen.findByRole("option", { name: "IT" });
    await fireEvent.click(within(it).getByRole("checkbox"));

    expect(screen.queryByTestId("saved-config-error")).toBeNull();
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
  });
});

describe("MarketScreenerPanel — persisted table sort (table.market.grid)", () => {
  const SORT_ROWS: MarketRow[] = [
    row("SMALLCAP", { marketCapCr: 100, change: 9, rsi: 80 }),
    row("MIDCAP", { marketCapCr: 900, change: 4, rsi: 50 }),
    row("BIGCAP", { marketCapCr: 9000, change: -3, rsi: 20 }),
  ];

  const rowOrder = () =>
    Array.from(document.querySelectorAll('[data-testid^="market-row-"]')).map((el) =>
      el.getAttribute("data-testid"),
    );
  const header = (id: string) => document.getElementById(`paper-tanstack-header-${id}`);

  beforeEach(() => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows: SORT_ROWS, total: SORT_ROWS.length }));
  });

  function withSavedTableSorting(sorting: { id: string; desc: boolean }[]) {
    mockGetUserConfig.mockImplementation(async (scope: string) => {
      if (scope === "table.market.grid") {
        return {
          scope,
          version: 1,
          saved: true,
          updated_at: "2026-11-15T09:41:22.192Z",
          config: { sorting, order: [], hidden: [] },
        } as never;
      }
      return {
        scope: "market.filters",
        version: 1,
        saved: false,
        updated_at: null,
        config: serializeMarketConfig(defaultMarketConfig()),
      } as never;
    });
  }

  test("the bridge maps every supported metric and ignores unsupported directions", () => {
    expect(sortEntryToMarketSort([{ id: "market_cap_cr", desc: true }])).toBe("mcap_desc");
    expect(sortEntryToMarketSort([{ id: "day_change", desc: true }])).toBe("day_desc");
    expect(sortEntryToMarketSort([{ id: "day_change", desc: false }])).toBe("day_asc");
    expect(sortEntryToMarketSort([{ id: "rsi", desc: true }])).toBe("rsi_desc");
    expect(sortEntryToMarketSort([{ id: "relative_volume", desc: true }])).toBe("relvol_desc");
    expect(sortEntryToMarketSort([{ id: "perf_w", desc: true }])).toBe("perf_w_desc");
    expect(sortEntryToMarketSort([{ id: "perf_1m", desc: true }])).toBe("perf_1m_desc");
    expect(sortEntryToMarketSort([{ id: "pos_52w", desc: true }])).toBe("pos_52w_desc");
    expect(sortEntryToMarketSort([{ id: "symbol", desc: false }])).toBe("symbol_asc");
    // Ascending is only expressible for day %/symbol — the map keeps its last
    // choice rather than pretending the table said something it cannot.
    expect(sortEntryToMarketSort([{ id: "rsi", desc: false }])).toBeNull();
    expect(sortEntryToMarketSort([])).toBeNull();

    expect(marketSortToSortEntry("mcap_desc")).toEqual({ id: "market_cap_cr", desc: true });
    expect(marketSortToSortEntry("day_asc")).toEqual({ id: "day_change", desc: false });
    expect(marketSortToSortEntry("symbol_asc")).toEqual({ id: "symbol", desc: false });
  });

  test("a saved day-change desc renders the biggest gainers first with aria-sort", async () => {
    withSavedTableSorting([{ id: "day_change", desc: true }]);
    r(() => <MarketScreenerPanel />);

    await waitFor(() =>
      expect(rowOrder()).toEqual(["market-row-SMALLCAP", "market-row-MIDCAP", "market-row-BIGCAP"]),
    );
    expect(header("day_change")).toHaveAttribute("aria-sort", "descending");
  });

  test("empty saved prefs fall back to mcap desc and write nothing", async () => {
    r(() => <MarketScreenerPanel />);
    await waitFor(() => expect(rowOrder()[0]).toBe("market-row-BIGCAP"));

    await new Promise((resolve) => setTimeout(resolve, 1000));
    expect(mockPutUserConfig.mock.calls.map(([scope]) => scope)).not.toContain("table.market.grid");
  }, 10000);

  test("a saved table sort survives hydration; the map has no sort to mirror", async () => {
    // The table owns the sort. On reload its saved TanStack sort must drive the
    // grid; the map no longer carries a second, competing sort control.
    withSavedTableSorting([{ id: "rsi", desc: true }]);
    r(() => <MarketScreenerPanel />);

    await waitFor(() => expect(header("rsi")).toHaveAttribute("aria-sort", "descending"));
    await waitFor(() =>
      expect(rowOrder()).toEqual(["market-row-SMALLCAP", "market-row-MIDCAP", "market-row-BIGCAP"]),
    );
    const toggle = screen.getByTestId("market-view-toggle");
    await fireEvent.click(within(toggle).getByText("Vis"));
    expect(screen.queryByTestId("market-map-sort")).toBeNull();
    expect(screen.getByTestId("market-vis-toolbar").querySelectorAll("select")).toHaveLength(1);
    await fireEvent.click(within(toggle).getByText("Table"));
  });

  test("ascending RSI still sorts the table and the map keeps its single control", async () => {
    r(() => <MarketScreenerPanel />);
    // RSI is numeric: first click descends, second ascends. The table keeps
    // that direction without needing a map enum for it.
    fireEvent.click(header("rsi")!);
    fireEvent.click(header("rsi")!);
    expect(header("rsi")).toHaveAttribute("aria-sort", "ascending");

    const toggle = screen.getByTestId("market-view-toggle");
    await fireEvent.click(within(toggle).getByText("Vis"));
    expect(screen.queryByTestId("market-map-sort")).toBeNull();
    expect(screen.getByTestId("market-vis-toolbar").querySelectorAll("select")).toHaveLength(1);
    await fireEvent.click(within(toggle).getByText("Table"));
  });

  test("the map has no sort control that could write back into the table", async () => {
    r(() => <MarketScreenerPanel />);
    const toggle = screen.getByTestId("market-view-toggle");
    await fireEvent.click(within(toggle).getByText("Vis"));
    expect(screen.queryByTestId("market-map-sort")).toBeNull();

    fireEvent.input(screen.getByTestId("market-map-metric").querySelector("select")!, {
      target: { value: "rsi" },
    });
    await fireEvent.click(within(toggle).getByText("Table"));

    // The table keeps its own persisted sort (mcap desc); the map's only
    // dropdown sizes tiles and must not mutate table.market.grid.
    expect(header("day_change")).not.toHaveAttribute("aria-sort", "ascending");
    await waitFor(() => expect(rowOrder()[0]).toBe("market-row-BIGCAP"));
  });

  test("a header click persists the table sort", async () => {
    r(() => <MarketScreenerPanel />);
    await waitFor(() => expect(rowOrder()[0]).toBe("market-row-BIGCAP"));

    fireEvent.click(header("day_change")!);
    expect(rowOrder()[0]).toBe("market-row-SMALLCAP");
    expect(header("day_change")).toHaveAttribute("aria-sort", "descending");

    const toggle = screen.getByTestId("market-view-toggle");
    await fireEvent.click(within(toggle).getByText("Vis"));
    expect(screen.queryByTestId("market-map-sort")).toBeNull();
    await fireEvent.click(within(toggle).getByText("Table"));

    await waitFor(
      () =>
        expect(
          mockPutUserConfig.mock.calls.some(([scope]) => scope === "table.market.grid"),
        ).toBe(true),
      { timeout: 4000 },
    );
    const put = mockPutUserConfig.mock.calls.find(([scope]) => scope === "table.market.grid")!;
    // The clicked column becomes primary; the previous sorter stays as a
    // secondary, which is exactly what `setSorting` must persist.
    expect(((put[1] as Record<string, unknown>).sorting as unknown[])[0]).toEqual({
      id: "day_change",
      desc: true,
    });
  }, 10000);
});

describe("MarketScreenerPanel — persisted column prefs (table.market.grid)", () => {
  const COL_ROWS: MarketRow[] = [
    row("RELIANCE", { marketCapCr: 100, rsi: 80 }),
    row("MPHASIS", { marketCapCr: 900, rsi: 50 }),
  ];
  const headerIds = () =>
    Array.from(document.querySelectorAll(".paper-tanstack-header-cell")).map(
      (el) => el.id.replace("paper-tanstack-header-", ""),
    );

  beforeEach(() => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows: COL_ROWS, total: COL_ROWS.length }));
  });

  function withSavedTablePrefs(prefs: {
    sorting?: { id: string; desc: boolean }[];
    order?: string[];
    hidden?: string[];
  }) {
    mockGetUserConfig.mockImplementation(async (scope: string) => {
      if (scope === "table.market.grid") {
        return {
          scope,
          version: 1,
          saved: true,
          updated_at: "2026-11-15T09:41:22.192Z",
          config: {
            sorting: prefs.sorting ?? [],
            order: prefs.order ?? [],
            hidden: prefs.hidden ?? [],
          },
        } as never;
      }
      return {
        scope: "market.filters",
        version: 1,
        saved: false,
        updated_at: null,
        config: serializeMarketConfig(defaultMarketConfig()),
      } as never;
    });
  }

  test("saved hidden/order reach TanStackTable as columnPrefs on hydration", async () => {
    // Fails on the current code: column controls are never enabled, so neither
    // the picker nor the hidden/order prefs ever reach the table.
    withSavedTablePrefs({
      hidden: ["rsi"],
      order: [
        "name", "symbol", "sector", "close", "day_change", "perf_w", "perf_1m",
        "pos_52w", "adx", "relative_volume", "market_cap_cr", "cap_tier", "patterns",
      ],
    });
    r(() => <MarketScreenerPanel />);

    expect(screen.getByTestId("table-column-controls")).toBeInTheDocument();
    expect(screen.getByTestId("table-column-picker-trigger")).toBeInTheDocument();
    // RSI is hidden by the saved prefs, and NAME leads the reordered layout.
    await waitFor(() => expect(document.getElementById("paper-tanstack-header-rsi")).toBeNull());
    expect(document.getElementById("paper-tanstack-header-name")).toBeInTheDocument();
    expect(headerIds()[0]).toBe("name");
    // SYMBOL is the row identity: locked in the picker, so it cannot be hidden.
    fireEvent.click(screen.getByTestId("table-column-picker-trigger"));
    expect(screen.getByTestId("table-column-picker-toggle-symbol")).toBeDisabled();
  });

  test("hiding a column in the picker persists hidden to table.market.grid", async () => {
    r(() => <MarketScreenerPanel />);
    fireEvent.click(screen.getByTestId("table-column-picker-trigger"));
    fireEvent.click(screen.getByTestId("table-column-picker-toggle-adx"));

    await waitFor(
      () =>
        expect(
          mockPutUserConfig.mock.calls.some(([scope]) => scope === "table.market.grid"),
        ).toBe(true),
      { timeout: 4000 },
    );
    const put = mockPutUserConfig.mock.calls.find(([scope]) => scope === "table.market.grid")!;
    expect((put[1] as Record<string, unknown>).hidden).toContain("adx");
  }, 10000);

  test("sort and column changes never write filter/sort/column params to the URL", async () => {
    window.history.replaceState({}, "", "/screener?view=table");
    r(() => <MarketScreenerPanel />);

    fireEvent.click(document.getElementById("paper-tanstack-header-day_change")!);
    const params = new URLSearchParams(window.location.search);
    // Only the shell's `?view=` survives; no filter/sort/column param is added.
    expect([...params.keys()].sort()).toEqual(["view"]);
    expect(params.get("view")).toBe("table");
  });
});

describe("MarketScreenerPanel — chart dock outlet layout", () => {
  beforeEach(() => {
    // Wide enough for the inline outlet; the bottom-sheet/fixed-rail fallbacks
    // depend on the other media queries, which must stay false here.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("1400px") || query.includes("1200px"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  test("the row keeps a flex-1 table container and a collapsed outlet while the dock is closed", () => {
    r(() => <MarketScreenerPanel />);

    const grid = screen.getByTestId("market-grid");
    const outlet = screen.getByTestId("chart-dock-outlet");
    const row = outlet.parentElement as HTMLElement;

    const tableContainer = Array.from(row.children).find(
      (child) => child.contains(grid) && (child as HTMLElement).className.includes("flex-1"),
    ) as HTMLElement | undefined;
    expect(tableContainer).toBeDefined();
    expect(tableContainer!.className).toContain("flex-1");

    // The outlet owns its own 38% basis and starts hidden; it must never claim
    // the table's flex-1 space, and the broken :empty utility is gone.
    expect(outlet.className).toContain("basis-[38%]");
    expect(outlet.className).not.toContain("flex-1");
    expect(outlet.className).not.toContain("empty:hidden");
    expect(outlet).toHaveAttribute("data-dock-open", "false");
  });
});

describe("MarketScreenerPanel — universe-aware columns, rail and reset", () => {
  const US_ROWS: MarketRow[] = [
    row("AAPL", {
      exchange: "NASDAQ",
      currency: "USD",
      marketCapCr: null,
      marketCapUsdB: 3200,
    }),
    row("MSFT", {
      exchange: "NASDAQ",
      currency: "USD",
      marketCapCr: null,
      marketCapUsdB: 2800,
    }),
  ];

  const mcapHeader = () =>
    document.getElementById("paper-tanstack-header-market_cap_cr")?.textContent ?? "";

  async function selectUniverse(name: string) {
    const combo = screen.getByTestId("market-universe-select").querySelector(
      '[role="combobox"]',
    ) as HTMLInputElement;
    await fireEvent.focus(combo);
    // `handleSelect` keeps the chosen label as the search query, so a second
    // open is filtered down to just that option. Clear it before picking.
    await fireEvent.input(combo, { target: { value: "" } });
    await fireEvent.mouseDown(await screen.findByRole("option", { name }));
  }

  function setNumber(testId: string, value: string) {
    const input = within(screen.getByTestId(testId)).getByRole("spinbutton") as HTMLInputElement;
    input.value = value;
    fireEvent.input(input);
  }

  async function selectSector(sector: string) {
    const select = screen.getByTestId("market-filter-sector");
    await fireEvent.focus(within(select).getByRole("combobox"));
    const option = await screen.findByRole("option", { name: sector });
    await fireEvent.click(within(option).getByRole("checkbox"));
  }

  test("ticking the ETF tier filters the grid to ETFs", async () => {
    const ETF_ROWS: MarketRow[] = [
      row("NIFTYBEES", {
        name: "Nifty BeES",
        capTier: "etf",
        etf: true,
        marketCapCr: null,
        sector: null,
      }),
      row("GOLDBEES", {
        name: "Gold BeES",
        capTier: "etf",
        etf: true,
        marketCapCr: null,
        sector: null,
      }),
      row("RELIANCE", { capTier: "large", etf: false, marketCapCr: 900000 }),
    ];
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows: ETF_ROWS, total: ETF_ROWS.length }));
    r(() => <MarketScreenerPanel />);

    expect(screen.getByTestId("market-row-NIFTYBEES")).toBeInTheDocument();
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("market-cap-etf"));

    expect(screen.getByTestId("market-filter-chip-capTier:etf")).toHaveTextContent("Cap: ETF");
    expect(screen.getByTestId("market-row-NIFTYBEES")).toBeInTheDocument();
    expect(screen.getByTestId("market-row-GOLDBEES")).toBeInTheDocument();
    expect(screen.queryByTestId("market-row-RELIANCE")).toBeNull();
  });

  test("USA switches the MCAP header to $B and rows to $", async () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows: US_ROWS, total: US_ROWS.length }));
    r(() => <MarketScreenerPanel />);
    expect(mcapHeader()).toContain("MCAP ₹Cr");

    await selectUniverse("USA");

    expect(mcapHeader()).toContain("MCAP $B");
    expect(screen.getByTestId("market-close-AAPL")).toHaveTextContent("$");
    expect(screen.getByTestId("market-mcap-AAPL")).toHaveTextContent("$");
    expect(screen.getByTestId("market-filter-price")).toHaveTextContent("Price $");
  });

  test("USA → All NSE clears unit-bound filters, keeps neutral ones, restores ₹Cr", async () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows: US_ROWS, total: US_ROWS.length }));
    r(() => <MarketScreenerPanel />);

    // F&O is India-only: set it while the toggle exists so entering USA must clear it.
    fireEvent.click(screen.getByTestId("market-filter-fno"));
    expect(screen.getByTestId("market-filter-chip-fno")).toBeInTheDocument();

    await selectUniverse("USA");

    // The US rail has no F&O affordance and no ETF tier — US scan is stock-only.
    expect(screen.queryByTestId("market-filter-fno")).toBeNull();
    expect(screen.queryByTestId("market-cap-etf")).toBeNull();
    expect(screen.queryByTestId("market-filter-chip-fno")).toBeNull();

    fireEvent.click(screen.getByTestId("market-cap-large"));
    setNumber("market-filter-price-min", "100");
    setNumber("market-filter-mcap-min", "100");
    await selectSector("IT");

    // Unit-neutral conditions that must survive the switch.
    setNumber("market-filter-day-min", "-5");
    setNumber("market-filter-rsi-min", "50");
    fireEvent.click(screen.getByTestId("market-filter-above-sma20"));
    const toggle = screen.getByTestId("market-view-toggle");
    await fireEvent.click(within(toggle).getByText("Vis"));
    fireEvent.input(screen.getByTestId("market-map-metric").querySelector("select")!, {
      target: { value: "rsi" },
    });
    await fireEvent.click(within(toggle).getByText("Table"));

    expect(screen.getByTestId("market-filter-chip-capTier:large")).toBeInTheDocument();
    expect(screen.getByTestId("market-filter-chip-price")).toBeInTheDocument();
    expect(screen.getByTestId("market-filter-chip-mcap")).toBeInTheDocument();

    await selectUniverse("All NSE");

    expect(mcapHeader()).toContain("MCAP ₹Cr");
    expect(screen.getByTestId("market-filter-fno")).toBeInTheDocument();
    for (const key of ["capTier:large", "price", "mcap", "sector:IT", "fno"]) {
      expect(screen.queryByTestId(`market-filter-chip-${key}`)).toBeNull();
    }
    // Unit-neutral conditions survive the switch.
    for (const key of ["day", "rsi", "sma20"]) {
      expect(screen.getByTestId(`market-filter-chip-${key}`)).toBeInTheDocument();
    }
    await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Vis"));
    expect(
      (screen.getByTestId("market-map-metric").querySelector("select") as HTMLSelectElement).value,
    ).toBe("rsi");
  });

  test("a saved us config restores its filters without a reset", async () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows: US_ROWS, total: US_ROWS.length }));
    const base = defaultMarketConfig({ universe: "us" });
    mockGetUserConfig.mockResolvedValue({
      scope: "market.filters",
      version: 1,
      saved: true,
      updated_at: "2026-11-15T09:41:22.192Z",
      config: serializeMarketConfig({
        ...base,
        filters: {
          ...base.filters,
          sectors: ["IT"],
          mcapMinCr: 100,
          capTiers: new Set(["large"]),
          rsiMin: 50,
          sort: "relvol_desc",
        },
      }),
    });

    r(() => <MarketScreenerPanel />);

    await waitFor(() =>
      expect(screen.getByTestId("market-filter-chip-sector:IT")).toBeInTheDocument(),
    );
    expect(mcapHeader()).toContain("MCAP $B");
    expect(screen.getByTestId("market-filter-chip-mcap")).toBeInTheDocument();
    expect(screen.getByTestId("market-filter-chip-capTier:large")).toBeInTheDocument();
    expect(screen.getByTestId("market-filter-chip-rsi")).toHaveTextContent("RSI ≥ 50");
    expect(mockUseMarketSnapshot.mock.calls.at(-1)?.[0]()).toBe("us");
    // The reset effect must not fire on a later tick either.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.getByTestId("market-filter-chip-sector:IT")).toBeInTheDocument();
  });

  test("USA chips use $B and US tier thresholds; India chips stay byte-identical", async () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows: US_ROWS, total: US_ROWS.length }));
    r(() => <MarketScreenerPanel />);
    await selectUniverse("USA");

    setNumber("market-filter-mcap-min", "10");
    fireEvent.click(screen.getByTestId("market-cap-large"));

    expect(screen.getByTestId("market-filter-chip-mcap")).toHaveTextContent(/^MCap ≥ 10 B$/);
    expect(screen.getByTestId("market-filter-chip-capTier:large")).toHaveTextContent(
      /^Cap: Large 10–200B$/,
    );
    expect(screen.getByTestId("market-filter-count")).toHaveTextContent("2");

    await selectUniverse("All NSE");
    setNumber("market-filter-mcap-min", "10");
    fireEvent.click(screen.getByTestId("market-cap-large"));

    expect(screen.getByTestId("market-filter-chip-mcap")).toHaveTextContent(/^MCap ≥ 10 Cr$/);
    expect(screen.getByTestId("market-filter-chip-capTier:large")).toHaveTextContent(/^Cap: Large$/);
    expect(screen.getByTestId("market-filter-count")).toHaveTextContent("2");
  });

  test("USA map reads caps in $B, not zero from the India descriptor", async () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows: US_ROWS, total: US_ROWS.length }));
    r(() => <MarketScreenerPanel />);
    await selectUniverse("USA");

    const toggle = screen.getByTestId("market-view-toggle");
    await fireEvent.click(within(toggle).getByText("Vis"));
    // Size by Market Cap: the tile's own label must price a USD row in $B.
    // An INR descriptor reads marketCapCr (null on USD rows) → "0".
    fireEvent.input(screen.getByTestId("market-map-metric").querySelector("select")!, {
      target: { value: "market_cap" },
    });
    await waitFor(() => {
      const option = echartsStub.chart.setOption.mock.calls.at(-1)?.[0] as
        | { series?: Array<{ data?: Array<{ metricValue?: string }> }> }
        | undefined;
      const values = (option?.series?.[0]?.data ?? []).map((d) => d.metricValue ?? "");
      expect(values.some((v) => /\$[\d,.]+B/.test(v))).toBe(true);
    });
    await fireEvent.click(within(toggle).getByText("Table"));
  });
});

describe("MarketScreenerPanel — cap-tier counts follow the loaded rows", () => {
  const INDIA_TIER_ROWS: MarketRow[] = [
    row("RELIANCE", { capTier: "large" }),
    row("MPHASIS", { capTier: "large" }),
    row("TCS", { capTier: "mid" }),
    row("ONGC", { capTier: "small" }),
    row("SMALLCO", { capTier: "micro" }),
  ];
  const US_TIER_ROWS: MarketRow[] = [
    row("AAPL", { exchange: "NASDAQ", currency: "USD", capTier: "mega", marketCapCr: null, marketCapUsdB: 3000 }),
    row("MSFT", { exchange: "NASDAQ", currency: "USD", capTier: "large", marketCapCr: null, marketCapUsdB: 300 }),
    row("NVDA", { exchange: "NASDAQ", currency: "USD", capTier: "large", marketCapCr: null, marketCapUsdB: 100 }),
    row("AVGO", { exchange: "NASDAQ", currency: "USD", capTier: "large", marketCapCr: null, marketCapUsdB: 50 }),
    row("LLY", { exchange: "NYSE", currency: "USD", capTier: "mid", marketCapCr: null, marketCapUsdB: 5 }),
    row("SMALL", { exchange: "NASDAQ", currency: "USD", capTier: "small", marketCapCr: null, marketCapUsdB: 1 }),
  ];

  async function selectUniverse(name: string) {
    const combo = screen.getByTestId("market-universe-select").querySelector(
      '[role="combobox"]',
    ) as HTMLInputElement;
    await fireEvent.focus(combo);
    await fireEvent.input(combo, { target: { value: "" } });
    await fireEvent.mouseDown(await screen.findByRole("option", { name }));
  }

  const rail = () => within(screen.getByTestId("market-filter-rail"));

  test("US rail labels use countByCapTier(US rows), not stale India ranks", async () => {
    const [rows, setRows] = createSignal<MarketRow[]>(INDIA_TIER_ROWS);
    mockUseMarketSnapshot.mockImplementation(() => ({
      ...hookResult(),
      rows: () => rows(),
      total: () => rows().length,
    }));
    r(() => <MarketScreenerPanel />);

    expect(rail().getByText("Large (2)")).toBeInTheDocument();
    expect(rail().getByText("Mid (1)")).toBeInTheDocument();

    await selectUniverse("USA");
    // The US snapshot lands after the tier options switched — exactly the
    // reload path where the rail used to keep printing India's counts.
    setRows(US_TIER_ROWS);

    expect(rail().getByText("Mega ≥200B (1)")).toBeInTheDocument();
    expect(rail().getByText("Large 10–200B (3)")).toBeInTheDocument();
    expect(rail().getByText("Mid 2–10B (1)")).toBeInTheDocument();
    expect(rail().getByText("Small 0.3–2B (1)")).toBeInTheDocument();
    expect(rail().queryByText(/\(100\)|\(150\)|\(250\)|\(2728\)/)).toBeNull();
  });

  test("switching USA → India recomputes the counts from the India rows", async () => {
    const [rows, setRows] = createSignal<MarketRow[]>(US_TIER_ROWS);
    mockUseMarketSnapshot.mockImplementation(() => ({
      ...hookResult(),
      rows: () => rows(),
      total: () => rows().length,
    }));
    r(() => <MarketScreenerPanel />);

    await selectUniverse("USA");
    setRows(US_TIER_ROWS);
    expect(rail().getByText("Large 10–200B (3)")).toBeInTheDocument();

    await selectUniverse("All NSE");
    setRows(INDIA_TIER_ROWS);
    expect(rail().getByText("Large (2)")).toBeInTheDocument();
    expect(rail().queryByText("Mega ≥200B (1)")).toBeNull();
  });
});

describe("MarketScreenerPanel — F&O chip follows the universe's affordance", () => {
  function savedConfig(universe: "us" | "all_equity") {
    const base = defaultMarketConfig({ universe });
    return {
      scope: "market.filters",
      version: 1,
      saved: true,
      updated_at: "2026-11-15T09:41:22.192Z",
      config: serializeMarketConfig({
        ...base,
        filters: { ...base.filters, fnoOnly: true, sectors: ["IT"] },
      }),
    };
  }

  const US_ROWS: MarketRow[] = [
    row("AAPL", { exchange: "NASDAQ", currency: "USD", sector: "IT", marketCapCr: null, marketCapUsdB: 3000 }),
    row("MSFT", { exchange: "NASDAQ", currency: "USD", sector: "IT", marketCapCr: null, marketCapUsdB: 2800 }),
  ];
  const INDIA_ROWS: MarketRow[] = [
    row("RELIANCE", { sector: "IT", fno: true }),
    row("MPHASIS", { sector: "IT", fno: false }),
  ];

  test("a saved US config with fnoOnly:true keeps every US row and shows no F&O chip or toggle", async () => {
    // US rows carry `fno:false` from the backend, so an inherited fnoOnly used
    // to empty the table as well as leave a dead chip in the toolbar.
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows: US_ROWS, total: US_ROWS.length }));
    mockGetUserConfig.mockResolvedValue(savedConfig("us") as never);

    r(() => <MarketScreenerPanel />);

    // Wait for hydration: the sector chip is the positive signal the saved
    // config landed (so this is not a pass-before-hydration false positive).
    await waitFor(() =>
      expect(screen.getByTestId("market-filter-chip-sector:IT")).toBeInTheDocument(),
    );
    expect(screen.queryByTestId("market-filter-chip-fno")).toBeNull();
    expect(screen.queryByTestId("market-filter-fno")).toBeNull();
    expect(screen.getByTestId("market-filter-count")).toHaveTextContent("1");
    expect(screen.getByTestId("market-row-AAPL")).toBeInTheDocument();
    expect(screen.getByTestId("market-row-MSFT")).toBeInTheDocument();
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("2 / 2");
  });

  test("an India config keeps its F&O chip, toggle and filtering", async () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows: INDIA_ROWS, total: INDIA_ROWS.length }));
    mockGetUserConfig.mockResolvedValue(savedConfig("all_equity") as never);

    r(() => <MarketScreenerPanel />);

    await waitFor(() =>
      expect(screen.getByTestId("market-filter-chip-sector:IT")).toBeInTheDocument(),
    );
    expect(screen.getByTestId("market-filter-chip-fno")).toBeInTheDocument();
    expect(screen.getByTestId("market-filter-fno")).toBeInTheDocument();
    expect(screen.getByTestId("market-filter-count")).toHaveTextContent("2");
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
    expect(screen.queryByTestId("market-row-MPHASIS")).toBeNull();
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("1 / 2");
  });
});

describe("MarketScreenerPanel — chart icon routes by exchange", () => {
  const US_CHART_ROWS: MarketRow[] = [
    row("AAPL", { exchange: "NASDAQ", currency: "USD" }),
    row("MSFT", { exchange: "NYSE", currency: "USD" }),
    row("BRK.B", { exchange: "AMEX", currency: "USD" }),
  ];

  beforeEach(() => {
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ rows: US_CHART_ROWS, total: US_CHART_ROWS.length }),
    );
  });

  test("a NASDAQ row navigates to the in-app chart with market=usa", () => {
    r(() => <MarketScreenerPanel />);
    fireEvent.click(screen.getByTestId("market-chart-AAPL"));
    expect(routerMocks.navigate).toHaveBeenCalledWith("/chart/AAPL?market=usa");
  });

  test("NYSE and AMEX rows also use the US chart route", () => {
    r(() => <MarketScreenerPanel />);
    fireEvent.click(screen.getByTestId("market-chart-MSFT"));
    fireEvent.click(screen.getByTestId("market-chart-BRK.B"));
    expect(routerMocks.navigate).toHaveBeenCalledWith("/chart/MSFT?market=usa");
    expect(routerMocks.navigate).toHaveBeenCalledWith("/chart/BRK.B?market=usa");
  });

  test("dots in a US symbol survive the chart URL unchanged", () => {
    r(() => <MarketScreenerPanel />);
    fireEvent.click(screen.getByTestId("market-chart-BRK.B"));
    expect(routerMocks.navigate).toHaveBeenCalledWith("/chart/BRK.B?market=usa");
    expect(routerMocks.navigate).not.toHaveBeenCalledWith("/chart/BRK-B?market=usa");
  });

  test("an India row keeps the dock path and never navigates", () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult());
    const open = vi.fn();
    const dockValue: SymbolDockApi = {
      preview: () => {},
      endPreview: () => {},
      open,
      close: () => {},
      pinned: false,
      setOutlet: () => {},
      symbol: () => null,
      mode: () => "chart",
    };
    render(() => (
      <UIProvider>
        <SymbolDockContext.Provider value={dockValue}>
          <MarketScreenerPanel />
        </SymbolDockContext.Provider>
      </UIProvider>
    ));

    fireEvent.click(screen.getByTestId("market-chart-RELIANCE"));
    expect(open).toHaveBeenCalledWith("RELIANCE");
    expect(routerMocks.navigate).not.toHaveBeenCalled();
  });
});

describe("MarketScreenerPanel — embedded Value view", () => {
  const toggle = () => screen.getByTestId("market-view-toggle");
  const choose = (label: string) => fireEvent.click(within(toggle()).getByText(label));

  const valueRow = (symbol: string, exchange: string): ValueRow => ({
    symbol,
    name: `${symbol} Ltd`,
    exchange,
    currency: "INR",
    price: 100,
    change: 0.5,
    mcap_bn: 10,
    rev_bn: 5,
    pe: 9,
    ps: 1,
    pb: 1,
    fcf_yield: 4,
    div_yield: 1,
    roe: 12,
    gross_margin: 30,
    op_margin: 15,
    rev_yoy: 5,
    eps_yoy: 4,
    debt_to_equity: 0.2,
    current_ratio: 1.5,
    rsi: 45,
    vs_200dma: 1,
    off_52w_high: -10,
    score: 70,
    subscores: { value: 70, quality: 70, growth: 70, health: 70 },
    peer: { bucket: "Banks", pe_median: 11, roe_median: 10, fcf_yield_median: 3 },
    flags: [],
    derived: {
      fcf_yield: 4,
      earnings_yield: 10,
      vs_200dma: 1,
      off_52w_high: -10,
      distorted_pe: false,
    },
  });

  const valueResponse = (rows: ValueRow[]): ValueScanResponse => ({
    market: "india",
    currency: "INR",
    as_of: "2026-11-17T10:00:00+05:30",
    scanned: rows.length,
    matched: rows.length,
    fields_complete: true,
    filters_applied: {},
    warnings: [],
    rows,
    sectors: [],
  });

  const renderWithDock = (open: SymbolDockApi["open"], jsx: () => JSX.Element) => {
    const dockValue: SymbolDockApi = {
      preview: () => {},
      endPreview: () => {},
      open,
      close: () => {},
      pinned: false,
      setOutlet: () => {},
      symbol: () => null,
      mode: () => "chart",
    };
    render(() => (
      <UIProvider>
        <SymbolDockContext.Provider value={dockValue}>{jsx()}</SymbolDockContext.Provider>
      </UIProvider>
    ));
  };

  test("clicking a chart-eligible Value row opens the same symbol dock as the table", async () => {
    const open = vi.fn();
    mockValueScan.mockResolvedValue(valueResponse([valueRow("RELIANCE", "NSE")]));
    renderWithDock(open, () => <MarketScreenerPanel initialView="value" />);
    await screen.findByTestId("value-row-RELIANCE", {}, { timeout: 3000 });

    fireEvent.click(screen.getByTestId("value-row-RELIANCE"));

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith("RELIANCE");
    expect(routerMocks.navigate).not.toHaveBeenCalled();
    expect(screen.queryByTestId("value-detail-RELIANCE")).not.toBeInTheDocument();
  });

  test("a Value row with no in-app chart keeps its detail drawer and never opens the dock", async () => {
    const open = vi.fn();
    mockValueScan.mockResolvedValue(valueResponse([valueRow("VOD", "LSE")]));
    renderWithDock(open, () => <MarketScreenerPanel initialView="value" />);
    await screen.findByTestId("value-row-VOD", {}, { timeout: 3000 });

    fireEvent.click(screen.getByTestId("value-row-VOD"));

    expect(open).not.toHaveBeenCalled();
    expect(screen.getByTestId("value-detail-VOD")).toBeInTheDocument();
  });

  test("initialView=value starts in the Value view", async () => {
    r(() => <MarketScreenerPanel initialView="value" />);
    expect(await screen.findByTestId("value-panel", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.queryByTestId("market-search")).not.toBeInTheDocument();
  });

  test("the Value button renders the panel and hides the Market-only chrome", async () => {
    r(() => <MarketScreenerPanel />);
    expect(screen.getByTestId("market-search")).toBeInTheDocument();

    await choose("Value");

    expect(await screen.findByTestId("value-panel", {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByTestId("market-value-region")).toBeInTheDocument();
    // The embedded panel has no second market selector: the Market universe
    // select stays as the single source of truth.
    expect(screen.getByTestId("market-universe-select")).toBeInTheDocument();
    expect(screen.queryByTestId("value-market-tabs")).not.toBeInTheDocument();
    for (const id of [
      "market-search",
      "market-filter-rail",
      "market-rail-toggle",
      "market-grid",
      "market-refresh",
      "market-mode-badge",
      "market-active-chips",
    ]) {
      expect(screen.queryByTestId(id)).not.toBeInTheDocument();
    }
    expect(within(toggle()).getByText("Value").closest("button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("the active Market universe drives the value scan market", async () => {
    r(() => <MarketScreenerPanel />);
    await choose("Value");
    await screen.findByTestId("value-panel", {}, { timeout: 3000 });
    await waitFor(() =>
      expect(mockValueScan).toHaveBeenCalledWith(
        expect.objectContaining({ market: "india" }),
        expect.anything(),
      ),
    );

    const combo = screen.getByTestId("market-universe-select").querySelector(
      '[role="combobox"]',
    ) as HTMLInputElement;
    await fireEvent.focus(combo);
    await fireEvent.mouseDown(await screen.findByRole("option", { name: "USA" }));

    await waitFor(
      () =>
        expect(mockValueScan).toHaveBeenCalledWith(
          expect.objectContaining({ market: "usa" }),
          expect.anything(),
        ),
      { timeout: 3000 },
    );
  });

  test("switching back restores the Market table with its filters intact", async () => {
    r(() => <MarketScreenerPanel />);
    fireEvent.click(screen.getByTestId("market-filter-above-sma200"));
    expect(screen.getByTestId("market-filter-chip-sma200")).toBeInTheDocument();
    const grid = screen.getByTestId("market-grid");

    await choose("Value");
    await screen.findByTestId("value-panel", {}, { timeout: 3000 });
    expect(screen.queryByTestId("market-grid")).not.toBeInTheDocument();

    await choose("Table");
    expect(screen.getByTestId("market-search")).toBeInTheDocument();
    expect(screen.getByTestId("market-filter-chip-sma200")).toBeInTheDocument();
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
    // The Market grid itself is remounted after the Value detour, so identity
    // is not asserted here — only that its data and filters came back.
    expect(grid.isConnected).toBe(false);
  });

  test("the Value view uses the shared view contract and restores search on return", async () => {
    const onViewChange = vi.fn();
    r(() => <MarketScreenerPanel onViewChange={onViewChange} />);
    const search = screen.getByTestId("market-search") as HTMLInputElement;
    fireEvent.input(search, { target: { value: "reliance" } });

    await choose("Value");
    await screen.findByTestId("value-panel", {}, { timeout: 3000 });
    expect(onViewChange).toHaveBeenCalledWith("value");

    await choose("Table");
    expect(onViewChange).toHaveBeenLastCalledWith("table");
    expect((screen.getByTestId("market-search") as HTMLInputElement).value).toBe("reliance");
  });
});

describe("MarketScreenerPanel — market snapshot gating in Value view", () => {
  // The real hook fetches only while `enabled()` is true (proved in
  // useMarketSnapshotSolid.test.tsx), so this getter is the 0-vs-1 request boundary.
  const enabledForFirstCall = () =>
    mockUseMarketSnapshot.mock.calls[0]?.[1]?.enabled?.() as boolean | undefined;

  test("Value view disables the market snapshot (zero market requests)", async () => {
    r(() => <MarketScreenerPanel initialView="value" />);
    await screen.findByTestId("value-panel", {}, { timeout: 3000 });

    expect(enabledForFirstCall()).toBe(false);
    expect(screen.getByTestId("market-value-region")).toBeInTheDocument();
  });

  test("switching Value → Table re-enables the market snapshot (one market request)", async () => {
    r(() => <MarketScreenerPanel initialView="value" />);
    await screen.findByTestId("value-panel", {}, { timeout: 3000 });
    expect(enabledForFirstCall()).toBe(false);

    await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Table"));

    expect(screen.getByTestId("market-search")).toBeInTheDocument();
    expect(enabledForFirstCall()).toBe(true);
  });

  test("switching universe inside Value keeps the market snapshot disabled", async () => {
    r(() => <MarketScreenerPanel initialView="value" />);
    await screen.findByTestId("value-panel", {}, { timeout: 3000 });
    expect(enabledForFirstCall()).toBe(false);

    const combo = screen.getByTestId("market-universe-select").querySelector(
      '[role="combobox"]',
    ) as HTMLInputElement;
    await fireEvent.focus(combo);
    await fireEvent.mouseDown(await screen.findByRole("option", { name: "USA" }));

    await waitFor(() =>
      expect(mockValueScan).toHaveBeenCalledWith(
        expect.objectContaining({ market: "usa" }),
        expect.anything(),
      ),
    );
    expect(enabledForFirstCall()).toBe(false);
  });
});

describe("MarketScreenerPanel — wire format", () => {
  const wireOption = () =>
    mockUseMarketSnapshot.mock.calls[0]?.[1] as { wireFormat?: string } | undefined;

  test("defaults to the columnar layout", () => {
    r(() => <MarketScreenerPanel />);
    expect(wireOption()?.wireFormat).toBe("columns");
  });

  test("?wire=json requests the legacy JSON envelope instead", () => {
    window.history.replaceState({}, "", "/?tab=market&wire=json");
    r(() => <MarketScreenerPanel />);
    expect(wireOption()?.wireFormat).toBeUndefined();
  });

  test("an explicit prop wins over the query string", () => {
    window.history.replaceState({}, "", "/?wire=json");
    r(() => <MarketScreenerPanel wireFormat="columns" />);
    expect(wireOption()?.wireFormat).toBe("columns");
  });

  test("wireFormat='json' forces the legacy envelope", () => {
    r(() => <MarketScreenerPanel wireFormat="json" />);
    expect(wireOption()?.wireFormat).toBeUndefined();
  });
});

describe("MarketScreenerPanel — wait for saved config before the first snapshot", () => {
  test("does not enable the table fetch until market.filters settles", async () => {
    let resolveConfig: (value: unknown) => void = () => {};
    mockGetUserConfig.mockReturnValue(
      new Promise((resolve) => {
        resolveConfig = resolve;
      }) as never,
    );
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ rows: [], total: 0, snapshot: null, isLoading: false }),
    );

    r(() => <MarketScreenerPanel />);

    const options = mockUseMarketSnapshot.mock.calls[0]?.[1] as
      | { enabled?: () => boolean }
      | undefined;
    expect(options?.enabled?.()).toBe(false);
    expect(screen.getByTestId("market-skeleton")).toBeInTheDocument();
    expect(mockUseMarketSnapshot).toHaveBeenCalledTimes(1);

    resolveConfig({
      scope: "market.filters",
      version: 1,
      saved: false,
      updated_at: null,
      config: serializeMarketConfig(defaultMarketConfig()),
    });

    await waitFor(() => expect(options?.enabled?.()).toBe(true));
    expect(mockUseMarketSnapshot).toHaveBeenCalledTimes(1);
  });
});

describe("MarketScreenerPanel — manual refresh is a forced scan", () => {
  test("the refresh button asks the hook to bypass the server cache", async () => {
    const refresh = vi.fn();
    mockUseMarketSnapshot.mockReturnValue(hookResult({ refresh }));
    r(() => <MarketScreenerPanel />);

    await waitFor(() => expect(screen.getByTestId("market-refresh")).not.toBeDisabled());
    fireEvent.click(screen.getByTestId("market-refresh"));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledWith(true);
  });

  test("the refresh button stays disabled while a fetch is in flight", () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ isLoading: true }));
    r(() => <MarketScreenerPanel />);

    expect(screen.getByTestId("market-refresh")).toBeDisabled();
  });

  test("the error retries stay unforced so they reuse the server cache", async () => {
    const refresh = vi.fn();
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ rows: [], total: 0, snapshot: null, error: new Error("boom"), refresh }),
    );
    r(() => <MarketScreenerPanel />);

    await waitFor(() => expect(screen.getByTestId("market-retry")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("market-retry"));

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(refresh.mock.calls[0][0]).not.toBe(true);
  });
});

describe("MarketScreenerPanel — map sizing metric (colorBy wire field)", () => {
  const metricValue = () =>
    (screen.getByTestId("market-map-metric").querySelector("select") as HTMLSelectElement).value;
  const savedColorByIs = (value: string): boolean =>
    mockPutUserConfig.mock.calls.some(
      ([scope, config]) =>
        scope === "market.filters" && (config as Record<string, unknown>).colorBy === value,
    );
  const backToTable = () =>
    fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Table"));

  test("a saved colorBy restores into the map's metric select after hydration", async () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows: ROWS, total: ROWS.length }));
    mockGetUserConfig.mockResolvedValue({
      scope: "market.filters",
      version: 1,
      saved: true,
      updated_at: "2026-11-15T09:41:22.192Z",
      config: serializeMarketConfig({
        ...defaultMarketConfig({ universe: "nifty500" }),
        view: "vis",
        colorBy: "rsi",
      }),
    });

    r(() => <MarketScreenerPanel />);
    await screen.findByTestId("market-map");

    // The restored colour wins over the sort-derived seed (mcap_desc ->
    // market_cap). A select still on market_cap means colorBy never reached the
    // map.
    await waitFor(() => expect(metricValue()).toBe("rsi"));
    await backToTable();
  });

  test("changing the colour metric persists it in the saved market config", async () => {
    r(() => <MarketScreenerPanel />);
    await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Vis"));

    fireEvent.input(screen.getByTestId("market-map-metric").querySelector("select")!, {
      target: { value: "rsi" },
    });

    await waitFor(() => expect(savedColorByIs("rsi")).toBe(true), { timeout: 4000 });
    await backToTable();
  }, 10000);

  test("changing the colour metric never refetches the snapshot", async () => {
    const refresh = vi.fn();
    mockUseMarketSnapshot.mockReturnValue(hookResult({ refresh }));
    r(() => <MarketScreenerPanel />);

    const snapshotOptions = mockUseMarketSnapshot.mock.calls[0]?.[1] as
      | { enabled?: () => boolean }
      | undefined;
    await waitFor(() => expect(snapshotOptions?.enabled?.()).toBe(true));
    const callsAfterHydration = mockUseMarketSnapshot.mock.calls.length;

    await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Vis"));
    fireEvent.input(screen.getByTestId("market-map-metric").querySelector("select")!, {
      target: { value: "relative_volume" },
    });

    // Wiring proof first: the choice must actually reach the panel (fails on
    // unwired code), otherwise a no-refetch assertion passes trivially.
    await waitFor(() => expect(savedColorByIs("relative_volume")).toBe(true), { timeout: 4000 });

    // Colour is a pure paint change: the enabled gate and the hook subscription
    // stay put, and no forced refresh is issued.
    expect(snapshotOptions?.enabled?.()).toBe(true);
    expect(mockUseMarketSnapshot).toHaveBeenCalledTimes(callsAfterHydration);
    expect(refresh).not.toHaveBeenCalled();
    await backToTable();
  }, 10000);
});

describe("MarketScreenerPanel — one hoisted Size by control in Vis mode", () => {
  const openVis = async () => {
    r(() => <MarketScreenerPanel />);
    await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Vis"));
  };
  const sizeSelect = () =>
    screen.getByTestId("market-map-metric").querySelector("select") as HTMLSelectElement;
  const lastOption = () =>
    echartsStub.chart.setOption.mock.calls.at(-1)?.[0] as
      | { series?: Array<{ data?: Array<{ metricLabel?: string; children?: Array<{ metricLabel?: string }> }> }> }
      | undefined;
  const switchViz = async (label: string) => {
    await fireEvent.click(within(screen.getByTestId("market-vis-selector")).getByText(label));
  };

  test("exactly one Size by control lives in the Vis toolbar and drives both renderers", async () => {
    await openVis();
    expect(screen.getAllByTestId("market-map-metric")).toHaveLength(1);
    expect(
      within(screen.getByTestId("market-vis-toolbar")).getByTestId("market-map-metric"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("market-map-toolbar").querySelectorAll("select")).toHaveLength(0);

    fireEvent.input(sizeSelect(), { target: { value: "rsi" } });
    await waitFor(() => expect(lastOption()?.series?.[0]?.data?.[0]?.metricLabel).toBe("RSI"));

    await switchViz("Sector treemap");
    expect(screen.getByTestId("market-sector-map-view")).toBeInTheDocument();
    expect(screen.getAllByTestId("market-map-metric")).toHaveLength(1);
    await waitFor(() =>
      expect(lastOption()?.series?.[0]?.data?.[0]?.children?.[0]?.metricLabel).toBe("RSI"),
    );
  });

  test("the selected size survives a viz switch", async () => {
    await openVis();
    fireEvent.input(sizeSelect(), { target: { value: "market_cap" } });
    expect(sizeSelect().value).toBe("market_cap");

    await switchViz("Sector treemap");
    expect(screen.getByTestId("market-sector-map-view")).toBeInTheDocument();
    expect(sizeSelect().value).toBe("market_cap");

    await switchViz("Heatmap");
    expect(screen.getByTestId("market-map-view")).toBeInTheDocument();
    expect(sizeSelect().value).toBe("market_cap");
  });
});

describe("MarketScreenerPanel — Vis toolbar at phone width (390px)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  function phoneViewport() {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes(`max-width: ${NARROW_TREEMAP_MAX_WIDTH - 1}px`),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }

  async function openVisAt390() {
    phoneViewport();
    r(() => <MarketScreenerPanel />);
    await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Vis"));
    return screen.getByTestId("market-vis-toolbar");
  }

  test("renders one viz selector and one Size by control, wrapping without a fixed row height", async () => {
    const toolbar = await openVisAt390();
    expect(within(toolbar).getAllByTestId("market-vis-selector")).toHaveLength(1);
    expect(within(toolbar).getAllByTestId("market-map-metric")).toHaveLength(1);
    // Wrapping (not clipping) is what keeps the controls from colliding on a
    // phone; the fixed 36px row is what used to overlap mid-word labels.
    expect(toolbar).toHaveClass("flex-wrap");
    expect(toolbar).not.toHaveClass("flex-nowrap");
    expect(toolbar).not.toHaveClass("h-9");
    expect(within(toolbar).queryByText("Visualization")).toBeNull();
    const sizeLabel = within(toolbar).getByText("Size by");
    expect(sizeLabel).toBeInTheDocument();
    expect(sizeLabel).toHaveClass("whitespace-nowrap");
  });

  test("the wide toolbar keeps its single row, helper label and one Size by control", async () => {
    r(() => <MarketScreenerPanel />);
    await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Vis"));
    const toolbar = screen.getByTestId("market-vis-toolbar");
    expect(within(toolbar).getByText("Visualization")).toBeInTheDocument();
    expect(toolbar).toHaveClass("h-9");
    expect(within(toolbar).getAllByTestId("market-map-metric")).toHaveLength(1);
    expect(within(toolbar).getAllByTestId("market-vis-selector")).toHaveLength(1);
  });
});

