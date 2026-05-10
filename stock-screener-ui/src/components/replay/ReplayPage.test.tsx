// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { MantineProvider } from "@mantine/core";
import { setupBrowserMocks } from "../../test-utils/setupBrowser";

const { mockUseReplayState } = vi.hoisted(() => ({
  mockUseReplayState: vi.fn(() => ({
    config: { date: "2025-01-15", strategy: "ALL", symbols: "DEFAULT", refresh_cache: false, bot_uuid: "" },
    isRunning: false,
    progress: null,
    trades: [],
    openPositions: [],
    orLevels: [],
    pivotLevels: [],
    high52wLevels: [],
    emaData: {},
    summary: null,
    candlesBySymbol: {},
    selectedSymbol: "",
    strategyFilter: "ALL",
    error: null,
    totalCandles: 0,
    totalSymbols: 0,
    chartOptions: { show_orb_zones: false, show_pivot_levels: false, show_52w_high: false, show_ema: false, show_markers: false, show_all_trades: false },
    highlightedTradeId: null,
    setConfig: vi.fn(),
    startReplay: vi.fn(),
    stopReplay: vi.fn(),
    reset: vi.fn(),
    setSelectedSymbol: vi.fn(),
    setStrategyFilter: vi.fn(),
    setChartOptions: vi.fn(),
    setHighlightedTrade: vi.fn(),
    loadSymbols: vi.fn(),
  })),
}));

vi.mock("../../hooks/useReplayState", () => ({
  useReplayState: mockUseReplayState,
}));

vi.mock("./ReplayConfig", () => ({
  ReplayConfigBar: (props: any) => <div data-testid="replay-config">ReplayConfig</div>,
}));

vi.mock("./ReplayStats", () => ({
  ReplayStats: (props: any) => <div data-testid="replay-stats">ReplayStats</div>,
}));

vi.mock("./ReplayPositions", () => ({
  ReplayPositions: (props: any) => props.positions.length > 0 ? <div data-testid="replay-positions">ReplayPositions</div> : null,
}));

vi.mock("./ReplayMainView", () => ({
  ReplayMainView: (props: any) => <div data-testid="replay-main-view">ReplayMainView</div>,
}));

vi.mock("./ReplaySummary", () => ({
  ReplaySummaryPanel: (props: any) => props.summary ? <div data-testid="replay-summary">ReplaySummary</div> : null,
}));

afterEach(() => cleanup());

describe("ReplayPage", () => {
  it("renders page with data-testid", async () => {
    const { ReplayPage } = await import("./ReplayPage");
    render(
      <MantineProvider>
        <ReplayPage />
      </MantineProvider>,
    );
    expect(screen.getByTestId("replay-page")).toBeInTheDocument();
  });

  it("renders title and description text", async () => {
    const { ReplayPage } = await import("./ReplayPage");
    render(
      <MantineProvider>
        <ReplayPage />
      </MantineProvider>,
    );
    expect(screen.getByText("Replay Trading Day")).toBeInTheDocument();
    expect(screen.getByText("Simulate paper trading using historical candles")).toBeInTheDocument();
  });

  it("renders ReplayConfigBar component", async () => {
    const { ReplayPage } = await import("./ReplayPage");
    render(
      <MantineProvider>
        <ReplayPage />
      </MantineProvider>,
    );
    expect(screen.getByTestId("replay-config")).toBeInTheDocument();
  });

  it("renders ReplayStats component", async () => {
    const { ReplayPage } = await import("./ReplayPage");
    render(
      <MantineProvider>
        <ReplayPage />
      </MantineProvider>,
    );
    expect(screen.getByTestId("replay-stats")).toBeInTheDocument();
  });

  it("hides ReplayPositions when no open positions", async () => {
    const { ReplayPage } = await import("./ReplayPage");
    render(
      <MantineProvider>
        <ReplayPage />
      </MantineProvider>,
    );
    expect(screen.queryByTestId("replay-positions")).not.toBeInTheDocument();
  });

  it("renders ReplayMainView component", async () => {
    const { ReplayPage } = await import("./ReplayPage");
    render(
      <MantineProvider>
        <ReplayPage />
      </MantineProvider>,
    );
    expect(screen.getByTestId("replay-main-view")).toBeInTheDocument();
  });

  it("auto-selects first trade on replay completion", async () => {
    const setSelectedSymbol = vi.fn();
    const setHighlightedTrade = vi.fn();
    mockUseReplayState.mockReturnValue({
      config: { date: "2025-01-15", strategy: "ALL", symbols: "DEFAULT", refresh_cache: false, bot_uuid: "" },
      isRunning: false,
      progress: null,
      trades: [{ id: 1, symbol: "TCS", strategy: "ORB", side: "LONG", entry_price: 100, exit_price: 110, entry_time: "09:15", exit_time: "09:30", pnl: 10, net_pnl: 9.5, costs: 0.5, exit_reason: "TP", quantity: 100 }],
      openPositions: [],
      orLevels: [],
      pivotLevels: [],
      high52wLevels: [],
      emaData: {},
      summary: null,
      candlesBySymbol: {},
      selectedSymbol: "",
      strategyFilter: "ALL",
      error: null,
      totalCandles: 0,
      totalSymbols: 0,
      chartOptions: { show_orb_zones: false, show_pivot_levels: false, show_52w_high: false, show_ema: false, show_markers: false, show_all_trades: false },
      highlightedTradeId: null,
      setConfig: vi.fn(),
      startReplay: vi.fn(),
      stopReplay: vi.fn(),
      reset: vi.fn(),
      setSelectedSymbol,
      setStrategyFilter: vi.fn(),
      setChartOptions: vi.fn(),
      setHighlightedTrade,
      loadSymbols: vi.fn(),
    });
    const { ReplayPage } = await import("./ReplayPage");
    render(
      <MantineProvider>
        <ReplayPage />
      </MantineProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(setSelectedSymbol).toHaveBeenCalledWith("TCS");
    expect(setHighlightedTrade).toHaveBeenCalledWith(1);
  });

  it("does not auto-select when highlightedTradeId already set", async () => {
    const setSelectedSymbol = vi.fn();
    const setHighlightedTrade = vi.fn();
    mockUseReplayState.mockReturnValue({
      config: { date: "2025-01-15", strategy: "ALL", symbols: "DEFAULT", refresh_cache: false, bot_uuid: "" },
      isRunning: false,
      progress: null,
      trades: [{ id: 1, symbol: "TCS", strategy: "ORB", side: "LONG", entry_price: 100, exit_price: 110, entry_time: "09:15", exit_time: "09:30", pnl: 10, net_pnl: 9.5, costs: 0.5, exit_reason: "TP", quantity: 100 }],
      openPositions: [],
      orLevels: [],
      pivotLevels: [],
      high52wLevels: [],
      emaData: {},
      summary: null,
      candlesBySymbol: {},
      selectedSymbol: "",
      strategyFilter: "ALL",
      error: null,
      totalCandles: 0,
      totalSymbols: 0,
      chartOptions: { show_orb_zones: false, show_pivot_levels: false, show_52w_high: false, show_ema: false, show_markers: false, show_all_trades: false },
      highlightedTradeId: 5,
      setConfig: vi.fn(),
      startReplay: vi.fn(),
      stopReplay: vi.fn(),
      reset: vi.fn(),
      setSelectedSymbol,
      setStrategyFilter: vi.fn(),
      setChartOptions: vi.fn(),
      setHighlightedTrade,
      loadSymbols: vi.fn(),
    });
    const { ReplayPage } = await import("./ReplayPage");
    render(
      <MantineProvider>
        <ReplayPage />
      </MantineProvider>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(setSelectedSymbol).not.toHaveBeenCalled();
  });
});
