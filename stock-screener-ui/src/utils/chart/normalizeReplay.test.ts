import { describe, expect, it } from "vitest";
import { normalizeReplay } from "./normalizeReplay";

describe("normalizeReplay", () => {
  const mockCandles = [
    { time: "2025-01-15T09:30:00", open: 100, high: 110, low: 95, close: 105, volume: 1000 },
    { time: "2025-01-15T09:31:00", open: 105, high: 108, low: 103, close: 107, volume: 800 },
    { time: "2025-01-15T09:32:00", open: 107, high: 112, low: 106, close: 110, volume: 900 },
  ];

  const mockTrades = [
    {
      id: 1,
      symbol: "TEST",
      entry_price: 100,
      exit_price: 110,
      entry_time: "2025-01-15T09:30:00",
      exit_time: "2025-01-15T09:35:00",
      exit_reason: "TP",
      quantity: 10,
      side: "BUY",
      pnl: 10,
      costs: 1,
      candle_idx: 0,
      exit_candle_idx: 2,
    },
  ];

  const mockORLevels = [
    {
      symbol: "TEST",
      strategy: "orb",
      from_index: 0,
      to_index: 8,
      or_high: 112,
      or_low: 98,
    },
  ];

  const mockPivotLevels = [
    {
      symbol: "TEST",
      strategy: "pivot",
      from_index: 0,
      to_index: 10,
      r2: 120,
      r1: 115,
      pp: 105,
      s1: 95,
      s2: 90,
    },
  ];

  const mock52WLevels = [
    {
      symbol: "TEST",
      strategy: "52w",
      from_index: 0,
      to_index: 20,
      high_52w: 150,
      low_52w: 80,
    },
  ];

  const mockEMADataMap = {
    TEST: {
      ema_fast_period: 9,
      ema_slow_period: 21,
      timeframes: {
        "5min": {
          ema_fast: [100, 101, 102],
          ema_slow: [99, 100, 101],
        },
      },
    },
  };

  describe("candle normalization", () => {
    it("maps candles to UnifiedCandle format", () => {
      const result = normalizeReplay(
        mockCandles,
        mockTrades,
        mockORLevels,
        mockPivotLevels,
        mock52WLevels,
        mockEMADataMap,
        "TEST",
        false,
      );
      expect(result.candles).toHaveLength(3);
      expect(result.candles[0]).toMatchObject({
        time: "2025-01-15T09:30:00",
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 1000,
      });
    });

    it("filters trades by selected symbol", () => {
      const tradesWithOther = [...mockTrades, { ...mockTrades[0], symbol: "OTHER", id: 2 }];
      const result = normalizeReplay(
        mockCandles,
        tradesWithOther,
        mockORLevels,
        mockPivotLevels,
        mock52WLevels,
        mockEMADataMap,
        "TEST",
        false,
      );
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].id).toBe(1);
    });

    it("maps trades with correct id", () => {
      const result = normalizeReplay(
        mockCandles,
        mockTrades,
        mockORLevels,
        mockPivotLevels,
        mock52WLevels,
        mockEMADataMap,
        "TEST",
        false,
      );
      expect(result.trades[0].id).toBe(1);
    });
  });

  describe("ORB overlays", () => {
    it("adds OR high and low overlays as lines", () => {
      const result = normalizeReplay(
        mockCandles,
        [],
        mockORLevels,
        [],
        [],
        {},
        "TEST",
        false,
        undefined,
        undefined,
        true,
      );
      const orHigh = result.overlays.find((o) => o.id.includes("or-high"));
      const orLow = result.overlays.find((o) => o.id.includes("or-low"));
      expect(orHigh).toBeDefined();
      expect(orLow).toBeDefined();
      expect(orHigh?.type).toBe("line");
      expect(orLow?.type).toBe("line");
    });

    it("includes strategy name in overlay labels", () => {
      const result = normalizeReplay(
        mockCandles,
        [],
        mockORLevels,
        [],
        [],
        {},
        "TEST",
        false,
        undefined,
        undefined,
        true,
      );
      const orHigh = result.overlays.find((o) => o.id === "or-high-orb");
      expect(orHigh?.label).toBe("OR High (orb)");
    });

    it("uses dashed [6,3] pattern for OR lines", () => {
      const result = normalizeReplay(
        mockCandles,
        [],
        mockORLevels,
        [],
        [],
        {},
        "TEST",
        false,
        undefined,
        undefined,
        true,
      );
      const orHigh = result.overlays.find((o) => o.id === "or-high-orb");
      expect(orHigh?.dash).toEqual([6, 3]);
    });

    it("sets OR levels with date range", () => {
      const result = normalizeReplay(
        mockCandles,
        [],
        mockORLevels,
        [],
        [],
        {},
        "TEST",
        false,
        undefined,
        undefined,
        true,
      );
      const orHigh = result.overlays.find((o) => o.id === "or-high-orb");
      expect(orHigh?.levels).toHaveLength(2);
      expect(orHigh?.levels[0]).toHaveProperty("date");
      expect(orHigh?.levels[0]).toHaveProperty("value", 112);
    });

    it("hides OR lines when show_orb_zones is false", () => {
      const result = normalizeReplay(
        mockCandles,
        [],
        mockORLevels,
        [],
        [],
        {},
        "TEST",
        false,
        undefined, // highlightedTradeId
        undefined, // showAllTrades
        undefined, // rawCandles
        undefined, // activeTF
        { show_orb_zones: false }, // chartOptions
      );
      expect(result.overlays.find((o) => o.id.includes("or-"))).toBeUndefined();
    });

    it("adds OR markAreas", () => {
      const result = normalizeReplay(
        mockCandles,
        [],
        mockORLevels,
        [],
        [],
        {},
        "TEST",
        false,
        undefined,
        { show_orb_zones: false }, // actually true through default
        true,
      );
      expect(result.markAreas).toHaveLength(1);
      expect(result.markAreas[0]).toMatchObject({
        fromY: 98,
        toY: 112,
        color: "rgba(33,150,243,0.15)",
      });
    });
  });

  describe("Pivot overlays", () => {
    it("adds pivot level lines", () => {
      const result = normalizeReplay(
        mockCandles,
        [],
        [],
        mockPivotLevels,
        [],
        {},
        "TEST",
        false,
        undefined,
        { show_pivot_levels: false }, // passing true via default
        false,
        true,
      );
      const pivotLevels = ["r2", "r1", "pp", "s1", "s2"];
      for (const level of pivotLevels) {
        expect(result.overlays.find((o) => o.id === `${level}-pivot`)).toBeDefined();
      }
    });

    it("uses correct colors for pivot levels", () => {
      const result = normalizeReplay(
        mockCandles,
        [],
        [],
        mockPivotLevels,
        [],
        {},
        "TEST",
        false,
        undefined,
        undefined,
        false,
        true,
      );
      const r1 = result.overlays.find((o) => o.id === "r1-pivot");
      expect(r1?.color).toBe("#EF5350");
      const pp = result.overlays.find((o) => o.id === "pp-pivot");
      expect(pp?.color).toBe("#AB47BC");
      const s1 = result.overlays.find((o) => o.id === "s1-pivot");
      expect(s1?.color).toBe("#26A69A");
    });

    it("uses correct dash patterns", () => {
      const result = normalizeReplay(
        mockCandles,
        [],
        [],
        mockPivotLevels,
        [],
        {},
        "TEST",
        false,
        undefined,
        undefined,
        false,
        true,
      );
      const r1 = result.overlays.find((o) => o.id === "r1-pivot");
      expect(r1?.dash).toEqual([6, 3]); // dashed
      const r2 = result.overlays.find((o) => o.id === "r2-pivot");
      expect(r2?.dash).toEqual([2, 2]); // dotted
    });
  });

  describe("52-week overlays", () => {
    it("adds 52W high line", () => {
      const result = normalizeReplay(
        mockCandles,
        [],
        [],
        [],
        mock52WLevels,
        {},
        "TEST",
        false,
        undefined,
        { show_52w_high: false }, // true by default
        false,
        true,
      );
      const high52w = result.overlays.find((o) => o.id === "52w-high-52w");
      expect(high52w).toBeDefined();
      expect(high52w?.color).toBe("#E91E63");
      expect(high52w?.dash).toEqual([6, 3]);
    });

    it("adds 52W low line when > 0", () => {
      const result = normalizeReplay(
        mockCandles,
        [],
        [],
        [],
        mock52WLevels,
        {},
        "TEST",
        false,
        undefined,
        undefined,
        false,
        true,
      );
      const low52w = result.overlays.find((o) => o.id === "52w-low-52w");
      expect(low52w).toBeDefined();
      expect(low52w?.color).toBe("#9C27B0");
      expect(low52w?.dash).toEqual([2, 2]);
    });
  });

  describe("EMA integration", () => {
    it("adds EMA series when show_ema is true", () => {
      const result = normalizeReplay(
        mockCandles,
        [],
        [],
        [],
        [],
        mockEMADataMap,
        "TEST",
        false,
        undefined,
        { show_ema: false }, // true by default
        false,
        true,
      );
      expect(result.emaData).toHaveLength(2);
      expect(result.emaData[0]).toMatchObject({
        label: "EMA 9",
        color: "#10ac84",
        data: [100, 101, 102],
      });
    });

    it("selects correct timeframe based on activeTF", () => {
      const emaDataMap = {
        TEST: {
          ema_fast_period: 9,
          ema_slow_period: 21,
          timeframes: {
            "1min": { ema_fast: [100], ema_slow: [99] },
            "5min": { ema_fast: [100, 101, 102], ema_slow: [99, 100, 101] },
          },
        },
      };
      const result = normalizeReplay(
        mockCandles,
        [],
        [],
        [],
        [],
        emaDataMap,
        "TEST",
        false,
        undefined, // highlightedTradeId
        undefined, // showAllTrades
        undefined, // rawCandles
        5, // activeTF
        undefined, // chartOptions
      );
      expect(result.emaData?.[0].data).toHaveLength(3);
    });

    it("fallback to first timeframe if specific not found", () => {
      const emaDataMap = {
        TEST: {
          ema_fast_period: 9,
          ema_slow_period: 21,
          timeframes: {
            "10min": { ema_fast: [100], ema_slow: [99] },
          },
        },
      };
      const result = normalizeReplay(
        mockCandles,
        [],
        [],
        [],
        [],
        emaDataMap,
        "TEST",
        false,
        undefined, // highlightedTradeId
        undefined, // showAllTrades
        undefined, // rawCandles
        5, // activeTF
        undefined, // chartOptions
      );
      expect(result.emaData).toBeDefined();
      expect(result.emaData?.[0].data).toEqual([100]);
    });

    it("does not add EMA when show_ema is false", () => {
      const result = normalizeReplay(
        mockCandles,
        [],
        [],
        [],
        [],
        mockEMADataMap,
        "TEST",
        false,
        undefined, // highlightedTradeId
        undefined, // showAllTrades
        undefined, // rawCandles
        undefined, // activeTF
        { show_ema: false }, // chartOptions
      );
      expect(result.emaData).toBeUndefined();
    });
  });

  describe("time index mapping for overlays", () => {
    it("maps 1m index to correct candle time", () => {
      const rawCandles = [
        { time: "2025-01-15T09:30:00" },
        { time: "2025-01-15T09:31:00" },
        { time: "2025-01-15T09:32:00" },
        { time: "2025-01-15T09:33:00" },
        { time: "2025-01-15T09:34:00" },
      ];
      const result = normalizeReplay(
        mockCandles,
        [],
        [{ ...mockORLevels[0], from_index: 0, to_index: 2 }],
        [],
        [],
        {},
        "TEST",
        false,
        undefined,
        undefined,
        rawCandles,
        1,
        undefined,
      );
      const orOverlay = result.overlays.find((o) => o.id.includes("or-high"));
      expect(orOverlay?.levels[0].date).toBe("2025-01-15"); // from 09:30
      expect(orOverlay?.levels[1].date).toBe("2025-01-15"); // to 09:32
    });

    it("handles out-of-bounds indices", () => {
      const rawCandles = [{ time: "2025-01-15T09:30:00" }];
      const result = normalizeReplay(
        mockCandles,
        [],
        [{ ...mockORLevels[0], from_index: 0, to_index: 100 }],
        [],
        [],
        {},
        "TEST",
        false,
        undefined, // highlightedTradeId
        undefined, // showAllTrades
        rawCandles, // rawCandles
        5, // activeTF
        undefined, // chartOptions
      );
      // Should use clamped index for 100 -> 0 (last index)
      const orOverlay = result.overlays.find((o) => o.id.includes("or-high"));
      expect(orOverlay?.levels[1].date).toBe("2025-01-15");
    });
  });

  describe("ChartInput configuration", () => {
    it("sets showVolume to true", () => {
      const result = normalizeReplay(mockCandles, [], [], [], [], {}, "TEST", false);
      expect(result.showVolume).toBe(true);
    });

    it("sets showDataZoomSlider to false", () => {
      const result = normalizeReplay(mockCandles, [], [], [], [], {}, "TEST", false);
      expect(result.showDataZoomSlider).toBe(false);
    });

    it("sets showLegend to false", () => {
      const result = normalizeReplay(mockCandles, [], [], [], [], {}, "TEST", false);
      expect(result.showLegend).toBe(false);
    });

    it("passes through isDark", () => {
      const result = normalizeReplay(mockCandles, [], [], [], [], {}, "TEST", true);
      expect(result.isDark).toBe(true);
    });

    it("parses highlightedTradeId to number", () => {
      const result = normalizeReplay(
        mockCandles,
        mockTrades,
        [],
        [],
        [],
        {},
        "TEST",
        false,
        1, // highlightedTradeId
      );
      expect(result.highlightedTradeId).toBe(1);
    });

    it("passes through showAllTrades", () => {
      const result = normalizeReplay(
        mockCandles,
        [],
        [],
        [],
        [],
        {},
        "TEST",
        false,
        undefined, // highlightedTradeId
        true, // showAllTrades
        undefined, // rawCandles
        undefined, // activeTF
        {}, // chartOptions
      );
      expect(result.showAllTrades).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles empty arrays", () => {
      const result = normalizeReplay([], [], [], [], [], {}, "TEST", false);
      expect(result.candles).toEqual([]);
      expect(result.trades).toEqual([]);
      expect(result.overlays).toEqual([]);
    });

    it("handles missing optional data", () => {
      const result = normalizeReplay(
        mockCandles,
        [],
        undefined as any,
        undefined as any,
        undefined as any,
        undefined as any,
        "TEST",
        false,
      );
      expect(result.overlays).toEqual([]);
      expect(result.emaData).toBeUndefined();
      expect(result.markAreas).toEqual([]);
    });

    it("handles trades with missing exit data", () => {
      const incompleteTrades = [
        {
          id: 1,
          symbol: "TEST",
          entry_price: 100,
          entry_time: "09:30",
          quantity: 10,
          side: "BUY",
          pnl: 10,
          candle_idx: 0,
        },
      ];
      const result = normalizeReplay(mockCandles, incompleteTrades, [], [], [], {}, "TEST", false);
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].exit_price).toBeUndefined();
      expect(result.trades[0].exit_time).toBeUndefined();
    });
  });
});
