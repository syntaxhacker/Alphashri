import { describe, expect, it } from "vitest";
import { normalizePaper, type PaperNormalizeInput } from "./normalizePaper";
import {
  PIVOT_OR_HIGH,
  PIVOT_OR_LOW,
  ORB_AREA,
  PIVOT_R1,
  PIVOT_PP,
  PIVOT_S1,
  PIVOT_52W_HIGH,
  INDICATOR_BLUE_A,
  INDICATOR_BLUE_B,
} from "../../config/colors";
import { makePaperData, findPivotLines } from "./normalizeTestFixtures";

type PaperFlags = {
  isDark?: boolean;
  selectedTradeId?: string | null;
  showAllTrades?: boolean;
  showOrbLines?: boolean;
  showPivotLines?: boolean;
  show52wLines?: boolean;
  showEmaLines?: boolean;
};

// Invoke the normalizer with the show* flag positions filled in via an options object.
const runPaper = (data: Parameters<typeof normalizePaper>[0], flags: PaperFlags = {}) =>
  normalizePaper(
    data,
    flags.isDark ?? false,
    flags.selectedTradeId,
    flags.showAllTrades,
    flags.showOrbLines,
    flags.showPivotLines,
    flags.show52wLines,
    flags.showEmaLines,
  );

describe("normalizePaper", () => {
  const mockPaperData = makePaperData();
  const fullPivotLevels = { r2: 120, r1: 115, pp: 105, s1: 95, s2: 90 };
  const pivotPaperData = () => ({ ...mockPaperData, pivot_levels: fullPivotLevels });

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
      const result = runPaper(data, { showOrbLines: true });
      expect(result.markLines).toHaveLength(2);
      expect(result.markLines[0]).toMatchObject({
        yAxis: 112,
        lineStyle: { color: PIVOT_OR_HIGH, type: "dashed", width: 1 },
        label: { formatter: "OR-H (15m) 112" },
      });
      expect(result.markLines[1]).toMatchObject({
        yAxis: 98,
        lineStyle: { color: PIVOT_OR_LOW, type: "dashed", width: 1 },
        label: { formatter: "OR-L (15m) 98" },
      });
    });

    it("adds OR markArea for first 15 minutes", () => {
      const data = {
        ...mockPaperData,
        orb_levels: { or_high: 112, or_low: 98, or_minutes: 15 },
      };
      const result = runPaper(data, { showOrbLines: true });
      expect(result.markAreas).toHaveLength(1);
      expect(result.markAreas[0]).toMatchObject({
        from: "09:30",
        to: "09:31",
        fromY: 98,
        toY: 112,
        color: ORB_AREA,
      });
    });

    it("handles missing or_minutes in orb_levels", () => {
      const data = {
        ...mockPaperData,
        orb_levels: { or_high: 112, or_low: 98 },
      };
      const result = runPaper(data, { showOrbLines: true });
      expect(result.markLines[0].label.formatter).toContain("OR-H 112");
      expect(result.markLines[0].label.formatter).not.toContain("(");
    });

    it("does not add OR lines when showOrbLines is false", () => {
      const data = { ...mockPaperData, orb_levels: { or_high: 112, or_low: 98 } };
      const result = runPaper(data, { showOrbLines: false });
      expect(result.markLines).toEqual([]);
      expect(result.markAreas).toEqual([]);
    });
  });

  describe("Pivot lines", () => {
    it("adds pivot level lines when showPivotLines is true", () => {
      const result = runPaper(pivotPaperData(), { showPivotLines: true });
      expect(result.markLines).toHaveLength(5);
      const levelNames = result.markLines.map((ml) => ml.label.formatter);
      expect(levelNames.some((f) => f.includes("R2"))).toBe(true);
      expect(levelNames.some((f) => f.includes("R1"))).toBe(true);
      expect(levelNames.some((f) => f.includes("PP"))).toBe(true);
      expect(levelNames.some((f) => f.includes("S1"))).toBe(true);
      expect(levelNames.some((f) => f.includes("S2"))).toBe(true);
    });

    it("uses correct colors for pivot levels", () => {
      const result = runPaper(pivotPaperData(), { showPivotLines: true });
      const { r2, r1, pp, s1, s2 } = findPivotLines(result);

      expect(r2?.lineStyle.color).toBe(PIVOT_R1); // R2
      expect(r1?.lineStyle.color).toBe(PIVOT_R1); // R1
      expect(pp?.lineStyle.color).toBe(PIVOT_PP); // PP
      expect(s1?.lineStyle.color).toBe(PIVOT_S1); // S1
      expect(s2?.lineStyle.color).toBe(PIVOT_S1); // S2
    });

    it("uses correct line styles", () => {
      const result = runPaper(pivotPaperData(), { showPivotLines: true });
      const { r2, r1, pp, s1, s2 } = findPivotLines(result);

      expect(r2?.lineStyle.type).toBe("dotted");
      expect(r1?.lineStyle.type).toBe("dashed");
      expect(pp?.lineStyle.type).toBe("dotted");
      expect(s1?.lineStyle.type).toBe("dashed");
      expect(s2?.lineStyle.type).toBe("dotted");
    });

    it("does not add pivot lines when showPivotLines is false", () => {
      const data = { ...mockPaperData, pivot_levels: { pp: 105 } };
      const result = runPaper(data, { showPivotLines: false });
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
      const result = runPaper(data, { show52wLines: true });
      expect(result.markLines.some((ml) => ml.label.formatter.includes("52W-H"))).toBe(true);
      const highLine = result.markLines.find((ml) => ml.label.formatter.includes("52W-H"));
      expect(highLine?.yAxis).toBe(150);
      expect(highLine?.lineStyle.color).toBe(PIVOT_52W_HIGH);
      expect(highLine?.lineStyle.type).toBe("dashed");
      expect(highLine?.lineStyle.width).toBe(2);
    });

    it("adds 52W low line only if low > 0", () => {
      const data = {
        ...mockPaperData,
        week52_levels: { high_52w: 150, low_52w: 80 },
      };
      const result = runPaper(data, { show52wLines: true });
      expect(result.markLines.some((ml) => ml.label.formatter.includes("52W-L"))).toBe(true);
    });

    it("omits 52W low line when low is 0", () => {
      const data = {
        ...mockPaperData,
        week52_levels: { high_52w: 150, low_52w: 0 },
      };
      const result = runPaper(data, { show52wLines: true });
      expect(result.markLines.some((ml) => ml.label.formatter.includes("52W-L"))).toBe(false);
    });

    it("does not add 52W lines when show52wLines is false", () => {
      const data = { ...mockPaperData, week52_levels: { high_52w: 150 } };
      const result = runPaper(data, { show52wLines: false });
      expect(result.markLines.some((ml) => ml.label.formatter.includes("52W"))).toBe(false);
    });
  });

  describe("EMA lines", () => {
    it("adds EMA series when showEmaLines is true", () => {
      const data = {
        ...mockPaperData,
        ema_series: {
          ema_fast: { label: "EMA 9", color: INDICATOR_BLUE_A, data: [100, 101, 102] },
          ema_slow: { label: "EMA 21", color: INDICATOR_BLUE_B, data: [99, 100, 101] },
        },
      };
      const result = runPaper(data, { showEmaLines: true });
      const ema = result.emaData ?? [];
      expect(ema).toHaveLength(2);
      expect(ema[0]).toMatchObject({
        label: "EMA 9",
        color: INDICATOR_BLUE_A,
        data: [100, 101, 102],
      });
      expect(ema[1].label).toBe("EMA 21");
    });

    it("does not add EMA when showEmaLines is false", () => {
      const data = {
        ...mockPaperData,
        ema_series: {
          ema_fast: { label: "EMA 9", color: INDICATOR_BLUE_A, data: [] },
          ema_slow: { label: "EMA 21", color: INDICATOR_BLUE_B, data: [] },
        },
      };
      const result = runPaper(data, { showEmaLines: false });
      expect(result.emaData).toBeUndefined();
    });
  });

  describe("live position", () => {
    it("maps current_position to livePosition", () => {
      const data: PaperNormalizeInput = {
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
    it("sets showVolume to false", () => {
      const result = normalizePaper(mockPaperData, false);
      expect(result.showVolume).toBe(false);
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
      const result = runPaper(mockPaperData, { isDark: true });
      expect(result.isDark).toBe(true);
    });

    it("looks up selectedTradeId by trade_id", () => {
      const result = runPaper(mockPaperData, { selectedTradeId: "1" });
      expect(result.highlightedTradeId).toBe(1);
    });

    it("returns null for non-existent selectedTradeId", () => {
      const result = runPaper(mockPaperData, { selectedTradeId: "nonexistent" });
      expect(result.highlightedTradeId).toBeNull();
    });

    it("sets highlightedTradeId to null when not provided", () => {
      const result = normalizePaper(mockPaperData, false);
      expect(result.highlightedTradeId).toBeNull();
    });

    it("passes through showAllTrades", () => {
      const result = runPaper(mockPaperData, { showAllTrades: true });
      expect(result.showAllTrades).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles empty data", () => {
      const data = { candles: [], trades: [] };
      const result = normalizePaper(data, false);
      expect(result.candles).toEqual([]);
      expect(result.trades).toEqual([]);
      expect(result.showVolume).toBe(false);
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
