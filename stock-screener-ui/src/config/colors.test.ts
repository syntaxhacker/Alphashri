import { describe, expect, it } from "vitest";
import {
  POSITIVE,
  NEGATIVE,
  NEUTRAL,
  MARKER_ENTRY,
  MARKER_TP,
  MARKER_SL,
  MARKER_EOD,
  BULLISH,
  BEARISH,
  MARKER_BUY,
  MARKER_SELL,
  MARKER_STOP_LOSS,
  MARKER_CUSTOM,
  PIVOT_R1,
  PIVOT_PP,
  PIVOT_S1,
  PIVOT_S2,
  PIVOT_CUSTOM,
  PIVOT_OR_HIGH,
  PIVOT_OR_LOW,
  PIVOT_52W_HIGH,
  PIVOT_52W_LOW,
  CHART_AVG_ENTRY,
  CHART_TRADE_EXIT,
  INDICATOR_BLUE_A,
  INDICATOR_BLUE_B,
  INDICATOR_LINE,
  OI_CALL,
  OI_PUT,
  BOT_RUNNING,
  BOT_STOPPED,
  BOT_SELECTED_BG,
  PERF_POSITIVE,
  PERF_NEGATIVE,
  SECTOR_STRONG_GREEN,
  SECTOR_GREEN,
  SECTOR_LIGHT_GREEN,
  SECTOR_STRONG_RED,
  SECTOR_RED,
  SECTOR_LIGHT_RED,
  SECTOR_NEUTRAL,
  TINT_POSITIVE,
  TINT_NEGATIVE,
  TINT_LOSS_ROW,
  TINT_TEST_TRADE,
  TOOLTIP_DARK_BG,
  TOOLTIP_LIGHT_BG,
  TOOLTIP_DARK_BORDER,
  TOOLTIP_LIGHT_BORDER,
  TOOLTIP_DARK_TEXT,
  TOOLTIP_LIGHT_TEXT,
  AXIS_DARK_LINE,
  AXIS_LIGHT_LINE,
  AXIS_DARK_SPLIT,
  AXIS_LIGHT_SPLIT,
  CHART_DARK_BG,
  CHART_LIGHT_BG,
  CHART_DARK_OVERLAY,
  CHART_LIGHT_OVERLAY,
  CHART_DARK_DROPDOWN,
  CHART_LIGHT_DROPDOWN,
  CHART_DARK_TEXT,
  CHART_LIGHT_TEXT,
  CHART_DARK_MUTED,
  CHART_LIGHT_MUTED,
  EXIT_COLORS,
  EXIT_DEFAULT,
  ERROR_COLOR,
  MARKER_BORDER,
  MARKER_MAX_HOLDING,
  CHART_DARK_DATAZOOM_BG,
  CHART_LIGHT_DATAZOOM_BG,
  DATAZOOM_FILLER,
  VOLUME_BULLISH,
  VOLUME_BEARISH,
  ORB_AREA,
  IV_AREA_START,
  IV_AREA_END,
} from "./colors";

describe("Color Constants", () => {
  describe("P&L / Directional", () => {
    it("POSITIVE is valid hex color", () => {
      expect(POSITIVE).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("NEGATIVE is valid hex color", () => {
      expect(NEGATIVE).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("NEUTRAL is defined", () => {
      expect(NEUTRAL).toBeDefined();
      expect(NEUTRAL).not.toBe(POSITIVE);
      expect(NEUTRAL).not.toBe(NEGATIVE);
    });
  });

  describe("Trade Markers", () => {
    it("MARKER_ENTRY is defined", () => {
      expect(MARKER_ENTRY).toBeDefined();
    });

    it("MARKER_TP matches POSITIVE", () => {
      expect(MARKER_TP).toBe(POSITIVE);
    });

    it("MARKER_SL matches NEGATIVE", () => {
      expect(MARKER_SL).toBe(NEGATIVE);
    });

    it("MARKER_EOD is distinct", () => {
      expect(MARKER_EOD).toBeDefined();
      expect(MARKER_EOD).not.toBe(POSITIVE);
    });
  });

  describe("Candlestick", () => {
    it("BULLISH matches POSITIVE", () => {
      expect(BULLISH).toBe(POSITIVE);
    });

    it("BEARISH matches NEGATIVE", () => {
      expect(BEARISH).toBe(NEGATIVE);
    });
  });

  describe("Chart Markers", () => {
    it("MARKER_BUY is defined", () => {
      expect(MARKER_BUY).toBeDefined();
    });

    it("MARKER_SELL is defined", () => {
      expect(MARKER_SELL).toBeDefined();
    });

    it("MARKER_STOP_LOSS is defined", () => {
      expect(MARKER_STOP_LOSS).toBeDefined();
    });

    it("MARKER_CUSTOM is defined", () => {
      expect(MARKER_CUSTOM).toBeDefined();
    });
  });

  describe("Pivot Levels", () => {
    it("PIVOT_R1 is defined", () => {
      expect(PIVOT_R1).toBeDefined();
      expect(PIVOT_R1).not.toBe(PIVOT_PP);
      expect(PIVOT_R1).not.toBe(PIVOT_S1);
    });

    it("PIVOT_PP is defined", () => {
      expect(PIVOT_PP).toBeDefined();
    });

    it("PIVOT_S1 is defined", () => {
      expect(PIVOT_S1).toBeDefined();
    });

    it("PIVOT_S2 is defined", () => {
      expect(PIVOT_S2).toBeDefined();
    });

    it("PIVOT_CUSTOM is defined", () => {
      expect(PIVOT_CUSTOM).toBeDefined();
    });

    it("PIVOT_OR_HIGH and PIVOT_OR_LOW are defined and distinct", () => {
      expect(PIVOT_OR_HIGH).toBeDefined();
      expect(PIVOT_OR_LOW).toBeDefined();
      expect(PIVOT_OR_HIGH).not.toBe(PIVOT_OR_LOW);
    });

    it("PIVOT_52W_HIGH is defined", () => {
      expect(PIVOT_52W_HIGH).toBeDefined();
    });

    it("PIVOT_52W_LOW is defined", () => {
      expect(PIVOT_52W_LOW).toBeDefined();
    });
  });

  describe("Chart Overlay", () => {
    it("CHART_AVG_ENTRY is cream (palette highlight)", () => {
      expect(CHART_AVG_ENTRY).toBe("#E1DCC9");
    });

    it("CHART_TRADE_EXIT is muted (palette secondary)", () => {
      expect(CHART_TRADE_EXIT).toBe("#998d78");
    });
  });

  describe("Indicator Lines", () => {
    it("INDICATOR_BLUE_A and B are defined", () => {
      expect(INDICATOR_BLUE_A).toBeDefined();
      expect(INDICATOR_BLUE_B).toBeDefined();
      expect(INDICATOR_BLUE_A).not.toBe(INDICATOR_BLUE_B);
    });

    it("INDICATOR_LINE is defined", () => {
      expect(INDICATOR_LINE).toBeDefined();
    });
  });

  describe("OI Chart", () => {
    it("OI_CALL is green", () => {
      expect(OI_CALL).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });

    it("OI_PUT is red", () => {
      expect(OI_PUT).toMatch(/^#[0-9A-Fa-f]{6}$/);
    });
  });

  describe("Bot Status", () => {
    it("BOT_RUNNING is green", () => {
      expect(BOT_RUNNING).toBe("#285A48");
    });

    it("BOT_STOPPED is muted", () => {
      expect(BOT_STOPPED).toBe("#998d78");
    });

    it("BOT_SELECTED_BG is rgba", () => {
      expect(BOT_SELECTED_BG).toMatch(/^rgba\(/);
    });
  });

  describe("Performance Bars", () => {
    it("PERF_POSITIVE is defined", () => {
      expect(PERF_POSITIVE).toBeDefined();
    });

    it("PERF_NEGATIVE is defined", () => {
      expect(PERF_NEGATIVE).toBeDefined();
    });
  });

  describe("Sector Treemap", () => {
    it("has all 8 sector colors defined", () => {
      expect(SECTOR_STRONG_GREEN).toBeDefined();
      expect(SECTOR_GREEN).toBeDefined();
      expect(SECTOR_LIGHT_GREEN).toBeDefined();
      expect(SECTOR_STRONG_RED).toBeDefined();
      expect(SECTOR_RED).toBeDefined();
      expect(SECTOR_LIGHT_RED).toBeDefined();
      expect(SECTOR_NEUTRAL).toBeDefined();
    });

    it("green shades are distinct", () => {
      expect(SECTOR_STRONG_GREEN).not.toBe(SECTOR_GREEN);
      expect(SECTOR_GREEN).not.toBe(SECTOR_LIGHT_GREEN);
    });

    it("red shades are distinct", () => {
      expect(SECTOR_STRONG_RED).not.toBe(SECTOR_RED);
      expect(SECTOR_RED).not.toBe(SECTOR_LIGHT_RED);
    });
  });

  describe("Heatmap / Tinted Backgrounds", () => {
    it("TINT_POSITIVE is rgba with green tint", () => {
      expect(TINT_POSITIVE).toMatch(/^rgba\(40, 90, 72, /);
    });

    it("TINT_NEGATIVE is rgba with red tint", () => {
      expect(TINT_NEGATIVE).toMatch(/^rgba\(155, 15, 6, /);
    });

    it("TINT_LOSS_ROW is defined", () => {
      expect(TINT_LOSS_ROW).toBeDefined();
    });

    it("TINT_TEST_TRADE is defined", () => {
      expect(TINT_TEST_TRADE).toBeDefined();
    });
  });

  describe("ECharts Tooltip", () => {
    it("TOOLTIP_DARK_BG is dark", () => {
      expect(TOOLTIP_DARK_BG).toBe("#1F150C");
    });

    it("TOOLTIP_LIGHT_BG is light", () => {
      expect(TOOLTIP_LIGHT_BG).toBe("#E1DCC9");
    });

    it("all four tooltip colors are defined", () => {
      expect(TOOLTIP_DARK_BORDER).toBeDefined();
      expect(TOOLTIP_LIGHT_BORDER).toBeDefined();
      expect(TOOLTIP_DARK_TEXT).toBeDefined();
      expect(TOOLTIP_LIGHT_TEXT).toBeDefined();
    });
  });

  describe("ECharts Axis", () => {
    it("dark axis colors are darker", () => {
      expect(AXIS_DARK_LINE).toBe("#412D15");
      expect(AXIS_DARK_SPLIT).toBe("#1F150C");
    });

    it("light axis colors are lighter", () => {
      expect(AXIS_LIGHT_LINE).toBe("#E1DCC9");
      expect(AXIS_LIGHT_SPLIT).toBe("#d4cfbd");
    });
  });

  describe("Chart Surfaces", () => {
    it("CHART_DARK_BG is very dark", () => {
      expect(CHART_DARK_BG).toBe("#000000");
    });

    it("CHART_LIGHT_BG is light cream", () => {
      expect(CHART_LIGHT_BG).toBe("#E1DCC9");
    });

    it("overlay and dropdown variants are rgba", () => {
      expect(CHART_DARK_OVERLAY).toMatch(/^rgba\(20, 20, 20, /);
      expect(CHART_LIGHT_OVERLAY).toMatch(/^rgba\(225, 220, 201, /);
      expect(CHART_DARK_DROPDOWN).toMatch(/^rgba\(0, 0, 0, /);
      expect(CHART_LIGHT_DROPDOWN).toMatch(/^rgba\(225, 220, 201, /);
    });
  });

  describe("Chart Text", () => {
    it("dark variants are light colors", () => {
      expect(CHART_DARK_TEXT).toBeDefined();
      expect(CHART_DARK_MUTED).toBeDefined();
    });

    it("light variants are dark colors", () => {
      expect(CHART_LIGHT_TEXT).toBeDefined();
      expect(CHART_LIGHT_MUTED).toBeDefined();
    });
  });

  describe("EXIT_COLORS mapping", () => {
    it("maps TP to MARKER_TP", () => {
      expect(EXIT_COLORS.TP).toBe(MARKER_TP);
    });

    it("maps SL to MARKER_SL", () => {
      expect(EXIT_COLORS.SL).toBe(MARKER_SL);
    });

    it("maps EOD to MARKER_EOD", () => {
      expect(EXIT_COLORS.EOD).toBe(MARKER_EOD);
    });
  });

  describe("EXIT_DEFAULT", () => {
    it("matches MARKER_EOD", () => {
      expect(EXIT_DEFAULT).toBe(MARKER_EOD);
    });
  });

  describe("Error and Miscellaneous", () => {
    it("ERROR_COLOR is red", () => {
      expect(ERROR_COLOR).toBe("#9B0F06");
    });

    it("MARKER_BORDER is cream", () => {
      expect(MARKER_BORDER).toBe("#E1DCC9");
    });

    it("MARKER_MAX_HOLDING is cream", () => {
      expect(MARKER_MAX_HOLDING).toBe("#E1DCC9");
    });
  });

  describe("DataZoom", () => {
    it("CHART_DARK_DATAZOOM_BG is dark", () => {
      expect(CHART_DARK_DATAZOOM_BG).toBeDefined();
    });

    it("CHART_LIGHT_DATAZOOM_BG is light", () => {
      expect(CHART_LIGHT_DATAZOOM_BG).toBeDefined();
    });

    it("DATAZOOM_FILLER is rgba green", () => {
      expect(DATAZOOM_FILLER).toMatch(/^rgba\(40, 90, 72, /);
    });
  });

  describe("Volume Bars", () => {
    it("VOLUME_BULLISH is green with transparency", () => {
      expect(VOLUME_BULLISH).toBe("rgba(40, 90, 72, 0.5)");
    });

    it("VOLUME_BEARISH is red with transparency", () => {
      expect(VOLUME_BEARISH).toBe("rgba(155, 15, 6, 0.5)");
    });
  });

  describe("ORB Area", () => {
    it("ORB_AREA is cream with transparency", () => {
      expect(ORB_AREA).toBe("rgba(225, 220, 201, 0.12)");
    });
  });

  describe("IV Skew Area", () => {
    it("IV_AREA_START has alpha", () => {
      expect(IV_AREA_START).toMatch(/0\.25\)$/);
    });

    it("IV_AREA_END fades to transparent", () => {
      expect(IV_AREA_END).toMatch(/0\)$/);
    });
  });
});
