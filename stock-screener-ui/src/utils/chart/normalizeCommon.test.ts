import { describe, expect, it, vi } from "vitest";
import { mapCandles, mapTrades } from "./normalizeCommon";

describe("mapCandles", () => {
  it("maps raw candles to UnifiedCandle format", () => {
    const rawCandles = [
      { time: "2025-01-15T09:30:00", open: 100, high: 110, low: 95, close: 105, volume: 1000 },
      { time: "2025-01-15T09:31:00", open: 105, high: 108, low: 103, close: 107, volume: 800 },
    ];
    const result = mapCandles(rawCandles);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      time: "2025-01-15T09:30:00",
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 1000,
    });
    expect(result[0].date).toBe("2025-01-15");
    expect(result[0].time_str).toBe("09:30");
  });

  it("extracts date and time_str from ISO timestamp", () => {
    const rawCandles = [
      { time: "2025-01-15T09:30:00", open: 1, high: 2, low: 3, close: 4, volume: 5 },
    ];
    const result = mapCandles(rawCandles);
    expect(result[0]).toEqual({
      time: "2025-01-15T09:30:00",
      date: "2025-01-15",
      time_str: "09:30",
      open: 1,
      high: 2,
      low: 3,
      close: 4,
      volume: 5,
    });
  });

  it("handles empty array", () => {
    const result = mapCandles([]);
    expect(result).toEqual([]);
  });

  it("creates new array (immutability)", () => {
    const rawCandles = [{ time: "test", open: 100, high: 101, low: 99, close: 100.5, volume: 500 }];
    const result = mapCandles(rawCandles);
    expect(result).not.toBe(rawCandles);
    rawCandles[0].open = 999;
    expect(result[0].open).toBe(100); // unchanged
  });
});

describe("mapTrades", () => {
  const rawTrades = [
    {
      entry_price: 100,
      exit_price: 110,
      entry_time: "09:30",
      exit_time: "09:35",
      exit_reason: "TP",
      quantity: 10,
      side: "BUY",
      net_pnl: 10,
      costs: 1,
    },
    {
      entry_price: 200,
      exit_price: 190,
      entry_time: "09:40",
      exit_time: "09:45",
      exit_reason: "SL",
      quantity: 5,
      side: "SELL",
      net_pnl: -10,
      costs: 1,
    },
  ];

  it("maps raw trades to UnifiedTrade format with custom id function", () => {
    const result = mapTrades(rawTrades, (_t, idx) => idx + 1);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
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
    });
    expect(result[1].id).toBe(2);
  });

  it("maps side to BUY|SELL union type", () => {
    const result = mapTrades(rawTrades, (_t) => 1);
    expect(result[0].side).toBe("BUY");
    expect(result[1].side).toBe("SELL");
  });

  it("renames net_pnl to pnl", () => {
    const result = mapTrades(rawTrades, (_t) => 1);
    expect(result[0]).toHaveProperty("pnl");
    expect(result[0]).not.toHaveProperty("net_pnl");
    expect(result[0].pnl).toBe(10);
  });

  it("maps costs field correctly", () => {
    const raw = [{ ...rawTrades[0], costs: 5 } as any];
    const result = mapTrades(raw, (_t) => 1);
    expect(result[0].costs).toBe(5);
  });

  it("handles missing optional fields", () => {
    const raw = [
      {
        entry_price: 100,
        entry_time: "09:30",
        exit_reason: "TP",
        quantity: 10,
        side: "BUY",
        net_pnl: 10,
      } as any,
    ];
    const result = mapTrades(raw, (_t) => 1);
    expect(result[0].exit_price).toBeUndefined();
    expect(result[0].exit_time).toBeUndefined();
    expect(result[0].costs).toBeUndefined();
  });

  it("handles empty array", () => {
    const result = mapTrades([], (_t) => 1);
    expect(result).toEqual([]);
  });

  it("calls getId function with trade and index", () => {
    const getId = vi.fn((_t, idx) => idx);
    mapTrades(rawTrades, getId);
    expect(getId).toHaveBeenCalledTimes(2);
    expect(getId).toHaveBeenNthCalledWith(1, rawTrades[0], 0);
    expect(getId).toHaveBeenNthCalledWith(2, rawTrades[1], 1);
  });

  it("creates new array (immutability)", () => {
    const result = mapTrades(rawTrades, (_t) => 1);
    expect(result).not.toBe(rawTrades);
  });
});
