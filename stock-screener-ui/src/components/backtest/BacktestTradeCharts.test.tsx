// @vitest-environment happy-dom
import { describe, expect, test, vi, beforeAll } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forwardRef } from "react";
import { UIProvider } from "@/ui";
import type { SymbolChartData } from "../../types/backtest";
import { BacktestTradeCharts } from "./BacktestTradeCharts";
import "@testing-library/jest-dom/vitest";

// The real chart is heavy (lightweight-charts); stub it — this test covers the
// per-trade row/list logic, not chart rendering.
vi.mock("../chart/TradingViewChart", () => ({
  TradingViewChart: forwardRef((props: { markLines?: unknown }, _ref: unknown) => (
    <div data-testid="tv" data-marklines={JSON.stringify(props.markLines ?? [])} />
  )),
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

  test("keeps the symbol switcher visible when a symbol has zero trades", () => {
    const data = { ...makeChartData(), trades: [] } as unknown as SymbolChartData;
    render(
      <BacktestTradeCharts chartData={data} symbols={["NETWEB", "SBILIFE"]} selectedSymbol="NETWEB" onSymbolSelect={() => {}} />,
      { wrapper: UIProvider },
    );
    expect(screen.getByTestId("trade-charts-header")).toBeInTheDocument();
    expect(screen.getByTestId("trade-symbol-tab-SBILIFE")).toBeInTheDocument();
    cleanup();
  });

  test("derives SL/TP level lines from strategy params", () => {
    render(
      <BacktestTradeCharts chartData={makeChartData()} params={{ sl_pct: 1.0, take_profit_pct: 2.0 }} strategyType="ORB" />,
      { wrapper: UIProvider },
    );
    const lines = screen.getByTestId("tv").getAttribute("data-marklines") ?? "";
    expect(lines).toContain("SL 99.0");
    expect(lines).toContain("TP 102.0");
    cleanup();
  });

  test("uses 52w_high as SL for the 52W Chaser strategy", () => {
    const data = makeChartData();
    (data.trades[0].trade as unknown as Record<string, number>)["52w_high"] = 97.5;
    render(
      <BacktestTradeCharts chartData={data} params={{ stop_loss_pct: 5, take_profit_pct: 2.0 }} strategyType="52W_CHASER" />,
      { wrapper: UIProvider },
    );
    const lines = screen.getByTestId("tv").getAttribute("data-marklines") ?? "";
    expect(lines).toContain("SL 97.5");
    cleanup();
  });

  function makeTwoTradeData(): SymbolChartData {
    const base = makeChartData();
    const mk = (id: number, type: "entry" | "exit", net: number) => ({
      trade_id: id, type, time: "2026-05-07T09:15:00", date: "2026-05-07", candle_idx: 0, price: 100,
      marker: { symbol: "triangle", color: "#00f", size: 10 },
      trade: {
        entry_price: 100, exit_price: 102, quantity: 10, gross_pnl: net, trading_costs: 0,
        net_pnl: net, net_pnl_pct: 1, exit_reason: "TP", hold_duration_minutes: 60,
        or_high: 105, or_low: 95,
      },
    });
    return {
      ...base,
      trades: [mk(1, "entry", 10), mk(1, "exit", 10), mk(2, "entry", -5), mk(2, "exit", -5)],
    } as unknown as SymbolChartData;
  }

  test("applies filters to the per-trade chart list", () => {
    render(
      <BacktestTradeCharts chartData={makeTwoTradeData()} filters={{ side: "ALL", result: "WIN", reason: "ALL" }} />,
      { wrapper: UIProvider },
    );
    expect(screen.getAllByTestId("tv")).toHaveLength(1);
    cleanup();
  });

  test("shows a filtered-empty message when no trade matches", () => {
    render(
      <BacktestTradeCharts chartData={makeChartData()} filters={{ side: "SHORT", result: "ALL", reason: "ALL" }} />,
      { wrapper: UIProvider },
    );
    expect(screen.queryByTestId("trade-charts")).toBeNull();
    expect(screen.getByText("No trades match the current filters.")).toBeInTheDocument();
    cleanup();
  });

  test("labels each row with its symbol and shows symbol tabs", async () => {
    const onSelect = vi.fn();
    render(
      <BacktestTradeCharts
        chartData={makeChartData()}
        symbols={["NETWEB", "SBILIFE"]}
        selectedSymbol="NETWEB"
        onSymbolSelect={onSelect}
      />,
      { wrapper: UIProvider },
    );
    expect(screen.getByTestId("trade-symbol-tab-NETWEB")).toBeInTheDocument();
    expect(screen.getByTestId("trade-symbol-tab-SBILIFE")).toBeInTheDocument();
    // per-row symbol chip
    expect(screen.getAllByText("NETWEB").length).toBeGreaterThanOrEqual(2);

    await userEvent.click(screen.getByTestId("trade-symbol-tab-SBILIFE"));
    expect(onSelect).toHaveBeenCalledWith("SBILIFE");
    cleanup();
  });

  test("keeps stable trade numbers under filters so scroll-to-trade matches the blotter", () => {
    const base = makeChartData();
    const mk = (id: number, type: "entry" | "exit", net: number, reason: string) => ({
      trade_id: id, type, time: "2026-05-07T09:15:00", date: "2026-05-07", candle_idx: 0, price: 100,
      marker: { symbol: "triangle", color: "#00f", size: 10 },
      trade: {
        entry_price: 100, exit_price: 102, quantity: 10, gross_pnl: net, trading_costs: 0,
        net_pnl: net, net_pnl_pct: 1, exit_reason: reason, hold_duration_minutes: 60,
        or_high: 105, or_low: 95,
      },
    });
    const data = {
      ...base,
      trades: [mk(1, "entry", -5, "EOD"), mk(1, "exit", -5, "EOD"), mk(2, "entry", 10, "TP"), mk(2, "exit", 10, "TP")],
    } as unknown as SymbolChartData;

    render(
      <BacktestTradeCharts chartData={data} filters={{ side: "ALL", result: "WIN", reason: "ALL" }} />,
      { wrapper: UIProvider },
    );
    const rows = screen.getByTestId("trade-charts").querySelectorAll("[data-trade-number]");
    // the surviving (winning) trade is #2 in the unfiltered list — not re-indexed to #1
    expect(rows).toHaveLength(1);
    expect(rows[0].getAttribute("data-trade-number")).toBe("2");
    cleanup();
  });
});
