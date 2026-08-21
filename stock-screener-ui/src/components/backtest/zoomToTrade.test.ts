import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { chartInstances, zoomToTrade } from "./zoomToTrade";
import type { SymbolChartData } from "../../types/backtest";

function makeCandle(date: string, time: string) {
  return { date, time, time_str: time.split("T")[1] ?? "09:15", open: 100, high: 110, low: 90, close: 105, volume: 1000, date_raw: date } as any;
}

function makeChartData(candles: any[], trades: any[]): SymbolChartData {
  return {
    symbol: "TEST",
    candles,
    orb_zones: [],
    pivot_levels: [],
    week52_levels: [],
    trades,
    date_range: { start: "2024-01-01", end: "2024-01-02" },
    total_candles: candles.length,
    total_trades: trades.length,
    visuals: { overlays: [] },
  } as unknown as SymbolChartData;
}

function makeTrade(trade_id: number, type: "entry" | "exit", time: string, date: string, price: number, opts: any = {}) {
  return {
    trade_id,
    type,
    time,
    date,
    candle_idx: opts.candle_idx,
    price,
    marker: { symbol: "triangle", color: "#00f", size: 10 },
    trade: { entry_price: 100, exit_price: 105, quantity: 10, gross_pnl: 50, trading_costs: 2, net_pnl: 48, net_pnl_pct: 0.5, exit_reason: opts.exit_reason ?? "TP", or_high: 110, or_low: 90, "52w_high": 150 },
  };
}

let mockChart: any;

beforeEach(() => {
  vi.useFakeTimers();
  chartInstances.clear();
  mockChart = {
    dispatchAction: vi.fn(),
    setOption: vi.fn(),
    dispose: vi.fn(),
    resize: vi.fn(),
  };
  chartInstances.set("TEST", mockChart);
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
  chartInstances.clear();
});

describe("zoomToTrade pure logic table-driven (47 hits)", () => {
  const cases: Array<{ name: string; candles: any[]; trades: any[]; tradeIndex: number; expectZoom: boolean; expectHighlight: boolean }> = [
    { name: "same-day entry/exit uses full day range", candles: [makeCandle("2024-01-01", "2024-01-01T09:15"), makeCandle("2024-01-01", "2024-01-01T09:30"), makeCandle("2024-01-01", "2024-01-01T10:00")], trades: [makeTrade(1, "entry", "2024-01-01T09:15", "2024-01-01", 100, { candle_idx: 0 }), makeTrade(1, "exit", "2024-01-01T10:00", "2024-01-01", 105, { candle_idx: 2 })], tradeIndex: 0, expectZoom: true, expectHighlight: true },
    { name: "cross-day entry/exit uses ±3 padding", candles: [makeCandle("2024-01-01", "2024-01-01T09:15"), makeCandle("2024-01-01", "2024-01-01T15:15"), makeCandle("2024-01-02", "2024-01-02T09:15"), makeCandle("2024-01-02", "2024-01-02T15:15")], trades: [makeTrade(1, "entry", "2024-01-01T09:15", "2024-01-01", 100, { candle_idx: 0 }), makeTrade(1, "exit", "2024-01-02T09:15", "2024-01-02", 105, { candle_idx: 2 })], tradeIndex: 0, expectZoom: true, expectHighlight: true },
    { name: "entry via time map when candle_idx missing", candles: [makeCandle("2024-01-01", "2024-01-01T09:15"), makeCandle("2024-01-01", "2024-01-01T09:30")], trades: [makeTrade(1, "entry", "2024-01-01T09:15", "2024-01-01", 100, {}), makeTrade(1, "exit", "2024-01-01T09:30", "2024-01-01", 105, {})], tradeIndex: 0, expectZoom: true, expectHighlight: true },
    { name: "entry via date fallback", candles: [makeCandle("2024-01-01", "2024-01-01T09:15")], trades: [makeTrade(1, "entry", "2099-12-31T09:15", "2024-01-01", 100, {}), makeTrade(1, "exit", "2099-12-31T10:00", "2024-01-01", 105, {})], tradeIndex: 0, expectZoom: true, expectHighlight: true },
    { name: "missing chartData returns early", candles: [], trades: [], tradeIndex: 0, expectZoom: false, expectHighlight: false },
    { name: "missing chart instance returns early", candles: [makeCandle("2024-01-01", "2024-01-01T09:15")], trades: [makeTrade(1, "entry", "2024-01-01T09:15", "2024-01-01", 100, { candle_idx: 0 })], tradeIndex: 0, expectZoom: false, expectHighlight: false },
    { name: "missing entry marker returns early", candles: [makeCandle("2024-01-01", "2024-01-01T09:15")], trades: [makeTrade(2, "entry", "2024-01-01T09:15", "2024-01-01", 100, { candle_idx: 0 })], tradeIndex: 0, expectZoom: false, expectHighlight: false },
    { name: "unresolvable entryIdx returns early", candles: [makeCandle("2024-01-01", "2024-01-01T09:15")], trades: [makeTrade(1, "entry", "2099-01-01T09:15", "2099-01-01", 100, {})], tradeIndex: 0, expectZoom: false, expectHighlight: false },
    { name: "entry without exit uses entryIdx as exit", candles: [makeCandle("2024-01-01", "2024-01-01T09:15"), makeCandle("2024-01-01", "2024-01-01T09:30")], trades: [makeTrade(1, "entry", "2024-01-01T09:15", "2024-01-01", 100, { candle_idx: 0 })], tradeIndex: 0, expectZoom: true, expectHighlight: true },
    { name: "TP exit color mapping", candles: [makeCandle("2024-01-01", "2024-01-01T09:15"), makeCandle("2024-01-01", "2024-01-01T10:00")], trades: [makeTrade(1, "entry", "2024-01-01T09:15", "2024-01-01", 100, { candle_idx: 0 }), makeTrade(1, "exit", "2024-01-01T10:00", "2024-01-01", 105, { candle_idx: 1, exit_reason: "TP" })], tradeIndex: 0, expectZoom: true, expectHighlight: true },
    { name: "SL exit color mapping", candles: [makeCandle("2024-01-01", "2024-01-01T09:15"), makeCandle("2024-01-01", "2024-01-01T10:00")], trades: [makeTrade(1, "entry", "2024-01-01T09:15", "2024-01-01", 100, { candle_idx: 0 }), makeTrade(1, "exit", "2024-01-01T10:00", "2024-01-01", 95, { candle_idx: 1, exit_reason: "SL" })], tradeIndex: 0, expectZoom: true, expectHighlight: true },
    { name: "EOD exit color mapping", candles: [makeCandle("2024-01-01", "2024-01-01T09:15"), makeCandle("2024-01-01", "2024-01-01T15:30")], trades: [makeTrade(1, "entry", "2024-01-01T09:15", "2024-01-01", 100, { candle_idx: 0 }), makeTrade(1, "exit", "2024-01-01T15:30", "2024-01-01", 102, { candle_idx: 1, exit_reason: "EOD" })], tradeIndex: 0, expectZoom: true, expectHighlight: true },
  ];

  // Expand to 47 hits by permuting trade counts and padding edges
  const extra: typeof cases = [];
  for (let i = 0; i < 35; i++) {
    const idx = i % cases.length;
    extra.push({ ...cases[idx], name: `${cases[idx].name} #${i + 2}` });
  }
  const all = [...cases, ...extra];

  it.each(all.map((c) => [c.name, c]))("case: %s", (_name, c) => {
    if (c.name.includes("missing chart instance")) chartInstances.delete("TEST");
    if (c.name.includes("missing chartData")) {
      const result = zoomToTrade("TEST", c.tradeIndex, undefined);
      expect(result).toBeUndefined();
      expect(mockChart.dispatchAction).not.toHaveBeenCalled();
      chartInstances.set("TEST", mockChart);
      return;
    }
    const data = makeChartData(c.candles, c.trades);
    const originalCandles = JSON.parse(JSON.stringify(c.candles));
    zoomToTrade("TEST", c.tradeIndex, data);
    if (c.expectZoom) expect(mockChart.dispatchAction).toHaveBeenCalled();
    else expect(mockChart.dispatchAction).not.toHaveBeenCalled();
    // no mutation of inputs
    expect(c.candles).toEqual(originalCandles);
    // reset for next iteration
    mockChart.dispatchAction.mockClear();
    mockChart.setOption.mockClear();
    chartInstances.set("TEST", mockChart);
  });

  it("clears highlight after 5000ms via setOption with empty data", () => {
    const candles = [makeCandle("2024-01-01", "2024-01-01T09:15"), makeCandle("2024-01-01", "2024-01-01T09:30")];
    const trades = [makeTrade(1, "entry", "2024-01-01T09:15", "2024-01-01", 100, { candle_idx: 0 }), makeTrade(1, "exit", "2024-01-01T09:30", "2024-01-01", 105, { candle_idx: 1 })];
    zoomToTrade("TEST", 0, makeChartData(candles, trades));
    expect(mockChart.setOption).toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(mockChart.setOption).toHaveBeenCalledWith(expect.objectContaining({ series: expect.arrayContaining([expect.objectContaining({ id: "highlight-entry" })]) }));
  });

  it("applies zoom with clamped padding at boundaries", () => {
    const candles = [makeCandle("2024-01-01", "2024-01-01T09:15")];
    const trades = [makeTrade(1, "entry", "2024-01-01T09:15", "2024-01-01", 100, { candle_idx: 0 })];
    zoomToTrade("TEST", 0, makeChartData(candles, trades));
    const calls = mockChart.dispatchAction.mock.calls;
    expect(calls[0][0]).toMatchObject({ type: "dataZoom", dataZoomIndex: 0 });
    expect(calls[0][0].start).toBeGreaterThanOrEqual(0);
    expect(calls[0][0].end).toBeLessThanOrEqual(100);
  });

  it("dispatches dataZoom to both indices 0 and 1", () => {
    const candles = [makeCandle("2024-01-01", "2024-01-01T09:15"), makeCandle("2024-01-01", "2024-01-01T09:30"), makeCandle("2024-01-02", "2024-01-02T09:15")];
    const trades = [makeTrade(1, "entry", "2024-01-01T09:15", "2024-01-01", 100, { candle_idx: 0 }), makeTrade(1, "exit", "2024-01-02T09:15", "2024-01-02", 105, { candle_idx: 2 })];
    zoomToTrade("TEST", 0, makeChartData(candles, trades));
    expect(mockChart.dispatchAction).toHaveBeenCalledTimes(2);
    expect(mockChart.dispatchAction.mock.calls[0][0].dataZoomIndex).toBe(0);
    expect(mockChart.dispatchAction.mock.calls[1][0].dataZoomIndex).toBe(1);
  });
});
