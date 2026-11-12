// ============================================================
// SINGLE SOURCE OF TRUTH FOR ALL COLORS IN THE APP
// ------------------------------------------------------------
// Style: "tastytrade desk" — deep slate, violet accent, mint/rose P&L.
//   - Body #0B0D10, panels #14171D, raised #1B1F27, hairline #262C36
//   - Text #E8EDF5 (~17:1 on body), muted #8B95A5
//   - Primary/accent: violet #7C5CFC (selection, focus, links, active tab)
//   - Positive #00C98D / negative #FF4D5E — semantic, never hardcoded
//   - Warning #F5A524, info #35B8F0
// Every other color in the app derives from here. Changing a raw anchor
// below re-themes the whole UI; never hardcode a hex outside this file.
// ============================================================

// ----- Raw anchors -----
export const PRIMARY = "#7C5CFC";        // violet accent
export const POSITIVE_COLOR = "#00C98D"; // mint green up
export const NEGATIVE_COLOR = "#FF4D5E"; // rose red down
export const TEXT_COLOR = "#E8EDF5";     // near-white
export const TEXT_MUTED_COLOR = "#8B95A5";
export const BG_COLOR = "#0B0D10";       // body
export const SURFACE_COLOR = "#14171D";  // cards / panels
export const BORDER_COLOR = "#262C36";   // hairline borders

// ----- dark theme scales (high-contrast ramps) -----
export const SCALE_DARK = ["#E8EDF5","#C4CCDA","#8B95A5","#6B7484","#4A5260","#333A46","#262C36","#1B1F27","#14171D","#0B0D10"];
export const SCALE_GRAY = ["#E8EDF5","#C4CCDA","#8B95A5","#6B7484","#4A5260","#333A46","#262C36","#1B1F27","#14171D","#0B0D10"];
export const SCALE_BLUE = ["#F0F7FF","#D9E8FF","#B3D1FF","#80B5FF","#4D99FF","#1F7FFF","#1F6FEB","#1A5CD6","#1449B8","#0F3A94"];
export const SCALE_CYAN = ["#E6FAFF","#B8F0FF","#8AE4FF","#5CD6F5","#2FC4E8","#0FB5D9","#0A9CC4","#0883A8","#066A8A","#04546E"];
export const SCALE_GREEN = ["#E6FFEC","#B7F0C4","#8CE0A4","#5CD182","#3FB950","#2EA043","#238636","#1A7F37","#1A6E32","#0F5323"];
export const SCALE_TEAL = ["#E6FFFB","#B8F3E8","#8AE6D4","#5CD4C0","#2FC0AC","#0FAE99","#0E9A87","#0C8575","#0A7063","#08594F"];
export const SCALE_RED = ["#FFF0F0","#FFD7D5","#FFA8A3","#FF7B72","#FF6259","#F85149","#DA3633","#B6231C","#8E151A","#67060C"];
export const SCALE_ORANGE = ["#FFF1E5","#FFDDB3","#FFC680","#FFA657","#F0883E","#DB6D28","#BD561D","#9E4213","#7D2F12","#5D2207"];
export const SCALE_YELLOW = ["#FFF8C5","#F8E3A1","#F2CC60","#E3B341","#D29922","#BB8009","#A68B1F","#8F6D1F","#785A1F","#62490E"];
export const SCALE_VIOLET = ["#F6F0FF","#E0D3FF","#C8B1FF","#AF8FFF","#9772FF","#8250DF","#6E40C9","#6332B2","#4E2A8F","#3D2370"];
export const SCALE_INDIGO = ["#edf2ff","#dbe4ff","#bac8ff","#91a7ff","#748ffc","#5c7cfa","#4c6ef5","#4263eb","#3b5bdb","#364fc7"];
export const SCALE_PINK = ["#fff0f6","#ffdeeb","#fcc2d7","#faa2c1","#f783ac","#f06595","#e64980","#d6336c","#c2255c","#a61e4d"];
export const SCALE_GRAPE = ["#f8f0fc","#f3d9fa","#eebefa","#e599f7","#da77f2","#cc5de8","#be4bdb","#ae3ec9","#9c36b5","#862e9c"];
export const SCALE_LIME = ["#f4fce3","#e9fac8","#d8f5a2","#c0eb75","#a9e34b","#94d82d","#82c91e","#74b816","#66a80f","#5c940d"];

// ----- Semantic tokens (single place everything imports) -----
export const POSITIVE = POSITIVE_COLOR; // green up
export const NEGATIVE = NEGATIVE_COLOR; // red down
export const NEUTRAL = "#8B95A5";
export const ERROR = NEGATIVE_COLOR;
export const WARNING = "#F5A524";
export const INFO = "#35B8F0";

/** Tabular/mono numeral stack for price, P&L, OI and IV columns. */
export const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

/** Dialog / modal drop shadow — flat design: one soft shadow, no elevation tint. */
export const DIALOG_SHADOW = "0 8px 32px rgba(0, 0, 0, 0.5)";

// Text / surfaces
export const TEXT = TEXT_COLOR;
export const TEXT_MUTED = TEXT_MUTED_COLOR;
export const BG = BG_COLOR;
export const SURFACE = SURFACE_COLOR;
export const SURFACE_ALT = "#1B1F27";
export const BORDER = BORDER_COLOR;
export const SURFACE_TEXT = TEXT_COLOR;

// Muted pattern/chart accent palette (professional desk look, not neon).
export const PATTERN_LINE_COLORS = [
  "#C9A227", // muted gold — selected pattern
  "#5B8DEF", // muted blue
  "#4C9A8F", // muted teal
  "#8C9BAA", // slate
  "#B07A3C", // bronze
  "#6F8FAF", // steel blue
  "#9A8C6A", // khaki
  "#7F8B99", // grey
];
export const PATTERN_BOUNDARY = ["#5B8DEF", "#C9A227"];
export const PATTERN_CONFIRMED = "#4C9A8F";
export const PATTERN_FORMING = "#5B8DEF";
export const PATTERN_FAILED = "#C05A5A";
export const PATTERN_MARGINAL = "#C9A227";

// Trading markers (vivid green/red on dark)
export const MARKER_ENTRY = PRIMARY;
export const MARKER_TP = POSITIVE_COLOR;
export const MARKER_SL = NEGATIVE_COLOR;
export const MARKER_EOD = WARNING;
export const MARKER_BUY = POSITIVE_COLOR;
export const MARKER_SELL = NEGATIVE_COLOR;
export const MARKER_STOP_LOSS = NEGATIVE_COLOR;
export const MARKER_CUSTOM = "#8250DF";
export const MARKER_BORDER = "#FFFFFF";
export const MARKER_MAX_HOLDING = "#F0883E";

export const BULLISH = POSITIVE_COLOR;
export const BEARISH = NEGATIVE_COLOR;

export const EXIT_COLORS: Record<string, string> = {
  TP: POSITIVE_COLOR,
  SL: NEGATIVE_COLOR,
  EOD: "#D29922",
};
export const EXIT_DEFAULT = WARNING;

// Chart overlays / tooltips / axis (dark theme)
export const TOOLTIP_BG = "#171B22";
export const TOOLTIP_BORDER = BORDER_COLOR;
export const TOOLTIP_TEXT = TEXT_COLOR;
export const AXIS_LINE = BORDER_COLOR;
export const AXIS_SPLIT = SURFACE_ALT;
export const CHART_BG = BG_COLOR;
/** Pure-black plot background for the TradingView (lightweight-charts) panels. */
export const CHART_TV_BG = BG_COLOR;
export const CHART_TEXT = TEXT_COLOR;
export const CHART_MUTED = TEXT_MUTED_COLOR;
export const CHART_BORDER = BORDER_COLOR;
export const CHART_SPLIT = SURFACE_ALT;
export const CHART_CROSSHAIR = "#5A6373";
export const CHART_OVERLAY = "rgba(11, 13, 16, 0.95)";
export const CHART_DROPDOWN = "rgba(23, 27, 34, 0.96)";
export const CHART_DATAZOOM_BG = BG_COLOR;
export const DATAZOOM_FILLER = "rgba(0, 201, 141, 0.15)";

// --- Desk / terminal surface for the Nifty analytics panels ----------------
// Deep panel, hairline border, CE-blue / PE-orange legs, mint net-gamma.
export const TERM_BG = BG_COLOR;
export const TERM_BORDER = "#20262F";
export const TERM_HEADER = "#171B22";
export const TERM_CE = "#4F8BFF";
export const TERM_PE = "#FF8A3D";
export const TERM_GAMMA = POSITIVE_COLOR;
export const TERM_GAMMA_NEG = NEGATIVE_COLOR;
export const TERM_SPOT = INFO;
export const TERM_FLIP = WARNING;

// P&L / indicators / OI / pivots
export const PERF_POSITIVE = POSITIVE_COLOR;
export const PERF_NEGATIVE = NEGATIVE_COLOR;
export const BOT_RUNNING = POSITIVE_COLOR;
export const BOT_STOPPED = TEXT_MUTED_COLOR;
export const BOT_SELECTED_BG = "rgba(124, 92, 252, 0.16)";
export const OI_CALL = POSITIVE_COLOR;
export const OI_PUT = NEGATIVE_COLOR;
export const INDICATOR_LINE = PRIMARY;
export const INDICATOR_BLUE_A = "#4D99FF";
export const INDICATOR_BLUE_B = "#1A5CD6";
export const PIVOT_R1 = NEGATIVE_COLOR;
export const PIVOT_PP = "#9772FF";
export const PIVOT_S1 = POSITIVE_COLOR;
export const PIVOT_S2 = "#0FB5D9";
export const PIVOT_CUSTOM = "#8250DF";
export const PIVOT_OR_HIGH = "#4D99FF";
export const PIVOT_OR_LOW = "#0FB5D9";
export const PIVOT_52W_HIGH = "#FF7B72";
export const PIVOT_52W_LOW = "#8250DF";
export const CHART_AVG_ENTRY = "#D29922";
export const CHART_TRADE_EXIT = "#F0883E";

// Sector treemap
export const SECTOR_STRONG_GREEN = "#2E7D5B";
export const SECTOR_GREEN = "#3E8E6A";
export const SECTOR_LIGHT_GREEN = "#345B4A";
export const SECTOR_STRONG_RED = "#B05A53";
export const SECTOR_RED = "#9E4640";
export const SECTOR_LIGHT_RED = "#5E3B39";
export const SECTOR_NEUTRAL = "#2A3140";

// Tinted row backgrounds
export const TINT_POSITIVE = "rgba(0, 201, 141, 0.12)";
export const TINT_NEGATIVE = "rgba(255, 77, 94, 0.12)";
export const TINT_LOSS_ROW = "rgba(255, 77, 94, 0.12)";
export const TINT_TEST_TRADE = "rgba(245, 165, 36, 0.12)";

// Volume / ORB / IV areas
export const VOLUME_BULLISH = "rgba(0, 201, 141, 0.45)";
export const VOLUME_BEARISH = "rgba(255, 77, 94, 0.45)";
export const ORB_AREA = "rgba(124, 92, 252, 0.15)";
export const IV_AREA_START = "rgba(124, 92, 252, 0.30)";
export const IV_AREA_END = "rgba(124, 92, 252, 0)";

// ----- Legacy light/dark aliases (app is DARK theme) -----
export const TOOLTIP_DARK_BG = TOOLTIP_BG;
export const TOOLTIP_LIGHT_BG = "#FFFFFF";
export const TOOLTIP_DARK_BORDER = TOOLTIP_BORDER;
export const TOOLTIP_LIGHT_BORDER = "#D0D7DE";
export const TOOLTIP_DARK_TEXT = TOOLTIP_TEXT;
export const TOOLTIP_LIGHT_TEXT = "#0D1117";
export const AXIS_DARK_LINE = AXIS_LINE;
export const AXIS_LIGHT_LINE = "#D0D7DE";
export const AXIS_DARK_SPLIT = AXIS_SPLIT;
export const AXIS_LIGHT_SPLIT = "#EFF2F5";
export const CHART_DARK_BG = CHART_BG;
export const CHART_LIGHT_BG = "#FFFFFF";
export const CHART_DARK_OVERLAY = CHART_OVERLAY;
export const CHART_LIGHT_OVERLAY = "rgba(255, 255, 255, 0.95)";
export const CHART_DARK_DROPDOWN = CHART_DROPDOWN;
export const CHART_LIGHT_DROPDOWN = "rgba(255, 255, 255, 0.9)";
export const CHART_DARK_TEXT = CHART_TEXT;
export const CHART_LIGHT_TEXT = "#0D1117";
export const CHART_DARK_MUTED = CHART_MUTED;
export const CHART_LIGHT_MUTED = "#57606A";
export const CHART_DARK_BORDER = CHART_BORDER;
export const CHART_LIGHT_BORDER = "#D0D7DE";
export const CHART_DARK_SPLIT = CHART_SPLIT;
export const CHART_LIGHT_SPLIT = "#EFF2F5";
export const ERROR_COLOR = ERROR;
export const CHART_DARK_DATAZOOM_BG = CHART_DATAZOOM_BG;
export const CHART_LIGHT_DATAZOOM_BG = "#FFFFFF";

// ----- NinjaTrader high-contrast SMC POC tokens -----
export const NT_BG = "#0E0E0E";
export const NT_GRID = "#2A2A2A";
export const NT_CANDLE_BULL = "#00FF88";
export const NT_CANDLE_BEAR = "#FF3B30";

// ----- Layout tokens -----
export const FIN_HEADER_H = 48;   // header height
export const FIN_OUTER_PAD = 16;  // horizontal padding
export const NT_FVG_BULL_FILL = "rgba(0,255,136,0.18)";
export const NT_FVG_BULL_STROKE = "rgba(0,255,136,0.9)";
export const NT_FVG_BEAR_FILL = "rgba(255,59,48,0.18)";
export const NT_FVG_BEAR_STROKE = "rgba(255,59,48,0.9)";
export const NT_IFVG_FILL = "rgba(255,215,0,0.22)";
export const NT_IFVG_STROKE = "#FFD700";
export const NT_HLINE = "#38BDF8";
export const NT_TREND = "#A78BFA";

// ----- Backward-compat aliases -----
export const BLACK = "#010409";
export const BROWN = "#30363D";
export const BROWN_DARK = "#0D1117";
export const CREAM = "#F0F6FC";
export const TRADING_GREEN = POSITIVE_COLOR;
export const TRADING_RED = NEGATIVE_COLOR;
