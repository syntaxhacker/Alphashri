import { describe, it, expect } from "vitest";
import type { PreviewCandle, ORBZone, PivotLevel } from "../../api/chartPreview";
import {
  buildChartOption,
  buildORBLine,
  buildPivotSeries,
  formatTimeLabel,
  formatTooltip,
  type ChartRenderOptions,
} from "./chartRenderer";

const makeCandle = (overrides: Partial<PreviewCandle> = {}): PreviewCandle => ({
  time: "2025-10-24T09:15",
  date: "2025-10-24",
  time_str: "09:15",
  open: 100,
  high: 105,
  low: 98,
  close: 103,
  volume: 1000,
  ...overrides,
});

describe("buildChartOption", () => {
  const candles = [
    makeCandle(),
    makeCandle({
      time: "2025-10-24T09:30",
      time_str: "09:30",
      open: 103,
      high: 108,
      low: 102,
      close: 106,
    }),
  ];

  it("returns null for empty candles array", () => {
    expect(buildChartOption({ symbol: "TEST", candles: [], size: "preview" })).toBeNull();
  });

  it("returns null for undefined candles", () => {
    expect(
      buildChartOption({ symbol: "TEST", candles: undefined as any, size: "preview" }),
    ).toBeNull();
  });

  it("builds a valid chart option for preview size", () => {
    const opt = buildChartOption({ symbol: "TEST", candles, size: "preview" });
    expect(opt).not.toBeNull();
    expect(opt.backgroundColor).toBe("#0a0a0a");
    expect(opt.animation).toBe(false);
    expect(opt.tooltip).toBeDefined();
    expect(opt.grid).toBeDefined();
    expect(opt.xAxis).toBeDefined();
    expect(opt.yAxis).toBeDefined();
    expect(opt.series).toBeDefined();
    expect(opt.series.length).toBe(3);
  });

  it("builds dark theme colors by default", () => {
    const opt = buildChartOption({ symbol: "TEST", candles, size: "expanded", isDark: true });
    expect(opt.backgroundColor).toBe("#0a0a0a");
  });

  it("builds light theme colors when isDark is false", () => {
    const opt = buildChartOption({ symbol: "TEST", candles, size: "expanded", isDark: false });
    expect(opt.backgroundColor).toBe("#ffffff");
  });

  it("includes title for non-preview sizes", () => {
    const opt = buildChartOption({ symbol: "AAPL", candles, size: "expanded" });
    expect(opt.title).toBeDefined();
    expect(opt.title.text).toBe("AAPL");
  });

  it("omits title for preview size", () => {
    const opt = buildChartOption({ symbol: "AAPL", candles, size: "preview" });
    expect(opt.title).toBeUndefined();
  });

  it("includes legend for non-preview sizes", () => {
    const opt = buildChartOption({ symbol: "TEST", candles, size: "expanded" });
    expect(opt.legend).toBeDefined();
  });

  it("omits legend for preview size", () => {
    const opt = buildChartOption({ symbol: "TEST", candles, size: "preview" });
    expect(opt.legend).toBeUndefined();
  });

  it("includes dataZoom for non-preview sizes", () => {
    const opt = buildChartOption({ symbol: "TEST", candles, size: "expanded" });
    expect(opt.dataZoom).toBeDefined();
    expect(opt.dataZoom.length).toBe(1);
  });

  it("includes slider dataZoom for full size", () => {
    const opt = buildChartOption({ symbol: "TEST", candles, size: "full" });
    expect(opt.dataZoom.length).toBe(2);
    expect(opt.dataZoom[1].type).toBe("slider");
  });

  it("includes pivot series when showPivots is true", () => {
    const pivot_levels: PivotLevel[] = [
      { date: "2025-10-24", date_raw: "2025-10-24", pp: 100, r1: 110, s1: 90 },
    ];
    const opt = buildChartOption({
      symbol: "TEST",
      candles,
      size: "expanded",
      showPivots: true,
      pivot_levels,
    });
    expect(opt.series.length).toBe(6);
    expect(opt.legend.data).toContain("R1");
    expect(opt.legend.data).toContain("PP");
    expect(opt.legend.data).toContain("S1");
  });

  it("does not include pivot series when showPivots is false", () => {
    const pivot_levels: PivotLevel[] = [
      { date: "2025-10-24", date_raw: "2025-10-24", pp: 100, r1: 110, s1: 90 },
    ];
    const opt = buildChartOption({
      symbol: "TEST",
      candles,
      size: "expanded",
      showPivots: false,
      pivot_levels,
    });
    expect(opt.series.length).toBe(3);
  });

  it("has correct grid dimensions for preview", () => {
    const opt = buildChartOption({ symbol: "TEST", candles, size: "preview" });
    expect(opt.grid.left).toBe(40);
    expect(opt.grid.right).toBe(15);
  });

  it("has correct grid dimensions for full", () => {
    const opt = buildChartOption({ symbol: "TEST", candles, size: "full" });
    expect(opt.grid.left).toBe(50);
    expect(opt.grid.top).toBe(50);
  });
});

describe("buildORBLine", () => {
  const candles = [
    makeCandle({ date: "2025-10-24" }),
    makeCandle({ date: "2025-10-25" }),
    makeCandle({ date: "2025-10-26" }),
  ];

  it("returns all nulls when orb_zones is empty", () => {
    expect(buildORBLine(candles, [], "high")).toEqual([null, null, null]);
  });

  it("returns all nulls when orb_zones is undefined", () => {
    expect(buildORBLine(candles, undefined as any, "high")).toEqual([null, null, null]);
  });

  it("maps high ORB levels to matching dates", () => {
    const orb_zones: ORBZone[] = [
      {
        date: "2025-10-24",
        date_raw: "2025-10-24",
        or_high: 105,
        or_low: 99,
        or_end_time: "09:45",
      },
    ];
    const result = buildORBLine(candles, orb_zones, "high");
    expect(result).toEqual([105, null, null]);
  });

  it("maps low ORB levels to matching dates", () => {
    const orb_zones: ORBZone[] = [
      {
        date: "2025-10-24",
        date_raw: "2025-10-24",
        or_high: 105,
        or_low: 99,
        or_end_time: "09:45",
      },
    ];
    const result = buildORBLine(candles, orb_zones, "low");
    expect(result).toEqual([99, null, null]);
  });

  it("uses date_raw as key when available", () => {
    const orb_zones: ORBZone[] = [
      {
        date: "2025-10-24",
        date_raw: "2025-10-24-custom",
        or_high: 200,
        or_low: 50,
        or_end_time: "09:45",
      },
    ];
    const result = buildORBLine(candles, orb_zones, "high");
    expect(result).toEqual([null, null, null]);
  });

  it("handles multiple orb zones", () => {
    const orb_zones: ORBZone[] = [
      {
        date: "2025-10-24",
        date_raw: "2025-10-24",
        or_high: 105,
        or_low: 99,
        or_end_time: "09:45",
      },
      {
        date: "2025-10-26",
        date_raw: "2025-10-26",
        or_high: 110,
        or_low: 95,
        or_end_time: "09:45",
      },
    ];
    const result = buildORBLine(candles, orb_zones, "high");
    expect(result).toEqual([105, null, 110]);
  });
});

describe("buildPivotSeries", () => {
  const candles = [
    makeCandle({ date: "2025-10-24" }),
    makeCandle({ date: "2025-10-25" }),
    makeCandle({ date: "2025-10-26" }),
  ];

  it("returns empty array when pivot_levels is empty", () => {
    expect(buildPivotSeries(candles, [])).toEqual([]);
  });

  it("returns empty array when pivot_levels is undefined", () => {
    expect(buildPivotSeries(candles, undefined as any)).toEqual([]);
  });

  it("builds R1, PP, S1 series for matching dates", () => {
    const pivot_levels: PivotLevel[] = [
      { date: "2025-10-24", date_raw: "2025-10-24", pp: 100, r1: 110, s1: 90 },
    ];
    const series = buildPivotSeries(candles, pivot_levels);
    expect(series).toHaveLength(3);
    expect(series[0].name).toBe("R1");
    expect(series[0].data).toEqual([110, null, null]);
    expect(series[1].name).toBe("PP");
    expect(series[1].data).toEqual([100, null, null]);
    expect(series[2].name).toBe("S1");
    expect(series[2].data).toEqual([90, null, null]);
  });

  it("handles multiple pivot levels", () => {
    const pivot_levels: PivotLevel[] = [
      { date: "2025-10-24", date_raw: "2025-10-24", pp: 100, r1: 110, s1: 90 },
      { date: "2025-10-26", date_raw: "2025-10-26", pp: 200, r1: 210, s1: 190 },
    ];
    const series = buildPivotSeries(candles, pivot_levels);
    expect(series[0].data).toEqual([110, null, 210]);
    expect(series[1].data).toEqual([100, null, 200]);
    expect(series[2].data).toEqual([90, null, 190]);
  });
});

describe("formatTimeLabel", () => {
  it("extracts time part from ISO string", () => {
    expect(formatTimeLabel("2025-10-24T09:15")).toBe("09:15");
  });

  it("extracts time part with seconds", () => {
    expect(formatTimeLabel("2025-10-24T09:15:30")).toBe("09:15");
  });

  it("returns original value if no T separator", () => {
    expect(formatTimeLabel("09:15")).toBe("09:15");
  });

  it("returns original value if empty", () => {
    expect(formatTimeLabel("")).toBe("");
  });

  it("handles time part only after T", () => {
    expect(formatTimeLabel("T09:30")).toBe("09:30");
  });
});

describe("formatTooltip", () => {
  const candles = [
    makeCandle({
      date: "2025-10-24",
      time_str: "09:15",
      open: 100,
      high: 105,
      low: 98,
      close: 103,
    }),
  ];

  it("returns empty string when no candlestick param found", () => {
    const params = [{ seriesType: "line" }];
    expect(formatTooltip(params, candles, true)).toBe("");
  });

  it("returns empty string when candle index is out of bounds", () => {
    const params = [{ seriesType: "candlestick", dataIndex: 5 }];
    expect(formatTooltip(params, candles, true)).toBe("");
  });

  it("renders tooltip with date, OHLC, and change", () => {
    const params = [{ seriesType: "candlestick", dataIndex: 0 }];
    const result = formatTooltip(params, candles, true);
    expect(result).toContain("2025-10-24");
    expect(result).toContain("09:15");
    expect(result).toContain("O:");
    expect(result).toContain("H:");
    expect(result).toContain("L:");
    expect(result).toContain("C:");
  });

  it("shows positive change percentage for bullish candle", () => {
    const params = [{ seriesType: "candlestick", dataIndex: 0 }];
    const result = formatTooltip(params, candles, true);
    expect(result).toContain("+3.00%");
  });

  it("shows negative change percentage for bearish candle", () => {
    const bearishCandles = [makeCandle({ open: 105, close: 100 })];
    const params = [{ seriesType: "candlestick", dataIndex: 0 }];
    const result = formatTooltip(params, bearishCandles, true);
    expect(result).toContain("-4.76%");
  });

  it("handles zero open price", () => {
    const zeroCandles = [makeCandle({ open: 0, close: 100 })];
    const params = [{ seriesType: "candlestick", dataIndex: 0 }];
    const result = formatTooltip(params, zeroCandles, true);
    expect(result).toContain("0");
  });
});
