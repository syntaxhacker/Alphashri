/**
 * Spot-relative dealer-gamma math — pure, no React, no clock, no network.
 *
 * Split out of `NiftyGexProfile.tsx` so the *pure* consumers (the desk plan,
 * the tape, the heatmap) can read the same regime/flip the panel shows
 * without dragging the component tree into their module graph.
 *
 * The rule the whole report obeys: the gamma regime is the sign of the
 * **cumulative net gamma up to spot** (the side of the flip spot trades on),
 * never the book total. A book can be net long overall while spot sits below
 * the flip — that is short gamma where price actually is, and reading the
 * total said "long" while the flip line said "short".
 *
 * The backend already applies this rule, but stored payloads recorded by older
 * builds carried a `regime` derived from `netTotal`. Re-deriving it here (and
 * dropping a flip that contradicts the cumulative sign) keeps a replayed frame
 * self-consistent.
 */

import type { NiftyGex } from "@/types/niftyReport";
import { sortByField } from "@/utils/ui-helpers";

/** A single point of the per-strike net-GEX profile (sorted ascending). */
export interface GexProfilePoint {
  strike: number;
  netGex: number;
}

/** Coerce a payload field to a finite number (NaN when absent/blank). */
function num(v: unknown): number {
  // `Number(null)` and `Number("")` are 0 — treat those as absent so a null
  // leg is dropped instead of being plotted as a genuine zero exposure.
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Per-strike profile, always ascending by strike. Drops rows whose strike or
 * netGex is missing / non-finite so a malformed payload can never crash the
 * chart or shift a label. Undefined / empty input yields `[]`.
 */
export function buildGexProfile(gex?: NiftyGex): GexProfilePoint[] {
  const strikes = Array.isArray(gex?.strikes) ? gex.strikes : [];
  return sortByField(
    strikes
      .map((s) => ({ strike: num(s?.strike), netGex: num(s?.netGex) }))
      .filter((p) => Number.isFinite(p.strike) && Number.isFinite(p.netGex)),
    "strike",
    "asc",
  );
}

/** Cumulative net gamma through the strikes at/below spot (backend rounding). */
export function gexCumAtSpot(
  gex: NiftyGex | undefined,
  spot: number,
): { cumAtSpot: number; inRange: boolean } {
  const profile = buildGexProfile(gex);
  const spotF = Number(spot);
  if (!Number.isFinite(spotF) || profile.length === 0) {
    return { cumAtSpot: 0, inRange: false };
  }
  if (spotF < profile[0].strike || spotF > profile[profile.length - 1].strike) {
    return { cumAtSpot: 0, inRange: false };
  }
  let cum = 0;
  let cumAtSpot = 0;
  for (const p of profile) {
    cum = Math.round((cum + p.netGex) * 100) / 100;
    if (p.strike <= spotF) cumAtSpot = cum;
  }
  return { cumAtSpot, inRange: true };
}

/**
 * Regime implied by the cumulative net gamma **up to spot** — the side of the
 * flip spot trades on. Returns `fallback` when the profile is absent or spot
 * sits outside it, so a partial payload still shows the backend's value.
 */
export function gexRegimeAtSpot(
  gex: NiftyGex | undefined,
  spot: number,
  fallback: string,
): string {
  const { cumAtSpot, inRange } = gexCumAtSpot(gex, spot);
  if (!inRange) return fallback;
  if (Math.abs(cumAtSpot) < 1) return "flat";
  return cumAtSpot > 0 ? "long" : "short";
}

/**
 * The payload's flip, dropped when it disagrees with the cumulative sign at
 * spot. A flip below spot must sit on positive cumulative gamma (long), and a
 * flip above spot on negative cumulative gamma (short); anything else is a
 * stale crossing that would contradict the regime beside it.
 */
export function gexFlipAtSpot(
  gex: NiftyGex | undefined,
  spot: number,
): number | null {
  const rawZero = gex?.zeroCross;
  const flip =
    rawZero != null && Number.isFinite(Number(rawZero)) ? Number(rawZero) : null;
  if (flip == null) return null;
  const spotF = Number(spot);
  if (!Number.isFinite(spotF)) return flip;
  const { cumAtSpot, inRange } = gexCumAtSpot(gex, spotF);
  if (!inRange) return flip;
  if (spotF < flip && cumAtSpot >= 0) return null;
  if (spotF > flip && cumAtSpot < 0) return null;
  return flip;
}

/**
 * One call for the two things every consumer needs: the spot-relative regime
 * and the spot-relative flip. `regime` falls back to the payload's own value
 * when the profile does not cover spot; `flip` is `null` when the payload has
 * no flip or the flip contradicts the cumulative sign.
 */
export function gexSpotRelative(
  gex: NiftyGex | undefined,
  spot: number,
): { regime: string; flip: number | null } {
  const fallback =
    gex?.regime && String(gex.regime).trim() ? String(gex.regime).trim() : "flat";
  return {
    regime: gexRegimeAtSpot(gex, spot, fallback),
    flip: gexFlipAtSpot(gex, spot),
  };
}
