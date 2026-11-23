import {
  GEX_LEVEL_MAX_DIST_PCT,
  GEX_LEVEL_MIN_SHARE,
} from "@/config/reportAnalytics";
import type { NiftyGex } from "@/types/niftyReport";
import {
  buildGexProfile,
  gexFlipAtSpot,
  gexRegimeAtSpot,
  type GexProfilePoint,
} from "./niftyGex";
import { num } from "./NiftyGexProfile.format";

// Gates are owned by config (mirrored from the Python owner, drift-guarded by
// tests/api/test_options_conventions.py); re-exported for existing importers.
export { GEX_LEVEL_MAX_DIST_PCT, GEX_LEVEL_MIN_SHARE };

export interface GexProfileStats {
  netTotal: number | null;
  zeroCross: number | null;
  regime: string;
  peakStrike: number | null;
  troughStrike: number | null;
}

/**
 * Headline stats. `netTotal` is the book total (null when absent / non-finite);
 * `zeroCross` is the payload's flip, dropped when it disagrees with the
 * cumulative sign at spot. `regime` is re-derived from that cumulative sign
 * (`gexRegimeAtSpot`), falling back to the payload's own value.
 * `peakStrike` / `troughStrike` are the strikes holding the max / min netGex;
 * ties break toward the strike nearest `spot`, which keeps the marker
 * deterministic on flat profiles.
 */
export function gexProfileStats(gex: NiftyGex | undefined, spot: number): GexProfileStats {
  const profile = buildGexProfile(gex);

  const distToSpot = (strike: number): number =>
    Number.isFinite(spot) ? Math.abs(strike - spot) : 0;

  let peak: GexProfilePoint | null = null;
  let trough: GexProfilePoint | null = null;
  for (const p of profile) {
    if (
      peak === null ||
      p.netGex > peak.netGex ||
      (p.netGex === peak.netGex && distToSpot(p.strike) < distToSpot(peak.strike))
    ) {
      peak = p;
    }
    if (
      trough === null ||
      p.netGex < trough.netGex ||
      (p.netGex === trough.netGex && distToSpot(p.strike) < distToSpot(trough.strike))
    ) {
      trough = p;
    }
  }

  const netTotal = num(gex?.netTotal);
  const zeroCross = gexFlipAtSpot(gex, spot);
  const backendRegime = gex?.regime ? String(gex.regime).trim() : "";
  const regime = gex
    ? gexRegimeAtSpot(gex, spot, backendRegime).toUpperCase()
    : "";

  return {
    netTotal: Number.isFinite(netTotal) ? netTotal : null,
    zeroCross,
    regime,
    peakStrike: peak ? peak.strike : null,
    troughStrike: trough ? trough.strike : null,
  };
}

/** One side-relative level for the stat row. */
export interface GexSideLevel {
  strike: number;
  netGex: number;
  kind: "support" | "resistance" | "fuel";
  side: "below" | "above";
}

/** Support/fuel below spot and resistance/fuel above spot. */
interface GexSideLevels {
  below: GexSideLevel | null;
  above: GexSideLevel | null;
}

/**
 * Largest positive (pin) if any, else most negative (fuel), on one side.
 * Entries below `minAbs` are noise: a +0.07 Cr wing is not a pin magnet just
 * because it is the only positive strike on that side.
 */
function sideLevel(
  points: GexProfilePoint[],
  side: "below" | "above",
  minAbs: number,
): GexSideLevel | null {
  const positive = points.filter((p) => p.netGex > 0 && p.netGex >= minAbs);
  if (positive.length > 0) {
    const best = positive.reduce((a, b) => (b.netGex > a.netGex ? b : a));
    return {
      ...best,
      kind: side === "below" ? "support" : "resistance",
      side,
    };
  }
  const negative = points.filter((p) => p.netGex < 0 && -p.netGex >= minAbs);
  if (negative.length > 0) {
    const worst = negative.reduce((a, b) => (b.netGex < a.netGex ? b : a));
    return { ...worst, kind: "fuel", side };
  }
  return null;
}

/**
 * Spot-relative support / resistance for the stat row.
 *
 * A positive-gamma strike is a pin magnet, but which level it is depends on
 * where it sits: above spot it caps rallies (resistance), below spot it is
 * bought (support). A negative-gamma strike accelerates moves on its side and
 * is **fuel, never support/resistance** — the old code called the global
 * minimum "resistance" even when it sat below spot (22,700 under a 22,952
 * spot on 2026-10-21).
 *
 * Uses the backend `levels` block when it passes the gates below, otherwise
 * derives the levels from the strike profile. Older snapshots (recorded before
 * `levels` existed, or by a build without the gates) therefore replay with the
 * corrected labels too. A strike must carry ≥10% of the profile's peak
 * |netGex| and sit within 5% of spot, otherwise the side is null (rendered as
 * `—`) rather than promoting a near-zero wing.
 */
export function gexSideLevels(
  gex: NiftyGex | undefined,
  spot: number,
): GexSideLevels {
  const spotF = Number(spot);
  const finiteSpot = Number.isFinite(spotF);
  const profile = buildGexProfile(gex);
  const peakAbs = profile.reduce((m, p) => Math.max(m, Math.abs(p.netGex)), 0);
  const minAbs = peakAbs * GEX_LEVEL_MIN_SHARE;
  const maxDist = finiteSpot ? Math.abs(spotF) * GEX_LEVEL_MAX_DIST_PCT : Infinity;

  /** Same gates as the backend: right side, near enough, big enough. */
  const qualifies = (
    raw: { strike: number; netGex: number } | null | undefined,
    side: "below" | "above",
  ): { strike: number; netGex: number } | null => {
    if (!raw) return null;
    if (finiteSpot) {
      if (side === "below" ? raw.strike > spotF : raw.strike < spotF) return null;
      if (Math.abs(raw.strike - spotF) > maxDist) return null;
    }
    if (peakAbs > 0 && Math.abs(raw.netGex) < minAbs) return null;
    return raw;
  };

  const asLevel = (
    raw: { strike: number; netGex: number } | null,
    positiveKind: "support" | "resistance",
    side: "below" | "above",
  ): GexSideLevel | null =>
    raw
      ? {
          strike: raw.strike,
          netGex: raw.netGex,
          kind: raw.netGex > 0 ? positiveKind : "fuel",
          side,
        }
      : null;

  const near = finiteSpot
    ? profile.filter((p) => Math.abs(p.strike - spotF) <= maxDist)
    : profile;
  const derive = (side: "below" | "above"): GexSideLevel | null =>
    finiteSpot
      ? sideLevel(
          near.filter((p) =>
            side === "below" ? p.strike <= spotF : p.strike >= spotF,
          ),
          side,
          minAbs,
        )
      : null;

  // Stored payloads may carry a `levels` block written by an older build that
  // lacked the significance/distance gates (e.g. the +0.07 support). Re-check
  // every backend level here and fall back to the gated derivation when it
  // fails, so replaying those frames cannot resurrect the degenerate label.
  const levels = gex?.levels;
  if (levels) {
    return {
      below:
        asLevel(qualifies(levels.support, "below"), "support", "below") ??
        asLevel(qualifies(levels.fuelDown, "below"), "support", "below") ??
        derive("below"),
      above:
        asLevel(qualifies(levels.resistance, "above"), "resistance", "above") ??
        asLevel(qualifies(levels.fuelUp, "above"), "resistance", "above") ??
        derive("above"),
    };
  }

  return { below: derive("below"), above: derive("above") };
}
