// ============================================================
// SINGLE SOURCE OF TRUTH — FINANCIAL THEME (MUI) + LEGACY DARK
// Financial = simple, intuitive, data-first (light default #F8FAFC)
// Legacy dark aliases kept for incremental Mantine → MUI migration.
// FIN_* are single source for muiTheme.ts — never duplicate hex there.
// ============================================================

// ----- Financial theme tokens (MUI) — 8pt grid, data-first -----
export const FIN_BG_LIGHT = "#F8FAFC";
export const FIN_BG_DARK = "#0B1220";
export const FIN_PAPER_LIGHT = "#FFFFFF";
export const FIN_PAPER_DARK = "#131C2E";
export const FIN_TEXT_LIGHT = "#0F172A";
export const FIN_TEXT_DARK = "#F1F5F9";
export const FIN_TEXT_MUTED_LIGHT = "#64748B";
export const FIN_TEXT_MUTED_DARK = "#94A3B8";
export const FIN_BORDER_LIGHT = "#E2E8F0";
export const FIN_BORDER_DARK = "#1E293B";
export const FIN_PRIMARY = "#2563EB";
export const FIN_POSITIVE = "#16A34A";
export const FIN_NEGATIVE = "#DC2626";
export const FIN_WARNING = "#D97706";
export const FIN_INFO = "#0891B2";
// layout tokens — single source for alignments (8pt grid)
export const FIN_RADIUS_SM = 4;
export const FIN_RADIUS = 8;
export const FIN_RADIUS_LG = 12;
export const FIN_HEADER_H = 48;
export const FIN_NAV_W = 200;
export const FIN_NAV_W_COLLAPSED = 64;
export const FIN_OUTER_PAD = 16;
export const FIN_INNER_PAD = 8;
export const FIN_TABLE_CELL_PY = 8;
export const FIN_TABLE_CELL_PX = 12;

// ============================================================
// SINGLE SOURCE OF TRUTH FOR ALL COLORS IN THE APP (LEGACY DARK)
// ------------------------------------------------------------
// Style: HIGH-CONTRAST DARK theme (GitHub Dark inspired)
//   - Near-black navy surfaces (#0D1117 / #161B22) — not pitch black
//   - Near-white text (#F0F6FC) — ~15:1 contrast on body
//   - Bright blue accent (#58A6FF)
//   - Vivid green (#3FB950) up / red (#F85149) down for trading
// Every other color in the app derives from here.
// ============================================================

// ----- Raw anchors -----
export const PRIMARY = "#58A6FF";        // bright blue accent
export const POSITIVE_COLOR = "#3FB950"; // vivid green up
export const NEGATIVE_COLOR = "#F85149"; // vivid red down
export const TEXT_COLOR = "#F0F6FC";     // near-white
export const TEXT_MUTED_COLOR = "#8B949E";
export const BG_COLOR = "#0D1117";       // body (near-black navy)
export const SURFACE_COLOR = "#161B22";  // cards
export const BORDER_COLOR = "#30363D";   // visible borders

// ----- Mantine scales (high-contrast dark ramps) -----
export const SCALE_DARK = ["#F0F6FC","#C9D1D9","#8B949E","#6E7681","#484F58","#30363D","#21262D","#0D1117","#0A0E14","#010409"];
export const SCALE_GRAY = ["#F0F6FC","#C9D1D9","#8B949E","#6E7681","#484F58","#30363D","#21262D","#161B22","#0D1117","#010409"];
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
export const NEUTRAL = "#8B949E";
export const ERROR = NEGATIVE_COLOR;
export const WARNING = "#F0883E";
export const INFO = PRIMARY;

// Text / surfaces
export const TEXT = TEXT_COLOR;
export const TEXT_MUTED = TEXT_MUTED_COLOR;
export const BG = BG_COLOR;
export const SURFACE = SURFACE_COLOR;
export const SURFACE_ALT = "#21262D";
export const BORDER = BORDER_COLOR;
export const SURFACE_TEXT = TEXT_COLOR;

// Trading markers (vivid green/red on dark)
export const MARKER_ENTRY = PRIMARY;
export const MARKER_TP = POSITIVE_COLOR;
export const MARKER_SL = NEGATIVE_COLOR;
export const MARKER_EOD = "#D29922";
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
export const EXIT_DEFAULT = "#D29922";

// Chart overlays / tooltips / axis (dark theme)
export const TOOLTIP_BG = "#161B22";
export const TOOLTIP_BORDER = "#30363D";
export const TOOLTIP_TEXT = "#F0F6FC";
export const AXIS_LINE = "#30363D";
export const AXIS_SPLIT = "#21262D";
export const CHART_BG = "#0D1117";
export const CHART_TEXT = "#F0F6FC";
export const CHART_MUTED = "#8B949E";
export const CHART_BORDER = "#30363D";
export const CHART_SPLIT = "#21262D";
export const CHART_CROSSHAIR = "#8B949E";
export const CHART_OVERLAY = "rgba(13, 17, 23, 0.95)";
export const CHART_DROPDOWN = "rgba(13, 17, 23, 0.92)";
export const CHART_DATAZOOM_BG = "#0D1117";
export const DATAZOOM_FILLER = "rgba(63, 185, 80, 0.15)";

// P&L / indicators / OI / pivots
export const PERF_POSITIVE = POSITIVE_COLOR;
export const PERF_NEGATIVE = NEGATIVE_COLOR;
export const BOT_RUNNING = POSITIVE_COLOR;
export const BOT_STOPPED = "#8B949E";
export const BOT_SELECTED_BG = "rgba(88, 166, 255, 0.15)";
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
export const SECTOR_STRONG_GREEN = "#1A7F37";
export const SECTOR_GREEN = "#3FB950";
export const SECTOR_LIGHT_GREEN = "#8CE0A4";
export const SECTOR_STRONG_RED = "#B6231C";
export const SECTOR_RED = "#F85149";
export const SECTOR_LIGHT_RED = "#FFA8A3";
export const SECTOR_NEUTRAL = "#484F58";

// Tinted row backgrounds
export const TINT_POSITIVE = "rgba(63, 185, 80, 0.12)";
export const TINT_NEGATIVE = "rgba(248, 81, 73, 0.12)";
export const TINT_LOSS_ROW = "rgba(248, 81, 73, 0.12)";
export const TINT_TEST_TRADE = "rgba(210, 153, 34, 0.12)";

// Volume / ORB / IV areas
export const VOLUME_BULLISH = "rgba(63, 185, 80, 0.45)";
export const VOLUME_BEARISH = "rgba(248, 81, 73, 0.45)";
export const ORB_AREA = "rgba(77, 153, 255, 0.15)";
export const IV_AREA_START = "rgba(88, 166, 255, 0.3)";
export const IV_AREA_END = "rgba(88, 166, 255, 0)";

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

// ----- Backward-compat aliases -----
export const BLACK = "#010409";
export const BROWN = "#30363D";
export const BROWN_DARK = "#0D1117";
export const CREAM = "#F0F6FC";
export const TRADING_GREEN = POSITIVE_COLOR;
export const TRADING_RED = NEGATIVE_COLOR;
