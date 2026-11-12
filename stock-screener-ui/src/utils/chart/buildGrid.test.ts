import { describe, expect, it } from "vitest";
import { buildGrid } from "./buildGrid";
import type { ChartColors } from "./types";
import {
  CHART_BG,
  CHART_TEXT,
  CHART_MUTED,
  CHART_BORDER,
  CHART_SPLIT,
} from "../../config/colors";

describe("buildGrid", () => {
  const mockColors: ChartColors = {
    bgColor: CHART_BG,
    textColor: CHART_TEXT,
    mutedColor: CHART_MUTED,
    borderColor: CHART_BORDER,
    gridLineColor: CHART_SPLIT,
  };

  describe("when showVolume is true", () => {
    it("returns two grids with correct structure", () => {
      const result = buildGrid(mockColors, true, false);
      expect(result.grids).toHaveLength(2);
      expect(result.xAxes).toHaveLength(2);
      expect(result.yAxes).toHaveLength(2);
    });

    it("configures main grid for candles", () => {
      const result = buildGrid(mockColors, true, false);
      expect(result.grids[0]).toEqual({
        left: "8%",
        right: "3%",
        top: "5%",
        height: "60%",
      });
    });

    it("configures volume grid below candles", () => {
      const result = buildGrid(mockColors, true, false);
      expect(result.grids[1]).toEqual({
        left: "8%",
        right: "3%",
        top: "72%",
        height: "18%",
      });
    });

    it("sets xAxis data for both grids", () => {
      const result = buildGrid(mockColors, true, false);
      expect(result.xAxes[0].data).toBeUndefined();
      expect(result.xAxes[1].data).toBeUndefined();
    });

    it("configures yAxis for volume with scale and hidden elements", () => {
      const result = buildGrid(mockColors, true, false);
      expect(result.yAxes[1]).toMatchObject({
        scale: true,
        gridIndex: 1,
        axisLine: { show: false },
        splitLine: { show: false },
      });
      expect(result.yAxes[1].axisLabel.show).toBe(true);
    });

    it("includes dataZoom configuration", () => {
      const result = buildGrid(mockColors, true, false);
      expect(result.dataZoom).toHaveLength(1);
      expect(result.dataZoom[0]).toMatchObject({
        type: "inside",
        xAxisIndex: [0, 1],
        start: 0,
        end: 100,
      });
    });
  });

  describe("when showVolume is false", () => {
    it("returns single grid", () => {
      const result = buildGrid(mockColors, false, false);
      expect(result.grids).toHaveLength(1);
      expect(result.xAxes).toHaveLength(1);
      expect(result.yAxes).toHaveLength(1);
    });

    it("configures grid dimensions correctly", () => {
      const result = buildGrid(mockColors, false, false);
      expect(result.grids[0]).toEqual({
        left: "8%",
        right: "8%",
        bottom: 82,
        top: 44,
      });
    });

    it("configures xAxis with category type and scale", () => {
      const result = buildGrid(mockColors, false, false);
      expect(result.xAxes[0]).toMatchObject({
        type: "category",
        scale: true,
        splitLine: { show: false },
      });
    });

    it("configures yAxis with splitArea", () => {
      const result = buildGrid(mockColors, false, false);
      expect(result.yAxes[0]).toMatchObject({
        splitArea: { show: false },
      });
    });

    it("formats yAxis label with rupee symbol", () => {
      const result = buildGrid(mockColors, false, false);
      expect(result.yAxes[0].axisLabel.formatter).toBeDefined();
      // Test formatter function
      const formatter = result.yAxes[0].axisLabel.formatter as (value: number) => string;
      expect(formatter(1000)).toBe("₹1000");
      expect(formatter(1234.56)).toBe("₹1235"); // Rounds to integer
    });

    it("has single dataZoom without slider", () => {
      const result = buildGrid(mockColors, false, false);
      expect(result.dataZoom).toHaveLength(1);
      expect(result.dataZoom[0]).toMatchObject({
        type: "inside",
        start: 0,
        end: 100,
      });
    });
  });

  describe("when showDataZoomSlider is true", () => {
    it("adds slider to dataZoom with show: true", () => {
      const result = buildGrid(mockColors, false, true);
      expect(result.dataZoom).toHaveLength(2);
      expect(result.dataZoom[1]).toMatchObject({
        type: "slider",
        show: true,
        start: 0,
        end: 100,
        bottom: 30,
      });
    });

    it("adds slider for volume layout as well", () => {
      const result = buildGrid(mockColors, true, true);
      expect(result.dataZoom).toHaveLength(2);
      expect(result.dataZoom[1]).toMatchObject({
        type: "slider",
        xAxisIndex: [0, 1],
      });
    });
  });

  describe("x-axis label formatting", () => {
    it("has a formatter function on xAxis", () => {
      const result = buildGrid(mockColors, false, false);
      expect(result.xAxes[0].axisLabel.formatter).toBeDefined();
    });

    it("passes through single-day time-only labels", () => {
      const result = buildGrid(mockColors, false, false);
      const formatter = result.xAxes[0].axisLabel.formatter as (value: string) => string;
      expect(formatter("09:30")).toBe("09:30");
      expect(formatter("14:45")).toBe("14:45");
    });

    it("formats multi-day labels to human-readable", () => {
      const result = buildGrid(mockColors, false, false);
      const formatter = result.xAxes[0].axisLabel.formatter as (value: string) => string;
      const formatted = formatter("2026-06-12 09:30");
      expect(formatted).toContain("Jun");
      expect(formatted).toContain("12");
      expect(formatted).toContain("09:30");
    });

    it("formats year-end multi-day labels correctly", () => {
      const result = buildGrid(mockColors, false, false);
      const formatter = result.xAxes[0].axisLabel.formatter as (value: string) => string;
      const formatted = formatter("2026-01-05 10:00");
      expect(formatted).toBe("Jan 5\n10:00");
    });

    it("formatter works with volume layout too", () => {
      const result = buildGrid(mockColors, true, false);
      const formatter = result.xAxes[0].axisLabel.formatter as (value: string) => string;
      expect(formatter("09:30")).toBe("09:30");
      const formatted = formatter("2026-06-12 09:30");
      expect(formatted).toContain("Jun");
    });

    it("does not rotate labels", () => {
      const result = buildGrid(mockColors, false, false);
      expect(result.xAxes[0].axisLabel.rotate).toBe(0);
    });
  });

  describe("color propagation", () => {
    it("uses provided colors for borderColor", () => {
      const result = buildGrid(mockColors, false, false);
      expect(result.xAxes[0].axisLine.lineStyle.color).toBe(mockColors.borderColor);
      expect(result.yAxes[0].axisLine.lineStyle.color).toBe(mockColors.borderColor);
    });

    it("uses provided mutedColor for axis labels", () => {
      const result = buildGrid(mockColors, false, false);
      expect(result.xAxes[0].axisLabel.color).toBe(mockColors.mutedColor);
      expect(result.yAxes[0].axisLabel.color).toBe(mockColors.mutedColor);
    });

    it("uses provided gridLineColor for split lines", () => {
      const result = buildGrid(mockColors, false, false);
      expect(result.yAxes[0].splitLine.lineStyle.color).toBe(mockColors.gridLineColor);
    });
  });
});
