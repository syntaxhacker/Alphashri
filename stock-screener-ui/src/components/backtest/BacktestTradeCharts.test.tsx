// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { forwardRef } from "react";
import { UIProvider } from "@/ui";
import type { SymbolChartData } from "../../types/backtest";
import { BacktestTradeCharts } from "./BacktestTradeCharts";
import "@testing-library/jest-dom/vitest";

// The real chart is heavy (lightweight-charts); stub it — this test covers the
// per-trade row/list logic, not chart rendering.
vi.mock("../chart/TradingViewChart", () => ({
  TradingViewChart: forwardRef((_props: unknown, _ref: unknown) => <div data-testid="tv" />),
}));

beforeAll(() => {
  class IO {
    cb: IntersectionObserverCallback;
    constructor(cb: IntersectionObserverCallback) { this.cb = cb; }
    observe(el: Element) { this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect() {}
    unobserve() {}
    takeRecords() { return []; }
    root = null; rootMargin = ""; thresholds = [];
  }
  global.IntersectionObserver = IO as unknown as typeof IntersectionObserver;
});

function makeChartData(): SymbolChartData {
  const candles = [0, 1, 2, 3, 4, 5].map((i) => ({
    time: `2026-05-07T09:${String(15 + i).padStart(2, "0")}:00`,
    date: "2026-05-07",
    time_str: `09:${String(15 + i).padStart(2, "0")}`,
    open: 100 + i, high: 101 + i, low: 99 + i, close: 100 + i, volume: 1000,
  }));
  const mk = (id: number, type: "entry" | "exit", time: string, price: number) => ({
    trade_id: id, type, time, date: "2026-05-07", candle_idx: 0, price,
    marker: { symbol: "triangle", color: "#00f", size: 10 },
    trade: {
      entry_price: 100, exit_price: 102, quantity: 10, gross_pnl: 20, trading_costs: 2,
      net_pnl: 18, net_pnl_pct: 1.8, exit_reason: "TP" as const, hold_duration_minutes: 60,
      or_high: 105, or_low: 95,
    },
  });
  return {
    symbol: "NETWEB",
    candles,
    orb_zones: [],
    pivot_levels: [],
    week52_levels: [],
    trades: [mk(1, "entry", "2026-05-07T09:15:00", 100), mk(1, "exit", "2026-05-07T09:20:00", 102)],
    date_range: { start: "2026-05-07", end: "2026-05-07" },
    total_candles: candles.length,
    total_trades: 1,
  } as unknown as SymbolChartData;
}

describe("BacktestTradeCharts", () => {
  test("renders one row per trade with its own chart", () => {
    render(<BacktestTradeCharts chartData={makeChartData()} />, { wrapper: UIProvider });
    expect(screen.getByTestId("trade-charts")).toBeInTheDocument();
    expect(screen.getAllByTestId("tv")).toHaveLength(1);
    cleanup();
  });

  test("empty state when no trades", () => {
    const data = { ...makeChartData(), trades: [] } as unknown as SymbolChartData;
    render(<BacktestTradeCharts chartData={data} />, { wrapper: UIProvider });
    expect(screen.queryByTestId("trade-charts")).toBeNull();
    expect(screen.getByText("No trades to show.")).toBeInTheDocument();
    cleanup();
  });
});
