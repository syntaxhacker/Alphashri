import { describe, expect, it } from "vitest";
import { normalizeReplay } from "./normalizeReplay";
import {
  PIVOT_R1,
  PIVOT_PP,
  PIVOT_S1,
  PIVOT_52W_HIGH,
  PIVOT_52W_LOW,
  INDICATOR_BLUE_A,
  ORB_AREA,
} from "../../config/colors";
import {
  makeReplayCandles,
  makeReplayTrade,
  makeORLevels,
  makePivotLevels,
  make52WLevels,
  makeEMADataMap,
  makeEMADataMapWithTimeframes,
} from "./normalizeTestFixtures";

type ReplayArgs = Parameters<typeof normalizeReplay>;
type CallReplayInput = {
  candles?: ReplayArgs[0];
  trades?: ReplayArgs[1];
  orLevels?: ReplayArgs[2];
  pivotLevels?: ReplayArgs[3];
  week52Levels?: ReplayArgs[4];
  emaDataMap?: ReplayArgs[5];
  symbol?: string;
  isDark?: boolean;
  highlightedTradeId?: ReplayArgs[8];
  // Tests pass booleans and option-bags in these slots on purpose (legacy call shapes).
  showAllTrades?: unknown;
  rawCandles?: unknown;
  // Tests pass `true` here on purpose (legacy call shapes).
  activeTF?: unknown;
  chartOptions?: ReplayArgs[12];
};

describe("normalizeReplay", () => {
  const mockCandles = makeReplayCandles();

  const mockTrades = [makeReplayTrade()];

  const mockORLevels = makeORLevels();

  const mockPivotLevels = makePivotLevels();

  const mock52WLevels = make52WLevels();

  const mockEMADataMap = makeEMADataMap();

  // Invoke the normalizer with shared defaults so each test only states its deltas.
  const callReplay = ({
    candles = mockCandles,
    trades = [],
    orLevels = mockORLevels,
    pivotLevels = [],
    week52Levels = [],
    emaDataMap = {},
    symbol = "TEST",
    isDark = false,
    highlightedTradeId,
    showAllTrades,
    rawCandles,
    activeTF,
    chartOptions,
  }: CallReplayInput = {}) =>
    normalizeReplay(
      candles,
      trades,
      orLevels,
      pivotLevels,
      week52Levels,
      emaDataMap,
      symbol,
      isDark,
      highlightedTradeId,
      showAllTrades as ReplayArgs[9],
      rawCandles as ReplayArgs[10],
      activeTF as ReplayArgs[11],
      chartOptions,
    );

  describe("candle normalization", () => {
    it("maps candles to UnifiedCandle format", () => {
      const result = callReplay({
        trades: mockTrades,
        pivotLevels: mockPivotLevels,
        week52Levels: mock52WLevels,
        emaDataMap: mockEMADataMap,
      });
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
      const result = callReplay({
        trades: tradesWithOther,
        pivotLevels: mockPivotLevels,
        week52Levels: mock52WLevels,
        emaDataMap: mockEMADataMap,
      });
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].id).toBe(1);
    });

    it("maps trades with correct id", () => {
      const result = callReplay({
        trades: mockTrades,
        pivotLevels: mockPivotLevels,
        week52Levels: mock52WLevels,
        emaDataMap: mockEMADataMap,
      });
      expect(result.trades[0].id).toBe(1);
    });
  });

  describe("ORB overlays", () => {
    it("adds OR high and low overlays as lines", () => {
      const result = callReplay({ showAllTrades: true });
      const orHigh = result.overlays.find((o) => o.id.includes("or-high"));
      const orLow = result.overlays.find((o) => o.id.includes("or-low"));
      expect(orHigh).toBeDefined();
      expect(orLow).toBeDefined();
      expect(orHigh?.type).toBe("line");
      expect(orLow?.type).toBe("line");
    });

    it("includes strategy name in overlay labels", () => {
      const result = callReplay({ showAllTrades: true });
      const orHigh = result.overlays.find((o) => o.id === "or-high-orb");
      expect(orHigh?.label).toBe("OR High (orb)");
    });

    it("uses dashed [6,3] pattern for OR lines", () => {
      const result = callReplay({ showAllTrades: true });
      const orHigh = result.overlays.find((o) => o.id === "or-high-orb");
      expect(orHigh?.dash).toEqual([6, 3]);
    });

    it("sets OR levels with date range", () => {
      const result = callReplay({ showAllTrades: true });
      const orHigh = result.overlays.find((o) => o.id === "or-high-orb");
      expect(orHigh?.levels).toHaveLength(2);
      expect(orHigh?.levels[0]).toHaveProperty("date");
      expect(orHigh?.levels[0]).toHaveProperty("value", 112);
    });

    it("hides OR lines when show_orb_zones is false", () => {
      const result = callReplay({ chartOptions: { show_orb_zones: false } });
      expect(result.overlays.find((o) => o.id.includes("or-"))).toBeUndefined();
    });

    it("adds OR markAreas", () => {
      const result = callReplay({
        showAllTrades: { show_orb_zones: false }, // actually true through default
        rawCandles: true,
      });
      expect(result.markAreas).toHaveLength(1);
      expect(result.markAreas[0]).toMatchObject({
        fromY: 98,
        toY: 112,
        color: ORB_AREA,
      });
    });
  });

  // Pivot overlays drawn on the raw-false/activeTF-true legacy call shape.
  const pivotReplay = () =>
    callReplay({
      pivotLevels: mockPivotLevels,
      rawCandles: false,
      activeTF: true,
    });

  describe("Pivot overlays", () => {
    it("adds pivot level lines", () => {
      const result = callReplay({
        pivotLevels: mockPivotLevels,
        showAllTrades: { show_pivot_levels: false }, // passing true via default
        rawCandles: false,
        activeTF: true,
      });
      const pivotLevels = ["r2", "r1", "pp", "s1", "s2"];
      for (const level of pivotLevels) {
        expect(result.overlays.find((o) => o.id === `${level}-pivot`)).toBeDefined();
      }
    });

    it("uses correct colors for pivot levels", () => {
      const result = pivotReplay();
      const r1 = result.overlays.find((o) => o.id === "r1-pivot");
      expect(r1?.color).toBe(PIVOT_R1);
      const pp = result.overlays.find((o) => o.id === "pp-pivot");
      expect(pp?.color).toBe(PIVOT_PP);
      const s1 = result.overlays.find((o) => o.id === "s1-pivot");
      expect(s1?.color).toBe(PIVOT_S1);
    });

    it("uses correct dash patterns", () => {
      const result = pivotReplay();
      const r1 = result.overlays.find((o) => o.id === "r1-pivot");
      expect(r1?.dash).toEqual([6, 3]); // dashed
      const r2 = result.overlays.find((o) => o.id === "r2-pivot");
      expect(r2?.dash).toEqual([2, 2]); // dotted
    });
  });

  describe("52-week overlays", () => {
    it("adds 52W high line", () => {
      const result = callReplay({
        week52Levels: mock52WLevels,
        showAllTrades: { show_52w_high: false }, // true by default
        rawCandles: false,
        activeTF: true,
      });
      const high52w = result.overlays.find((o) => o.id === "52w-high-52w");
      expect(high52w).toBeDefined();
      expect(high52w?.color).toBe(PIVOT_52W_HIGH);
      expect(high52w?.dash).toEqual([6, 3]);
    });

    it("adds 52W low line when > 0", () => {
      const result = callReplay({
        week52Levels: mock52WLevels,
        rawCandles: false,
        activeTF: true,
      });
      const low52w = result.overlays.find((o) => o.id === "52w-low-52w");
      expect(low52w).toBeDefined();
      expect(low52w?.color).toBe(PIVOT_52W_LOW);
      expect(low52w?.dash).toEqual([2, 2]);
    });
  });

  describe("EMA integration", () => {
    it("adds EMA series when show_ema is true", () => {
      const result = callReplay({
        emaDataMap: mockEMADataMap,
        showAllTrades: { show_ema: false }, // true by default
        rawCandles: false,
        activeTF: true,
      });
      expect(result.emaData).toHaveLength(2);
      expect(result.emaData[0]).toMatchObject({
        label: "EMA 9",
        color: INDICATOR_BLUE_A,
        data: [100, 101, 102],
      });
    });

    it("selects correct timeframe based on activeTF", () => {
      const emaDataMap = makeEMADataMapWithTimeframes({
        "1min": { ema_fast: [100], ema_slow: [99] },
        "5min": { ema_fast: [100, 101, 102], ema_slow: [99, 100, 101] },
      });
      const result = callReplay({
        emaDataMap,
        activeTF: 5,
      });
      expect(result.emaData?.[0].data).toHaveLength(3);
    });

    it("fallback to first timeframe if specific not found", () => {
      const emaDataMap = makeEMADataMapWithTimeframes({
        "10min": { ema_fast: [100], ema_slow: [99] },
      });
      const result = callReplay({
        emaDataMap,
        activeTF: 5,
      });
      expect(result.emaData).toBeDefined();
      expect(result.emaData?.[0].data).toEqual([100]);
    });

    it("does not add EMA when show_ema is false", () => {
      const result = callReplay({
        emaDataMap: mockEMADataMap,
        chartOptions: { show_ema: false },
      });
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
      const result = callReplay({
        orLevels: [{ ...mockORLevels[0], from_index: 0, to_index: 2 }],
        rawCandles,
        activeTF: 1,
      });
      const orOverlay = result.overlays.find((o) => o.id.includes("or-high"));
      expect(orOverlay?.levels[0].date).toBe("2025-01-15"); // from 09:30
      expect(orOverlay?.levels[1].date).toBe("2025-01-15"); // to 09:32
    });

    it("handles out-of-bounds indices", () => {
      const rawCandles = [{ time: "2025-01-15T09:30:00" }];
      const result = callReplay({
        orLevels: [{ ...mockORLevels[0], from_index: 0, to_index: 100 }],
        rawCandles, // rawCandles
        activeTF: 5, // activeTF
      });
      // Should use clamped index for 100 -> 0 (last index)
      const orOverlay = result.overlays.find((o) => o.id.includes("or-high"));
      expect(orOverlay?.levels[1].date).toBe("2025-01-15");
    });
  });

  describe("ChartInput configuration", () => {
    it("sets showVolume to false", () => {
      const result = callReplay({ symbol: "RELIANCE" });
      expect(result.showVolume).toBe(false);
    });

    it("sets showDataZoomSlider to false", () => {
      const result = callReplay();
      expect(result.showDataZoomSlider).toBe(false);
    });

    it("sets showLegend to false", () => {
      const result = callReplay();
      expect(result.showLegend).toBe(false);
    });

    it("passes through isDark", () => {
      const result = callReplay({ isDark: true });
      expect(result.isDark).toBe(true);
    });

    it("parses highlightedTradeId to number", () => {
      const result = callReplay({
        trades: mockTrades,
        highlightedTradeId: 1,
      });
      expect(result.highlightedTradeId).toBe(1);
    });

    it("passes through showAllTrades", () => {
      const result = callReplay({
        showAllTrades: true,
        chartOptions: {},
      });
      expect(result.showAllTrades).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("handles empty arrays", () => {
      const result = callReplay({ candles: [], orLevels: [] });
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
      const result = callReplay({ trades: incompleteTrades });
      expect(result.trades).toHaveLength(1);
      expect(result.trades[0].exit_price).toBeUndefined();
      expect(result.trades[0].exit_time).toBeUndefined();
    });
  });
});
