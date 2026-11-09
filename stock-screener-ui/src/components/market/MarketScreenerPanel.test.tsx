// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { act, fireEvent, render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi, beforeEach, afterEach } from "vitest";
import { UIProvider } from "@/ui";
import { MarketScreenerPanel } from "./MarketScreenerPanel";
import { useMarketSnapshot } from "../../hooks/useMarketSnapshot";
import * as marketFilters from "./marketFilters";
import type { MarketRow } from "../../types/marketScreener";
import type { UseMarketSnapshotResult } from "../../hooks/useMarketSnapshot";

vi.mock("../../hooks/useMarketSnapshot", () => ({
  useMarketSnapshot: vi.fn(),
}));

const mockUseMarketSnapshot = vi.mocked(useMarketSnapshot);

function row(symbol: string): MarketRow {
  return {
    symbol,
    name: `${symbol} Ltd`,
    sector: "IT",
    industry: null,
    exchange: "NSE",
    close: 100,
    change: 1,
    volume: 100000,
    relativeVolume: 1.0,
    marketCap: 10000000000,
    marketCapCr: 1000,
    capTier: "mid",
    rsi: 50,
    adx: 20,
    atr: 2,
    sma20: 90,
    sma50: 85,
    sma200: 70,
    perfW: 1,
    perf1m: 2,
    perf3m: 3,
    high52w: 120,
    low52w: 60,
    pos52w: 66,
    fno: false,
    etf: false,
  };
}

const ROWS: MarketRow[] = [row("RELIANCE"), row("MPHASIS")];

function hookResult(overrides: Partial<UseMarketSnapshotResult> = {}): UseMarketSnapshotResult {
  return {
    snapshot: {
      asOf: new Date().toISOString(),
      universe: "all_equity",
      total: ROWS.length,
      updateMode: "streaming",
      rows: ROWS,
    },
    rows: ROWS,
    total: ROWS.length,
    updateMode: "streaming",
    asOf: new Date().toISOString(),
    isLoading: false,
    error: null,
    refresh: vi.fn(),
    lastUpdated: new Date().toISOString(),
    stale: false,
    warming: false,
    ...overrides,
  };
}

function r(jsx: React.ReactElement) {
  return render(<UIProvider>{jsx}</UIProvider>);
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
    const user = userEvent.setup();
    await user.click(
      screen.getByTestId("market-universe-select").querySelector('[role="combobox"]') as HTMLElement,
    );
    await user.click(await screen.findByRole("option", { name: "Nifty 500" }));
    expect(screen.queryByTestId("market-warming-hint")).not.toBeInTheDocument();
    expect(mockUseMarketSnapshot).toHaveBeenLastCalledWith("nifty500");
  });

  test("warming-hint switch button jumps to Nifty 500", async () => {
    mockUseMarketSnapshot.mockReturnValue(
      hookResult({ rows: [], total: 0, snapshot: null, isLoading: true, warming: true }),
    );
    r(<MarketScreenerPanel />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId("market-warming-switch"));
    expect(mockUseMarketSnapshot).toHaveBeenLastCalledWith("nifty500");
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
    act(() => {
      fireEvent.click(sma200);
    });

    // Immediate path: chip and active-filter count reflect the click within the
    // same synchronous render — no waiting for a transition.
    expect(screen.getByTestId("market-filter-chip-sma200")).toBeInTheDocument();
    expect(screen.getByTestId("market-filter-count")).toHaveTextContent("1");
    // The table is deliberately NOT recomputed yet — the deferred copy of the
    // filters still drives `filteredRows`, so a click never blocks on
    // re-rendering the full row set.
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("496 / 496");
    expect(screen.getByTestId("market-row-SYM001")).toBeInTheDocument();

    // `filterMarketRows` is not re-invoked by further non-filter interaction:
    // no synchronous 496-row filter pass blocks the UI. (The deferred render is
    // committed by React's scheduler in the browser; happy-dom does not process
    // that scheduler work, so the test covers the synchronous guarantee above.)
    const filterSpy = vi.spyOn(marketFilters, "filterMarketRows");
    act(() => {
      fireEvent.click(screen.getByTestId("market-rail-toggle"));
    });
    expect(filterSpy.mock.calls.length).toBe(0);
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("496 / 496");
  });

  test("non-filter interactions do not re-run the filter pipeline", () => {
    const rows = buildBenchRows(496);
    mockUseMarketSnapshot.mockReturnValue(hookResult({ rows, total: rows.length }));
    const filterSpy = vi.spyOn(marketFilters, "filterMarketRows");
    r(<MarketScreenerPanel />);

    const callsBefore = filterSpy.mock.calls.length;
    expect(callsBefore).toBeGreaterThan(0);

    act(() => {
      fireEvent.click(screen.getByTestId("market-rail-toggle"));
    });

    expect(filterSpy.mock.calls.length).toBe(callsBefore);
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("496 / 496");
  });
});
