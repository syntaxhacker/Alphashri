// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render as rtlRender, screen, cleanup, waitFor, within, fireEvent } from "@solidjs/testing-library";
import { configure } from "@testing-library/dom";
import type { JSX } from "solid-js";
import "@testing-library/jest-dom/vitest";
import { ScreenerPage } from "./ScreenerPage";
import { UIProvider } from "@/ui";
import { fetchMarketSnapshot } from "../../api/marketScreener";
import type { Stock } from "../../types";

vi.setConfig({ testTimeout: 20_000 });

// Panels (GroupPerformance, ScreenerContent, the tab chunks) are lazy: their
// DOM appears a microtask after render, and under an 8-worker run
// that first chunk resolve can exceed the 1000 ms default findBy budget. Give
// every async query room instead of sprinkling per-call timeouts.
configure({ asyncUtilTimeout: 10_000 });

/** Every `setSearchParams` call, in order — options included, so push vs replace is assertable. */
const paramWrites = vi.hoisted(
  () => [] as Array<{
    params: Record<string, string | string[] | null | undefined>;
    options?: { replace?: boolean };
  }>,
);

/** Every `navigate()` call, in order — the tab lives in the path, not the query. */
const pathNavigations = vi.hoisted(
  () => [] as Array<{ to: string; options?: { replace?: boolean } }>,
);

// @solidjs/router's navigation path never settles in happy-dom, so the router is
// replaced with a reactive window.location-backed route. `useParams`/`useNavigate`
// are backed by the same signal, so a tab change re-renders the page exactly like
// a real navigation would.
vi.mock("@solidjs/router", async () => {
  const { createSignal } = await import("solid-js");
  const g = globalThis as unknown as {
    __screenerRoute?: ReturnType<
      typeof createSignal<{ path: string; search: Record<string, string | undefined> }>
    >;
  };
  const state = (g.__screenerRoute ??= createSignal({
    path: "/screener",
    search: {} as Record<string, string | undefined>,
  }));
  const [route, setRoute] = state;
  const parseUrl = (url: string) => {
    const [path, query = ""] = url.split("?");
    return { path, search: Object.fromEntries(new URLSearchParams(query).entries()) };
  };
  return {
    useSearchParams: () => [
      new Proxy({} as Record<string, string | undefined>, {
        get: (_, key) => route().search[key as string],
        ownKeys: () => Object.keys(route().search),
        getOwnPropertyDescriptor: (_, key) => ({
          enumerable: true,
          configurable: true,
          value: route().search[key as string],
        }),
      }),
      (params: Record<string, string | string[] | null | undefined>, options?: { replace?: boolean }) => {
        paramWrites.push({ params, options });
        const current = route();
        const next = { ...current.search };
        for (const [k, v] of Object.entries(params)) {
          if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) delete next[k];
          else next[k] = String(Array.isArray(v) ? v[0] : v);
        }
        setRoute({ path: current.path, search: next });
      },
    ],
    useParams: () =>
      new Proxy({} as { tab?: string }, {
        get: (_, key) => {
          if (key !== "tab") return undefined;
          return /^\/screener\/([^/]+)\/?$/.exec(route().path)?.[1];
        },
      }),
    useNavigate: () => (to: string, options?: { replace?: boolean }) => {
      pathNavigations.push({ to, options });
      setRoute(parseUrl(to));
    },
    MemoryRouter: (props: any) => props.children,
    Route: (props: any) => (props.component ? props.component() : props.children),
    createMemoryHistory: () => ({ get: () => "/", set: () => {}, listen: () => () => {} }),
  };
});

const seedRoute = (route = "/screener/screener") => {
  const state = (globalThis as unknown as {
    __screenerRoute?: [unknown, (next: { path: string; search: Record<string, string | undefined> }) => void];
  }).__screenerRoute;
  if (!state) return;
  const [path, query = ""] = route.split("?");
  state[1]({
    path,
    search: Object.fromEntries(new URLSearchParams(query).entries()),
  });
};

const currentRoute = () =>
  (globalThis as unknown as {
    __screenerRoute?: [() => { path: string; search: Record<string, string | undefined> }, unknown];
  }).__screenerRoute?.[0]() ?? { path: "/screener", search: {} };

/** The live query string as the component sees it. */
const currentSearchParams = () => currentRoute().search;

const render = (ui: () => JSX.Element, options?: { initialRoute?: string }) => {
  seedRoute(options?.initialRoute);
  return rtlRender(ui);
};

/**
 * happy-dom has no layout engine: `getBoundingClientRect()` returns 0×0 for
 * everything, so chrome height cannot be measured. Assert the *declared* box
 * instead — the arbitrary Tailwind height, else the inline height. A zero here
 * means the element declares no height at all (which is a failure, not a pass).
 */
function declaredHeightPx(el: Element): number | null {
  const fromClass = (el.getAttribute("class") ?? "").match(/(?:^|\s)h-\[(\d+)px\]/);
  if (fromClass) return Number(fromClass[1]);
  const inline = (el as HTMLElement).style.getPropertyValue("height");
  return inline.endsWith("px") ? Number(inline.slice(0, -2)) : null;
}

// Mock child components to isolate ScreenerPage tests
vi.mock("./ScreenerNav", () => ({
  ScreenerNav: ({ options, activeScreener, onChange }: any) => (
    <div
      data-testid="screener-nav"
      data-active={activeScreener}
      data-options-count={options.length}
    >
      {options.map((opt: any) => (
        <button data-testid={`nav-${opt.id}`} onClick={() => onChange(opt.id)}>
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
        <div data-testid={`row-${stock.symbol}`}>
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
const selectedSymbolsRef = vi.hoisted(() => ({ current: [] as string[] }));

vi.mock("../../state", () => ({
  profileMetaById: {
    trending: { section_labels: { primary: "Approaching", secondary: "Touched" } },
  },
  get selectedSymbols() {
    return selectedSymbolsRef.current;
  },
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

// The real panels fetch on mount (value scan via a 300ms debounce). These
// mocks fire the same API call on mount so the suite can prove the panel
// only mounts — and only hits the network — when its tab is active.
const valueScanSpy = vi.hoisted(() => vi.fn(async (_params?: unknown) => ({})));

vi.mock("../../api/valueScan", () => ({
  valueScan: valueScanSpy,
}));

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

// The screener body is a lazy chunk (ScreenerContent). Its first import is a
// cold module transform — several seconds on an 8-worker run — and `findBy*`
// would have to cover that inside its own async budget. Resolve the chunk here,
// during collection, so no test pays a chunk load inside an assertion.
await import("./ScreenerContent");

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
      exchange: "NSE",
      close: 2946,
      change: 0.82,
      relativeVolume: 1.4,
      marketCapCr: 199000,
      capTier: "large",
      rsi: 61,
      adx: 24,
      sma20: 2880,
      sma50: 2800,
      sma200: 2600,
      perfW: 2.1,
      perf1m: 4.6,
      high52w: 3000,
      low52w: 1800,
      pos52w: 95,
      peRatio: null,
      pbRatio: null,
      dividendYield: null,
      roe: null,
      fno: true,
      etf: false,
    },
  ],
};

// The Market page is a pass-through to the Market panel, which owns the view.
// Capture the props at that boundary so the URL contract is assertable without
// the panel's internals; the real page still renders behind the capture.
const marketPanelProps = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

vi.mock("../../pages/market/MarketScreenerPage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../pages/market/MarketScreenerPage")>();
  const Actual = actual.MarketScreenerPage as unknown as (props: Record<string, unknown>) => JSX.Element;
  return {
    MarketScreenerPage: (props: Record<string, unknown>) => {
      marketPanelProps.current = props;
      return <Actual {...props} />;
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
    onConfigScreenerSelect: vi.fn(),
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
    paramWrites.length = 0;
    pathNavigations.length = 0;
    selectedSymbolsRef.current = [];
    seedRoute("/screener/screener");
    marketPanelProps.current = null;
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

  it("opens Market on a bare route without writing a tab param", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/" });
    expect(screen.queryByTestId("tab-dashboard")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dashboard-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("market-tab-panel")).toBeVisible();
    expect(paramWrites).toHaveLength(0);
    expect(currentSearchParams().tab).toBeUndefined();
  });

  it("redirects ?tab=dashboard to the Market movers view", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/?tab=dashboard" });

    await waitFor(() => expect(currentRoute().path).toBe("/screener/market"), { timeout: 10_000 });
    expect(currentSearchParams().view).toBe("movers");
    expect(currentSearchParams().tab).toBeUndefined();
    expect(pathNavigations.at(-1)?.options?.replace).toBe(true);
    expect(screen.getByTestId("market-tab-panel")).toBeVisible();
  });

  it("redirects the /screener/dashboard path to the Market movers view", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/screener/dashboard" });

    await waitFor(() => expect(currentRoute().path).toBe("/screener/market"), { timeout: 10_000 });
    expect(currentSearchParams().view).toBe("movers");
    expect(pathNavigations.at(-1)?.options?.replace).toBe(true);
  });

  it("switches from Market to Screener and back", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/" });
    expect(screen.getByTestId("market-tab-panel")).toBeVisible();

    fireEvent.click(screen.getByTestId("tab-screener"));
    expect(await screen.findByTestId("screener-table-approaching")).toBeVisible();
    expect(screen.getByTestId("screener-select")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tab-market"));
    expect(screen.getByTestId("market-tab-panel")).toBeVisible();
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

  it("does not mount the screener panel on the Market tab", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/?tab=market" });
    expect(screen.queryByTestId("screener-table-approaching")).not.toBeInTheDocument();
    expect(screen.queryByTestId("group-performance-panel")).not.toBeInTheDocument();
    expect(screen.getByTestId("market-tab-panel")).toBeInTheDocument();
    // An explicit ?tab=market converges on the path form; the tab is dropped.
    await waitFor(() => expect(currentRoute().path).toBe("/screener/market"));
    expect(pathNavigations.at(-1)).toEqual({
      to: "/screener/market",
      options: { replace: true },
    });
    expect(currentSearchParams().tab).toBeUndefined();
  });

  it("forwards ?view= to the Market panel", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/?tab=market&view=movers" });

    await waitFor(() => expect(marketPanelProps.current?.initialView).toBe("movers"), {
      timeout: 10_000,
    });
    expect(currentRoute().path).toBe("/screener/market");
    expect(currentSearchParams().view).toBe("movers");
  });

  it("defaults the Market panel to the table view when ?view= is absent", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/?tab=market" });

    await waitFor(() => expect(marketPanelProps.current).not.toBeNull(), { timeout: 10_000 });
    expect(marketPanelProps.current?.initialView).toBe("table");
  });

  it("writes ?view= when the Market panel changes view", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/?tab=market" });

    await waitFor(() => expect(marketPanelProps.current).not.toBeNull(), { timeout: 10_000 });
    const onViewChange = marketPanelProps.current?.onViewChange;
    expect(onViewChange).toBeTypeOf("function");
    (onViewChange as (v: string) => void)("map");

    expect(currentSearchParams().view).toBe("map");
    expect(paramWrites.at(-1)?.params.view).toBe("map");
    expect(paramWrites.at(-1)?.options?.replace).toBe(true);
  });

  it("drops the market view param when leaving the Market tab", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/?tab=market&view=movers" });

    await waitFor(() => expect(currentSearchParams().view).toBe("movers"), { timeout: 10_000 });
    fireEvent.click(screen.getByTestId("tab-correlation"));

    await waitFor(() => expect(currentRoute().path).toBe("/screener/correlation"));
    expect(currentSearchParams().view).toBeUndefined();
    // No `tab=` write: the tab lives in the path now.
    expect(paramWrites.some((w) => "tab" in w.params)).toBe(false);
  });

  it("does not fetch value scan endpoints on the Market tab", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/" });
    expect(valueScanSpy).not.toHaveBeenCalled();
    // Panels stay in the DOM (hidden) but must not mount their contents
    expect(screen.getByTestId("deep-value-panel")).not.toBeVisible();
    expect(screen.queryByTestId("value-panel")).not.toBeInTheDocument();

    await waitFor(() => expect(mockFetchMarketSnapshot).toHaveBeenCalledTimes(1), {
      timeout: 10_000,
    });
    expect(valueScanSpy).not.toHaveBeenCalled();
    expect(screen.queryByTestId("value-panel")).not.toBeInTheDocument();
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

    // Switching away unmounts; coming back remounts and refetches
    fireEvent.click(screen.getByTestId("tab-market"));
    expect(screen.queryByTestId("value-panel")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-deepvalue"));
    await waitFor(() => expect(valueScanSpy).toHaveBeenCalledTimes(2), { timeout: 10_000 });
  });

  it("keeps correlation and config tabs working from Market", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/" });
    fireEvent.click(screen.getByTestId("tab-correlation"));
    await waitFor(
      () => expect(screen.queryByTestId("market-tab-panel")).not.toBeVisible(),
      { timeout: 10_000 },
    );
    expect(await screen.findByTestId("correlation-tab", undefined, { timeout: 10_000 })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-config"));
    await waitFor(
      () => expect(screen.queryByTestId("market-tab-panel")).not.toBeVisible(),
      { timeout: 10_000 },
    );
    expect(await screen.findByTestId("screener-config-view", undefined, { timeout: 10_000 })).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("tab-market"));
    await waitFor(
      () => expect(screen.getByTestId("market-tab-panel")).toBeVisible(),
      { timeout: 10_000 },
    );
  });

  it("pushes a history entry on tab change so Back returns to the previous tab", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/?tab=screener" });
    expect(await screen.findByTestId("screener-table-approaching")).toBeInTheDocument();
    // The legacy query converges on /screener/screener (replace), then the tab click pushes.
    await waitFor(() => expect(currentRoute().path).toBe("/screener/screener"));
    pathNavigations.length = 0;

    fireEvent.click(screen.getByTestId("tab-market"));

    expect(pathNavigations).toHaveLength(1);
    // Market is the default tab, so its path is bare.
    expect(pathNavigations[0].to).toBe("/screener");
    // `replace: true` kept Back on the tab you came from from ever being reachable.
    expect(pathNavigations[0].options?.replace).toBeFalsy();
    expect(currentRoute().path).toBe("/screener");
    expect(currentSearchParams().tab).toBeUndefined();
    expect(currentSearchParams().view).toBeUndefined();
    // The tab is a path segment now, never a `tab=` write.
    expect(paramWrites.some((w) => "tab" in w.params)).toBe(false);
  });

  it("does not write the URL when the clicked tab is already active", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/?tab=screener" });
    expect(await screen.findByTestId("screener-table-approaching")).toBeInTheDocument();
    await waitFor(() => expect(currentRoute().path).toBe("/screener/screener"));
    pathNavigations.length = 0;

    fireEvent.click(screen.getByTestId("tab-screener"));

    expect(pathNavigations).toHaveLength(0);
  });

  it("converges a legacy ?tab= URL on its path form", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/?tab=screener" });

    expect(await screen.findByTestId("screener-table-approaching")).toBeInTheDocument();
    await waitFor(() => expect(currentRoute().path).toBe("/screener/screener"));
    expect(pathNavigations.at(-1)).toEqual({ to: "/screener/screener", options: { replace: true } });
    expect(currentSearchParams().tab).toBeUndefined();
    expect(paramWrites.some((w) => "tab" in w.params)).toBe(false);
  });

  it("drops correlation-only params when leaving the correlation tab", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>),
      { initialRoute: "/?tab=correlation&symbols=INFY,TCS&timeframe=daily&period=90" });
    expect(await screen.findByTestId("correlation-tab", undefined, { timeout: 10_000 })).toBeInTheDocument();
    await waitFor(() => expect(currentRoute().path).toBe("/screener/correlation"));
    expect(currentSearchParams().symbols).toBe("INFY,TCS");

    fireEvent.click(screen.getByTestId("tab-config"));

    await waitFor(() => expect(currentRoute().path).toBe("/screener/config"));
    // navigate rebuilds the query, so these only disappear if they are dropped.
    expect(currentSearchParams().symbols).toBeUndefined();
    expect(currentSearchParams().timeframe).toBeUndefined();
    expect(currentSearchParams().period).toBeUndefined();
  });

  it("keeps the screener profile param across tab changes", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/?tab=screener&screener=trending" });
    expect(await screen.findByTestId("screener-table-approaching")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tab-config"));
    await waitFor(() => expect(currentRoute().path).toBe("/screener/config"));
    expect(currentSearchParams().screener).toBe("trending");
  });

  it("deep links land on their tab without rewriting the URL", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/screener/deepvalue" });

    expect(await screen.findByTestId("value-panel", undefined, { timeout: 10_000 })).toBeInTheDocument();
    // Already canonical: no redirect, no query write.
    expect(pathNavigations).toHaveLength(0);
    expect(paramWrites).toHaveLength(0);
    expect(currentRoute().path).toBe("/screener/deepvalue");
  });

  it("Compare pushes correlation params, which are dropped when leaving the tab", async () => {
    selectedSymbolsRef.current = ["INFY", "TCS"];
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/?tab=screener" });
    expect(await screen.findByTestId("screener-table-approaching")).toBeInTheDocument();
    await waitFor(() => expect(currentRoute().path).toBe("/screener/screener"));

    fireEvent.click(screen.getByTestId("compare-btn"));

    await waitFor(() => expect(currentRoute().path).toBe("/screener/correlation"));
    expect(currentSearchParams().symbols).toBe("INFY,TCS");
    expect(currentSearchParams().period).toBe("90");
    expect(pathNavigations.at(-1)?.options?.replace).toBeFalsy();

    fireEvent.click(screen.getByTestId("tab-config"));
    await waitFor(() => expect(currentRoute().path).toBe("/screener/config"));
    expect(currentSearchParams().symbols).toBeUndefined();
    expect(currentSearchParams().period).toBeUndefined();
  });

  it("onOpenScan navigates to /screener?view=table (replace) and forwards the symbols", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} universe="nifty500" />
      </UIProvider>), { initialRoute: "/screener" });
    await waitFor(() => expect(marketPanelProps.current?.onOpenScan).toBeTypeOf("function"), {
      timeout: 10_000,
    });
    const onOpenScan = marketPanelProps.current?.onOpenScan;
    (onOpenScan as (id: string, symbols: string[]) => void)("gainers", [
      "INDIAGLYCO",
      "RELIANCE",
    ]);
    await waitFor(() => expect(currentRoute().path).toBe("/screener"));
    expect(currentSearchParams().tab).toBeUndefined();
    expect(currentSearchParams().view).toBe("table");
    expect(pathNavigations.at(-1)).toEqual({ to: "/screener?view=table", options: { replace: true } });
    await waitFor(() => expect(marketPanelProps.current?.symbolAllowlist).toEqual(["INDIAGLYCO", "RELIANCE"]));
    expect(marketPanelProps.current?.onClearSymbolAllowlist).toBeTypeOf("function");
    expect(defaultProps.onScreenerChange).not.toHaveBeenCalled();
  });

  it("clears the symbol allowlist when leaving the Market tab", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} universe="nifty500" />
      </UIProvider>), { initialRoute: "/screener/market" });
    await waitFor(() => expect(marketPanelProps.current?.onOpenScan).toBeTypeOf("function"), {
      timeout: 10_000,
    });
    const onOpenScan = marketPanelProps.current?.onOpenScan;
    (onOpenScan as (id: string, symbols: string[]) => void)("gainers", ["RELIANCE"]);
    await waitFor(() => expect(marketPanelProps.current?.symbolAllowlist).toEqual(["RELIANCE"]));
    fireEvent.click(screen.getByTestId("tab-correlation"));
    await waitFor(() => expect(currentRoute().path).toBe("/screener/correlation"));
    fireEvent.click(screen.getByTestId("tab-market"));
    await waitFor(() => expect(screen.getByTestId("market-tab-panel")).toBeVisible());
    await waitFor(() => expect(marketPanelProps.current?.symbolAllowlist).toEqual([]));
  });

  it("keeps the screener table alive (no remount) when another tab is opened", async () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/?tab=screener" });
    expect(await screen.findByTestId("screener-table-approaching")).toBeInTheDocument();
    expect(await screen.findByTestId("group-performance-panel")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tab-deepvalue"));
    expect(await screen.findByTestId("value-panel", undefined, { timeout: 10_000 })).toBeInTheDocument();
    // Visited tabs stay mounted (hidden), so switching back costs no remount.
    expect(screen.getByTestId("screener-table-approaching")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("tab-screener"));
    expect(screen.getByTestId("screener-table-approaching")).toBeInTheDocument();
    expect(screen.getByTestId("screener-table-approaching")).toBeVisible();
  });

  // LAYOUT_CONTRACT §1: primary workspace chrome (tab strip + toolbar) ≤96px.
  // Not measurable in happy-dom (no layout), so the declared frame is asserted:
  // outer page padding + band height + the gap under the band.
  it("fits the tab strip and toolbar inside the 96px chrome budget", () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} universe="nifty500" />
      </UIProvider>), { initialRoute: "/" });

    const page = screen.getByTestId("screener-page") as HTMLElement;
    const frame = page.parentElement as HTMLElement;
    const band = screen.getByTestId("screener-controls");
    const bandHeight = declaredHeightPx(band);
    expect(bandHeight, "the chrome band must declare its height").not.toBeNull();

    // p-4 = the 16px outer frame the page owns (the shell has no padding).
    expect(frame.className).toMatch(/\bp-4\b/);
    const sectionGap = parseFloat(page.style.getPropertyValue("gap") || "0");

    expect(16 + (bandHeight ?? 0) + sectionGap).toBeLessThanOrEqual(96);
  });

  it("uses one bottom rule for the chrome band instead of a boxed band", () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} universe="nifty500" />
      </UIProvider>), { initialRoute: "/" });

    const bandTokens = screen.getByTestId("screener-controls").className.split(/\s+/);
    expect(bandTokens).toContain("border-b");
    // A bare `border` outlines all four sides and doubles up with the panels.
    expect(bandTokens).not.toContain("border");

    // The tab strip must not draw its own rule under the band's rule.
    const tabList = screen.getByTestId("screener-tab-list") as HTMLElement;
    expect(tabList.style.getPropertyValue("border-bottom-width")).toBe("0px");

    // Outer padding belongs to the page frame, not to the content region.
    expect(screen.getByTestId("screener-content").className).not.toMatch(/\bpx-2\b/);
  });

  it("keeps the chrome controls on one height tier for the 28px band", () => {
    render(() => (
      <UIProvider>
        <ScreenerPage {...defaultProps} />
      </UIProvider>), { initialRoute: "/?tab=screener" });

    const controls = [
      within(screen.getByTestId("screener-select")).getByRole("combobox"),
    ];
    for (const control of controls) {
      const height = declaredHeightPx(control);
      expect(height, `${control.getAttribute("data-testid")} declares no height`).not.toBeNull();
      expect(height!).toBeLessThanOrEqual(28);
    }
  });
});
