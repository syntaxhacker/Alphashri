import { describe, expect, it } from "vitest";
import { chartCurrency, chartPriceLocale, formatChartPrice } from "./chartFormat";

describe("chartCurrency", () => {
  it("maps USA to USD and everything else to INR", () => {
    expect(chartCurrency("usa")).toBe("USD");
    expect(chartCurrency("india")).toBe("INR");
    expect(chartCurrency()).toBe("INR");
  });
});

describe("formatChartPrice", () => {
  it("renders a US price with $ and en-US grouping, never ₹", () => {
    const price = formatChartPrice(352.25, "usa");
    expect(price).toBe("$352.25");
    expect(price).not.toContain("₹");
  });

  it("renders a large US price with en-US grouping", () => {
    expect(formatChartPrice(1234567.5, "usa")).toBe("$1,234,567.50");
  });

  it("keeps the India price byte-identical (₹, ungrouped)", () => {
    expect(formatChartPrice(352.25, "india")).toBe("₹352.25");
    expect(formatChartPrice(352.25)).toBe("₹352.25");
    expect(formatChartPrice(1234567.5)).toBe("₹1234567.50");
  });

  it("renders missing prices as an em dash in either market", () => {
    expect(formatChartPrice(null, "usa")).toBe("—");
    expect(formatChartPrice(undefined)).toBe("—");
  });
});

describe("chartPriceLocale", () => {
  it("uses the currency registry's grouping for the axis/crosshair", () => {
    expect(chartPriceLocale("usa")).toBe("en-US");
    expect(chartPriceLocale("india")).toBe("en-IN");
    expect(chartPriceLocale()).toBe("en-IN");
  });
});
