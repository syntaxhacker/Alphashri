// ============================================================
// SINGLE SOURCE OF TRUTH FOR ALL COLORS IN THE APP
// ------------------------------------------------------------
// Style: "Bloomberg terminal" — pure black canvas, amber chrome, mono data.
//   - Body #000000, panels #0A0A0A, bars #141414, hairline #2B2B2B
//   - Text #E8E8E8, muted #9B9B9B, dividers #6E6E6E
//   - Primary/CTA: amber #D9902A (panel headers, active tabs, selection, keys)
//   - Links/info: blue #4A8FD8
//   - Bullish #2FA36B / bearish #D94A55 — tickers and deltas only
// Every other color in the app derives from here. Changing a raw anchor
// below re-themes the whole UI; never hardcode a hex outside this file.
// ============================================================

// ----- Raw anchors -----
export const PRIMARY = "#D9902A";        // amber chrome
export const POSITIVE_COLOR = "#2FA36B"; // bullish green
export const NEGATIVE_COLOR = "#D94A55"; // bearish red
export const TEXT_COLOR = "#E8E8E8";     // off-white
export const TEXT_MUTED_COLOR = "#9B9B9B";
export const BG_COLOR = "#000000";       // body
export const SURFACE_COLOR = "#0A0A0A";  // cards / panels
export const BORDER_COLOR = "#2B2B2B";   // hairline borders

// ----- dark theme scales (high-contrast ramps) -----
export const SCALE_DARK = ["#E8E8E8","#C4C4C4","#9B9B9B","#6E6E6E","#525252","#3A3A3A","#2B2B2B","#1F1F1F","#141414","#000000"];
export const SCALE_GRAY = ["#E8E8E8","#C4C4C4","#9B9B9B","#6E6E6E","#525252","#3A3A3A","#2B2B2B","#1F1F1F","#141414","#000000"];
export const SCALE_BLUE = ["#E6EDF5","#C6D4E4","#A6BBD3","#86A0C1","#4A7FC1","#3F6CA6","#35598A","#2B466E","#213452","#172337"];
export const SCALE_CYAN = ["#E2EEF1","#B9D6DD","#90BEC9","#6AA6B4","#3B93AD","#337D92","#2B6777","#24525E","#1D3E47","#162B31"];
export const SCALE_GREEN = ["#E4F3EA","#B9DCC7","#8CC4A4","#5EAA82","#2FA36B","#278A5B","#21744D","#1C6142","#184F36","#123D29"];
export const SCALE_TEAL = ["#E4F2EF","#B7DCD5","#8CC4BA","#5FA89D","#3B93AD","#337D88","#2B6771","#24525A","#1D3E45","#162B30"];
export const SCALE_RED = ["#F5E4E5","#E6C4C7","#D6A0A5","#C77D84","#D94A55","#BE3A46","#A32B36","#8A2029","#6E1720","#520F17"];
export const SCALE_ORANGE = ["#F3E7DA","#E3CDB0","#D2B186","#C2966A","#D9822B","#BE6F22","#A25C1B","#864A15","#6B3A11","#512B0C"];
export const SCALE_YELLOW = ["#F2EDD3","#E4DAB0","#D4C48A","#C4AE67","#C9912F","#B27F27","#9A6D20","#835C1B","#6C4B16","#553A11"];
export const SCALE_VIOLET = ["#EDEAF4","#D6D0E6","#BEB6D6","#A79BC7","#8E80B8","#7C6BC4","#6859A8","#57498D","#463A72","#352B57"];
export const SCALE_INDIGO = ["#E7EAF2","#C9D2E4","#ABBBD5","#8DA3C6","#6E86AE","#5C7296","#4B5E7D","#3A4A64","#29364B","#1B2331"];
export const SCALE_PINK = ["#F3E7EB","#E0C6CE","#CDA5B1","#BA8494","#A66277","#8E5365","#764553","#5E3743","#462933","#321C23"];
export const SCALE_GRAPE = ["#EFEAF3","#D9D0E2","#C3B6D1","#AD9CC0","#8E80B8","#7C6BAB","#695A92","#574A79","#453B60","#332C47"];
export const SCALE_LIME = ["#EEF0DC","#DADFB4","#C6CE8C","#B2BD65","#9AA84E","#849140","#6E7A34","#586329","#434C1F","#2F3615"];

// ----- Semantic tokens (single place everything imports) -----
export const POSITIVE = POSITIVE_COLOR; // green up
export const NEGATIVE = NEGATIVE_COLOR; // red down
export const NEUTRAL = "#9B9B9B";
export const ERROR = NEGATIVE_COLOR;
export const WARNING = "#C9912F";
export const INFO = "#4A8FD8";

/** Derive an rgba() tint from any anchor above — keeps alphas out of components. */
export function alpha(hex: string, a: number): string {
  const raw = hex.replace("#", "");
  const full = raw.length === 3 ? raw.split("").map((c) => c + c).join("") : raw;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Tabular/mono numeral stack for price, P&L, OI and IV columns. */
export const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';

/** Dialog / modal drop shadow — flat design: one soft shadow, no elevation tint. */
export const DIALOG_SHADOW = "0 8px 32px rgba(0, 0, 0, 0.5)";

// Text / surfaces
export const TEXT = TEXT_COLOR;
export const TEXT_MUTED = TEXT_MUTED_COLOR;
export const BG = BG_COLOR;
export const SURFACE = SURFACE_COLOR;
export const SURFACE_ALT = "#15181C";
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
export const TOOLTIP_BG = "#15181C";
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
export const CHART_CROSSHAIR = "#6B7280";
export const CHART_OVERLAY = "rgba(14, 16, 18, 0.95)";
export const CHART_DROPDOWN = "rgba(21, 24, 28, 0.96)";
export const CHART_DATAZOOM_BG = BG_COLOR;
export const DATAZOOM_FILLER = "rgba(0, 200, 83, 0.15)";

// --- Desk / terminal surface for the Nifty analytics panels ----------------
// Deep panel, hairline border, CE-blue / PE-orange legs, mint net-gamma.
export const TERM_BG = BG_COLOR;
export const TERM_BORDER = "#2A2E35";
export const TERM_HEADER = "#15181C";
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
export const BOT_SELECTED_BG = "rgba(225, 29, 46, 0.16)";
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
export const SECTOR_NEUTRAL = "#242A31";

// Heatmap value ramp. Kept apart from the SECTOR_* fill tokens: a treemap tile
// is a *value*, and the muted sector ramp left green/red barely distinguishable
// at a glance (sat 0.46/0.37). These hold mid luminance so white labels stay
// legible while the two directions separate cleanly.
export const RAMP_STRONG_GREEN = "#0E8A4F";
export const RAMP_GREEN = "#1FA76A";
export const RAMP_NEUTRAL = "#20262E";
export const RAMP_RED = "#D0454C";
export const RAMP_STRONG_RED = "#A82932";

// Sector rotation (RRG quadrants + rotation status) — muted, never neon.
export const ROTATION_LEADING = "#4C9A8F";
export const ROTATION_IMPROVING = "#5B8DEF";
export const ROTATION_WEAKENING = "#C9A227";
export const ROTATION_LAGGING = "#C05A5A";
export const ROTATION_HEATING = "#F0883E";
export const ROTATION_COOLING = "#5B8DEF";

/** Text/icon on a saturated tile or badge fill. */
export const TEXT_ON_ACCENT = "#FFFFFF";

// Tinted row backgrounds
export const TINT_POSITIVE = "rgba(0, 200, 83, 0.12)";
export const TINT_NEGATIVE = "rgba(255, 59, 48, 0.12)";
export const TINT_LOSS_ROW = "rgba(255, 59, 48, 0.12)";
export const TINT_TEST_TRADE = "rgba(245, 165, 36, 0.12)";

// Volume / ORB / IV areas
export const VOLUME_BULLISH = "rgba(0, 200, 83, 0.45)";
export const VOLUME_BEARISH = "rgba(255, 59, 48, 0.45)";
export const ORB_AREA = "rgba(225, 29, 46, 0.15)";
export const IV_AREA_START = "rgba(225, 29, 46, 0.30)";
export const IV_AREA_END = "rgba(225, 29, 46, 0)";

// ----- Nifty tape terminal palette ----------------------------------------
// A deliberate standalone "terminal" palette for the Nifty tape table (pitch
// black desk, blue call/put deltas, brown Net, blue/brown spot-flip tints).
// These are chart-specific hues that have no global-app equivalent, so they
// live here as the single source rather than as inline hexes in the table.
export const TAPE_CELL_RULE = "#141414";
export const TAPE_HEADER_RULE = "#2A2A2A";
export const TAPE_COL_RULE = "#1F1F1F";
export const TAPE_ROW_HOVER = "#101418";
export const TAPE_ROW_LATEST = "#0A0F16";
export const TAPE_SPOT = "#F2CC60";
export const TAPE_CALL_DOI = "#80B5FF";
export const TAPE_PUT_DOI = "#8AA4C2";
export const TAPE_NET_HUE = "#7A4D16";
export const TAPE_NET_TEXT = "#FFDDB3";
export const TAPE_POS_HUE = "#1F7FFF";
export const TAPE_FLIP_POS_TEXT = "#B3D1FF";
export const TAPE_NEG_HUE = "#DB6D28";
export const TAPE_FLIP_NEG_TEXT = "#FFC680";

// ----- Replay / tick terminals ---------------------------------------------
// Shared status-chip surfaces for the replay review panels, the lightweight-charts
// series hues, and the SMC trade-stack hues. One-offs with no global-app
// equivalent, so they live here as the single source.
export const REPLAY_CHIP_BG = "#1F2937";
export const REPLAY_CHIP_BG_ERROR = "#3B1D1D";
export const REPLAY_CHIP_TEXT_ERROR = "#F87171";
export const REPLAY_CHART_TEXT = "#E5E7EB";
export const REPLAY_CHART_MUTED = "#9CA3AF";
export const REPLAY_BG = "#111111";
export const SERIES_VWAP = "#F0B90B";
export const SERIES_STACK_DEFAULT = "#6B7280";
export const STACK_MOMENTUM = "#2563EB";
export const STACK_REVERSION = "#A855F7";
export const STACK_REVERSION_TEXT = "#CE9BFC";

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

// ----- TradingView lightweight-charts one-offs -----------------------------
// Bright label hues for the trade markers and RSI guides: deliberately more
// vivid than the candle bodies so labels stay legible at a glance.
const TV_HUE_RED = "#FF5252";
const TV_HUE_GREEN = "#00E676";
export const TV_ENTRY_BUY = "#38BDF8";
export const TV_ENTRY_SELL = "#FF9F43";
export const TV_EXIT_TP = TV_HUE_GREEN;
export const TV_EXIT_SL = TV_HUE_RED;
export const TV_EXIT_OTHER = "#FFD166";
export const TV_SERIES_TEXT = "#E5E7EB";
export const RSI_OVERBOUGHT = TV_HUE_RED;
export const RSI_OVERSOLD = TV_HUE_GREEN;

// ----- Nifty OI heatmap cells ----------------------------------------------
export const HEATMAP_CE = "#DC2626";
export const HEATMAP_PE = "#16A34A";
export const HEATMAP_SPOT = TEXT_ON_ACCENT;
export const HEATMAP_MP = "#F59E0B";
export const HEATMAP_FLIP = "#38BDF8";
export const HEATMAP_TOUCH_STROKE = "#000";

// ----- Option payoff chart tooltip -----------------------------------------
export const OPTION_PAYOFF_TOOLTIP_TEXT = "#E6EDF3";

// ----- Nifty flow strip (OI flow ticks) -------------------------------------
export const FLOW_BULL = "#16A34A";
export const FLOW_BEAR = "#DC2626";
export const FLOW_STRUCT = "#F59E0B";

// ----- Nifty unusual-volume terminal ---------------------------------------
// Pitch-black desk with its own CE-blue / PE-orange leg hues; these are
// chart-specific and have no global-app equivalent.
export const UNUSUAL_TERM_BORDER = "#1A1A1A";
export const UNUSUAL_CE = "#5B9CF6";
export const UNUSUAL_PE = "#F2A65A";
export const UNUSUAL_PILL_ACTIVE = "#2FC0AC";
export const UNUSUAL_PILL_ACTIVE_TEXT = "#8AE6D4";
export const UNUSUAL_PILL_BORDER = "#30363D";
export const UNUSUAL_PILL_TEXT = "#8B949E";

// ----- Patterns applied-filter chip ----------------------------------------
export const PATTERN_CHIP_BG = "#484F58";
