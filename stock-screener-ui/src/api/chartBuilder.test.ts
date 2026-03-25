import { describe, expect, test } from "vitest";
import { buildChartData, chartTradesToTrades } from "./chartBuilder";

const makeRawCandle = (overrides: Record<string, unknown> = {}) => ({
  index: [
    "2025-10-24T09:15:00",
    "2025-10-24T09:30:00",
    "2025-10-24T10:00:00",
    "2025-10-24T10:30:00",
  ],
  open: [100, 101, 103, 105],
  high: [102, 104, 106, 108],
  low: [99, 100, 102, 104],
  close: [101, 103, 105, 107],
  volume: [1000, 2000, 3000, 1500],
  ...overrides,
});

const makeRawTrade = (overrides: Record<string, unknown> = {}) => ({
  entry_price: 103,
  exit_price: 107,
  entry_time: "2025-10-24T10:00:00",
  exit_time: "2025-10-24T10:30:00",
  quantity: 10,
  gross_pnl: 40,
  gross_pnl_pct: 3.88,
  trading_costs: 5,
  net_pnl: 35,
  net_pnl_pct: 3.4,
  exit_reason: "TP" as const,
  hold_duration_minutes: 30,
  date: "2025-10-24",
  ...overrides,
});

describe("buildChartData", () => {
  test("builds chart data with correct structure", () => {
    const result = buildChartData("RELIANCE", makeRawCandle(), [makeRawTrade()]);

    expect(result.symbol).toBe("RELIANCE");
    expect(result.candles).toHaveLength(4);
    expect(result.trades).toHaveLength(2); // entry + exit markers
    expect(result.total_candles).toBe(4);
    expect(result.total_trades).toBe(1);
    expect(result.date_range).toEqual({ start: null, end: null });
  });

  test("formats candle data correctly", () => {
    const result = buildChartData("TATASTEEL", makeRawCandle(), []);
    const firstCandle = result.candles[0];

    expect(firstCandle.time).toBe("2025-10-24T09:15");
    expect(firstCandle.date).toBe("2025-10-24");
    expect(firstCandle.time_str).toBe("09:15");
    expect(firstCandle.open).toBe(100);
    expect(firstCandle.high).toBe(102);
    expect(firstCandle.low).toBe(99);
    expect(firstCandle.close).toBe(101);
    expect(firstCandle.volume).toBe(1000);
  });

  test("handles candles with +00:00 timezone suffix", () => {
    const candles = makeRawCandle({
      index: ["2025-10-24T09:15:00+00:00"],
      open: [100],
      high: [102],
      low: [99],
      close: [101],
      volume: [500],
    });
    const result = buildChartData("TEST", candles, []);

    expect(result.candles[0].time).toBe("2025-10-24T09:15");
  });

  test("handles candles with Z timezone suffix", () => {
    const candles = makeRawCandle({
      index: ["2025-10-24T09:15:00Z"],
      open: [100],
      high: [102],
      low: [99],
      close: [101],
      volume: [500],
    });
    const result = buildChartData("TEST", candles, []);

    expect(result.candles[0].time).toBe("2025-10-24T09:15");
  });

  test("skips candles with date-only strings (no time component)", () => {
    const candles = makeRawCandle({
      index: [
        "2026-02-01",
        "2025-10-24T09:15:00",
        "2026-03-01",
      ],
      open: [100, 101, 103],
      high: [102, 104, 106],
      low: [99, 100, 102],
      close: [101, 103, 105],
      volume: [1000, 2000, 3000],
    });
    const result = buildChartData("TEST", candles, []);

    expect(result.candles).toHaveLength(1);
    expect(result.candles[0].time).toBe("2025-10-24T09:15");
  });

  test("handles mixed valid and malformed candle timestamps", () => {
    const candles = makeRawCandle({
      index: [
        "2025-10-24T09:15:00",
        "2025-10-24T09:30:00",
        "invalid-timestamp",
        "2025-10-24T10:00:00+00:00",
        "",
        "2025-10-24T10:30:00Z",
      ],
      open: [100, 101, 102, 103, 104, 105],
      high: [102, 104, 106, 108, 110, 112],
      low: [99, 100, 101, 102, 103, 104],
      close: [101, 103, 105, 107, 109, 111],
      volume: [1000, 2000, 3000, 1500, 2500, 3500],
    });
    const result = buildChartData("TEST", candles, []);

    expect(result.candles).toHaveLength(4);
  });

  test("calculates ORB zones for trade dates only", () => {
    const candles = makeRawCandle({
      index: [
        "2025-10-24T09:15:00",
        "2025-10-24T09:30:00",
        "2025-10-24T10:00:00",
        "2025-10-25T09:15:00",
        "2025-10-25T09:30:00",
        "2025-10-25T10:00:00",
      ],
      open: [100, 101, 103, 200, 201, 203],
      high: [102, 104, 106, 202, 204, 206],
      low: [99, 100, 102, 199, 200, 202],
      close: [101, 103, 105, 201, 203, 205],
      volume: [1000, 2000, 3000, 1000, 2000, 3000],
    });

    const result = buildChartData("TEST", candles, [makeRawTrade({ date: "2025-10-25" })]);

    expect(result.orb_zones).toHaveLength(1);
    expect(result.orb_zones[0].date_raw).toBe("2025-10-25");
    expect(result.orb_zones[0].or_high).toBe(204);
    expect(result.orb_zones[0].or_low).toBe(199);
  });

  test("calculates ORB end time correctly based on orMinutes", () => {
    const result = buildChartData("TEST", makeRawCandle(), [makeRawTrade()], 30);

    expect(result.orb_zones[0].or_end_time).toBe("09:45");
  });

  test("extracts pivot levels from trades with pp/r1/s1", () => {
    const result = buildChartData("TEST", makeRawCandle(), [
      makeRawTrade({
        pp: 100,
        r1: 105,
        s1: 95,
        r2: 110,
        s2: 90,
      }),
    ]);

    expect(result.pivot_levels).toHaveLength(1);
    expect(result.pivot_levels[0].pp).toBe(100);
    expect(result.pivot_levels[0].r1).toBe(105);
    expect(result.pivot_levels[0].s1).toBe(95);
    expect(result.pivot_levels[0].r2).toBe(110);
    expect(result.pivot_levels[0].s2).toBe(90);
  });

  test("does not extract pivot levels when pp is missing", () => {
    const result = buildChartData("TEST", makeRawCandle(), [makeRawTrade({ pp: undefined })]);

    expect(result.pivot_levels).toHaveLength(0);
  });

  test("deduplicates pivot levels by date", () => {
    const result = buildChartData("TEST", makeRawCandle(), [
      makeRawTrade({ pp: 100, r1: 105, s1: 95 }),
      makeRawTrade({ pp: 100, r1: 105, s1: 95 }),
    ]);

    expect(result.pivot_levels).toHaveLength(1);
  });

  test("extracts 52W levels from 52w_high field", () => {
    const result = buildChartData("TEST", makeRawCandle(), [makeRawTrade({ "52w_high": 500 })]);

    expect(result.week52_levels).toHaveLength(1);
    expect(result.week52_levels[0]["52w_high"]).toBe(500);
  });

  test("prefers 52w_high_entry over 52w_high", () => {
    const result = buildChartData("TEST", makeRawCandle(), [
      makeRawTrade({ "52w_high": 500, "52w_high_entry": 600 }),
    ]);

    expect(result.week52_levels[0]["52w_high"]).toBe(600);
  });

  test("creates entry and exit trade markers", () => {
    const result = buildChartData("TEST", makeRawCandle(), [makeRawTrade()]);

    expect(result.trades).toHaveLength(2);
    expect(result.trades[0].type).toBe("entry");
    expect(result.trades[0].price).toBe(103);
    expect(result.trades[0].marker.symbol).toBe("triangle");
    expect(result.trades[0].marker.color).toBe("#00BFFF");

    expect(result.trades[1].type).toBe("exit");
    expect(result.trades[1].price).toBe(107);
    expect(result.trades[1].marker.symbol).toBe("circle");
  });

  test("uses correct exit marker colors", () => {
    const tpResult = buildChartData("TEST", makeRawCandle(), [makeRawTrade({ exit_reason: "TP" })]);
    const slResult = buildChartData("TEST", makeRawCandle(), [makeRawTrade({ exit_reason: "SL" })]);
    const eodResult = buildChartData("TEST", makeRawCandle(), [
      makeRawTrade({ exit_reason: "EOD" }),
    ]);

    expect(tpResult.trades[1].marker.color).toBe("#00E676");
    expect(slResult.trades[1].marker.color).toBe("#FF1744");
    expect(eodResult.trades[1].marker.color).toBe("#FFEA00");
  });

  test("defaults to yellow for unknown exit reasons", () => {
    const result = buildChartData("TEST", makeRawCandle(), [
      makeRawTrade({ exit_reason: "UNKNOWN" as any }),
    ]);

    expect(result.trades[1].marker.color).toBe("#FFEA00");
  });

  test("handles empty candles and trades", () => {
    const result = buildChartData(
      "EMPTY",
      {
        index: [],
        open: [],
        high: [],
        low: [],
        close: [],
        volume: [],
      },
      [],
    );

    expect(result.symbol).toBe("EMPTY");
    expect(result.candles).toHaveLength(0);
    expect(result.orb_zones).toHaveLength(0);
    expect(result.pivot_levels).toHaveLength(0);
    expect(result.week52_levels).toHaveLength(0);
    expect(result.trades).toHaveLength(0);
    expect(result.date_range).toEqual({ start: null, end: null });
  });

  test("handles candles with missing values by defaulting to 0", () => {
    const candles = {
      index: ["2025-10-24T09:15:00"],
      open: [],
      high: [],
      low: [],
      close: [],
      volume: [],
    };
    const result = buildChartData("TEST", candles as any, []);

    expect(result.candles[0].open).toBe(0);
    expect(result.candles[0].high).toBe(0);
    expect(result.candles[0].low).toBe(0);
    expect(result.candles[0].close).toBe(0);
    expect(result.candles[0].volume).toBe(0);
  });

  test("assigns incrementing trade_id", () => {
    const result = buildChartData("TEST", makeRawCandle(), [
      makeRawTrade(),
      makeRawTrade({ entry_time: "2025-10-24T09:30:00" }),
    ]);

    expect(result.trades[0].trade_id).toBe(1);
    expect(result.trades[1].trade_id).toBe(1);
    expect(result.trades[2].trade_id).toBe(2);
    expect(result.trades[3].trade_id).toBe(2);
  });
});

describe("chartTradesToTrades", () => {
  const makeChartTrade = (overrides: Record<string, unknown> = {}) => ({
    trade_id: 1,
    type: "entry" as const,
    time: "2025-10-24T10:00",
    candle_idx: 2,
    date: "2025-10-24",
    price: 103,
    marker: { symbol: "triangle", color: "#00BFFF", size: 16 },
    trade: {
      entry_price: 103,
      exit_price: 107,
      entry_time: "2025-10-24T10:00:00",
      exit_time: "2025-10-24T10:30:00",
      quantity: 10,
      gross_pnl: 40,
      trading_costs: 5,
      net_pnl: 35,
      net_pnl_pct: 3.4,
      exit_reason: "TP" as const,
      hold_duration_minutes: 30,
      or_high: undefined,
      or_low: undefined,
      pp: undefined,
      r1: undefined,
      s1: undefined,
      r2: undefined,
      s2: undefined,
      gross_pnl_pct: 3.88,
      "52w_high": undefined,
      trailing_active: undefined,
    },
    ...overrides,
  });

  test("filters to entry markers only", () => {
    const chartTrades = [
      makeChartTrade({ type: "entry", trade_id: 1 }),
      makeChartTrade({ type: "exit", trade_id: 1 }),
      makeChartTrade({ type: "entry", trade_id: 2 }),
      makeChartTrade({ type: "exit", trade_id: 2 }),
    ];

    const result = chartTradesToTrades(chartTrades);
    expect(result).toHaveLength(2);
  });

  test("maps trade data correctly", () => {
    const result = chartTradesToTrades([makeChartTrade()]);

    expect(result[0].entry_price).toBe(103);
    expect(result[0].exit_price).toBe(107);
    expect(result[0].quantity).toBe(10);
    expect(result[0].gross_pnl).toBe(40);
    expect(result[0].net_pnl).toBe(35);
    expect(result[0].exit_reason).toBe("TP");
    expect(result[0].hold_duration_minutes).toBe(30);
    expect(result[0].date).toBe("2025-10-24");
  });

  test("defaults gross_pnl_pct to 0 when undefined", () => {
    const chartTrade = makeChartTrade();
    delete (chartTrade.trade as any).gross_pnl_pct;
    const result = chartTradesToTrades([chartTrade]);

    expect(result[0].gross_pnl_pct).toBe(0);
  });

  test("returns empty array for no entries", () => {
    const result = chartTradesToTrades([makeChartTrade({ type: "exit", trade_id: 1 })]);

    expect(result).toHaveLength(0);
  });

  test("returns empty array for empty input", () => {
    expect(chartTradesToTrades([])).toHaveLength(0);
  });
});
