import {
  NEGATIVE,
  NEUTRAL,
  POSITIVE,
  SURFACE_ALT,
  TINT_NEGATIVE,
  TINT_POSITIVE,
} from "@/ui/palette";

export const EM_DASH = "—";

export type PositioningVerdict = "bearish" | "bullish" | "neutral";
export type PositioningMode = "since_open" | "prev_close";
export type PositioningView = "table" | "chart";

export interface PositioningStrikeRow {
  strike: number;
  ce_class: string | null;
  ce_doi_shares: number | null;
  ce_cr: number | null;
  pe_class: string | null;
  pe_doi_shares: number | null;
  pe_cr: number | null;
  net_cr: number | null;
}

export interface PositioningBiggestMove {
  strike: number;
  side: string;
  sentiment: string;
  label: string;
  cr: number | null;
}

export interface PositioningData {
  status: string;
  underlying: string;
  expiry: string;
  spot: number;
  lot_size: number;
  timestamp: string;
  baseline: string;
  baseline_note: string;
  verdict: PositioningVerdict;
  initiated_cr: number | null;
  lean_pct: number;
  state: { calls_cr: number | null; puts_cr: number | null; note: string };
  flow: { calls_cr: number | null; puts_cr: number | null; note: string };
  initiated: { bearish_cr: number | null; bullish_cr: number | null; note: string };
  split: { bearish_cr: number | null; bearish_pct: number; bullish_cr: number | null; bullish_pct: number };
  read: { pct: number; readable_shares: number; total_shares: number };
  biggest_move: PositioningBiggestMove | null;
  rows: PositioningStrikeRow[];
}

/**
 * Format a crore value, e.g. -87494 -> "-87,494 Cr", null -> "—".
 * Uses the ASCII hyphen to match the ui-helpers sign convention.
 */
export function formatCr(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return EM_DASH;
  if (v === 0) return "0 Cr";
  const sign = v < 0 ? "-" : "";
  return `${sign}${Math.abs(Math.round(v)).toLocaleString("en-IN")} Cr`;
}

/** Compact share count, e.g. 123456 -> "1.2L", null -> "—". */
export function formatShares(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return EM_DASH;
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 10000000) return `${sign}${(abs / 10000000).toFixed(1)}Cr`;
  if (abs >= 100000) return `${sign}${(abs / 100000).toFixed(1)}L`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1)}K`;
  return `${sign}${abs}`;
}

/** Signed percent with one decimal, e.g. 97.3 -> "+97.3%", null -> "—". */
export function formatPct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return EM_DASH;
  const sign = v < 0 ? "-" : "+";
  return `${sign}${Math.abs(v).toFixed(digits)}%`;
}

export interface VerdictMeta {
  icon: "▼" | "▲" | "■";
  colorToken: string;
  tintToken: string;
  label: string;
}

/** Palette-token-only verdict presentation (no hardcoded colors). */
export function verdictMeta(verdict: PositioningVerdict): VerdictMeta {
  switch (verdict) {
    case "bearish":
      return { icon: "▼", colorToken: NEGATIVE, tintToken: TINT_NEGATIVE, label: "Bearish" };
    case "bullish":
      return { icon: "▲", colorToken: POSITIVE, tintToken: TINT_POSITIVE, label: "Bullish" };
    default:
      return { icon: "■", colorToken: NEUTRAL, tintToken: SURFACE_ALT, label: "Neutral" };
  }
}
