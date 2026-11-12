// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, cleanup } from "@solidjs/testing-library";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { UIProvider } from "@/ui";
import { MarketScreenerPanel } from "./MarketScreenerPanel";
import { useMarketSnapshotSolid } from "./useMarketSnapshotSolid";
import * as marketFilters from "./marketFilters";
import type { MarketRow } from "../../types/marketScreener";

vi.mock("./useMarketSnapshotSolid", () => ({
  useMarketSnapshotSolid: vi.fn(),
}));

const mockUseMarketSnapshot = vi.mocked(useMarketSnapshotSolid);

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

function r(jsx: JSX.Element) {
  return render(() => (<UIProvider>{jsx}</UIProvider>));
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  mockUseMarketSnapshot.mockReturnValue(hookResult());
});

describe("MarketScreenerPanel — stale cache, warming hint, timeout", () => {
  test("shows rows with a Stale badge while serving the cached snapshot", () => {
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ stale: true, isLoading: true }),
    );
    r(<MarketScreenerPanel />);
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("market-stale-badge")).toBeInTheDocument();
    expect(screen.queryByTestId("market-warming-hint")).not.toBeInTheDocument();
  });

  test("a fresh snapshot clears the Stale badge", () => {
    mockUseMarketSnapshot.mockReturnValue(hookResult({ stale: false }));
    r(<MarketScreenerPanel />);
    expect(screen.queryByTestId("market-stale-badge")).not.toBeInTheDocument();
  });

  test("warming hint is shown for All NSE while the skeleton is up", () => {
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ rows: [], total: 0, snapshot: null, isLoading: true, warming: true }),
    );
    r(<MarketScreenerPanel />);
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
    r(<MarketScreenerPanel />);
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
    r(<MarketScreenerPanel />);
        await fireEvent.click(screen.getByTestId("market-warming-switch"));
    expect(mockUseMarketSnapshot.mock.calls.at(-1)?.[0]()).toBe("nifty500");
  });

  test("timeout error with no rows shows the error panel", () => {
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ rows: [], total: 0, snapshot: null, isLoading: false, error: new Error("Market snapshot timed out") }),
    );
    r(<MarketScreenerPanel />);
    expect(screen.getByTestId("market-error")).toBeInTheDocument();
    expect(screen.getByTestId("market-error-message")).toHaveTextContent("Market snapshot timed out");
    expect(screen.queryByTestId("market-skeleton")).not.toBeInTheDocument();
  });

  test("timeout error with cached rows keeps the grid and shows a retry banner", () => {
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ error: new Error("Market snapshot timed out"), isLoading: false }),
    );
    r(<MarketScreenerPanel />);
    expect(screen.getByTestId("market-grid")).toBeInTheDocument();
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
    expect(screen.getByTestId("market-error-banner-message")).toHaveTextContent(
      "Market snapshot timed out",
    );
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
    r(<MarketScreenerPanel />);

    expect(screen.getByTestId("market-grid")).toBeInTheDocument();
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("496 / 496");
    expect(screen.queryByTestId("market-filter-count")).toBeNull();

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
    expect(screen.getByTestId("market-filter-count")).toHaveTextContent("1");
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
    r(<MarketScreenerPanel />);

    const callsBefore = filterSpy.mock.calls.length;
    expect(callsBefore).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId("market-rail-toggle"));

    expect(filterSpy.mock.calls.length).toBe(callsBefore);
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("496 / 496");
  });
});
