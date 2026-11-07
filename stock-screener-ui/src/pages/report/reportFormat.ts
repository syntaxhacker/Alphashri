/**
 * Shared numeric vocabulary for the Nifty report panels.
 *
 * Every panel in this folder used to carry its own near-identical copy of the
 * number / percent / OI formatters. They had drifted apart: one printed the
 * Unicode minus "−" where another printed the ASCII "-", the K tier of the
 * compact scale used 2 decimals in one panel and 1 in another, and the "no
 * value" glyph was spelled three different ways. This module is the single
 * place the report's numbers are formatted, so a change lands once.
 *
 * Two number paths live here, on purpose:
 *
 * - {@link formatReportNum} — Indian-grouped magnitudes (index levels,
 *   strikes, OI counts). These read as "25,750".
 * - {@link formatReportPct} / {@link formatReportRatio} — fixed-decimal
 *   values without grouping. These read as "2.35%".
 *
 * Every helper is total: a null / undefined / non-finite input prints the
 * dash glyph instead of throwing.
 */

/** Glyph printed for a missing value. */
export const REPORT_DASH = "—";

/** Unicode minus — the glyph the newer panels use for negative numbers. */
export const REPORT_MINUS = "−";

/** How a sign is rendered next to a number. */
export type SignMode =
  /** No "+" — negatives still carry a minus. */
  | "none"
  /** "+" on zero and positives, the minus glyph on negatives. */
  | "always"
  /** "+" on positives only; zero and negatives print without a "+". */
  | "nonzero";

/** Options shared by every number helper in this module. */
export interface ReportNumOptions {
  /**
   * Maximum fraction digits. Omitted → the locale default (3), which is what
   * a bare `toLocaleString("en-IN")` produces.
   */
  digits?: number;
  /** Minimum fraction digits — pads with trailing zeros. Default 0. */
  minDigits?: number;
  /** Sign rendering. Default "none". */
  sign?: SignMode;
  /** Glyph used for a negative sign. Default "-". */
  minus?: string;
  /** Round to an integer before formatting. Default false. */
  round?: boolean;
  /** Glyph printed for a missing value. Default {@link REPORT_DASH}. */
  dash?: string;
}

/** Options for the compact M/K scale used by contract counts. */
export interface ReportCompactOptions {
  /** Decimals in the M (millions) tier. Default 2. */
  millions?: number;
  /**
   * Drop the decimals in the M tier once it reaches ten million ("96M"
   * rather than "96.0M"). The intel strip reads that way; the tape does not.
   */
  smartMillions?: boolean;
  /** Decimals in the K (thousands) tier. Default 2. */
  thousands?: number;
  /** Decimals in the plain tier. Default 0 (0 = locale default when grouped). */
  units?: number;
  /** Sign rendering. Default "none". */
  sign?: SignMode;
  /** Glyph used for a negative sign. Default "-". */
  minus?: string;
  /** Round the plain tier to an integer. Default false. */
  round?: boolean;
  /** Indian-group the plain tier. Default true. */
  grouped?: boolean;
  /** Glyph printed for a missing value. Default {@link REPORT_DASH}. */
  dash?: string;
}

function isMissing(value: number | null | undefined): value is null | undefined {
  return value === null || value === undefined || !Number.isFinite(value);
}

/** Prefix a sign onto an already-absolute body. */
function withSign(
  body: string,
  value: number,
  sign: SignMode,
  minus: string,
): string {
  if (value < 0) return `${minus}${body}`;
  if (sign === "always") return `+${body}`;
  if (sign === "nonzero" && value > 0) return `+${body}`;
  return body;
}

/**
 * Indian-grouped number — index levels, strikes, OI magnitudes.
 *
 * `formatReportNum(25750)` → `"25,750"`, `formatReportNum(-2.5, { digits: 1 })`
 * → `"-2.5"`, `formatReportNum(null)` → `"—"`.
 */
export function formatReportNum(
  value: number | null | undefined,
  options: ReportNumOptions = {},
): string {
  const {
    digits,
    minDigits = 0,
    sign = "none",
    minus = "-",
    round = false,
    dash = REPORT_DASH,
  } = options;
  if (isMissing(value)) return dash;
  const rounded = round ? Math.round(value) : value;
  const body = Math.abs(rounded).toLocaleString("en-IN", {
    minimumFractionDigits: minDigits,
    maximumFractionDigits: digits,
  });
  return withSign(body, rounded, sign, minus);
}

/**
 * Fixed-decimal number without grouping — percentages and ratios.
 *
 * `formatReportPct(2.345, { digits: 2 })` → `"2.35%"`.
 */
export function formatReportFixed(
  value: number | null | undefined,
  options: ReportNumOptions & { suffix?: string } = {},
): string {
  const {
    digits = 2,
    sign = "none",
    minus = "-",
    round = false,
    dash = REPORT_DASH,
    suffix = "",
  } = options;
  if (isMissing(value)) return dash;
  const rounded = round ? Math.round(value) : value;
  const body = Math.abs(rounded).toFixed(digits);
  return `${withSign(body, rounded, sign, minus)}${suffix}`;
}

/** Percentage with a `%` suffix — `formatReportPct(2.35)` → `"+2.35%"`. */
export function formatReportPct(
  value: number | null | undefined,
  options: ReportNumOptions = {},
): string {
  return formatReportFixed(value, { ...options, suffix: "%" });
}

/** Plain ratio (PCR, Vol÷OI) — `formatReportRatio(1.235)` → `"1.24"`. */
export function formatReportRatio(
  value: number | null | undefined,
  options: ReportNumOptions = {},
): string {
  return formatReportFixed(value, { digits: 2, ...options });
}

/**
 * Compact contract magnitude — `1.25M` / `850.00K` / `912`.
 *
 * The tiers are configurable because the panels disagree on decimals: the
 * tape uses 2 on both tiers, the heatmap uses 1 on the K tier, and the intel
 * strip drops to whole units. The plain tier is Indian-grouped by default
 * (the tape/unusual-volume convention).
 */
export function formatReportCompact(
  value: number | null | undefined,
  options: ReportCompactOptions = {},
): string {
  const {
    millions = 2,
    smartMillions = false,
    thousands = 2,
    units = 0,
    sign = "none",
    minus = "-",
    round = false,
    grouped = true,
    dash = REPORT_DASH,
  } = options;
  if (isMissing(value)) return dash;
  const abs = Math.abs(value);
  let body: string;
  if (abs >= 1_000_000) {
    const scaled = abs / 1_000_000;
    const digits = smartMillions && scaled >= 10 ? 0 : millions;
    body = `${(abs / 1_000_000).toFixed(digits)}M`;
  } else if (abs >= 1_000) {
    body = `${(abs / 1_000).toFixed(thousands)}K`;
  } else if (grouped) {
    const plain = round ? Math.round(abs) : abs;
    body = plain.toLocaleString("en-IN", { maximumFractionDigits: units });
  } else {
    body = abs.toFixed(units);
  }
  return withSign(body, value, sign, minus);
}

/** Options for the open-interest "Cr / L / k" scale. */
export interface ReportOiCrOptions {
  /** Decimals in the Cr tier. Default 2. */
  cr?: number;
  /** Decimals in the L (lakh) tier. Default 2. */
  lakh?: number;
  /** Decimals in the k (thousand) tier. Default 1. */
  thousand?: number;
  /** Space between the number and the L / k unit. Default true. The Cr tier
   *  always carries a space — both panels print "2.50 Cr". */
  space?: boolean;
  /** Include the k tier below a lakh. Default false. */
  thousands?: boolean;
  /** Indian-group the plain tier. Default true. */
  grouped?: boolean;
  /** Sign rendering. Default "none". */
  sign?: SignMode;
  /** Glyph used for a negative sign. Default "-". */
  minus?: string;
  /** Print the dash for zero and negative OI. Default false. */
  dashOnNonPositive?: boolean;
  /** Glyph printed for a missing value. Default {@link REPORT_DASH}. */
  dash?: string;
}

/**
 * Open interest in the desk's Cr/L idiom — `2.50 Cr` / `25.00 L` / `1,234`.
 *
 * Two panels read OI and they did not agree: the desk plan printed
 * `25.00 L` (two decimals, a space) while the depth map printed `25.0L`
 * (one decimal, no space) and added a `5.0k` tier the desk plan never had.
 * The options below keep both readings available from one implementation.
 */
export function formatReportOiCr(
  value: number | null | undefined,
  options: ReportOiCrOptions = {},
): string {
  const {
    cr = 2,
    lakh = 2,
    thousand = 1,
    space = true,
    thousands = false,
    grouped = true,
    sign = "none",
    minus = "-",
    dashOnNonPositive = false,
    dash = REPORT_DASH,
  } = options;
  if (isMissing(value)) return dash;
  if (dashOnNonPositive && value <= 0) return dash;
  const gap = space ? " " : "";
  // The tier is picked from the magnitude — a negative OI prints "-2.5L", not
  // a value that fell through to the plain tier.
  const abs = Math.abs(value);
  if (abs >= 1e7) return `${(abs / 1e7).toFixed(cr)} Cr`;
  if (abs >= 1e5) return `${withSign((abs / 1e5).toFixed(lakh), value, sign, minus)}${gap}L`;
  if (thousands && abs >= 1e3) {
    return `${withSign((abs / 1e3).toFixed(thousand), value, sign, minus)}${gap}k`;
  }
  const body = grouped
    ? abs.toLocaleString("en-IN", { maximumFractionDigits: 0 })
    : String(Math.round(abs));
  return withSign(body, value, sign, minus);
}

/**
 * IST wall-clock `HH:MM:SS` for an epoch-ms value — host-TZ independent.
 * Shared by the tape and the unusual-volume panel, which both stamp their
 * "last refreshed" line with it.
 */
export function formatReportClock(ms: number): string {
  if (!Number.isFinite(ms)) return REPORT_DASH;
  return new Date(ms).toLocaleTimeString("en-IN", {
    hour12: false,
    timeZone: "Asia/Kolkata",
  });
}

/**
 * Distance from spot in index points — `+50 pts` / `-120 pts`.
 * The sign is the distance itself: positive means the level sits above spot.
 */
export function formatReportPoints(
  distance: number | null | undefined,
  options: { dash?: string; minus?: string } = {},
): string {
  const { dash = REPORT_DASH, minus = "-" } = options;
  if (isMissing(distance)) return dash;
  const body = Math.abs(distance).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return `${distance < 0 ? minus : "+"}${body} pts`;
}
