// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StrategiesState, StrategyPerformance } from "../../types/strategies";
import {
  renderPerformanceView,
  initPerformanceHandlers,
  selectStrategyById,
  getSelectedStrategyId,
  clearPerformanceCache,
} from "./performance";

const mockGetStrategyTrades = vi.fn();
vi.mock("../../api/strategies", () => ({
  getStrategyTrades: (...args: unknown[]) => mockGetStrategyTrades(...args),
}));

const mockTriggerRerender = vi.fn();
vi.mock("../../state/strategies", () => ({
  triggerRerender: () => mockTriggerRerender(),
}));

function makePerformance(overrides: Partial<StrategyPerformance> = {}): StrategyPerformance {
  return {
    strategy_id: 1,
    strategy_name: "Test Strategy",
    total_trades: 10,
    winners: 6,
    losers: 4,
    win_rate: 60,
    total_pnl: 5000,
    net_pnl: 3000,
    ...overrides,
  };
}

function makeState(overrides: Partial<StrategiesState> = {}): StrategiesState {
  return {
    strategies: [],
    templates: [],
    selectedStrategy: null,
    selectedVariations: [],
    performance: null,
    allPerformance: [],
    bots: [],
    isLoading: false,
    error: null,
    showCreateModal: false,
    showEditModal: false,
    editingStrategy: null,
    parentTemplate: null,
    ...overrides,
  };
}

beforeEach(() => {
  clearPerformanceCache();
  vi.clearAllMocks();
});

describe("renderPerformanceView", () => {
  it("returns empty state message when allPerformance is empty", () => {
    const state = makeState({ allPerformance: [] });
    const html = renderPerformanceView(state);
    expect(html).toContain("No strategy performance data available.");
    expect(html).toContain("strategies-empty");
  });

  it("renders summary cards with correct totals for single strategy", () => {
    const state = makeState({
      allPerformance: [makePerformance()],
    });
    const html = renderPerformanceView(state);

    expect(html).toContain("performance-summary");
    expect(html).toContain("Total Trades");
    expect(html).toContain("10");
    expect(html).toContain("60.0%");
    expect(html).toContain("Overall Win Rate");
  });

  it("renders performance table for multiple strategies", () => {
    const state = makeState({
      allPerformance: [
        makePerformance({ strategy_id: 1, strategy_name: "Strategy A", net_pnl: 2000 }),
        makePerformance({ strategy_id: 2, strategy_name: "Strategy B", net_pnl: 5000 }),
      ],
    });
    const html = renderPerformanceView(state);

    expect(html).toContain("performance-table");
    expect(html).toContain("Strategy A");
    expect(html).toContain("Strategy B");
    expect(html).toContain("performance-chart-container");
  });

  it("sorts strategies by net_pnl descending in table rows", () => {
    const state = makeState({
      allPerformance: [
        makePerformance({ strategy_id: 1, strategy_name: "Low PnL", net_pnl: 1000 }),
        makePerformance({ strategy_id: 2, strategy_name: "High PnL", net_pnl: 5000 }),
        makePerformance({ strategy_id: 3, strategy_name: "Mid PnL", net_pnl: 3000 }),
      ],
    });
    const html = renderPerformanceView(state);

    const lowIdx = html.indexOf("Low PnL");
    const midIdx = html.indexOf("Mid PnL");
    const highIdx = html.indexOf("High PnL");

    expect(highIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(lowIdx);
  });

  it("calculates correct totals across multiple strategies", () => {
    const state = makeState({
      allPerformance: [
        makePerformance({
          total_trades: 10,
          winners: 6,
          losers: 4,
          total_pnl: 5000,
          net_pnl: 3000,
        }),
        makePerformance({
          total_trades: 20,
          winners: 12,
          losers: 8,
          total_pnl: 10000,
          net_pnl: 7000,
        }),
      ],
    });
    const html = renderPerformanceView(state);

    expect(html).toContain("30");
    expect(html).toContain("60.0%");
  });

  it("handles all-zero performance data (division by zero)", () => {
    const state = makeState({
      allPerformance: [
        makePerformance({
          total_trades: 0,
          winners: 0,
          losers: 0,
          win_rate: 0,
          total_pnl: 0,
          net_pnl: 0,
        }),
      ],
    });
    const html = renderPerformanceView(state);

    expect(html).toContain("0.0%");
    expect(html).toContain("performance-summary");
  });

  it("handles negative net PnL with negative CSS classes", () => {
    const state = makeState({
      allPerformance: [
        makePerformance({ net_pnl: -5000, total_pnl: -3000, winners: 3, losers: 7 }),
      ],
    });
    const html = renderPerformanceView(state);

    expect(html).toContain("negative");
    expect(html).toContain("📉");
    expect(html).toContain("💸");
  });

  it("handles positive net PnL with positive CSS classes", () => {
    const state = makeState({
      allPerformance: [makePerformance({ net_pnl: 5000, total_pnl: 7000, winners: 7, losers: 3 })],
    });
    const html = renderPerformanceView(state);

    expect(html).toContain("positive");
    expect(html).toContain("📈");
    expect(html).toContain("💰");
  });

  it("renders performance bars chart with correct strategy data", () => {
    const state = makeState({
      allPerformance: [
        makePerformance({ strategy_id: 1, strategy_name: "Alpha", net_pnl: 2000 }),
        makePerformance({ strategy_id: 2, strategy_name: "Beta", net_pnl: -3000 }),
      ],
    });
    const html = renderPerformanceView(state);

    expect(html).toContain("performance-bars");
    expect(html).toContain("performance-bar-item");
    expect(html).toContain("Alpha");
    expect(html).toContain("Beta");
  });

  it("renders strategy detail view when a strategy is selected", async () => {
    mockGetStrategyTrades.mockResolvedValue({ trades: [] });
    initPerformanceHandlers();

    await (window as any).selectStrategyForDetail(1);

    const state = makeState({
      allPerformance: [makePerformance({ strategy_id: 1, strategy_name: "My Strategy" })],
    });
    const html = renderPerformanceView(state);

    expect(html).toContain("strategy-detail-panel");
    expect(html).toContain("My Strategy");
    expect(html).toContain("Back to Overview");
  });

  it("renders trade rows when selected strategy has cached trades", async () => {
    mockGetStrategyTrades.mockResolvedValue({
      trades: [
        {
          symbol: "RELIANCE",
          side: "BUY",
          quantity: 10,
          entry_price: 2500.5,
          exit_price: 2600.75,
          net_pnl: 1002.5,
          exit_reason: "TP",
          exit_time: "2025-06-20T14:45:00+05:30",
        },
      ],
    });
    initPerformanceHandlers();

    await (window as any).selectStrategyForDetail(1);

    const state = makeState({
      allPerformance: [makePerformance({ strategy_id: 1 })],
    });
    const html = renderPerformanceView(state);

    expect(html).toContain("RELIANCE");
    expect(html).toContain("side-long");
    expect(html).toContain("trade-win");
    expect(html).toContain("TP");
  });

  it("shows empty trades message when selected strategy has no trades", async () => {
    mockGetStrategyTrades.mockResolvedValue({ trades: [] });
    initPerformanceHandlers();

    await (window as any).selectStrategyForDetail(1);

    const state = makeState({
      allPerformance: [makePerformance({ strategy_id: 1 })],
    });
    const html = renderPerformanceView(state);

    expect(html).toContain("No trades found for this strategy.");
  });

  it("renders strategy detail with negative PnL trade", async () => {
    mockGetStrategyTrades.mockResolvedValue({
      trades: [
        {
          symbol: "TCS",
          side: "SELL",
          quantity: 5,
          entry_price: 3800.0,
          exit_price: 3900.0,
          net_pnl: -500,
          exit_reason: "SL",
          exit_time: "2025-06-20T10:30:00+05:30",
        },
      ],
    });
    initPerformanceHandlers();

    await (window as any).selectStrategyForDetail(1);

    const state = makeState({
      allPerformance: [makePerformance({ strategy_id: 1 })],
    });
    const html = renderPerformanceView(state);

    expect(html).toContain("TCS");
    expect(html).toContain("side-short");
    expect(html).toContain("SL");
    expect(html).toContain("trade-loss");
  });

  it("uses win_rate class 'good' for win_rate >= 60", () => {
    const state = makeState({
      allPerformance: [makePerformance({ win_rate: 75 })],
    });
    const html = renderPerformanceView(state);
    expect(html).toContain("win-rate-good");
  });

  it("uses win_rate class 'average' for win_rate >= 40 and < 60", () => {
    const state = makeState({
      allPerformance: [makePerformance({ win_rate: 50 })],
    });
    const html = renderPerformanceView(state);
    expect(html).toContain("win-rate-average");
  });

  it("uses win_rate class 'poor' for win_rate < 40", () => {
    const state = makeState({
      allPerformance: [makePerformance({ win_rate: 25 })],
    });
    const html = renderPerformanceView(state);
    expect(html).toContain("win-rate-poor");
  });

  it("includes data-testid attributes for key elements", () => {
    const state = makeState({
      allPerformance: [makePerformance()],
    });
    const html = renderPerformanceView(state);

    expect(html).toContain('data-testid="performance-view"');
    expect(html).toContain('data-testid="performance-summary"');
    expect(html).toContain('data-testid="performance-table-container"');
    expect(html).toContain('data-testid="performance-table"');
    expect(html).toContain('data-testid="performance-chart-container"');
    expect(html).toContain('data-testid="performance-bars"');
  });

  it("includes data-strategy-id on performance rows", () => {
    const state = makeState({
      allPerformance: [makePerformance({ strategy_id: 42 })],
    });
    const html = renderPerformanceView(state);
    expect(html).toContain('data-strategy-id="42"');
  });

  it("shows warning emoji when overall win rate is below 50%", () => {
    const state = makeState({
      allPerformance: [makePerformance({ total_trades: 10, winners: 4, losers: 6 })],
    });
    const html = renderPerformanceView(state);
    expect(html).toContain("⚠️");
  });

  it("shows checkmark emoji when overall win rate is 50% or above", () => {
    const state = makeState({
      allPerformance: [makePerformance({ total_trades: 10, winners: 5, losers: 5 })],
    });
    const html = renderPerformanceView(state);
    expect(html).toContain("✅");
  });
});

describe("getSelectedStrategyId", () => {
  it("returns null initially", () => {
    expect(getSelectedStrategyId()).toBeNull();
  });

  it("returns strategy id after selection", async () => {
    mockGetStrategyTrades.mockResolvedValue({ trades: [] });
    initPerformanceHandlers();

    await (window as any).selectStrategyForDetail(5);

    expect(getSelectedStrategyId()).toBe(5);
  });
});

describe("clearPerformanceCache", () => {
  it("resets selected strategy id to null", async () => {
    mockGetStrategyTrades.mockResolvedValue({ trades: [] });
    initPerformanceHandlers();

    await (window as any).selectStrategyForDetail(7);
    expect(getSelectedStrategyId()).toBe(7);

    clearPerformanceCache();
    expect(getSelectedStrategyId()).toBeNull();
  });
});

describe("initPerformanceHandlers", () => {
  it("attaches selectStrategyForDetail to window", () => {
    initPerformanceHandlers();
    expect(typeof (window as any).selectStrategyForDetail).toBe("function");
  });

  it("attaches clearSelectedStrategy to window", () => {
    initPerformanceHandlers();
    expect(typeof (window as any).clearSelectedStrategy).toBe("function");
  });

  it("attaches viewAllStrategyTrades to window", () => {
    initPerformanceHandlers();
    expect(typeof (window as any).viewAllStrategyTrades).toBe("function");
  });

  it("clearSelectedStrategy resets selected strategy", async () => {
    mockGetStrategyTrades.mockResolvedValue({ trades: [] });
    initPerformanceHandlers();

    await (window as any).selectStrategyForDetail(3);
    expect(getSelectedStrategyId()).toBe(3);

    (window as any).clearSelectedStrategy();
    expect(getSelectedStrategyId()).toBeNull();
    expect(mockTriggerRerender).toHaveBeenCalled();
  });

  it("viewAllStrategyTrades sets localStorage filterStrategy", () => {
    initPerformanceHandlers();
    localStorage.clear();

    (window as any).viewAllStrategyTrades(42);

    expect(localStorage.getItem("filterStrategy")).toBe("42");
  });
});

describe("selectStrategyById", () => {
  it("selects strategy by id", async () => {
    mockGetStrategyTrades.mockResolvedValue({ trades: [] });

    await selectStrategyById(10);

    expect(getSelectedStrategyId()).toBe(10);
  });

  it("selects strategy by id with different id", async () => {
    mockGetStrategyTrades.mockResolvedValue({ trades: [] });

    await selectStrategyById(20);

    expect(getSelectedStrategyId()).toBe(20);
  });

  it("handles zero id", async () => {
    mockGetStrategyTrades.mockResolvedValue({ trades: [] });

    await selectStrategyById(0);

    expect(getSelectedStrategyId()).toBe(0);
  });
});
