// ============================================
// Semantic Colors (Single Source of Truth)
// ============================================

// ----- P&L / Directional -----
export const POSITIVE = "#00E676";
export const NEGATIVE = "#FF1744";
export const NEUTRAL = "#FFEA00";

// ----- Trade Markers -----
export const MARKER_ENTRY = "#00BFFF";
export const MARKER_TP = "#00E676";
export const MARKER_SL = "#FF1744";
export const MARKER_EOD = "#FFEA00";

// ----- Candlestick -----
export const BULLISH = "#00E676";
export const BEARISH = "#FF1744";

// ----- Chart Markers (Buy/Sell/SL/Custom) -----
export const MARKER_BUY = "#00FFFF";
export const MARKER_SELL = "#FFFF00";
export const MARKER_STOP_LOSS = "#FF00FF";
export const MARKER_CUSTOM = "#FFA500";

// ----- Pivot Levels -----
export const PIVOT_R1 = "#EF5350";
export const PIVOT_PP = "#AB47BC";
export const PIVOT_S1 = "#26A69A";
export const PIVOT_S2 = "#00BCD4";
export const PIVOT_CUSTOM = "#9C27B0";
export const PIVOT_OR_HIGH = "#2196F3";
export const PIVOT_OR_LOW = "#2196F3";
export const PIVOT_52W_HIGH = "#E91E63";
export const PIVOT_52W_LOW = "#9C27B0";

// ----- Chart Overlay -----
export const CHART_AVG_ENTRY = "#FFD700";
export const CHART_TRADE_EXIT = "#FF6B00";

// ----- Indicator Lines -----
export const INDICATOR_BLUE_A = "#42A5F5";
export const INDICATOR_BLUE_B = "#1E88E5";
export const INDICATOR_LINE = "#228be6";

// ----- OI Chart -----
export const OI_CALL = "#40c057";
export const OI_PUT = "#fa5252";

// ----- Bot Status -----
export const BOT_RUNNING = "#51cf66";
export const BOT_STOPPED = "#868e96";
export const BOT_SELECTED_BG = "rgba(34, 139, 230, 0.1)";

// ----- Performance Bars (CSS) -----
export const PERF_POSITIVE = "#00ff9d";
export const PERF_NEGATIVE = "#ff6b6b";

// ----- Sector Treemap -----
export const SECTOR_STRONG_GREEN = "#166534";
export const SECTOR_GREEN = "#1f7a4a";
export const SECTOR_LIGHT_GREEN = "#2b5f46";
export const SECTOR_STRONG_RED = "#7f1d1d";
export const SECTOR_RED = "#991b1b";
export const SECTOR_LIGHT_RED = "#7a2e2e";
export const SECTOR_NEUTRAL = "#2a3441";

// ----- Heatmap / Tinted Backgrounds -----
export const TINT_POSITIVE = "rgba(64, 192, 87, 0.05)";
export const TINT_NEGATIVE = "rgba(250, 82, 82, 0.05)";
export const TINT_LOSS_ROW = "rgba(255, 0, 0, 0.05)";
export const TINT_TEST_TRADE = "rgba(255, 193, 7, 0.1)";

// ----- ECharts Tooltip (dark/light) -----
export const TOOLTIP_DARK_BG = "#25262b";
export const TOOLTIP_LIGHT_BG = "#fff";
export const TOOLTIP_DARK_BORDER = "#373a40";
export const TOOLTIP_LIGHT_BORDER = "#dee2e6";
export const TOOLTIP_DARK_TEXT = "#c1c2c5";
export const TOOLTIP_LIGHT_TEXT = "#1f2937";

// ----- ECharts Axis -----
export const AXIS_DARK_LINE = "#373a40";
export const AXIS_LIGHT_LINE = "#dee2e6";
export const AXIS_DARK_SPLIT = "#1a1b1e";
export const AXIS_LIGHT_SPLIT = "#f1f3f5";

// ----- Chart Surfaces -----
export const CHART_DARK_BG = "#0a0a0a";
export const CHART_LIGHT_BG = "#ffffff";
export const CHART_DARK_OVERLAY = "rgba(20,20,20,0.95)";
export const CHART_LIGHT_OVERLAY = "rgba(255,255,255,0.95)";
export const CHART_DARK_DROPDOWN = "rgba(0,0,0,0.7)";
export const CHART_LIGHT_DROPDOWN = "rgba(255,255,255,0.7)";

// ----- Chart Text -----
export const CHART_DARK_TEXT = "#e0e0e0";
export const CHART_LIGHT_TEXT = "#333333";
export const CHART_DARK_MUTED = "#888";
export const CHART_LIGHT_MUTED = "#666666";
export const CHART_DARK_BORDER = "#333";
export const CHART_LIGHT_BORDER = "#e0e0e0";
export const CHART_DARK_SPLIT = "#222";
export const CHART_LIGHT_SPLIT = "#eeeeee";
export const CHART_CROSSHAIR = "#666";

// ----- Info Text on Surfaces -----
export const SURFACE_TEXT = "#f8fafc";

// ----- Exit Reason Colors -----
export const EXIT_COLORS: Record<string, string> = {
  TP: MARKER_TP,
  SL: MARKER_SL,
  EOD: MARKER_EOD,
};
export const EXIT_DEFAULT = MARKER_EOD;

// ----- Loss/Error Color -----
export const ERROR_COLOR = "#FF1744";
