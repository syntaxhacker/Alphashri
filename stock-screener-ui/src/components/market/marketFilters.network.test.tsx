// @vitest-environment happy-dom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, cleanup, waitFor } from "@solidjs/testing-library";
import { createComponent, type JSX } from "solid-js";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { UIProvider } from "@/ui";
import { MarketScreenerPanel } from "./MarketScreenerPanel";
import { useMarketSnapshotSolid } from "./useMarketSnapshotSolid";
import { fetchScreenerDashboard } from "../../api/screenerDashboard";
import { valueScan } from "../../api/valueScan";
import { getUserConfig, putUserConfig, deleteUserConfig } from "../../api/userConfigs";
import { defaultMarketConfig, serializeMarketConfig } from "./useMarketConfig";
import type { MarketRow } from "../../types/marketScreener";

vi.mock("@solidjs/router", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useNavigate: () => vi.fn() };
});

vi.mock("./useMarketSnapshotSolid", () => ({ useMarketSnapshotSolid: vi.fn() }));
vi.mock("../../api/screenerDashboard", () => ({ fetchScreenerDashboard: vi.fn() }));
vi.mock("../../api/valueScan", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/valueScan")>();
  return { ...actual, valueScan: vi.fn() };
});
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
const mockLookupPatterns = vi.hoisted(() => vi.fn());
vi.mock("../../api/patternLookup", () => ({
  PATTERN_LOOKUP_MAX_SYMBOLS: 500,
  lookupPatterns: mockLookupPatterns,
}));
vi.mock("../../utils/loadEcharts", () => ({
  loadEcharts: vi.fn(async () => ({
    init: vi.fn(() => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn(), on: vi.fn() })),
  })),
}));

const mockUseMarketSnapshot = vi.mocked(useMarketSnapshotSolid);
const mockFetchDashboard = vi.mocked(fetchScreenerDashboard);
const mockValueScan = vi.mocked(valueScan);
const mockGetUserConfig = vi.mocked(getUserConfig);
const mockPutUserConfig = vi.mocked(putUserConfig);
const mockDeleteUserConfig = vi.mocked(deleteUserConfig);

function row(symbol: string, overrides: Partial<MarketRow> = {}): MarketRow {
  return {
    symbol,
    name: `${symbol} Ltd`,
    sector: "IT",
    exchange: "NSE",
    close: 100,
    change: 1,
    relativeVolume: 1,
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

const ROWS: MarketRow[] = [row("CHEAP", { peRatio: 12 }), row("PRICEY", { peRatio: 40 })];

function r(jsx: () => JSX.Element) {
  return render(() => createComponent(UIProvider, { children: jsx() }));
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  const refresh = vi.fn();
  mockUseMarketSnapshot.mockReturnValue({
    snapshot: () => ({ asOf: new Date().toISOString(), total: ROWS.length, rows: ROWS }),
    rows: () => ROWS,
    total: () => ROWS.length,
    updateMode: () => "streaming",
    asOf: () => new Date().toISOString(),
    isLoading: () => false,
    error: () => null,
    refresh,
    lastUpdated: () => new Date().toISOString(),
    stale: () => false,
    ageSec: () => null,
    warming: () => false,
  } as never);
  mockFetchDashboard.mockResolvedValue({
    sections: [],
    universe: "nifty500",
    as_of: new Date().toISOString(),
    total: 0,
  } as never);
  mockValueScan.mockResolvedValue({
    market: "india",
    currency: "INR",
    as_of: "2026-11-17T10:00:00+05:30",
    scanned: 500,
    matched: 0,
    fields_complete: true,
    filters_applied: {},
    warnings: [],
    rows: [],
    sectors: [],
  } as never);
  mockLookupPatterns.mockResolvedValue({
    timeframe: "1D",
    session: "2026-11-16",
    source: "stored",
    data_through: "2026-11-14",
    items: [],
  });
  mockGetUserConfig.mockResolvedValue({
    scope: "market.filters",
    version: 1,
    saved: false,
    updated_at: null,
    config: serializeMarketConfig(defaultMarketConfig()),
  } as never);
  mockPutUserConfig.mockImplementation(async (_scope, config) => ({
    scope: "market.filters",
    version: 1,
    saved: true,
    updated_at: "2026-11-15T09:41:22.192Z",
    config,
  }) as never);
  mockDeleteUserConfig.mockResolvedValue({ scope: "market.filters", deleted: true } as never);
});

describe("value filters are local to the cached snapshot", () => {
  test("changing a value bound never refetches data — it filters the loaded rows", async () => {
    r(() => <MarketScreenerPanel />);
    await waitFor(() => expect(mockLookupPatterns).toHaveBeenCalled());

    const refresh = mockUseMarketSnapshot.mock.results.at(-1)?.value.refresh as ReturnType<
      typeof vi.fn
    >;
    const callsBefore = {
      snapshotHook: mockUseMarketSnapshot.mock.calls.length,
      refresh: refresh.mock.calls.length,
      dashboard: mockFetchDashboard.mock.calls.length,
      valueScan: mockValueScan.mock.calls.length,
      configGet: mockGetUserConfig.mock.calls.length,
    };

    fireEvent.click(screen.getByTestId("market-value-toggle"));
    fireEvent.input(screen.getByTestId("market-filter-peMax-input"), { target: { value: "15" } });

    // Filtering happened locally, against the snapshot already in memory.
    expect(screen.getByTestId("market-result-count")).toHaveTextContent("1 / 2");
    expect(screen.getByTestId("market-row-CHEAP")).toBeInTheDocument();
    expect(screen.queryByTestId("market-row-PRICEY")).toBeNull();

    expect(mockUseMarketSnapshot.mock.calls).toHaveLength(callsBefore.snapshotHook);
    expect(refresh.mock.calls).toHaveLength(callsBefore.refresh);
    expect(mockFetchDashboard.mock.calls).toHaveLength(callsBefore.dashboard);
    expect(mockValueScan.mock.calls).toHaveLength(callsBefore.valueScan);
    expect(mockGetUserConfig.mock.calls).toHaveLength(callsBefore.configGet);
  });
});
