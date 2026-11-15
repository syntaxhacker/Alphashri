import { describe, expect, test } from "vitest";
import type { PaperChartData, PaperPosition } from "../../types/paperTrading";
import {
  MARKER_ENTRY,
  MARKER_TP,
  MARKER_SL,
  PIVOT_OR_HIGH,
  PIVOT_52W_HIGH,
  INDICATOR_BLUE_A,
  INDICATOR_BLUE_B,
} from "../../config/colors";

function buildChartLegendItems(orbLabel: string | undefined, hasWeek52: boolean) {
  const items = [
    { color: MARKER_ENTRY, label: "Entry", shape: "square" as const },
    { color: MARKER_TP, label: "TP", shape: "circle" as const },
    { color: MARKER_SL, label: "SL", shape: "circle" as const },
  ];
  if (orbLabel) items.push({ color: PIVOT_OR_HIGH, label: orbLabel, shape: "square" as const });
  if (hasWeek52) items.push({ color: PIVOT_52W_HIGH, label: "52W High", shape: "square" as const });
  return items;
}

const mockChartData = (overrides: Partial<PaperChartData> = {}): PaperChartData => ({
  symbol: "RELIANCE",
  date: "2026-04-24",
  candles: [
    { time: "2026-04-24T09:15:00", open: 2500, high: 2510, low: 2490, close: 2505, volume: 100000 },
    { time: "2026-04-24T09:30:00", open: 2505, high: 2520, low: 2500, close: 2515, volume: 150000 },
  ],
  trades: [],
  orb_levels: null,
  week52_levels: null,
  pivot_levels: null,
  current_position: null,
  ...overrides,
});

const mockPosition = (overrides: Partial<PaperPosition>): PaperPosition => ({
  symbol: "RELIANCE",
  side: "BUY",
  quantity: 100,
  entry_price: 2500,
  current_price: 2550,
  entry_time: "2026-04-24T09:30:00Z",
  stop_loss: 2450,
  take_profit: 2650,
  pnl: 5000,
  pnl_pct: 2.0,
  margin_used: 250000,
  order_id: "ord-1",
  strategy_id: 1,
  strategy_name: "ORB Strategy",
  ...overrides,
});

describe("PaperChart types", () => {
  describe("PaperChartData", () => {
    test("has required fields", () => {
      const chart = mockChartData();
      expect(chart.symbol).toBe("RELIANCE");
      expect(chart.date).toBe("2026-04-24");
      expect(chart.candles).toBeDefined();
      expect(chart.candles.length).toBe(2);
    });

    test("accepts optional actual_date", () => {
      const chart = mockChartData({
        date: "2026-04-25", // Saturday
        actual_date: "2026-04-24 to 2026-04-25",
      });
      expect(chart.actual_date).not.toBe(chart.date);
      expect(chart.actual_date).toContain("2026-04-24");
    });

    test("accepts orb_levels", () => {
      const chart = mockChartData({
        orb_levels: {
          or_high: 2510,
          or_low: 2490,
          or_open: 2500,
          or_range: 20,
          or_range_pct: 0.8,
          or_minutes: 30,
        },
      });
      expect(chart.orb_levels).not.toBeNull();
      expect(chart.orb_levels!.or_minutes).toBe(30);
      expect(chart.orb_levels!.or_range_pct).toBe(0.8);
    });

    test("accepts pivot_levels", () => {
      const chart = mockChartData({
        pivot_levels: {
          pp: 2500,
          r1: 2510,
          r2: 2520,
          s1: 2490,
          s2: 2480,
        },
      });
      expect(chart.pivot_levels).not.toBeNull();
      expect(chart.pivot_levels!.pp).toBe(2500);
    });

    test("accepts week52_levels", () => {
      const chart = mockChartData({
        week52_levels: {
          high_52w: 2800,
          low_52w: 2200,
          distance_to_high_pct: 10.7,
          distance_to_low_pct: 13.6,
          near_high: false,
        },
      });
      expect(chart.week52_levels).not.toBeNull();
      expect(chart.week52_levels!.high_52w).toBe(2800);
    });

    test("accepts current_position", () => {
      const chart = mockChartData({
        current_position: mockPosition({}),
      });
      expect(chart.current_position).not.toBeNull();
      expect(chart.current_position!.side).toBe("BUY");
      expect(chart.current_position!.pnl).toBe(5000);
    });

    test("accepts ema_series", () => {
      const chart = mockChartData({
        ema_series: {
          ema_fast: { label: "EMA 9", color: INDICATOR_BLUE_A, data: [2490, 2500, 2510] },
          ema_slow: { label: "EMA 21", color: INDICATOR_BLUE_B, data: [2480, 2490, 2500] },
        },
      });
      expect(chart.ema_series).not.toBeNull();
      expect(chart.ema_series!.ema_fast.label).toBe("EMA 9");
      expect(chart.ema_series!.ema_slow.data.length).toBe(3);
    });

    test("accepts empty candles (valid state)", () => {
      const chart = mockChartData({ candles: [] });
      expect(chart.candles).toBeDefined();
      expect(chart.candles.length).toBe(0);
    });
  });

  describe("CandleData", () => {
    test("has required OHLCV fields", () => {
      const candle = {
        time: "2026-04-24T09:15:00",
        open: 2500,
        high: 2510,
        low: 2490,
        close: 2505,
        volume: 100000,
      };
      expect(candle.open).toBe(2500);
      expect(candle.high).toBe(2510);
      expect(candle.low).toBe(2490);
      expect(candle.close).toBe(2505);
      expect(candle.volume).toBe(100000);
    });
  });
});

test.each([
  ["ORB (30m)", true, 5, "ORB (30m)", "52W High"],
  [undefined, false, 3, undefined, undefined],
])(
  "ChartLegend items (orbLabel=%s, hasWeek52=%s)",
  (orbLabel, hasWeek52, expectedLength, expectedOrb, expected52w) => {
    const items = buildChartLegendItems(orbLabel, hasWeek52);
    expect(items.length).toBe(expectedLength);
    if (expectedOrb) expect(items[3].label).toBe(expectedOrb);
    if (expected52w) expect(items[4].label).toBe(expected52w);
  },
);


