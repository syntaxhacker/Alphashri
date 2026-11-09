import * as palette from "@/ui/palette";
import { formatReportNum, formatReportCompact, REPORT_MINUS, formatReportPct } from "./reportFormat";
import type { WallsEvent, WallsRow } from "@/api/reportNifty";

/**
 * Shared walls helpers for the Nifty "walls" cards / panels.
 *
 * Formatters + colour map (extracted verbatim from `NiftyWallsCard`,
 * `NiftyWallsExpanded` and `WallsMap` — the three copies were
 * byte-identical) so the numbers keep the exact same rendering everywhere:
 * `—` for missing/non-finite values, 2dp millions, 0dp thousands.
 *
 * Plus the shared aggregation helpers (`wallsMaxOi`, `firstBreakEvent`,
 * `lastBreakEvent`) so the card and the expanded view clamp and scan
 * breaks identically.
 */

/** Chip colour per wall state; unknown states fall back to muted text. */
export const STATE_COLOR: Record<string, string> = {
  BREAK: palette.NEGATIVE,
  PIN_RISK: palette.WARNING,
  WATCH: palette.PRIMARY,
  WALL_WATCH: palette.INFO,
  FADE: palette.TEXT_MUTED,
  QUIET: palette.TEXT_MUTED,
};

export const fmtOI = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value) || value <= 0) return "—";
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(0)}K`;
  return String(Math.round(value));
};

export const fmtPct = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;
};

/**
 * Alias — byte-identical to
 * `formatReportCompact(v, { sign: "nonzero", minus: "−", thousands: 0, millions: 2, grouped: false })`.
 * Kept as a named export because `NiftyWallsCard`, `NiftyWallsExpanded` and
 * `WallsMap` import it.
 */
export const fmtSignedOI = (value: number | null | undefined): string =>
  formatReportCompact(value, {
    sign: "nonzero",
    minus: REPORT_MINUS,
    thousands: 0,
    millions: 2,
    grouped: false,
  });

export const newOiTint = (value: number | null | undefined, rows: WallsRow[]): string => {
  if (value == null || !Number.isFinite(value) || value === 0) return "transparent";
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.new_oi ?? 0)));
  const alpha = 0.06 + 0.16 * Math.min(1, Math.abs(value) / max);
  return value > 0 ? `rgba(22,163,74,${alpha})` : `rgba(220,38,38,${alpha})`;
};

/**
 * Alias — byte-identical to `formatReportNum(v, { digits, minDigits: digits })`.
 * Kept as a named export because `NiftyWallsCard`, `NiftyWallsExpanded` and
 * `WallsMap` import it.
 */
export const fmtNum = (value: number | null | undefined, digits = 0): string =>
  formatReportNum(value, { digits, minDigits: digits });

export const erosionColor = (value: number | null | undefined): string => {
  if (value == null) return palette.TEXT_MUTED;
  return value < 0 ? palette.NEGATIVE : palette.POSITIVE;
};

/**
 * Alias — byte-identical to `formatReportPct(v, { digits: 2, sign: "nonzero" })`.
 * Kept as a named export because `NiftyWallsCard` and `NiftyWallsExpanded`
 * import it.
 */
export const dist = (value: number | null | undefined): string =>
  formatReportPct(value, { digits: 2, sign: "nonzero" });

/** `0-DTE` / `n-DTE` / empty when the payload has no DTE. */
export const formatDte = (dte: number | null | undefined): string => {
  if (dte == null) return "";
  return dte === 0 ? "0-DTE" : `${dte}-DTE`;
};

/**
 * Max OI across one or more wall groups, clamped to ≥ 1 so the width ratios
 * never divide by zero. Matches the inline `Math.max(1, …)` used by the card
 * and the expanded tables/ladder.
 */
export const wallsMaxOi = (...groups: WallsRow[][]): number =>
  Math.max(1, ...groups.flat().map((row) => row.oi));

/** First BREAK event in the recorded window (`undefined` when none). */
export const firstBreakEvent = (events: WallsEvent[]): WallsEvent | undefined =>
  events.find((event) => event.kind === "BREAK");

/** Last BREAK event in the recorded window (`undefined` when none). */
export const lastBreakEvent = (events: WallsEvent[]): WallsEvent | undefined =>
  [...events].reverse().find((event) => event.kind === "BREAK");

/** Wall flow token → human label; unknown/missing → dash. */
export const flowLabel = (flow: string | null | undefined): string => {
  switch ((flow ?? "").trim().toUpperCase()) {
    case "WRITERS_COVERING":
      return "WRITERS COVERING";
    case "LONG_UNWIND":
      return "LONG UNWIND";
    case "WRITERS_ADDING":
      return "WRITERS ADDING";
    case "LONG_BUILD":
      return "LONG BUILD";
    default:
      return "—";
  }
};

/** Flow read mapped onto the desk's bull/bear vocabulary; unknown → muted. */
export const flowTone = (flow: string | null | undefined): "bull" | "bear" | "muted" => {
  switch ((flow ?? "").trim().toUpperCase()) {
    case "WRITERS_COVERING":
    case "LONG_BUILD":
      return "bull";
    case "LONG_UNWIND":
    case "WRITERS_ADDING":
      return "bear";
    default:
      return "muted";
  }
};

/** Wall health chip tone; unknown → muted. */
export const statusTone = (
  status: string | null | undefined,
): "positive" | "warning" | "negative" | "muted" => {
  switch ((status ?? "").trim().toUpperCase()) {
    case "BUILDING":
      return "positive";
    case "ERODING":
      return "warning";
    case "BREACHED":
      return "negative";
    default:
      return "muted";
  }
};

/**
 * Direction glyph for a wall: `▲` = the upside fuel, `▼` = the downside fuel.
 * A CALL wall failing (or broken) releases the upside; a PUT wall failing
 * releases the downside. BUILDING strengthens the wall, the opposite read.
 */
export const erosionArrow = (
  side: "CALL" | "PUT",
  status: string | null | undefined,
): "▲" | "▼" | "—" => {
  const sideDir = side === "CALL" ? "▲" : "▼";
  const against = side === "CALL" ? "▼" : "▲";
  switch ((status ?? "").trim().toUpperCase()) {
    case "ERODING":
    case "BREACHED":
      return sideDir;
    case "BUILDING":
      return against;
    default:
      return "—";
  }
};

/** Erosion velocity, fraction/min → `-0.11%/min`. */
export const fmtRate = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  return `${pct > 0 ? "+" : ""}${pct.toFixed(2)}%/min`;
};

/** Volume multiple → `1.3×`; negative/non-finite → dash (ratio is ≥ 0 by definition). */
export const fmtVolMult = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  return `${value.toFixed(1)}×`;
};

/** Minutes to the wall breaking → `~4m` / `<1m`; unknown → dash. */
export const fmtTimeToBreak = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value < 1) return "<1m";
  return `~${Math.round(value)}m`;
};

/** Premium change, fraction → `+1.2%`. */
export const fmtPremChange = (value: number | null | undefined): string => {
  if (value == null || !Number.isFinite(value)) return "—";
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
};

/**
 * Resolve the wall board to use: prefer `near` when it has at least one call
 * or put entry; otherwise fall back to `full`. Both arguments can be null/
 * undefined. The returned value has the same shape as the inputs.
 */
export function resolveWallBoard(
  near: { calls?: NiftyWall[] | null; puts?: NiftyWall[] | null } | null | undefined,
  full: { calls?: NiftyWall[] | null; puts?: NiftyWall[] | null } | null | undefined,
): { calls?: NiftyWall[] | null; puts?: NiftyWall[] | null } | null {
  const nearHasData = (near?.calls?.length ?? 0) + (near?.puts?.length ?? 0) > 0;
  return nearHasData ? near : full;
}
