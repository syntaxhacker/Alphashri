/** Shared chart-test candles (test-only module; never import from production). */
import { expect, it } from "vitest";
import {
  CHART_DARK_BG,
  CHART_DARK_BORDER,
  CHART_DARK_MUTED,
  CHART_DARK_SPLIT,
  CHART_DARK_TEXT,
  CHART_LIGHT_BG,
  CHART_LIGHT_BORDER,
  CHART_LIGHT_MUTED,
  CHART_LIGHT_SPLIT,
  CHART_LIGHT_TEXT,
} from "@/config/colors";
import { formatVolume, getCandleChange } from "../chartUtils";

export function makeCandles() {
  return [
    { open: 100, close: 105, high: 110, low: 95 },
    { open: 105, close: 103, high: 108, low: 102 },
  ];
}

/** Mantine-theme shape consumed by getChartThemeColors (dark variant). */
export function makeDarkTheme() {
  return {
    white: CHART_DARK_TEXT,
    colors: {
      dark: { 7: CHART_DARK_BG, 5: CHART_DARK_SPLIT, 4: CHART_DARK_BORDER, 1: CHART_DARK_MUTED },
      gray: { 8: CHART_DARK_TEXT, 6: CHART_DARK_MUTED, 3: CHART_DARK_BORDER, 2: CHART_DARK_SPLIT },
    },
  };
}

/** Mantine-theme shape consumed by getChartThemeColors (light variant). */
export function makeLightTheme() {
  return {
    white: CHART_LIGHT_BG,
    colors: {
      dark: { 7: CHART_LIGHT_BG },
      gray: { 8: CHART_LIGHT_TEXT, 6: CHART_LIGHT_MUTED, 3: CHART_LIGHT_BORDER, 2: CHART_LIGHT_SPLIT },
    },
  };
}

/** Asserts the zero-open guard shared by the getCandleChange zero-open tests. */
export function expectZeroOpenChange(): void {
  expect(getCandleChange(0, 100).change).toBe("0");
}

/** The "formats millions" case is identical in both formatVolume suites. */
export function registerFormatVolumeMillionsTest(): void {
  it("formats millions with M suffix", () => {
    expect(formatVolume(1500000)).toBe("1.5M");
    expect(formatVolume(2000000)).toBe("2.0M");
    expect(formatVolume(1234567)).toBe("1.2M");
  });
}

/** The "formats thousands" case is identical in both formatVolume suites. */
export function registerFormatVolumeThousandsTest(): void {
  it("formats thousands with K suffix", () => {
    expect(formatVolume(1500)).toBe("1.5K");
    expect(formatVolume(1000)).toBe("1.0K");
    expect(formatVolume(99999)).toBe("100.0K");
  });
}
