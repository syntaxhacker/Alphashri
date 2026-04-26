import { describe, expect, it } from "vitest";
import { normalizeBacktest } from "./normalizeBacktest";
import type { ChartInput, UnifiedTrade } from "./types";

describe("normalizeBacktest", () => {
  const mockHolidays = [
    { date: "2025-01-16", type: "trading", description: "Trading holiday" },
    { date: "2025-01-17", type: "clearing", description: "Clearing holiday" },
  ];

  describe("candle normalization", () => {
    it("maps raw candles to UnifiedCandle format", () => {
      const data = {
        candles: [
          {
            time: "2025-01-15T09:30:00",
            date: "2025-01-15",
            time_str: "09:30",
            open: 100,
            high: 110,
            low: 95,
            close: 105,
            volume: 1000,
          },
        ],
        trades: [],
      };
      const result = normalizeBacktest(data, false);
      expect(result.candles).toHaveLength(1);
      expect(result.candles[0]).toMatchObject({
        time: "2025-01-15T09:30:00",
        date: "2025-01-15",
        time_str: "09:30",
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 1000,
      });
    });

    it("handles missing candles", () => {
      const data = { candles: [], trades: [] };
      const result = normalizeBacktest(data, false);
      expect(result.candles).toEqual([]);
    });
  });

  describe("trade normalization", () => {
    it("pairs entry and exit trades into unified format", () => {
      const data = {
        candles: [],
        trades: [
          {
            type: "entry",
            trade: { entry_price: 100, entry_time: "09:30", quantity: 10 },
            trade_id: 1,
            candle_idx: 0,
          },
          {
            type: "exit",
            trade: {
              exit_price: 110,
              exit_time: "09:35",
              exit_reason: "TP",
              net_pnl: 10,
              trading_costs: 1,
            },
            trade_id: 1,
            candle_idx: 3,
          },
        ],
      };
      const result = normalizeBacktest(data, false);
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0]).toMatchObject({
        id: 1,
        entry_price: 100,
        exit_price: 110,
        entry_time: "09:30",
        exit_time: "09:35",
        exit_reason: "TP",
        quantity: 10,
        side: "BUY",
        pnl: 10,
        costs: 1,
        candle_idx: 0,
        exit_candle_idx: 3,
      });
    });

    it("handles trade with missing exit", () => {
      const data = {
        candles: [],
        trades: [
          {
            type: "entry",
            trade: { entry_price: 100, entry_time: "09:30", quantity: 10 },
            trade_id: 1,
            candle_idx: 0,
          },
        ],
      };
      const result = normalizeBacktest(data, false);
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].exit_price).toBeUndefined();
      expect(result.trades[0].exit_time).toBeUndefined();
      expect(result.trades[0].exit_reason).toBeUndefined();
      expect(result.trades[0].pnl).toBeUndefined();
      expect(result.trades[0].costs).toBeUndefined();
      expect(result.trades[0].exit_candle_idx).toBeUndefined();
    });

    it("uses entry time as fallback for missing entry_time", () => {
      const data = {
        candles: [{ time: "09:30" }],
        trades: [
          {
            type: "entry",
            trade: { entry_price: 100, quantity: 10 },
            trade_id: 1,
            candle_idx: 0,
            time: "2025-01-15T09:30:00",
          },
        ],
      };
      const result = normalizeBacktest(data, false);
      expect(result.trades[0].entry_time).toBe("2025-01-15T09:30:00");
    });

    it("uses exit time as fallback for missing exit_time", () => {
      const data = {
        candles: [],
        trades: [
          {
            type: "entry",
            trade: { entry_price: 100, entry_time: "09:30", quantity: 10 },
            trade_id: 1,
            candle_idx: 0,
          },
          {
            type: "exit",
            trade: { exit_price: 110, exit_reason: "TP", net_pnl: 10, trading_costs: 1 },
            trade_id: 1,
            candle_idx: 3,
            time: "2025-01-15T09:35:00",
          },
        ],
      };
      const result = normalizeBacktest(data, false);
      expect(result.trades[0].exit_time).toBe("2025-01-15T09:35:00");
    });

    it("always sets side to BUY for backtest", () => {
      const data = {
        candles: [],
        trades: [
          {
            type: "entry",
            trade: { entry_price: 100, entry_time: "09:30", quantity: 10 },
            trade_id: 1,
            candle_idx: 0,
          },
          {
            type: "exit",
            trade: {
              exit_price: 110,
              exit_time: "09:35",
              exit_reason: "TP",
              net_pnl: 10,
              trading_costs: 1,
            },
            trade_id: 1,
            candle_idx: 3,
          },
        ],
      };
      const result = normalizeBacktest(data, false);
      expect(result.trades[0].side).toBe("BUY");
    });

    it("handles multiple trades", () => {
      const data = {
        candles: [],
        trades: [
          {
            type: "entry",
            trade: { entry_price: 100, entry_time: "09:30", quantity: 10 },
            trade_id: 1,
            candle_idx: 0,
          },
          {
            type: "exit",
            trade: {
              exit_price: 110,
              exit_time: "09:35",
              exit_reason: "TP",
              net_pnl: 10,
              trading_costs: 1,
            },
            trade_id: 1,
            candle_idx: 3,
          },
          {
            type: "entry",
            trade: { entry_price: 200, entry_time: "09:40", quantity: 5 },
            trade_id: 2,
            candle_idx: 2,
          },
          {
            type: "exit",
            trade: {
              exit_price: 190,
              exit_time: "09:45",
              exit_reason: "SL",
              net_pnl: -10,
              trading_costs: 1,
            },
            trade_id: 2,
            candle_idx: 4,
          },
        ],
      };
      const result = normalizeBacktest(data, false);
      expect(result.trades).toHaveLength(2);
    });
  });

  describe("overlays normalization", () => {
    it("converts visuals.overlays to UnifiedOverlay", () => {
      const data = {
        candles: [],
        trades: [],
        visuals: {
          overlays: [
            {
              id: "line1",
              label: "EMA Fast",
              type: "line",
              color: "#00FF00",
              dash: [2, 2],
              levels: [{ value: 100 }],
            },
          ],
        },
      };
      const result = normalizeBacktest(data, false);
      expect(result.overlays).toHaveLength(1);
      expect(result.overlays[0]).toMatchObject({
        id: "line1",
        label: "EMA Fast",
        type: "line",
        color: "#00FF00",
        dash: [2, 2],
        levels: [{ value: 100 }],
        showLabel: false,
      });
    });

    it("showLabel defaults to false", () => {
      const data = {
        candles: [],
        trades: [],
        visuals: {
          overlays: [
            { id: "line1", label: "Test", type: "line", color: "#000", levels: [{ value: 100 }] },
          ],
        },
      };
      const result = normalizeBacktest(data, false);
      expect(result.overlays[0].showLabel).toBe(false);
    });

    it("handles overlay with levels array", () => {
      const data = {
        candles: [],
        trades: [],
        visuals: {
          overlays: [
            {
              id: "line1",
              label: "Test",
              type: "line",
              color: "#000",
              levels: [{ value: 100 }, { value: 110 }],
            },
          ],
        },
      };
      const result = normalizeBacktest(data, false);
      expect(result.overlays[0].levels).toHaveLength(2);
    });

    it("handles missing visuals", () => {
      const data = { candles: [], trades: [] };
      const result = normalizeBacktest(data, false);
      expect(result.overlays).toEqual([]);
    });
  });

  describe("EMA data normalization", () => {
    it("maps ema_series to emaData format", () => {
      const data = {
        candles: [{ time: "09:30" }, { time: "09:31" }],
        trades: [],
        visuals: {
          ema_series: [
            { label: "EMA 9", color: "#00FF00", data: [100, 101] },
            { label: "EMA 21", color: "#FF0000", data: [99, 100] },
          ],
        },
      };
      const result = normalizeBacktest(data, false);
      expect(result.emaData).toHaveLength(2);
      expect(result.emaData[0]).toMatchObject({
        label: "EMA 9",
        color: "#00FF00",
        data: [100, 101],
      });
    });

    it("clears emaData when length mismatch", () => {
      const data = {
        candles: [{ time: "09:30" }],
        trades: [],
        visuals: {
          ema_series: [
            { label: "EMA 9", color: "#00FF00", data: [100, 101] }, // length 2, candles length 1
          ],
        },
      };
      const result = normalizeBacktest(data, false);
      expect(result.emaData).toEqual([]); // Should be cleared
    });

    it("keeps emaData when lengths match", () => {
      const data = {
        candles: [{ time: "09:30" }, { time: "09:31" }],
        trades: [],
        visuals: {
          ema_series: [{ label: "EMA 9", color: "#00FF00", data: [100, 101] }],
        },
      };
      const result = normalizeBacktest(data, false);
      expect(result.emaData).toHaveLength(1);
    });

    it("handles missing ema_series", () => {
      const data = { candles: [], trades: [] };
      const result = normalizeBacktest(data, false);
      expect(result.emaData).toBeUndefined();
    });
  });

  describe("highlighted trade markLines", () => {
    it("adds OR high/low lines for highlighted trade with or_high/or_low", () => {
      const data = {
        candles: [],
        trades: [
          {
            type: "entry",
            trade: { entry_price: 100, or_high: 105, or_low: 95 },
            trade_id: 1,
            candle_idx: 0,
          },
        ],
      };
      const result = normalizeBacktest(data, false, undefined, 1);
      expect(result.markLines).toHaveLength(2);
      expect(result.markLines[0]).toMatchObject({
        yAxis: 105,
        lineStyle: { color: "#2196F3", type: "dashed", width: 1 },
        label: { formatter: "OR-H 105" },
      });
      expect(result.markLines[1]).toMatchObject({
        yAxis: 95,
        lineStyle: { color: "#2196F3", type: "dashed", width: 1 },
        label: { formatter: "OR-L 95" },
      });
    });

    it("adds R1 line when present", () => {
      const data = {
        candles: [],
        trades: [
          { type: "entry", trade: { entry_price: 100, r1: 115 }, trade_id: 1, candle_idx: 0 },
        ],
      };
      const result = normalizeBacktest(data, false, undefined, 1);
      expect(result.markLines.find((ml) => ml.label.formatter.includes("R1"))).toBeDefined();
    });

    it("adds S1 line when present", () => {
      const data = {
        candles: [],
        trades: [
          { type: "entry", trade: { entry_price: 100, s1: 90 }, trade_id: 1, candle_idx: 0 },
        ],
      };
      const result = normalizeBacktest(data, false, undefined, 1);
      expect(result.markLines.find((ml) => ml.label.formatter.includes("S1"))).toBeDefined();
    });

    it("adds PP line when present", () => {
      const data = {
        candles: [],
        trades: [
          { type: "entry", trade: { entry_price: 100, pp: 100 }, trade_id: 1, candle_idx: 0 },
        ],
      };
      const result = normalizeBacktest(data, false, undefined, 1);
      expect(result.markLines.find((ml) => ml.label.formatter.includes("PP"))).toBeDefined();
    });

    it("does not add markLines when highlightedTradeId is null", () => {
      const data = {
        candles: [],
        trades: [
          { type: "entry", trade: { entry_price: 100, or_high: 105 }, trade_id: 1, candle_idx: 0 },
        ],
      };
      const result = normalizeBacktest(data, false, undefined, null);
      expect(result.markLines).toEqual([]);
    });

    it("does not add markLines for trade without pivot levels", () => {
      const data = {
        candles: [],
        trades: [{ type: "entry", trade: { entry_price: 100 }, trade_id: 1, candle_idx: 0 }],
      };
      const result = normalizeBacktest(data, false, undefined, 1);
      expect(result.markLines).toEqual([]);
    });
  });

  describe("ChartInput structure", () => {
    it("returns ChartInput with required fields", () => {
      const data = { candles: [], trades: [], symbol: "TEST" };
      const result = normalizeBacktest(data, true, undefined, undefined);
      expect(result).toMatchObject({
        candles: expect.any(Array),
        trades: expect.any(Array),
        overlays: expect.any(Array),
        showVolume: false,
        showDataZoomSlider: true,
        showLegend: true,
        isDark: true,
        title: "TEST - Backtest Results",
      });
    });

    it("constructs title from symbol correctly", () => {
      const data = { candles: [], trades: [], symbol: "RELIANCE" };
      const result = normalizeBacktest(data, false);
      expect(result.title).toBe("RELIANCE - Backtest Results");
    });

    it("passes through holidays", () => {
      const data = { candles: [], trades: [] };
      const result = normalizeBacktest(data, false, mockHolidays);
      expect(result.holidays).toEqual(mockHolidays);
    });

    it("passes through isDark", () => {
      const data = { candles: [], trades: [] };
      const result = normalizeBacktest(data, true);
      expect(result.isDark).toBe(true);
    });
  });
});
