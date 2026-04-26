import { describe, expect, it } from "vitest";
import { normalizePaper } from "./normalizePaper";
import type { ChartInput } from "./types";

describe("normalizePaper", () => {
  const mockPaperData = {
    candles: [
      {
        time: "2025-01-15T09:30:00",
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 1000,
      },
      {
        time: "2025-01-15T09:31:00",
        open: 105,
        high: 108,
        low: 103,
        close: 107,
        volume: 800,
      },
    ],
    trades: [
      {
        trade_id: "1",
        entry_price: 100,
        exit_price: 110,
        entry_time: "2025-01-15T09:30:00",
        exit_time: "2025-01-15T09:35:00",
        exit_reason: "TP",
        quantity: 10,
        side: "BUY",
        pnl: 10,
        net_pnl: 10,
        costs: 1,
      },
    ],
  };

  describe("candle normalization", () => {
    it("maps candles to UnifiedCandle format", () => {
      const result = normalizePaper(mockPaperData, false);
      expect(result.candles).toHaveLength(2);
      expect(result.candles[0]).toMatchObject({
        time: "2025-01-15T09:30:00",
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 1000,
      });
    });

    it("preserves all candle fields", () => {
      const result = normalizePaper(mockPaperData, false);
      expect(result.candles[0]).toHaveProperty("time");
      expect(result.candles[0]).toHaveProperty("open");
      expect(result.candles[0]).toHaveProperty("high");
      expect(result.candles[0]).toHaveProperty("low");
      expect(result.candles[0]).toHaveProperty("close");
      expect(result.candles[0]).toHaveProperty("volume");
    });
  });

  describe("trade normalization", () => {
    it("maps trades to UnifiedTrade with parsed id", () => {
      const result = normalizePaper(mockPaperData, false);
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0]).toMatchObject({
        id: 1,
        entry_price: 100,
        exit_price: 110,
        entry_time: "2025-01-15T09:30:00",
        exit_time: "2025-01-15T09:35:00",
        exit_reason: "TP",
        quantity: 10,
        side: "BUY",
        pnl: 10,
        costs: 1,
      });
    });

    it("handles string trade_id that is not a number", () => {
      const data = {
        ...mockPaperData,
        trades: [
          {
            trade_id: "abc",
            entry_price: 100,
            exit_price: 110,
            entry_time: "09:30",
            exit_time: "09:35",
            quantity: 10,
            side: "BUY",
            pnl: 10,
          },
        ],
      };
      const result = normalizePaper(data, false);
      expect(result.trades[0].id).toBe(0);
    });

    it("handles multiple trades", () => {
      const data = {
        ...mockPaperData,
        trades: [
          {
            trade_id: "1",
            entry_price: 100,
            exit_price: 110,
            entry_time: "09:30",
            exit_time: "09:35",
            quantity: 10,
            side: "BUY",
            pnl: 10,
          },
          {
            trade_id: "2",
            entry_price: 200,
            exit_price: 190,
            entry_time: "09:40",
            exit_time: "09:45",
            quantity: 5,
            side: "SELL",
            pnl: -10,
          },
        ],
      };
      const result = normalizePaper(data, false);
      expect(result.trades).toHaveLength(2);
      expect(result.trades[0].id).toBe(1);
      expect(result.trades[1].id).toBe(2);
    });
  });

  describe("ORB lines", () => {
    it("adds OR high and low markLines when showOrbLines is true", () => {
      const data = {
        ...mockPaperData,
        orb_levels: {
          or_high: 112,
          or_low: 98,
          or_minutes: 15,
        },
      };
      const result = normalizePaper(data, false, undefined, false, true);
      expect(result.markLines).toHaveLength(2);
      expect(result.markLines[0]).toMatchObject({
        yAxis: 112,
        lineStyle: { color: "#2196F3", type: "dashed", width: 1 },
        label: { formatter: "OR-H (15m) 112" },
      });
      expect(result.markLines[1]).toMatchObject({
        yAxis: 98,
        lineStyle: { color: "#2196F3", type: "dashed", width: 1 },
        label: { formatter: "OR-L (15m) 98" },
      });
    });

    it("adds OR markArea for first 15 minutes", () => {
      const data = {
        ...mockPaperData,
        orb_levels: { or_high: 112, or_low: 98, or_minutes: 15 },
      };
      const result = normalizePaper(data, false, undefined, false, true);
      expect(result.markAreas).toHaveLength(1);
      expect(result.markAreas[0]).toMatchObject({
        from: "09:30",
        to: "09:31",
        fromY: 98,
        toY: 112,
        color: "rgba(33,150,243,0.15)",
      });
    });

    it("handles missing or_minutes in orb_levels", () => {
      const data = {
        ...mockPaperData,
        orb_levels: { or_high: 112, or_low: 98 },
      };
      const result = normalizePaper(data, false, undefined, false, true);
      expect(result.markLines[0].label.formatter).toContain("OR-H 112");
      expect(result.markLines[0].label.formatter).not.toContain("(");
    });

    it("does not add OR lines when showOrbLines is false", () => {
      const data = { ...mockPaperData, orb_levels: { or_high: 112, or_low: 98 } };
      const result = normalizePaper(data, false, undefined, false, false);
      expect(result.markLines).toEqual([]);
      expect(result.markAreas).toEqual([]);
    });
  });

  describe("Pivot lines", () => {
    it("adds pivot level lines when showPivotLines is true", () => {
      const data = {
        ...mockPaperData,
        pivot_levels: {
          r2: 120,
          r1: 115,
          pp: 105,
          s1: 95,
          s2: 90,
        },
      };
      const result = normalizePaper(data, false, undefined, false, false, true);
      expect(result.markLines).toHaveLength(5);
      const levelNames = result.markLines.map((ml) => ml.label.formatter);
      expect(levelNames.some((f) => f.includes("R2"))).toBe(true);
      expect(levelNames.some((f) => f.includes("R1"))).toBe(true);
      expect(levelNames.some((f) => f.includes("PP"))).toBe(true);
      expect(levelNames.some((f) => f.includes("S1"))).toBe(true);
      expect(levelNames.some((f) => f.includes("S2"))).toBe(true);
    });

    it("uses correct colors for pivot levels", () => {
      const data = {
        ...mockPaperData,
        pivot_levels: { r2: 120, r1: 115, pp: 105, s1: 95, s2: 90 },
      };
      const result = normalizePaper(data, false, undefined, false, false, true);
      const r2 = result.markLines.find((ml) => ml.label.formatter.includes("R2"));
      const r1 = result.markLines.find((ml) => ml.label.formatter.includes("R1"));
      const pp = result.markLines.find((ml) => ml.label.formatter.includes("PP"));
      const s1 = result.markLines.find((ml) => ml.label.formatter.includes("S1"));
      const s2 = result.markLines.find((ml) => ml.label.formatter.includes("S2"));

      expect(r2?.lineStyle.color).toBe("#EF5350"); // R2
      expect(r1?.lineStyle.color).toBe("#EF5350"); // R1
      expect(pp?.lineStyle.color).toBe("#AB47BC"); // PP
      expect(s1?.lineStyle.color).toBe("#26A69A"); // S1
      expect(s2?.lineStyle.color).toBe("#26A69A"); // S2
    });

    it("uses correct line styles", () => {
      const data = {
        ...mockPaperData,
        pivot_levels: { r2: 120, r1: 115, pp: 105, s1: 95, s2: 90 },
      };
      const result = normalizePaper(data, false, undefined, false, false, true);
      const r2 = result.markLines.find((ml) => ml.label.formatter.includes("R2"));
      const r1 = result.markLines.find((ml) => ml.label.formatter.includes("R1"));
      const pp = result.markLines.find((ml) => ml.label.formatter.includes("PP"));
      const s1 = result.markLines.find((ml) => ml.label.formatter.includes("S1"));
      const s2 = result.markLines.find((ml) => ml.label.formatter.includes("S2"));

      expect(r2?.lineStyle.type).toBe("dotted");
      expect(r1?.lineStyle.type).toBe("dashed");
      expect(pp?.lineStyle.type).toBe("dotted");
      expect(s1?.lineStyle.type).toBe("dashed");
      expect(s2?.lineStyle.type).toBe("dotted");
    });

    it("does not add pivot lines when showPivotLines is false", () => {
      const data = { ...mockPaperData, pivot_levels: { pp: 105 } };
      const result = normalizePaper(data, false, undefined, false, false, false);
      expect(result.markLines.some((ml) => ml.label.formatter.includes("PP"))).toBe(false);
    });
  });

  describe("52-week lines", () => {
    it("adds 52W high line when show52wLines is true", () => {
      const data = {
        ...mockPaperData,
        week52_levels: {
          high_52w: 150,
          low_52w: 80,
        },
      };
      const result = normalizePaper(data, false, undefined, false, false, false, true);
      expect(result.markLines.some((ml) => ml.label.formatter.includes("52W-H"))).toBe(true);
      const highLine = result.markLines.find((ml) => ml.label.formatter.includes("52W-H"));
      expect(highLine?.yAxis).toBe(150);
      expect(highLine?.lineStyle.color).toBe("#E91E63");
      expect(highLine?.lineStyle.type).toBe("dashed");
      expect(highLine?.lineStyle.width).toBe(2);
    });

    it("adds 52W low line only if low > 0", () => {
      const data = {
        ...mockPaperData,
        week52_levels: { high_52w: 150, low_52w: 80 },
      };
      const result = normalizePaper(data, false, undefined, false, false, false, true);
      expect(result.markLines.some((ml) => ml.label.formatter.includes("52W-L"))).toBe(true);
    });

    it("omits 52W low line when low is 0", () => {
      const data = {
        ...mockPaperData,
        week52_levels: { high_52w: 150, low_52w: 0 },
      };
      const result = normalizePaper(data, false, undefined, false, false, false, true);
      expect(result.markLines.some((ml) => ml.label.formatter.includes("52W-L"))).toBe(false);
    });

    it("does not add 52W lines when show52wLines is false", () => {
      const data = { ...mockPaperData, week52_levels: { high_52w: 150 } };
      const result = normalizePaper(data, false, undefined, false, false, false, false);
      expect(result.markLines.some((ml) => ml.label.formatter.includes("52W"))).toBe(false);
    });
  });

  describe("EMA lines", () => {
    it("adds EMA series when showEmaLines is true", () => {
      const data = {
        ...mockPaperData,
        ema_series: {
          ema_fast: { label: "EMA 9", color: "#10ac84", data: [100, 101, 102] },
          ema_slow: { label: "EMA 21", color: "#ee5253", data: [99, 100, 101] },
        },
      };
      const result = normalizePaper(data, false, undefined, false, false, false, false, true);
      expect(result.emaData).toHaveLength(2);
      expect(result.emaData[0]).toMatchObject({
        label: "EMA 9",
        color: "#10ac84",
        data: [100, 101, 102],
      });
      expect(result.emaData[1].label).toBe("EMA 21");
    });

    it("does not add EMA when showEmaLines is false", () => {
      const data = { ...mockPaperData, ema_series: { ema_fast: { label: "EMA 9", data: [] } } };
      const result = normalizePaper(data, false, undefined, false, false, false, false, false);
      expect(result.emaData).toBeUndefined();
    });
  });

  describe("live position", () => {
    it("maps current_position to livePosition", () => {
      const data = {
        ...mockPaperData,
        current_position: {
          entry_price: 100,
          entry_time: "09:30",
          side: "BUY",
          stop_loss: 95,
          take_profit: 110,
          current_price: 105,
          pnl: 5,
          pnl_pct: 5.0,
          quantity: 10,
        },
      };
      const result = normalizePaper(data, false);
      expect(result.livePosition).toMatchObject({
        entry_price: 100,
        entry_time: "09:30",
        side: "BUY",
        stop_loss: 95,
        take_profit: 110,
        current_price: 105,
        pnl: 5,
        pnl_pct: 5.0,
        quantity: 10,
      });
    });

    it("omits livePosition when not present", () => {
      const result = normalizePaper(mockPaperData, false);
      expect(result.livePosition).toBeUndefined();
    });
  });

  describe("ChartInput configuration", () => {
    it("sets showVolume to true", () => {
      const result = normalizePaper(mockPaperData, false);
      expect(result.showVolume).toBe(true);
    });

    it("sets showDataZoomSlider to false", () => {
      const result = normalizePaper(mockPaperData, false);
      expect(result.showDataZoomSlider).toBe(false);
    });

    it("sets showLegend to false", () => {
      const result = normalizePaper(mockPaperData, false);
      expect(result.showLegend).toBe(false);
    });

    it("passes through isDark", () => {
      const result = normalizePaper(mockPaperData, true);
      expect(result.isDark).toBe(true);
    });

    it("parses selectedTradeId to number", () => {
      const result = normalizePaper(mockPaperData, false, "42");
      expect(result.highlightedTradeId).toBe(42);
    });

    it("handles invalid selectedTradeId string", () => {
      const result = normalizePaper(mockPaperData, false, "abc");
      expect(result.highlightedTradeId).toBeNaN();
    });

    it("sets highlightedTradeId to null when not provided", () => {
      const result = normalizePaper(mockPaperData, false);
      expect(result.highlightedTradeId).toBeNull();
    });

    it("passes through showAllTrades", () => {
      const result = normalizePaper(mockPaperData, false, undefined, true);
      expect(result.showAllTrades).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles empty data", () => {
      const data = { candles: [], trades: [] };
      const result = normalizePaper(data, false);
      expect(result.candles).toEqual([]);
      expect(result.trades).toEqual([]);
      expect(result.showVolume).toBe(true);
    });

    it("handles missing optional data fields", () => {
      const data = { candles: [], trades: [] };
      const result = normalizePaper(data, false);
      expect(result.overlays).toEqual([]);
      expect(result.emaData).toBeUndefined();
      expect(result.livePosition).toBeUndefined();
      expect(result.markLines).toEqual([]);
      expect(result.markAreas).toEqual([]);
    });
  });
});
