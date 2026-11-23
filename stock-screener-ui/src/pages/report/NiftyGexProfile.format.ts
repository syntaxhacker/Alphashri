import { formatNumberIN } from "@/utils/ui-helpers";
import * as palette from "@/ui/palette";
import type { GexSideLevel } from "./NiftyGexProfile.levels";

/**
 * Display strings and tones for the GEX panel. Pure functions keep the numbers,
 * units and fallback glyphs in one place while the JSX modules stay about
 * layout — the text is byte-identical to the pre-split facade.
 */

export const GEX_DASH = "—";

/** Coerce a payload field to a finite number (NaN when absent/blank). */
export function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export function formatGexCr(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return GEX_DASH;
  return `${v > 0 ? "+" : ""}${v.toFixed(2)} Cr/pt`;
}

/** Integer Indian-grouped strike, e.g. `22,600` / `—`. */
export function formatGexStrike(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return GEX_DASH;
  return formatNumberIN(v);
}

/** Colour the netGex / regime value by sign (support vs volatility fuel). */
export function gexTone(v: number | null): string {
  if (v == null || !Number.isFinite(v) || v === 0) return palette.TEXT_MUTED;
  return v > 0 ? palette.TERM_GAMMA : palette.TERM_GAMMA_NEG;
}

/**
 * A pin magnet is a level, not a gamma sign: SUP is green support, RES is red
 * resistance, regardless of the sign of the gamma that creates it. Negative
 * gamma is fuel on its own side and keeps the sign-based tone.
 */
export function gexLevelTone(level: GexSideLevel | null): string {
  if (!level) return palette.TEXT_MUTED;
  if (level.kind === "support") return palette.LEVEL_SUPPORT;
  if (level.kind === "resistance") return palette.LEVEL_RESISTANCE;
  return gexTone(level.netGex);
}

/** Label / hint for one side cell: a pin magnet or move fuel. */
export function gexSideCopy(
  level: GexSideLevel | null,
  side: "below" | "above",
): { label: string; hint: string } {
  if (level?.kind === "fuel") {
    return side === "below"
      ? { label: "γ fuel ↓", hint: "breakdown fuel · below" }
      : { label: "γ fuel ↑", hint: "squeeze fuel · above" };
  }
  return side === "below"
    ? { label: "γ support", hint: "pin magnet · below" }
    : { label: "γ resistance", hint: "pin magnet · above" };
}
