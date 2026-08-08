// ============================================================
// THE SINGLE SOURCE OF TRUTH FOR ALL COLORS IN THE APP
// ------------------------------------------------------------
// Base palette (user-specified):
//   #000000  pure black          — deepest background
//   #412D15  dark brown          — mid surface / borders / accents
//   #1F150C  very dark brown     — primary surface / cards
//   #E1DCC9  cream               — text / highlights / primary
//
// Trading accents (used SPARINGLY — only for green/red semantics
// like P&L up/down, markers, positive/negative signals):
//   #285A48  dark green          — positive
//   #9B0F06  dark red            — negative
//
// Everything else in the app (Mantine scales, chart colors,
// semantic tokens) is DERIVED from these, so changing the brand
// palette here recolors the entire codebase.
// ============================================================

// ----- Raw palette (the only literals in the app) -----
export const BLACK = "#000000";
export const BROWN = "#412D15";
export const BROWN_DARK = "#1F150C";
export const CREAM = "#E1DCC9";
export const TRADING_GREEN = "#285A48";
export const TRADING_RED = "#9B0F06";

// ----- Shade helpers (mix toward cream/black, stay in palette) -----
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const bl = Math.round(b1 + (b2 - b1) * t);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${bl.toString(16).padStart(2, "0")}`;
}

/** Mantine expects a 10-step scale: index 0 lightest … index 9 darkest. */
function makeScale(base: string, lightAnchor = CREAM, darkAnchor = BLACK): string[] {
  const steps: string[] = [];
  for (let i = 0; i < 10; i++) {
    const t = i / 9;
    // light half: base -> lightAnchor ; dark half: base -> darkAnchor
    const s = t < 0.5 ? mix(base, lightAnchor, (0.5 - t) * 2) : mix(base, darkAnchor, (t - 0.5) * 2);
    steps.push(s);
  }
  return steps;
}

// ----- Mantine color scales (all derived from the palette) -----
// Primary/neutral: warm cream→brown→black monochrome
export const SCALE_TEAL = makeScale(CREAM);
export const SCALE_GREEN = makeScale(TRADING_GREEN);
export const SCALE_RED = makeScale(TRADING_RED);
export const SCALE_ORANGE = makeScale(BROWN);
export const SCALE_DARK = makeScale(BROWN_DARK, BROWN_DARK, BLACK);
export const SCALE_GRAY = makeScale(BROWN, CREAM, BLACK);
export const SCALE_BLUE = makeScale(BROWN);
export const SCALE_YELLOW = makeScale(CREAM);
export const SCALE_CYAN = makeScale(BROWN);
export const SCALE_VIOLET = makeScale(BROWN);
export const SCALE_INDIGO = makeScale(BROWN);

// ----- Semantic tokens (single place everything imports) -----
export const POSITIVE = TRADING_GREEN;
export const NEGATIVE = TRADING_RED;
export const NEUTRAL = CREAM;
export const ERROR = TRADING_RED;
export const WARNING = BROWN;
export const INFO = CREAM;

// Text / surfaces
export const TEXT = CREAM;
export const TEXT_MUTED = mix(CREAM, BROWN, 0.45);
export const BG = BLACK;
export const SURFACE = BROWN_DARK;
export const SURFACE_ALT = BROWN;
export const BORDER = BROWN;
export const SURFACE_TEXT = CREAM;

// Trading markers (keep green/red semantics, sparingly)
export const MARKER_ENTRY = CREAM;
export const MARKER_TP = TRADING_GREEN;
export const MARKER_SL = TRADING_RED;
export const MARKER_EOD = CREAM;
export const MARKER_BUY = TRADING_GREEN;
export const MARKER_SELL = TRADING_RED;
export const MARKER_STOP_LOSS = TRADING_RED;
export const MARKER_CUSTOM = CREAM;
export const MARKER_BORDER = CREAM;
export const MARKER_MAX_HOLDING = CREAM;

export const BULLISH = TRADING_GREEN;
export const BEARISH = TRADING_RED;

export const EXIT_COLORS: Record<string, string> = {
  TP: TRADING_GREEN,
  SL: TRADING_RED,
  EOD: CREAM,
};
export const EXIT_DEFAULT = CREAM;

// Chart overlays / tooltips / axis (dark theme is the app default)
export const TOOLTIP_BG = BROWN_DARK;
export const TOOLTIP_BORDER = BROWN;
export const TOOLTIP_TEXT = CREAM;
export const AXIS_LINE = BROWN;
export const AXIS_SPLIT = BROWN_DARK;
export const CHART_BG = BLACK;
export const CHART_TEXT = CREAM;
export const CHART_MUTED = TEXT_MUTED;
export const CHART_BORDER = BROWN;
export const CHART_SPLIT = BROWN_DARK;
export const CHART_CROSSHAIR = TEXT_MUTED;
export const CHART_OVERLAY = "rgba(20, 20, 20, 0.95)";
export const CHART_DROPDOWN = "rgba(0, 0, 0, 0.7)";
export const CHART_DATAZOOM_BG = BROWN_DARK;
export const DATAZOOM_FILLER = "rgba(40, 90, 72, 0.18)";

// P&L / indicators / OI / pivots (green/red only where semantically needed)
export const PERF_POSITIVE = TRADING_GREEN;
export const PERF_NEGATIVE = TRADING_RED;
export const BOT_RUNNING = TRADING_GREEN;
export const BOT_STOPPED = TEXT_MUTED;
export const BOT_SELECTED_BG = "rgba(225, 220, 201, 0.08)";
export const OI_CALL = TRADING_GREEN;
export const OI_PUT = TRADING_RED;
export const INDICATOR_LINE = CREAM;
export const INDICATOR_BLUE_A = TEXT_MUTED;
export const INDICATOR_BLUE_B = CREAM;
export const PIVOT_R1 = TRADING_RED;
export const PIVOT_PP = CREAM;
export const PIVOT_S1 = TRADING_GREEN;
export const PIVOT_S2 = TEXT_MUTED;
export const PIVOT_CUSTOM = CREAM;
export const PIVOT_OR_HIGH = CREAM;
export const PIVOT_OR_LOW = TEXT_MUTED;
export const PIVOT_52W_HIGH = TRADING_RED;
export const PIVOT_52W_LOW = TRADING_GREEN;
export const CHART_AVG_ENTRY = CREAM;
export const CHART_TRADE_EXIT = TEXT_MUTED;

// Sector treemap (monochrome browns + green/red for direction)
export const SECTOR_STRONG_GREEN = TRADING_GREEN;
export const SECTOR_GREEN = mix(TRADING_GREEN, CREAM, 0.35);
export const SECTOR_LIGHT_GREEN = mix(TRADING_GREEN, BLACK, 0.3);
export const SECTOR_STRONG_RED = TRADING_RED;
export const SECTOR_RED = mix(TRADING_RED, CREAM, 0.3);
export const SECTOR_LIGHT_RED = mix(TRADING_RED, BLACK, 0.3);
export const SECTOR_NEUTRAL = BROWN;

// Tinted row backgrounds (subtle green/red washes, sparing)
export const TINT_POSITIVE = "rgba(40, 90, 72, 0.14)";
export const TINT_NEGATIVE = "rgba(155, 15, 6, 0.14)";
export const TINT_LOSS_ROW = "rgba(155, 15, 6, 0.10)";
export const TINT_TEST_TRADE = "rgba(225, 220, 201, 0.10)";

// Volume / ORB / IV areas
export const VOLUME_BULLISH = "rgba(40, 90, 72, 0.5)";
export const VOLUME_BEARISH = "rgba(155, 15, 6, 0.5)";
export const ORB_AREA = "rgba(225, 220, 201, 0.12)";
export const IV_AREA_START = "rgba(225, 220, 201, 0.25)";
export const IV_AREA_END = "rgba(225, 220, 201, 0)";

// Backward-compat aliases (some call sites use the old light/dark names)
export const POSITIVE_COLOR = POSITIVE;
export const NEGATIVE_COLOR = NEGATIVE;


// ----- Legacy light/dark aliases (app defaults to dark theme) -----
export const TOOLTIP_DARK_BG = TOOLTIP_BG;
export const TOOLTIP_LIGHT_BG = CREAM;
export const TOOLTIP_DARK_BORDER = TOOLTIP_BORDER;
export const TOOLTIP_LIGHT_BORDER = CREAM;
export const TOOLTIP_DARK_TEXT = TOOLTIP_TEXT;
export const TOOLTIP_LIGHT_TEXT = BLACK;
export const AXIS_DARK_LINE = AXIS_LINE;
export const AXIS_LIGHT_LINE = CREAM;
export const AXIS_DARK_SPLIT = AXIS_SPLIT;
export const AXIS_LIGHT_SPLIT = mix(CREAM, BLACK, 0.06);
export const CHART_DARK_BG = CHART_BG;
export const CHART_LIGHT_BG = CREAM;
export const CHART_DARK_OVERLAY = CHART_OVERLAY;
export const CHART_LIGHT_OVERLAY = "rgba(225, 220, 201, 0.95)";
export const CHART_DARK_DROPDOWN = CHART_DROPDOWN;
export const CHART_LIGHT_DROPDOWN = "rgba(225, 220, 201, 0.7)";
export const CHART_DARK_TEXT = CHART_TEXT;
export const CHART_LIGHT_TEXT = BLACK;
export const CHART_DARK_MUTED = CHART_MUTED;
export const CHART_LIGHT_MUTED = mix(BLACK, CREAM, 0.45);
export const CHART_DARK_BORDER = CHART_BORDER;
export const CHART_LIGHT_BORDER = CREAM;
export const CHART_DARK_SPLIT = CHART_SPLIT;
export const CHART_LIGHT_SPLIT = mix(CREAM, BLACK, 0.06);
export const ERROR_COLOR = ERROR;
export const CHART_DARK_DATAZOOM_BG = CHART_DATAZOOM_BG;
export const CHART_LIGHT_DATAZOOM_BG = CREAM;
