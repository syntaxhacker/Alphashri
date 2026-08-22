import { describe, expect, it } from "vitest";
import { buildTradeMarkers, getMarkerConfigs } from "./buildMarkers";
import type { UnifiedTrade } from "./types";
import {
  MARKER_ENTRY,
  MARKER_TP,
  MARKER_SL,
  MARKER_EOD,
  MARKER_STOP_LOSS,
  MARKER_MAX_HOLDING,
  PIVOT_S2,
  CHART_AVG_ENTRY,
} from "../../config/colors";

describe("getMarkerConfigs", () => {
  it("returns array of 7 marker configs", () => {
    const configs = getMarkerConfigs();
    expect(configs).toHaveLength(7);
  });

  it("includes Entry config", () => {
    const configs = getMarkerConfigs();
    const entry = configs.find((c) => c.name === "Entry");
    expect(entry).toMatchObject({
      filter: expect.any(Function),
      color: MARKER_ENTRY,
      symbol: "triangle",
      size: 18,
      rotate: 180,
    });
  });

  it("includes TP config", () => {
    const configs = getMarkerConfigs();
    const tp = configs.find((c) => c.name === "TP");
    expect(tp).toMatchObject({
      filter: expect.any(Function),
      color: MARKER_TP,
      symbol: "circle",
      size: 16,
    });
  });

  it("includes SL config", () => {
    const configs = getMarkerConfigs();
    const sl = configs.find((c) => c.name === "SL");
    expect(sl).toMatchObject({
      filter: expect.any(Function),
      color: MARKER_SL,
      symbol: "circle",
      size: 16,
    });
  });

  it("includes EOD config", () => {
    const configs = getMarkerConfigs();
    const eod = configs.find((c) => c.name === "EOD");
    expect(eod).toMatchObject({
      filter: expect.any(Function),
      color: MARKER_EOD,
      symbol: "diamond",
      size: 16,
    });
  });

  it("includes Trailing config", () => {
    const configs = getMarkerConfigs();
    const trailing = configs.find((c) => c.name === "Trailing");
    expect(trailing).toMatchObject({
      filter: expect.any(Function),
      color: MARKER_STOP_LOSS,
      symbol: "circle",
      size: 16,
    });
  });

  it("includes MaxHold config", () => {
    const configs = getMarkerConfigs();
    const maxHold = configs.find((c) => c.name === "MaxHold");
    expect(maxHold).toMatchObject({
      filter: expect.any(Function),
      color: MARKER_MAX_HOLDING,
      symbol: "diamond",
      size: 16,
    });
  });

  it("includes 52W config", () => {
    const configs = getMarkerConfigs();
    const w52 = configs.find((c) => c.name === "52W");
    expect(w52).toMatchObject({
      filter: expect.any(Function),
      color: PIVOT_S2,
      symbol: "circle",
      size: 16,
    });
  });

  it("Entry filter matches all trades", () => {
    const configs = getMarkerConfigs();
    const entryFilter = configs[0].filter;
    expect(entryFilter({ id: 1 } as UnifiedTrade)).toBe(true);
    expect(entryFilter({ id: 2, exit_reason: "TP" } as UnifiedTrade)).toBe(true);
  });

  it("TP filter matches only TP exits", () => {
    const configs = getMarkerConfigs();
    const tpFilter = configs[1].filter;
    expect(tpFilter({ exit_reason: "TP" } as UnifiedTrade)).toBe(true);
    expect(tpFilter({ exit_reason: "SL" } as UnifiedTrade)).toBe(false);
    expect(tpFilter({ exit_reason: "EOD" } as UnifiedTrade)).toBe(false);
  });
});

describe("buildTradeMarkers", () => {
  const mockCandles = [
    { time: "2025-01-15T09:30:00" },
    { time: "2025-01-15T09:31:00" },
    { time: "2025-01-15T09:32:00" },
    { time: "2025-01-15T09:33:00" },
    { time: "2025-01-15T09:34:00" },
  ];

  const createMockTrade = (overrides: Partial<UnifiedTrade> = {}): UnifiedTrade => ({
    id: 1,
    entry_price: 100,
    exit_price: 110,
    entry_time: "2025-01-15T09:30:00",
    exit_time: "2025-01-15T09:33:00",
    exit_reason: "TP",
    quantity: 1,
    side: "BUY",
    pnl: 10,
    costs: 1,
    candle_idx: 0,
    exit_candle_idx: 3,
    ...overrides,
  });

  describe("time index mapping", () => {
    it("maps candles to time indices correctly", () => {
      const trades = [createMockTrade()];
      const result = buildTradeMarkers(trades, mockCandles);
      // Entry should be at index 0 (09:30)
      expect(result).toHaveLength(2); // Entry series + TP series
      expect(result[0].data[0].value[0]).toBe(0);
    });

    it("handles trades with same entry/exit time", () => {
      const trade = createMockTrade({
        entry_time: "2025-01-15T09:30:00",
        exit_time: "2025-01-15T09:30:00",
        exit_candle_idx: 0,
      });
      const result = buildTradeMarkers([trade], mockCandles);
      const entryMarker = result[0].data[0];
      const exitMarker = result[1].data[0];
      expect(entryMarker.value[0]).toBe(0);
      expect(exitMarker.value[0]).toBe(0);
    });

    it("handles missing exit time", () => {
      const trade = createMockTrade({
        exit_time: undefined,
        exit_candle_idx: undefined,
      });
      const result = buildTradeMarkers([trade], mockCandles);
      expect(result[0]).toHaveProperty("data");
      // Should only have entry marker, no exit
      expect(result[1]).toBeUndefined();
    });
  });

  describe("highlighting", () => {
    it("highlights trade when highlightedTradeId matches", () => {
      const trade = createMockTrade({ id: 5 });
      const result = buildTradeMarkers([trade], mockCandles, 5, false);
      const entryMarker = result[0].data[0];
      expect(entryMarker.itemStyle.color).toBe(CHART_AVG_ENTRY); // palette highlight
      expect(entryMarker.itemStyle.borderWidth).toBe(3);
      expect(entryMarker.symbolSize).toBe(26);
      expect(entryMarker.label).toBeDefined();
      expect(entryMarker.label.formatter).toBe("#5");
    });

    it("hides non-highlighted trades when showAllTrades is false", () => {
      const trade1 = createMockTrade({ id: 1 });
      const trade2 = createMockTrade({ id: 2 });
      const result = buildTradeMarkers([trade1, trade2], mockCandles, 1, false);
      const entryIds = result[0].data.map((d: any) => d.trade_id);
      expect(entryIds).toEqual([1]);
    });

    it("shows all trades when showAllTrades is true", () => {
      const trade1 = createMockTrade({ id: 1 });
      const trade2 = createMockTrade({ id: 2 });
      const result = buildTradeMarkers([trade1, trade2], mockCandles, 1, true);
      const entryIds = result[0].data.map((d: any) => d.trade_id);
      expect(entryIds).toEqual([1, 2]);
    });

    it("highlights exit marker for highlighted trade", () => {
      const trade = createMockTrade({ id: 5 });
      const result = buildTradeMarkers([trade], mockCandles, 5, false);
      const exitSeries = result.find((s: any) => s.name === "TP");
      expect(exitSeries).toBeDefined();
      expect(exitSeries.data[0].itemStyle.color).toBe(CHART_AVG_ENTRY);
      expect(exitSeries.data[0].symbolSize).toBe(24);
      expect(exitSeries.data[0].label).toBeDefined();
    });
  });

  describe("entry markers", () => {
    it("uses correct symbol for BUY side", () => {
      const trade = createMockTrade({ side: "BUY" });
      const result = buildTradeMarkers([trade], mockCandles);
      expect(result[0].data[0].symbol).toBe("triangle");
      expect(result[0].data[0].symbolRotate).toBe(180);
    });

    it("uses correct symbol for SELL side", () => {
      const trade = createMockTrade({ side: "SELL" });
      const result = buildTradeMarkers([trade], mockCandles);
      expect(result[0].data[0].symbol).toBe("triangleRotated");
      expect(result[0].data[0].symbolRotate).toBeUndefined();
    });

    it("includes trade object in entry marker", () => {
      const trade = createMockTrade({ id: 42 });
      const result = buildTradeMarkers([trade], mockCandles);
      expect(result[0].data[0].trade).toEqual(trade);
      expect(result[0].data[0].trade_id).toBe(42);
    });
  });

  describe("exit markers", () => {
    it("places TP marker in TP series", () => {
      const trade = createMockTrade({ exit_reason: "TP" });
      const result = buildTradeMarkers([trade], mockCandles);
      const tpSeries = result.find((s: any) => s.name === "TP");
      expect(tpSeries).toBeDefined();
      expect(tpSeries.data).toHaveLength(1);
    });

    it("places SL marker in SL series", () => {
      const trade = createMockTrade({ exit_reason: "SL" });
      const result = buildTradeMarkers([trade], mockCandles);
      const slSeries = result.find((s: any) => s.name === "SL");
      expect(slSeries).toBeDefined();
    });

    it("places EOD marker in EOD series", () => {
      const trade = createMockTrade({ exit_reason: "EOD" });
      const result = buildTradeMarkers([trade], mockCandles);
      const eodSeries = result.find((s: any) => s.name === "EOD");
      expect(eodSeries).toBeDefined();
    });

    it("handles unknown exit reason in Force bucket", () => {
      const trade = createMockTrade({ exit_reason: "UNKNOWN" });
      const result = buildTradeMarkers([trade], mockCandles);
      // Force bucket won't be in named series, but we should check it doesn't crash
      const forceSeries = result.find((s: any) => s.name === "Force");
      expect(forceSeries).toBeDefined();
    });

    it("offsets exit marker when entry and exit are same candle", () => {
      const trade = createMockTrade({
        entry_candle_idx: 0,
        exit_candle_idx: 0,
      });
      const result = buildTradeMarkers([trade], mockCandles);
      const entryMarker = result[0].data[0];
      const exitMarker = result[1].data[0];
      expect(entryMarker.symbolOffset).toEqual([0, -20]);
      expect(exitMarker.symbolOffset).toEqual([0, 20]);
    });

    it("does not offset when entry and exit are different candles", () => {
      const trade = createMockTrade({
        entry_candle_idx: 0,
        exit_candle_idx: 3,
      });
      const result = buildTradeMarkers([trade], mockCandles);
      const entryMarker = result[0].data[0];
      const exitMarker = result[1].data[0];
      expect(entryMarker.symbolOffset).toBeUndefined();
      expect(exitMarker.symbolOffset).toEqual([0, 0]);
    });
  });

  describe("candleToXAxis mapping", () => {
    it("applies mapping when candleToXAxis is provided", () => {
      const trade = createMockTrade({ candle_idx: 0 });
      const candleToXAxis = new Map([[0, 5]]);
      const result = buildTradeMarkers([trade], mockCandles, undefined, undefined, candleToXAxis);
      expect(result[0].data[0].value[0]).toBe(5);
    });

    it("does not modify when candleToXAxis is undefined", () => {
      const trade = createMockTrade({ candle_idx: 0 });
      const result = buildTradeMarkers([trade], mockCandles);
      expect(result[0].data[0].value[0]).toBe(0);
    });
  });

  describe("edge cases", () => {
    it("handles empty trades array", () => {
      const result = buildTradeMarkers([], mockCandles);
      expect(result).toEqual([]);
    });

    it("handles trade without exit_price", () => {
      const trade = createMockTrade({ exit_price: undefined });
      const result = buildTradeMarkers([trade], mockCandles);
      expect(result[0]).toBeDefined(); // Entry still exists
    });

    it("handles trade with null exit_time", () => {
      const trade = createMockTrade({ exit_time: null as any });
      const result = buildTradeMarkers([trade], mockCandles);
      // Should still have entry
      expect(result[0]).toBeDefined();
    });
  });
});
