import { describe, expect, it } from "vitest";
import { buildLegend } from "./buildLegend";
import { CHART_MUTED } from "../../config/colors";

describe("buildLegend", () => {
  describe("when showLegend is false", () => {
    it("returns object with show: false", () => {
      const result = buildLegend(["Series1"], false);
      expect(result).toEqual({ show: false });
    });
  });

  describe("when showLegend is true", () => {
    it("returns legend configuration with all series names", () => {
      const result = buildLegend(["Series1", "Series2", "Series3"], true);
      expect(result).toMatchObject({
        data: ["Series1", "Series2", "Series3"],
        bottom: 6,
        type: "scroll",
        itemWidth: 14,
        itemHeight: 10,
        itemGap: 8,
      });
    });

    it("removes duplicate series names", () => {
      const result = buildLegend(["Series1", "Series2", "Series1"], true);
      expect(result.data).toEqual(["Series1", "Series2"]);
    });

    it("filters out falsy values", () => {
      const result = buildLegend(["Series1", null, undefined, "Series2"], true);
      expect(result.data).toEqual(["Series1", "Series2"]);
    });

    it("applies mutedColor text style when provided", () => {
      const result = buildLegend(["Series1"], true, CHART_MUTED);
      expect(result.textStyle).toEqual({ color: CHART_MUTED });
    });

    it("does not add textStyle when mutedColor is not provided", () => {
      const result = buildLegend(["Series1"], true);
      expect(result.textStyle).toBeUndefined();
    });

    it("handles empty array", () => {
      const result = buildLegend([], true);
      expect(result.data).toEqual([]);
    });

    it("maintains original order after deduplication", () => {
      const result = buildLegend(["C", "A", "B", "A", "C"], true);
      expect(result.data).toEqual(["C", "A", "B"]);
    });
  });
});
