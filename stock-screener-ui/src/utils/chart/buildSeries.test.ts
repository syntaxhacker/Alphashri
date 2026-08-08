import { describe, expect, it } from "vitest";
import { buildSeries } from "./buildSeries";
import { CANDLESTICK_ITEM_STYLE } from "../chartUtils";
import {
  MARKER_SL,
  BLACK,
  CHART_TEXT,
  ORB_AREA,
  VOLUME_BULLISH,
  VOLUME_BEARISH,
} from "../../config/colors";

describe("buildSeries", () => {
  const mockCandles = [
    { open: 100, close: 110, high: 115, low: 98, volume: 1000 },
    { open: 110, close: 108, high: 112, low: 107, volume: 1500 },
    { open: 108, close: 105, high: 109, low: 104, volume: 800 },
  ];

  it("returns object with series array", () => {
    const result = buildSeries(mockCandles, {} as any, false);
    expect(result).toHaveProperty("series");
    expect(Array.isArray(result.series)).toBe(true);
  });

  describe("candlestick series", () => {
    it("creates candlestick series", () => {
      const result = buildSeries(mockCandles, {} as any, false);
      expect(result.series[0].type).toBe("candlestick");
      expect(result.series[0].name).toBe("Price");
    });

    it("converts candles to OHLC array format", () => {
      const result = buildSeries(mockCandles, {} as any, false);
      const ohlc = result.series[0].data;
      expect(ohlc).toHaveLength(3);
      expect(ohlc[0]).toEqual([100, 110, 98, 115]);
      expect(ohlc[1]).toEqual([110, 108, 107, 112]);
      expect(ohlc[2]).toEqual([108, 105, 104, 109]);
    });

    it("applies candlestick item style", () => {
      const result = buildSeries(mockCandles, {} as any, false);
      expect(result.series[0].itemStyle).toEqual(CANDLESTICK_ITEM_STYLE);
    });

    it("sets z-index to 2 for candle series", () => {
      const result = buildSeries(mockCandles, {} as any, false);
      expect(result.series[0].z).toBe(2);
    });
  });

  describe("markLines integration", () => {
    it("adds markLines when provided", () => {
      const markLines = [
        {
          yAxis: 105,
          lineStyle: { color: MARKER_SL, type: "dashed", width: 2 },
          label: { position: "insideEndTop", formatter: "SL 105" },
        },
      ];
      const result = buildSeries(mockCandles, {} as any, false, markLines);
      expect(result.series[0].markLine).toBeDefined();
      expect(result.series[0].markLine.data).toEqual(markLines);
    });

    it("configures markLine symbol correctly", () => {
      const markLines = [
        {
          yAxis: 100,
          lineStyle: { color: BLACK },
          label: { position: "insideEndTop", formatter: "Test" },
        },
      ];
      const result = buildSeries(mockCandles, {} as any, false, markLines);
      expect(result.series[0].markLine.symbol).toEqual(["none", "none"]);
    });

    it("sets markLine label style", () => {
      const markLines = [
        {
          yAxis: 100,
          lineStyle: { color: BLACK },
          label: { position: "insideEndTop", formatter: "Test" },
        },
      ];
      const result = buildSeries(mockCandles, {} as any, false, markLines);
      expect(result.series[0].markLine.label).toEqual({
        color: "inherit",
        fontSize: 11,
        formatter: "{b}",
      });
    });

    it("does not add markLine when array is empty", () => {
      const result = buildSeries(mockCandles, {} as any, false, []);
      expect(result.series[0].markLine).toBeUndefined();
    });

    it("does not add markLine when undefined", () => {
      const result = buildSeries(mockCandles, {} as any, false, undefined);
      expect(result.series[0].markLine).toBeUndefined();
    });
  });

  describe("markAreas integration", () => {
    const times = ["09:30", "09:31", "09:32"];

    it("adds markArea when provided with times", () => {
      const markAreas = [{ from: "09:30", to: "09:31", color: ORB_AREA }];
      const result = buildSeries(mockCandles, {} as any, false, undefined, markAreas, times);
      expect(result.series[0].markArea).toBeDefined();
    });

    it("maps markArea to xAxis positions", () => {
      const markAreas = [{ from: "09:30", to: "09:31", color: "red" }];
      const result = buildSeries(mockCandles, {} as any, false, undefined, markAreas, times);
      expect(result.series[0].markArea.data[0][0]).toEqual({
        xAxis: "09:30",
        itemStyle: { color: "red" },
      });
      expect(result.series[0].markArea.data[0][1]).toEqual({
        xAxis: "09:31",
      });
    });

    it("handles markArea with fromY and toY", () => {
      const markAreas = [{ from: "09:30", to: "09:32", fromY: 100, toY: 110, color: "blue" }];
      const result = buildSeries(mockCandles, {} as any, false, undefined, markAreas, times);
      expect(result.series[0].markArea.data[0][0].yAxis).toBe(100);
      expect(result.series[0].markArea.data[0][1].yAxis).toBe(110);
    });

    it("does not add markArea when times is undefined", () => {
      const markAreas = [{ from: "09:30", to: "09:31", color: "red" }];
      const result = buildSeries(mockCandles, {} as any, false, undefined, markAreas, undefined);
      expect(result.series[0].markArea).toBeUndefined();
    });

    it("does not add markArea when array is empty", () => {
      const result = buildSeries(mockCandles, {} as any, false, undefined, []);
      expect(result.series[0].markArea).toBeUndefined();
    });
  });

  describe("volume series", () => {
    it("adds volume bar series when showVolume is true", () => {
      const result = buildSeries(mockCandles, {} as any, true);
      expect(result.series).toHaveLength(2);
      expect(result.series[1].name).toBe("Volume");
      expect(result.series[1].type).toBe("bar");
    });

    it("maps volume data correctly", () => {
      const result = buildSeries(mockCandles, {} as any, true);
      const volumeData = result.series[1].data;
      expect(volumeData[0]).toEqual([0, 1000, 1]); // [index, volume, 1 for bullish]
      expect(volumeData[1]).toEqual([1, 1500, -1]); // [index, volume, -1 for bearish]
      expect(volumeData[2]).toEqual([2, 800, -1]); // [index, volume, -1 for bearish (close < open)]
    });

    it("sets volume series to use xAxisIndex 1 and yAxisIndex 1", () => {
      const result = buildSeries(mockCandles, {} as any, true);
      expect(result.series[1].xAxisIndex).toBe(1);
      expect(result.series[1].yAxisIndex).toBe(1);
    });

    it("colors volume bars green for bullish candles", () => {
      const result = buildSeries(mockCandles, {} as any, true);
      const colorFn = result.series[1].itemStyle.color as (params: any) => string;
      expect(colorFn({ data: [0, 1000, 1] })).toBe(VOLUME_BULLISH);
    });

    it("colors volume bars red for bearish candles", () => {
      const result = buildSeries(mockCandles, {} as any, true);
      const colorFn = result.series[1].itemStyle.color as (params: any) => string;
      expect(colorFn({ data: [0, 1000, -1] })).toBe(VOLUME_BEARISH);
    });

    it("sets volume z-index to 1", () => {
      const result = buildSeries(mockCandles, {} as any, true);
      expect(result.series[1].z).toBe(1);
    });

    it("does not add volume when showVolume is false", () => {
      const result = buildSeries(mockCandles, {} as any, false);
      expect(result.series).toHaveLength(1);
    });
  });

  describe("array candle format", () => {
    it("handles candles already as OHLC arrays", () => {
      const arrayCandles = [
        [100, 110, 98, 115],
        [110, 108, 107, 112],
      ];
      const result = buildSeries(arrayCandles as any, {} as any, false);
      expect(result.series[0].data).toEqual(arrayCandles);
    });
  });

  describe("times parameter", () => {
    it("is not used when showVolume is false", () => {
      const result = buildSeries(mockCandles, {} as any, false, undefined, undefined, ["09:30"]);
      // Should not affect output when showVolume is false
      expect(result.series[0].type).toBe("candlestick");
    });
  });

  describe("colors parameter", () => {
    it("is not currently used but accepted", () => {
      const colors = { bgColor: BLACK, textColor: CHART_TEXT };
      const result = buildSeries(mockCandles, colors as any, false);
      expect(result.series).toBeDefined();
    });
  });
});
