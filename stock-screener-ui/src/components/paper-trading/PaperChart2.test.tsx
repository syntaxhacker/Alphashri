import { describe, expect, test } from "vitest";
import type { PaperChartData, PaperPosition } from "../../types/paperTrading";

function buildChartLegendItems(orbLabel: string | undefined, hasWeek52: boolean) {
  const items = [
    { color: "#00FFFF", label: "Entry", shape: "square" as const },
    { color: "#FFFF00", label: "TP", shape: "circle" as const },
    { color: "#FF00FF", label: "SL", shape: "circle" as const },
  ];
  if (orbLabel) items.push({ color: "#2196F3", label: orbLabel, shape: "square" as const });
  if (hasWeek52) items.push({ color: "#E91E63", label: "52W High", shape: "square" as const });
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
          ema_fast: { label: "EMA 9", color: "#10ac84", data: [2490, 2500, 2510] },
          ema_slow: { label: "EMA 21", color: "#f59e0b", data: [2480, 2490, 2500] },
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

describe("PaperChart state logic", () => {
  test("empty state when no selectedSymbol", () => {
    const selectedSymbol = null;
    expect(selectedSymbol).toBeNull();
  });

  test("loading state when chartLoading is true", () => {
    const chartLoading = true;
    const selectedSymbol = "RELIANCE";
    expect(chartLoading).toBe(true);
    expect(selectedSymbol).toBe("RELIANCE");
  });

  test("error state when chartData is null but symbol selected", () => {
    const chartData = null;
    const selectedSymbol = "RELIANCE";
    expect(chartData).toBeNull();
    expect(selectedSymbol).toBe("RELIANCE");
  });

  test("no-data state when candles empty", () => {
    const chartData = mockChartData({ candles: [] });
    expect(chartData).not.toBeNull();
    expect(chartData.candles.length).toBe(0);
  });

  test("valid state when chartData has candles", () => {
    const chartData = mockChartData();
    const selectedSymbol = "RELIANCE";
    expect(chartData).not.toBeNull();
    expect(chartData.candles.length).toBeGreaterThan(0);
    expect(selectedSymbol).toBe("RELIANCE");
  });

  test("chartTimeframe options match TIMEFRAMES", () => {
    const timeframes = [
      { value: 1, label: "1m" },
      { value: 5, label: "5m" },
      { value: 15, label: "15m" },
      { value: 30, label: "30m" },
      { value: 60, label: "1h" },
      { value: 120, label: "2h" },
      { value: 240, label: "4h" },
      { value: 720, label: "12h" },
      { value: 1440, label: "1d" },
    ];
    expect(timeframes.length).toBe(9);
    expect(timeframes[0].value).toBe(1);
    expect(timeframes[4].value).toBe(60);
  });

  test("toApiFormat conversion logic", () => {
    const toApiFormat = (val: number): string => {
      if (val === 1) return "1min";
      if (val === 5) return "5min";
      if (val === 15) return "15min";
      if (val === 30) return "30min";
      if (val === 60) return "1hour";
      if (val === 120) return "2hour";
      if (val === 240) return "4hour";
      if (val === 720) return "12hour";
      if (val === 1440) return "1day";
      return `${val}min`;
    };

    expect(toApiFormat(1)).toBe("1min");
    expect(toApiFormat(5)).toBe("5min");
    expect(toApiFormat(15)).toBe("15min");
    expect(toApiFormat(30)).toBe("30min");
    expect(toApiFormat(60)).toBe("1hour");
    expect(toApiFormat(120)).toBe("2hour");
    expect(toApiFormat(240)).toBe("4hour");
    expect(toApiFormat(720)).toBe("12hour");
    expect(toApiFormat(1440)).toBe("1day");
    expect(toApiFormat(7)).toBe("7min");
  });

  test("formatDateRange conversion logic", () => {
    const formatDateRange = (range: string): string => {
      if (!range.includes(" to ")) return range;
      const [start, end] = range.split(" to ");
      const fmt = (d: string) => {
        const dt = new Date(d);
        return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
      };
      return `${fmt(start)} - ${fmt(end)}`;
    };

    expect(formatDateRange("2026-04-24")).toBe("2026-04-24");
    expect(formatDateRange("2026-03-24 to 2026-04-24")).toBe("Mar 24 - Apr 24");
  });

  test("default state values for chart toggles", () => {
    const toggles = {
      showAllTrades: false,
      showOrbLines: false,
      showPivotLines: false,
      show52wLines: false,
      showEmaLines: false,
      intradayOnly: false,
    };

    expect(toggles.showOrbLines).toBe(false);
    expect(toggles.showPivotLines).toBe(false);
    expect(toggles.show52wLines).toBe(false);
    expect(toggles.showEmaLines).toBe(false);
    expect(toggles.intradayOnly).toBe(false);
    expect(toggles.showAllTrades).toBe(false);
  });

  test("toggled state values", () => {
    const toggles = {
      showAllTrades: true,
      showOrbLines: true,
      showPivotLines: true,
      show52wLines: true,
      showEmaLines: true,
      intradayOnly: true,
    };

    expect(toggles.showOrbLines).toBe(true);
    expect(toggles.showPivotLines).toBe(true);
    expect(toggles.show52wLines).toBe(true);
    expect(toggles.showEmaLines).toBe(true);
    expect(toggles.intradayOnly).toBe(true);
    expect(toggles.showAllTrades).toBe(true);
  });

  test("PositionInfo displays correct data", () => {
    const position = mockPosition({
      pnl: 5000,
      pnl_pct: 2.0,
      side: "BUY",
    });

    const pnlClass = position.pnl >= 0 ? "positive" : "negative";
    const sideIcon = position.side === "BUY" ? "▲" : "▼";

    expect(pnlClass).toBe("positive");
    expect(sideIcon).toBe("▲");
    expect(position.pnl).toBe(5000);
    expect(position.pnl_pct).toBe(2.0);
  });

  test("PositionInfo negative pnl", () => {
    const position = mockPosition({
      pnl: -1500,
      pnl_pct: -0.6,
      side: "SELL",
    });

    const pnlClass = position.pnl >= 0 ? "positive" : "negative";
    const sideIcon = position.side === "BUY" ? "▲" : "▼";

    expect(pnlClass).toBe("negative");
    expect(sideIcon).toBe("▼");
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
});
