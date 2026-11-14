import { describe, expect, it } from "vitest";
import {
  getHeatmapMetricColor,
  getSignedMetricColor,
  isSignedHeatmapMetric,
} from "./heatmapUtils";

describe("heatmapUtils signed metrics", () => {
  it("treats day_change as signed", () => {
    expect(isSignedHeatmapMetric("day_change")).toBe(true);
    expect(isSignedHeatmapMetric("market_cap")).toBe(false);
  });

  it("colors positive day_change green and negative red", () => {
    const min = -5;
    const max = 5;
    const green = getSignedMetricColor(3, min, max);
    const red = getSignedMetricColor(-3, min, max);
    expect(green).not.toBe(red);
    expect(getSignedMetricColor(1, min, max)).not.toBe(getSignedMetricColor(-1, min, max));
    expect(getHeatmapMetricColor("day_change", 3, min, max)).toBe(green);
    expect(getHeatmapMetricColor("day_change", -3, min, max)).toBe(red);
    expect(getHeatmapMetricColor("market_cap", 3, min, max)).not.toBe(
      getHeatmapMetricColor("day_change", 3, min, max),
    );
  });
});