// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, cleanup, waitFor, within, fireEvent } from "@solidjs/testing-library";
import { configure } from "@testing-library/dom";
import type { JSX } from "solid-js";
import "@testing-library/jest-dom/vitest";
import { ScreenerPage, mapDashboardPanelToScreener, DEFAULT_DASHBOARD_UNIVERSE } from "./ScreenerPage";
import { UIProvider } from "@/ui";
import { fetchMarketSnapshot } from "../../api/marketScreener";

vi.setConfig({ testTimeout: 20_000 });

// Panels (Dashboard, GroupPerformance, ScreenerContent, the tab chunks) are
// lazy: their DOM appears a microtask after render, and under an 8-worker run
// that first chunk resolve can exceed the 1000 ms default findBy budget. Give
// every async query room instead of sprinkling per-call timeouts.
configure({ asyncUtilTimeout: 10_000 });

// @solidjs/router's navigation path never settles in happy-dom and MemoryRouter
// has no initialEntries, so the router is replaced with a reactive
// window.location-backed searchParams. The helper seeds it from initialRoute.
vi.mock("@solidjs/router", async () => {
  const { createSignal } = await import("solid-js");
  const state = globalThis.__screenerSearchParams ??= createSignal<Record<string, string | undefined>>({});
  const [search, setSearch] = state;
  return {
    useSearchParams: () => [
      new Proxy({}, { get: (_, key) => search()[key as string] }) as Record<string, string | undefined>,
      (params: Record<string, string | string[] | null | undefined>) => {
        const next = { ...search() };
        for (const [k, v] of Object.entries(params)) {
          if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) delete next[k];
          else next[k] = String(Array.isArray(v) ? v[0] : v);
        }
        setSearch(next);
      },
    ],
    MemoryRouter: (props: any) => props.children,
    Route: (props: any) => (props.component ? props.component() : props.children),
    createMemoryHistory: () => ({ get: () => "/", set: () => {}, listen: () => () => {} }),
  };
});

const seedSearchParams = (route?: string) => {
  const state = (globalThis as any).__screenerSearchParams;
  if (!state) return;
  const q = (route ?? "/?tab=screener").split("?")[1];
  state[1](q ? Object.fromEntries(new URLSearchParams(q).entries()) : {});
};

const render = (ui: JSX.Element, options?: { initialRoute?: string }) => {
  seedSearchParams(options?.initialRoute);
  return rtlRender(() => ui);
};

// Mock child components to isolate ScreenerPage tests
vi.mock("./ScreenerNav", () => ({
  ScreenerNav: ({ options, activeScreener, onChange }: any) => (
    <div
      data-testid="screener-nav"
      data-active={activeScreener}
      data-options-count={options.length}
    >
      {options.map((opt: any) => (
        <button key={opt.id} data-testid={`nav-${opt.id}`} onClick={() => onChange(opt.id)}>
          {opt.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./ScreenerHeader", () => ({
  ScreenerHeader: (props: any) => (
    <div
      data-testid="screener-header"
      data-status={props.status}
      data-loading={props.isLoading}
      data-auto-refresh={props.autoRefreshSeconds}
      data-provider={props.provider}
      data-mode={props.mode}
      data-view-mode={props.viewMode}
      data-disable-controls={props.disableControls}
    >
      <button data-testid="refresh-btn" onClick={props.onRefresh}>
        Refresh
      </button>
      <input
        data-testid="auto-refresh-input"
        value={props.autoRefreshSeconds}
        onInput={(e) => props.onAutoRefreshChange(Number(e.currentTarget.value))}
      />
      <select
        data-testid="provider-select"
        value={props.provider}
        onInput={(e) => props.onProviderChange(e.currentTarget.value)}
      >
        <option value="upstox">Upstox</option>
        <option value="indmoney">INDMONEY</option>
      </select>
      <select
        data-testid="mode-select"
        value={props.mode}
        onInput={(e) => props.onModeChange(e.currentTarget.value)}
      >
        <option value="intraday">Intraday</option>
        <option value="historical">5D</option>
      </select>
      <button data-testid="view-table" onClick={() => props.onViewModeChange("table")}>
        Table
      </button>
      <button data-testid="view-heatmap" onClick={() => props.onViewModeChange("heatmap")}>
        Heatmap
      </button>
    </div>
  ),
}));

vi.mock("./ScreenerTable", () => ({
  ScreenerTable: (props: any) => (
    <div
      data-testid={props.testId || "screener-table"}
      data-stocks-count={props.stocks.length}
    >
      {props.stocks.map((stock: Stock) => (
        <div key={`stock-${stock.symbol}`} data-testid={`row-${stock.symbol}`}>
          {stock.symbol}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("./ScreenerHeatmapView", () => ({
  ScreenerHeatmapView: (props: any) => (
    <div
      data-testid={props.testId || "screener-heatmap"}
      data-stocks-count={props.stocks.length}
    >
      {props.stocks.map((stock: Stock) => (
        <div key={`heatmap-${stock.symbol}`} data-testid={`heatmap-${stock.symbol}`}>
          {stock.symbol}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("./ScreenerEmpty", () => ({
  ScreenerEmpty: ({ message }: any) => (
    <div data-testid="screener-empty" data-message={message}>
      Empty state
    </div>
  ),
}));

vi.mock("./GroupPerformancePanel", () => ({
  GroupPerformancePanel: () => (
    <div data-testid="group-performance-panel">Groups</div>
  ),
}));

vi.mock("./CorrelationTab", () => ({
  CorrelationTab: () => <div data-testid="correlation-tab">Correlation</div>,
}));

vi.mock("./ScreenerConfigView", () => ({
  ScreenerConfigView: () => <div data-testid="screener-config-view">Config</div>,
}));

vi.mock("./ScreenerLoading", () => ({
  ScreenerLoading: ({ message }: any) => (
    <div data-testid="screener-loading" data-message={message}>
      Loading...
    </div>
  ),
}));

vi.mock("../../hooks/useTableSort", () => ({
  useTableSort: () => ({
    getSortedData: (data: any, accessor: any) =>
      data.sort((a: any, b: any) => {
        const aVal = accessor(a);
        const bVal = accessor(b);
        if (aVal < bVal) return -1;
        if (aVal > bVal) return 1;
        return 0;
      }),
  }),
}));

// Mock the state module
vi.mock("../../state", () => ({
  profileMetaById: {
    trending: { section_labels: { primary: "Approaching", secondary: "Touched" } },
  },
  selectedSymbols: [] as string[],
  toggleSymbolSelection: vi.fn(),
  setSelectedSymbols: vi.fn(),
  clearSelectedSymbols: vi.fn(),
  subscribe: vi.fn(() => vi.fn()),
  subscribeToSelection: vi.fn(() => vi.fn()),
  screenerOptions: [
    { id: "trending", label: "Trending" },
  ],
}));

vi.mock("../../state/correlation", () => ({
  setSymbols: vi.fn(),
  setTimeframe: vi.fn(),
  setPeriod: vi.fn(),
  setPeriodUnit: vi.fn(),
  fetchCorrelationData: vi.fn(),
  clearSelectedSymbols: vi.fn(),
}));

vi.mock("../../api/marketScreener", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/marketScreener")>();
  return { ...actual, fetchMarketSnapshot: vi.fn() };
});

// The real panels fetch on mount (value scan via a 300ms debounce, events
// calendar + anomalies via the events store). These mocks fire the same API
// calls on mount so the suite can prove the panels only mount — and only hit
// the network — when their tab is active.
const valueScanSpy = vi.hoisted(() => vi.fn(async () => ({})));
const fetchEventsSpy = vi.hoisted(() => vi.fn(async () => ({})));
const fetchAnomaliesSpy = vi.hoisted(() => vi.fn(async () => ({})));

vi.mock("../../api/valueScan", () => ({
  valueScan: valueScanSpy,
}));

vi.mock("../../api/events", () => ({
  fetchEvents: fetchEventsSpy,
  fetchAnomalies: fetchAnomaliesSpy,
}));

vi.mock("../events/EventsPanel", async () => {
  const { onMount } = await import("solid-js");
  return {
    EventsPanel: () => {
      onMount(() => {
        void fetchEventsSpy({ market: "us" });
        void fetchAnomaliesSpy("2026-11-09");
      });
      return <div data-testid="events-panel" />;
    },
  };
});

vi.mock("../value/ValuePanel", async () => {
  const { onMount } = await import("solid-js");
  return {
    ValuePanel: () => {
      onMount(() => {
        void valueScanSpy({ market: "india", limit: 100, sort: "score" });
      });
      return <div data-testid="value-panel" />;
    },
  };
});

const mockFetchMarketSnapshot = vi.mocked(fetchMarketSnapshot);

// The Market tab is lazy and mounts on activation — keep its fetch off the
// network so the screener's other tests stay hermetic.
const marketSnapshot = {
  asOf: new Date().toISOString(),
  universe: "all_equity",
  total: 1,
  updateMode: "streaming",
  rows: [
    {
      symbol: "RELIANCE",
      name: "Reliance Industries",
      sector: "Energy",
      industry: "Oil & Gas",
      exchange: "NSE",
      close: 2946,
      change: 0.82,
      volume: 1234567,
      relativeVolume: 1.4,
      marketCap: 1990000000000,
      marketCapCr: 199000,
      capTier: "large",
      rsi: 61,
      adx: 24,
      atr: 45,
      sma20: 2880,
      sma50: 2800,
      sma200: 2600,
      perfW: 2.1,
      perf1m: 4.6,
      perf3m: 8.2,
      high52w: 3000,
      low52w: 1800,
      pos52w: 95,
      fno: true,
      etf: false,
    },
  ],
};

const dashboardMounts = vi.hoisted(() => ({ count: 0 }));

vi.mock("./DashboardView", async () => {
  const { onMount } = await import("solid-js");
  const panels = ["near_52w", "new_highs", "gap_up", "gainers", "most_active", "unknown_xyz"];
  return {
    DashboardView: (props: any) => {
      onMount(() => {
        dashboardMounts.count += 1;
      });
      return (
        <div data-testid="dashboard-view" data-universe={props.universe}>
          <button data-testid="dashboard-open-symbol" onClick={() => props.onOpenSymbol?.("RELIANCE")}>
            Open symbol
          </button>
          {panels.map((id) => (
            <button key={id} data-testid={`dashboard-open-scan-${id}`} onClick={() => props.onOpenScan?.(id)}>
              {id}
            </button>
          ))}
        </div>
      );
    },
  };
});

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

const mockApproachingStocks: Stock[] = [mockStock, { ...mockStock, symbol: "TCS", score: 75 }];
const mockTouchedStocks: Stock[] = [{ ...mockStock, symbol: "INFY", touched_52w: true }];

describe("ScreenerPage", () => {
  const defaultProps = {
    screenerOptions: [
      { id: "trending", label: "Trending" },
      { id: "new-highs", label: "New Highs" },
    ],
    activeScreener: "trending",
    onScreenerChange: vi.fn(),
    title: "Trending | Alphashri",
    status: "3 stocks",
    isLoading: false,
    autoRefreshSeconds: 60,
    provider: "upstox",
    mode: "intraday",
    onRefresh: vi.fn(),
    onAutoRefreshChange: vi.fn(),
    onProviderChange: vi.fn(),
    onModeChange: vi.fn(),
    approachingStocks: mockApproachingStocks,
    touchedStocks: mockTouchedStocks,
    onSymbolClick: vi.fn(),
    onSymbolHover: vi.fn(),
    error: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    seedSearchParams("/?tab=screener");
    dashboardMounts.count = 0;
    mockFetchMarketSnapshot.mockResolvedValue(marketSnapshot);
  });

  afterEach(() => {
    cleanup();
  });

  it("displays loading state", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} isLoading={true} approachingStocks={[]} touchedStocks={[]} />
      </UIProvider>
    ));
    expect(await screen.findByTestId("screener-loading")).toBeInTheDocument();
  });

  it("displays error state with retry button", async () => {
    const errorMsg = "Failed to fetch data";
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} error={errorMsg} />
      </UIProvider>
    ));
    expect(await screen.findByTestId("screener-error-container")).toBeInTheDocument();
    expect(screen.getByText("Screener failed to load")).toBeInTheDocument();
    expect(screen.getByText(errorMsg)).toBeInTheDocument();
    expect(await screen.findByTestId("screener-retry-btn")).toBeInTheDocument();
  });

  it("calls onRefresh when retry button clicked", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} error="Error occurred" />
      </UIProvider>
    ));
    fireEvent.click(await screen.findByTestId("screener-retry-btn"));
    expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("displays empty state when no stocks", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} approachingStocks={[]} touchedStocks={[]} />
      </UIProvider>
    ));
    expect(await screen.findByTestId("screener-empty")).toBeInTheDocument();
  });

  it("displays approaching stocks section when data exists", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>
    ));
    expect(await screen.findByTestId("screener-approaching-section")).toBeInTheDocument();
    expect(screen.getByText(`Approaching (${mockApproachingStocks.length})`)).toBeInTheDocument();
  });

  it("displays touched stocks section when data exists", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>
    ));
    expect(await screen.findByTestId("screener-touched-section")).toBeInTheDocument();
    expect(screen.getByText(`Touched (${mockTouchedStocks.length})`)).toBeInTheDocument();
  });

  it("renders table view by default", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>
    ));
    // Both approaching and touched sections render tables
    expect(await screen.findByTestId("screener-table-approaching")).toBeInTheDocument();
    expect(await screen.findByTestId("screener-table-touched")).toBeInTheDocument();
  });

  it("switches to heatmap view when view mode changes", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>
    ));
    fireEvent.click(screen.getByTestId("view-heatmap"));
    // Both approaching and touched sections render heatmaps
    expect(await screen.findByTestId("screener-heatmap-approaching")).toBeInTheDocument();
    expect(await screen.findByTestId("screener-heatmap-touched")).toBeInTheDocument();
  });

  it("switches back to table view", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>
    ));
    // Switch to heatmap first
    fireEvent.click(screen.getByTestId("view-heatmap"));
    expect(await screen.findByTestId("screener-heatmap-approaching")).toBeInTheDocument();
    expect(await screen.findByTestId("screener-heatmap-touched")).toBeInTheDocument();

    // Switch back to table
    fireEvent.click(screen.getByTestId("view-table"));
    expect(await screen.findByTestId("screener-table-approaching")).toBeInTheDocument();
    expect(await screen.findByTestId("screener-table-touched")).toBeInTheDocument();
  });

  it("renders screener navigation with options", () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>
    ));
    // unified toolbar replaces left rail nav with dropdown — no screener-nav
    expect(screen.queryByTestId("screener-nav")).not.toBeInTheDocument();
    expect(screen.getByTestId("screener-select")).toBeInTheDocument();
  });

  it("calls onScreenerChange when screener select changes", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>
    ));
    fireEvent.input(within(screen.getByTestId("screener-select")).getByRole("combobox"), { target: { value: "new-highs" } });
    expect(defaultProps.onScreenerChange).toHaveBeenCalledWith("new-highs");
  });

  it("renders header with correct status", () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>
    ));
    const header = screen.getByTestId("screener-header");
    expect(header).toHaveAttribute("data-status", "3 stocks");
  });

  it("disables controls when loading", () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} isLoading={true} />
      </UIProvider>
    ));
    // Header controls should be disabled - check via props
    const header = screen.getByTestId("screener-header");
    expect(header).toHaveAttribute("data-loading", "true");
  });

  it("keeps controls enabled during background refresh when results are present", () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} isLoading={true} />
      </UIProvider>
    ));
    expect(screen.getByTestId("screener-header")).toHaveAttribute(
      "data-disable-controls",
      "false",
    );
  });

  it("calls onRefresh when refresh button clicked", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>
    ));
    fireEvent.click(screen.getByTestId("refresh-btn"));
    expect(defaultProps.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("calls onAutoRefreshChange when auto-refresh value changes", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>
    ));
    const input = screen.getByTestId("auto-refresh-input");
    fireEvent.input(input, { target: { value: "" } }); fireEvent.input(input, { target: { value: "120" } });
    expect(defaultProps.onAutoRefreshChange).toHaveBeenCalled();
  });

  it("calls onProviderChange when provider changes", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>
    ));
    const select = screen.getByTestId("provider-select");
    fireEvent.input(select, { target: { value: "indmoney" } });
    expect(defaultProps.onProviderChange).toHaveBeenCalledWith("indmoney");
  });

  it("calls onModeChange when mode changes", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>
    ));
    const select = screen.getByTestId("mode-select");
    fireEvent.input(select, { target: { value: "historical" } });
    expect(defaultProps.onModeChange).toHaveBeenCalledWith("historical");
  });

  it("handles zero approaching stocks", () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} approachingStocks={[]} />
      </UIProvider>
    ));
    expect(screen.queryByTestId("screener-approaching-section")).not.toBeInTheDocument();
  });

  it("handles zero touched stocks", () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} touchedStocks={[]} />
      </UIProvider>
    ));
    expect(screen.queryByTestId("screener-touched-section")).not.toBeInTheDocument();
  });

  it("renders the groups performance panel beside the screener table", () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>
    ));
    expect(screen.getByTestId("group-performance-panel")).toBeInTheDocument();
    expect(screen.getByTestId("screener-page")).toBeInTheDocument();
    expect(screen.getByTestId("screener-content")).toBeInTheDocument();
    expect(screen.getByTestId("screener-controls")).toBeInTheDocument();
  });

  it("renders the Dashboard tab by default", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/" });
    expect(screen.getByTestId("tab-dashboard")).toBeInTheDocument();
    // DashboardView is lazy: it resolves a microtask after the shell paints.
    expect(await screen.findByTestId("dashboard-view")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-view")).toHaveAttribute(
      "data-universe",
      DEFAULT_DASHBOARD_UNIVERSE,
    );
    // Dashboard toolbar replaces the screener select with the universe select
    expect(screen.getByTestId("dashboard-universe-select")).toBeInTheDocument();
    expect(screen.queryByTestId("screener-select")).not.toBeInTheDocument();
    // Dashboard landing does not mount the screener subtree (mount-on-first-visit)
    expect(screen.queryByTestId("screener-table-approaching")).not.toBeInTheDocument();
    expect(screen.queryByTestId("group-performance-panel")).not.toBeInTheDocument();
  });

  it("switches from dashboard to screener and back", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/" });
    expect(await screen.findByTestId("dashboard-view")).toBeVisible();

    fireEvent.click(screen.getByTestId("tab-screener"));
    expect(await screen.findByTestId("screener-table-approaching")).toBeVisible();
    expect(screen.getByTestId("screener-select")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tab-dashboard"));
    expect(await screen.findByTestId("dashboard-view")).toBeVisible();
    expect(screen.queryByTestId("screener-table-approaching")).not.toBeVisible();
  });

  it("does not fetch the market snapshot until the Market tab is opened", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/" });
    expect(mockFetchMarketSnapshot).not.toHaveBeenCalled();
    expect(screen.queryByTestId("market-screener")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-market"));
    await waitFor(() => expect(mockFetchMarketSnapshot).toHaveBeenCalledTimes(1), {
      timeout: 10_000,
    });
    expect(await screen.findByTestId("market-screener", undefined, { timeout: 10_000 })).toBeInTheDocument();
    expect(screen.getByTestId("market-row-RELIANCE")).toBeInTheDocument();
  });

  it("does not mount the dashboard or screener panels on the Market tab", () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/?tab=market" });
    expect(dashboardMounts.count).toBe(0);
    expect(screen.queryByTestId("dashboard-view")).not.toBeInTheDocument();
    expect(screen.queryByTestId("screener-table-approaching")).not.toBeInTheDocument();
    expect(screen.queryByTestId("group-performance-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("market-tab-panel")).toBeInTheDocument();
  });

  it("does not fetch value scan or events endpoints on Dashboard or Market tabs", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/" });
    expect(valueScanSpy).not.toHaveBeenCalled();
    expect(fetchEventsSpy).not.toHaveBeenCalled();
    expect(fetchAnomaliesSpy).not.toHaveBeenCalled();
    // Panels stay in the DOM (hidden) but must not mount their contents
    expect(screen.getByTestId("deep-value-panel")).not.toBeVisible();
    expect(screen.getByTestId("events-tab-panel")).not.toBeVisible();
    expect(screen.queryByTestId("value-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("events-panel")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tab-market"));
    await waitFor(() => expect(mockFetchMarketSnapshot).toHaveBeenCalledTimes(1), {
      timeout: 10_000,
    });
    expect(valueScanSpy).not.toHaveBeenCalled();
    expect(fetchEventsSpy).not.toHaveBeenCalled();
    expect(fetchAnomaliesSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("value-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("events-panel")).not.toBeInTheDocument();
  });

  it("fetches the value scan only when the Deep Value tab is opened, and remounts on re-entry", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/" });
    expect(valueScanSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("tab-deepvalue"));
    await waitFor(() => expect(valueScanSpy).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(await screen.findByTestId("value-panel", undefined, { timeout: 10_000 })).toBeInTheDocument();
    expect(fetchEventsSpy).not.toHaveBeenCalled();
    expect(fetchAnomaliesSpy).not.toHaveBeenCalled();

    // Switching away unmounts; coming back remounts and refetches
    fireEvent.click(screen.getByTestId("tab-dashboard"));
    expect(screen.queryByTestId("value-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-deepvalue"));
    await waitFor(() => expect(valueScanSpy).toHaveBeenCalledTimes(2), { timeout: 10_000 });
  });

  it("fetches the events endpoints only when the Events tab is opened, and remounts on re-entry", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/" });
    expect(fetchEventsSpy).not.toHaveBeenCalled();
    expect(fetchAnomaliesSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("tab-events"));
    await waitFor(() => {
      expect(fetchEventsSpy).toHaveBeenCalledTimes(1);
      expect(fetchAnomaliesSpy).toHaveBeenCalledTimes(1);
    }, { timeout: 10_000 });
    expect(await screen.findByTestId("events-panel", undefined, { timeout: 10_000 })).toBeInTheDocument();
    expect(valueScanSpy).not.toHaveBeenCalled();

    // Switching away unmounts; coming back remounts and refetches
    fireEvent.click(screen.getByTestId("tab-dashboard"));
    expect(screen.queryByTestId("events-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-events"));
    await waitFor(() => {
      expect(fetchEventsSpy).toHaveBeenCalledTimes(2);
      expect(fetchAnomaliesSpy).toHaveBeenCalledTimes(2);
    }, { timeout: 10_000 });
  });

  it("keeps correlation and config tabs working alongside dashboard", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/" });
    fireEvent.click(screen.getByTestId("tab-correlation"));
    await waitFor(
      () => expect(screen.queryByTestId("dashboard-view")).not.toBeVisible(),
      { timeout: 10_000 },
    );
    expect(await screen.findByTestId("correlation-tab", undefined, { timeout: 10_000 })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-config"));
    await waitFor(
      () => expect(screen.queryByTestId("dashboard-view")).not.toBeVisible(),
      { timeout: 10_000 },
    );
    expect(await screen.findByTestId("screener-config-view", undefined, { timeout: 10_000 })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-dashboard"));
    await waitFor(
      () => expect(screen.getByTestId("dashboard-view")).toBeVisible(),
      { timeout: 10_000 },
    );
  });

  it("maps dashboard panels to screener profiles", () => {
    const ids = ["52w_high", "near_52w_breakout", "touched_52w_high", "market_open_gap", "trending"];
    expect(mapDashboardPanelToScreener("near_52w", ids)).toBe("near_52w_breakout");
    expect(mapDashboardPanelToScreener("near_52w", ["52w_high"])).toBe("52w_high");
    expect(mapDashboardPanelToScreener("near_52w", ["trending"])).toBeNull();
    expect(mapDashboardPanelToScreener("new_highs", ids)).toBe("touched_52w_high");
    expect(mapDashboardPanelToScreener("gap_up", ids)).toBe("market_open_gap");
    expect(mapDashboardPanelToScreener("gainers", ids)).toBeNull();
    expect(mapDashboardPanelToScreener("most_active", ids)).toBeNull();
    expect(mapDashboardPanelToScreener("volume_surge", ids)).toBeNull();
    expect(mapDashboardPanelToScreener("unknown_xyz", ids)).toBeNull();
  });

  it("onOpenScan for near_52w switches profile and opens the Screener tab", async () => {
    const onScreenerChange = vi.fn();
    render(() => (
      <UIProvider>
        <ScreenerPage
          {...defaultProps}
          screenerOptions={[
            { id: "trending", label: "Trending" },
            { id: "52w_high", label: "52W High" },
          ]}
          activeScreener="trending"
          onScreenerChange={onScreenerChange}
          universe="nifty500"
        />
      </UIProvider>), { initialRoute: "/" });
    fireEvent.click(await screen.findByTestId("dashboard-open-scan-near_52w"));
    expect(onScreenerChange).toHaveBeenCalledWith("52w_high");
    expect(await screen.findByTestId("screener-table-approaching")).toBeVisible();
  });

  it("onOpenScan for gainers opens the Screener tab without changing profile", async () => {
    const onScreenerChange = vi.fn();
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} onScreenerChange={onScreenerChange} universe="nifty500" />
      </UIProvider>), { initialRoute: "/" });
    fireEvent.click(await screen.findByTestId("dashboard-open-scan-gainers"));
    expect(onScreenerChange).not.toHaveBeenCalled();
    expect(await screen.findByTestId("screener-table-approaching")).toBeVisible();
  });

  it("dashboard refresh remounts the DashboardView", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} universe="nifty500" />
      </UIProvider>), { initialRoute: "/" });
    expect(await screen.findByTestId("dashboard-view")).toBeInTheDocument();
    expect(dashboardMounts.count).toBe(1);
    fireEvent.click(screen.getByTestId("dashboard-refresh"));
    await waitFor(() => expect(dashboardMounts.count).toBe(2));
    expect(screen.getByTestId("dashboard-view")).toHaveAttribute("data-universe", "nifty500");
  });

  it("dashboard universe selector calls onUniverseChange", async () => {
    const onUniverseChange = vi.fn();
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} universe="nifty50" onUniverseChange={onUniverseChange} />
      </UIProvider>), { initialRoute: "/" });
    fireEvent.input(within(screen.getByTestId("dashboard-universe-select")).getByRole("combobox"), { target: { value: "nifty500" } });
    expect(onUniverseChange).toHaveBeenCalledWith("nifty500");
  });

  it("last close toggle flips its pressed state", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/" });
    const toggle = screen.getByTestId("dashboard-last-close-toggle");
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(toggle).toBeChecked();
  });

  it("dashboard symbol click forwards to onSymbolClick", async () => {
    const onSymbolClick = vi.fn();
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} onSymbolClick={onSymbolClick} />
      </UIProvider>), { initialRoute: "/" });
    fireEvent.click(await screen.findByTestId("dashboard-open-symbol"));
    expect(onSymbolClick).toHaveBeenCalledWith("RELIANCE");
  });

  it("keeps the screener table alive (no remount) when another tab is opened", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/?tab=screener" });
    expect(await screen.findByTestId("screener-table-approaching")).toBeInTheDocument();
    expect(await screen.findByTestId("group-performance-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tab-events"));
    expect(await screen.findByTestId("events-panel", undefined, { timeout: 10_000 })).toBeInTheDocument();
    // Visited tabs stay mounted (hidden), so switching back costs no remount.
    expect(screen.getByTestId("screener-table-approaching")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tab-screener"));
    expect(screen.getByTestId("screener-table-approaching")).toBeInTheDocument();
    expect(screen.getByTestId("screener-table-approaching")).toBeVisible();
  });
});
