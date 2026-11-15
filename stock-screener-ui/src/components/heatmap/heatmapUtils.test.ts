import { describe, expect, it } from "vitest";
import {
  formatMarketCap,
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
describe("formatMarketCap", () => {
  // Input is rupees. The crore band is 1e7; a mis-scaled band made the map
  // tooltip disagree with the table's ₹Cr column by 10^5.
  it("renders rupee amounts on the correct scale", () => {
    expect(formatMarketCap(1812818.9 * 1e7)).toBe("₹18.1T"); // ₹18.1 lakh crore
    expect(formatMarketCap(54236.65 * 1e7)).toBe("₹542.4B"); // ₹54,237 Cr
    expect(formatMarketCap(50 * 1e7)).toBe("₹50.0Cr");
    expect(formatMarketCap(50 * 1e5)).toBe("₹50.0L");
  });

  it("is total for missing or zero values", () => {
    expect(formatMarketCap(0)).toBe("—");
    expect(formatMarketCap(Number.NaN)).toBe("—");
  });
});
