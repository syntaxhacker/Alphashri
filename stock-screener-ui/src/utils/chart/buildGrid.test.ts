import { describe, expect, it } from "vitest";
import { buildGrid } from "./buildGrid";
import type { ChartColors } from "./types";

describe("buildGrid", () => {
  const mockColors: ChartColors = {
    bgColor: "#000",
    textColor: "#fff",
    mutedColor: "#888",
    borderColor: "#333",
    gridLineColor: "#222",
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
        splitArea: { show: true },
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
