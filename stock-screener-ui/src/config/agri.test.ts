import { describe, expect, it } from "vitest";
import {
  AGRICULTURE_UNIT,
  AGRI_CHART_MODES,
  AGRI_CHART_MODE_KEYS,
  AGRI_DEFAULT_CHART_MODE,
  AGRI_COMMODITIES,
  AGRI_COMMODITY_UNIT,
  AGRI_GROUPS,
  AGRI_RANGE_PRESETS,
  agriCommodity,
  agriCommodityLabel,
  agriGroup,
  agriGroupLabel,
  formatAgriPrice,
  formatArrivals,
  formatChangePct,
} from "./agri";

describe("agri registry", () => {
  it("uses a single unique key per commodity and per group", () => {
    const keys = AGRI_COMMODITIES.map((item) => item.key);
    expect(new Set(keys).size).toBe(keys.length);
    const groupKeys = AGRI_GROUPS.map((group) => group.key);
    expect(new Set(groupKeys).size).toBe(groupKeys.length);
    expect(new Set(AGRI_GROUPS.map((group) => group.order)).size).toBe(AGRI_GROUPS.length);
  });

  it("puts every commodity in a declared group with the shared unit", () => {
    const groupKeys = new Set(AGRI_GROUPS.map((group) => group.key));
    for (const item of AGRI_COMMODITIES) {
      expect(groupKeys.has(item.group)).toBe(true);
      expect(item.unit).toBe(AGRI_COMMODITY_UNIT);
      expect(typeof item.hasMsp).toBe("boolean");
    }
    expect(AGRICULTURE_UNIT).toBe("₹/quintal");
  });

  it("keeps range ids stable", () => {
    expect(AGRI_RANGE_PRESETS.map((preset) => preset.key)).toEqual(["1m", "3m", "6m", "1y", "max"]);
    const rangeKeys = AGRI_RANGE_PRESETS.map((preset) => preset.key);
    expect(new Set(rangeKeys).size).toBe(rangeKeys.length);
    for (const preset of AGRI_RANGE_PRESETS) {
      expect(preset.label).toBeTruthy();
      expect(preset.description).toBeTruthy();
    }
    expect(AGRI_RANGE_PRESETS.find((preset) => preset.key === "max")?.days).toBeNull();
  });

  it("registers exactly the seven EDA chart modes with unique ids", () => {
    const keys = AGRI_CHART_MODES.map((mode) => mode.key);
    expect(keys).toEqual([
      "band",
      "compare",
      "distribution",
      "supplyDemand",
      "heatmap",
      "rolling",
      "seasonality",
    ]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain("ohlc");
    expect(keys).not.toContain("arrivals");
    expect(AGRI_CHART_MODE_KEYS).toEqual(keys);
    expect(AGRI_DEFAULT_CHART_MODE).toBe("band");
    for (const mode of AGRI_CHART_MODES) {
      expect(mode.label).toBeTruthy();
      expect(mode.description).toBeTruthy();
    }
  });

  it("resolves descriptors with safe fallbacks", () => {
    expect(agriGroup("pulses")?.label).toBe("Pulses");
    expect(agriGroup("unknown")).toBeUndefined();
    expect(agriGroupLabel(null)).toBe("Other");
    expect(agriCommodity("rice")?.hasMsp).toBe(true);
    expect(agriCommodity("onion")?.hasMsp).toBe(false);
    expect(agriCommodityLabel("unknown")).toBe("—");
  });
});

describe("agri formatters", () => {
  const missing = [null, undefined, Number.NaN];

  it("renders missing prices as a dash", () => {
    for (const value of missing) expect(formatAgriPrice(value)).toBe("—");
  });

  it("renders missing arrivals as a dash", () => {
    for (const value of missing) expect(formatArrivals(value)).toBe("—");
  });

  it("renders missing changes as a dash", () => {
    for (const value of missing) expect(formatChangePct(value)).toBe("—");
  });

  it("formats Indian-grouped rupees", () => {
    expect(formatAgriPrice(2450)).toBe("₹2,450");
    expect(formatAgriPrice(2450.5)).toBe("₹2,450.5");
  });

  it("compacts arrivals with the lakh ladder", () => {
    expect(formatArrivals(250000)).toBe("2.5L qtl");
    expect(formatArrivals(1200)).toBe("1.2K qtl");
  });

  it("signs percentage changes", () => {
    expect(formatChangePct(2.34)).toBe("+2.3%");
    expect(formatChangePct(-1.28)).toBe("-1.3%");
    expect(formatChangePct(0)).toBe("0.0%");
  });
});
