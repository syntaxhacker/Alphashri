// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, cleanup, within, waitFor } from "@solidjs/testing-library";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import type { JSX } from "solid-js";
import { UIProvider } from "@/ui";
import {
  MarketScreenerPanel,
  marketSortToSortEntry,
  sortEntryToMarketSort,
} from "./MarketScreenerPanel";
import { useMarketSnapshotSolid } from "./useMarketSnapshotSolid";
import { fetchScreenerDashboard } from "../../api/screenerDashboard";
import { getUserConfig, putUserConfig, deleteUserConfig } from "../../api/userConfigs";
import * as marketFilters from "./marketFilters";
import { defaultMarketConfig, serializeMarketConfig } from "./useMarketConfig";
import type { MarketRow } from "../../types/marketScreener";
import type { ScreenerDashboardResponse } from "../../types/screenerDashboard";

vi.mock("./useMarketSnapshotSolid", () => ({
  useMarketSnapshotSolid: vi.fn(),
}));

vi.mock("../../api/screenerDashboard", () => ({
  fetchScreenerDashboard: vi.fn(),
}));

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
vi.mock("../../utils/loadEcharts", () => {
  const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn() };
  return { loadEcharts: vi.fn(async () => ({ init: vi.fn(() => chart) })) };
});

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
  refresh?: () => void;
  lastUpdated?: string | null;
  stale?: boolean;
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

  test("timeout error with no rows shows the error panel", () => {
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ rows: [], total: 0, snapshot: null, isLoading: false, error: new Error("Market snapshot timed out") }),
    );
    r(() => <MarketScreenerPanel />);
    expect(screen.getByTestId("market-error")).toBeInTheDocument();
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
    // t0: the snapshot is fresh, so no badge and the table is up.
    expect(screen.queryByTestId("market-stale-badge")).not.toBeInTheDocument();
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();

    // Advance 16 minutes with no new data: the badge must appear on its own.
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
    // Focus is inside the drawer, not left on the toolbar behind it.
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

describe("MarketScreenerPanel — the sort control lives on the map", () => {
  test("the rail offers sectors only; the map owns the sort", async () => {
    r(() => <MarketScreenerPanel />);
    const rail = screen.getByTestId("market-filter-rail");
    expect(within(rail).queryByTestId("market-filter-sort")).toBeNull();
    expect(within(rail).getByTestId("market-filter-sector")).toBeInTheDocument();

    await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Map"));
    expect(screen.getByTestId("market-map-sort")).toBeInTheDocument();
    await fireEvent.click(within(screen.getByTestId("market-view-toggle")).getByText("Table"));
  });

  test("changing the map sort updates filters.sort and the map's colour", async () => {
    const rows = [
      row("RELIANCE", { marketCapCr: 1_000_000, rsi: 20 }),
      row("MPHASIS", { marketCapCr: 10_000, rsi: 80 }),
    ];
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows, total: rows.length }));
    r(() => <MarketScreenerPanel />);
    const toggle = screen.getByTestId("market-view-toggle");
    await fireEvent.click(within(toggle).getByText("Map"));

    const metric = () =>
      (screen.getByTestId("market-map-metric").querySelector("select") as HTMLSelectElement).value;
    const sortValue = () =>
      (screen.getByTestId("market-map-sort").querySelector("select") as HTMLSelectElement).value;
    expect(metric()).toBe("market_cap");

    fireEvent.input(screen.getByTestId("market-map-sort").querySelector("select")!, {
      target: { value: "rsi_desc" },
    });
    // One owner: filters.sort. The sort select and the colour both read it back.
    expect(sortValue()).toBe("rsi_desc");
    expect(metric()).toBe("rsi");

    // Rendered table order is NOT asserted here: TanStackTable re-sorts whatever
    // array it receives by its own `initialState` (market_cap_cr desc), so a row
    // order assertion would pass with or without this wiring. Header sort →
    // filters.sort is a separate task; until then filters.sort drives the map's
    // colour only.
    await fireEvent.click(within(toggle).getByText("Table"));
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
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

    // and back to Movers: the lazy branch remounts cleanly
    await fireEvent.click(screen.getByRole("button", { name: "Movers" }));
    expect(await screen.findByTestId("screener-dashboard")).toBeInTheDocument();
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

    await fireEvent.click(within(toggle).getByText("Map"));
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
    await fireEvent.click(within(toggle).getByText("Map"));
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

    r(() => <MarketScreenerPanel initialView="map" />);

    await waitFor(() =>
      expect(screen.getByTestId("market-filter-chip-sector:IT")).toBeInTheDocument(),
    );
    // `table` renders too (hidden), so assert the toggle's pressed state.
    const toggle = screen.getByTestId("market-view-toggle");
    expect(within(toggle).getByText("Map").closest("button")?.getAttribute("aria-pressed")).toBe(
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

    // The saved IT/rsi never applied over the user's clearing.
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
    // Failure never blanks the table or reverts the click.
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
  const mapSortValue = () =>
    (screen.getByTestId("market-map-sort").querySelector("select") as HTMLSelectElement).value;

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

  test("choosing day_asc in the map drives the table to day_change ascending", async () => {
    r(() => <MarketScreenerPanel />);
    const toggle = screen.getByTestId("market-view-toggle");
    await fireEvent.click(within(toggle).getByText("Map"));

    fireEvent.input(screen.getByTestId("market-map-sort").querySelector("select")!, {
      target: { value: "day_asc" },
    });
    await fireEvent.click(within(toggle).getByText("Table"));

    expect(header("day_change")).toHaveAttribute("aria-sort", "ascending");
    await waitFor(() =>
      expect(rowOrder()).toEqual(["market-row-BIGCAP", "market-row-MIDCAP", "market-row-SMALLCAP"]),
    );
    await waitFor(
      () =>
        expect(
          mockPutUserConfig.mock.calls.some(([scope]) => scope === "table.market.grid"),
        ).toBe(true),
      { timeout: 4000 },
    );
  });

  test("a header click persists the sort and mirrors it into the map dropdown", async () => {
    r(() => <MarketScreenerPanel />);
    await waitFor(() => expect(rowOrder()[0]).toBe("market-row-BIGCAP"));

    fireEvent.click(header("day_change")!);
    expect(rowOrder()[0]).toBe("market-row-SMALLCAP");
    expect(header("day_change")).toHaveAttribute("aria-sort", "descending");

    const toggle = screen.getByTestId("market-view-toggle");
    await fireEvent.click(within(toggle).getByText("Map"));
    await waitFor(() => expect(mapSortValue()).toBe("day_desc"));
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

