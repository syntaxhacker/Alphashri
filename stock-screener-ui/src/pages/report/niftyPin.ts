import { formatNumberIN } from "@/utils/ui-helpers";
import { resolveWallBoard } from "./niftyWallsFormat";
import type { NiftyWall } from "@/types/niftyReport";
import type { SymbolMetrics } from "./symbolMetrics";

export type PinLevel = "HIGH" | "MEDIUM" | "LOW";

/** Legacy constants (NIFTY-calibrated). Kept for backward compatibility. */
export const PIN_EDGE_HIGH_PTS = 50;
export const PIN_EDGE_MEDIUM_PTS = 100;
export const PIN_PAIN_PTS = 100;
/** Walls that may set the edge: from half the heaviest OI up. */
export const PIN_WALL_MIN_OI_FRACTION = 0.5;

export interface PinInput {
  spot?: number | null;
  maxPain?: number | null;
  /** Heaviest OI within ±300 pts of spot — preferred when present. */
  wallsNear?: { calls?: NiftyWall[] | null; puts?: NiftyWall[] | null } | null;
  /** Full wall board — fallback for payloads without `wallsNear`. */
  walls?: { calls?: NiftyWall[] | null; puts?: NiftyWall[] | null } | null;
  /** Symbol-aware thresholds — required; never fall back to NIFTY defaults. */
  metrics: SymbolMetrics;
}

export interface PinRead {
  level: PinLevel;
  /** Signed points from spot to max pain (positive = max pain above spot). */
  maxPainDistance: number;
  /** Strike of the nearest significant wall, or `null`. */
  edgeStrike: number | null;
  /** Absolute points from spot to that wall, or `null`. */
  edgeDistance: number | null;
  /** Where the magnet sits relative to spot. */
  magnet: "above" | "below" | "at";
  /** True when spot sits between the heaviest put and call walls. */
  contained: boolean;
  /** One sentence for the tooltip — never rendered as a third text line. */
  detail: string;
}

/** Coerce to a finite number; absent / blank / NaN → NaN (never 0). */
function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return NaN;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Valid walls only — a missing strike or OI would poison the max. */
function validWalls(walls: NiftyWall[] | null | undefined): NiftyWall[] {
  return (walls ?? []).filter(
    (wall) => Number.isFinite(num(wall?.strike)) && Number.isFinite(num(wall?.oi)),
  );
}

/** Heaviest wall in a list (strike breaks an OI tie for determinism). */
function heaviest(walls: NiftyWall[]): NiftyWall | null {
  let best: NiftyWall | null = null;
  for (const wall of walls) {
    if (
      best === null ||
      num(wall.oi) > num(best.oi) ||
      (num(wall.oi) === num(best.oi) && num(wall.strike) > num(best.strike))
    ) {
      best = wall;
    }
  }
  return best;
}

/**
 * Classify the frame. Returns `null` when spot or max pain is missing — an
 * absent payload must render a dash, never a fabricated "LOW".
 */
export function pinRisk(input: PinInput): PinRead | null {
  const spot = num(input.spot);
  const maxPain = num(input.maxPain);
  if (!Number.isFinite(spot) || !Number.isFinite(maxPain) || spot <= 0) {
    return null;
  }

  const metrics = input.metrics;
  const pinEdgeHigh = metrics.pinEdgeHigh;
  const pinEdgeMedium = metrics.pinEdgeMedium;
  const pinPainPts = metrics.pinPainPts;

  const maxPainDistance = maxPain - spot;
  const absPain = Math.abs(maxPainDistance);
  const magnet: PinRead["magnet"] =
    Math.round(maxPainDistance) === 0
      ? "at"
      : maxPainDistance > 0
        ? "above"
        : "below";

  const source = resolveWallBoard(input.wallsNear, input.walls);
  const puts = validWalls(source?.puts);
  const calls = validWalls(source?.calls);
  const all = [...puts, ...calls];

  const heavyPut = heaviest(puts);
  const heavyCall = heaviest(calls);
  const heavyPutStrike = heavyPut ? num(heavyPut.strike) : NaN;
  const heavyCallStrike = heavyCall ? num(heavyCall.strike) : NaN;
  const contained =
    Number.isFinite(heavyPutStrike) &&
    Number.isFinite(heavyCallStrike) &&
    spot > heavyPutStrike &&
    spot < heavyCallStrike;

  // Pin significance is deliberately stricter than setup's wall gate: only
  // walls at least half the heaviest OI can define the pin edge. This is a
  // semantic difference (pin = dominant wall), not a scale bug.
  const maxOi = all.reduce((m, wall) => Math.max(m, num(wall.oi)), 0);
  const significant =
    maxOi > 0
      ? all.filter((wall) => num(wall.oi) >= maxOi * PIN_WALL_MIN_OI_FRACTION)
      : [];

  let edgeStrike: number | null = null;
  let edgeDistance: number | null = null;
  for (const wall of significant) {
    const strike = num(wall.strike);
    const distance = Math.abs(strike - spot);
    if (edgeDistance === null || distance < edgeDistance) {
      edgeStrike = strike;
      edgeDistance = distance;
    }
  }

  let level: PinLevel = "LOW";
  if (edgeDistance != null && absPain >= pinPainPts) {
    if (edgeDistance <= pinEdgeHigh) level = "HIGH";
    else if (edgeDistance <= pinEdgeMedium) level = "MEDIUM";
  }

  const painLabel = `${formatNumberIN(Math.round(maxPain))} is ${formatNumberIN(Math.round(
    absPain,
  ))} pts ${magnet} spot`;
  const edgeLabel =
    edgeStrike != null && edgeDistance != null
      ? `the ${formatNumberIN(Math.round(edgeStrike))} wall is ${formatNumberIN(Math.round(
          edgeDistance,
        ))} pts away`
      : "no significant wall is priced in this frame";
  const boxLabel = contained
    ? `spot is between the ${formatNumberIN(Math.round(heavyPutStrike))} put and ${formatNumberIN(Math.round(
        heavyCallStrike,
      ))} call walls`
    : Number.isFinite(heavyPutStrike) && spot <= heavyPutStrike
      ? `spot is below the ${formatNumberIN(Math.round(heavyPutStrike))} put wall`
      : Number.isFinite(heavyCallStrike) && spot >= heavyCallStrike
        ? `spot is above the ${formatNumberIN(Math.round(heavyCallStrike))} call wall`
        : "no two-sided wall box is priced in this frame";

  const detail =
    level === "HIGH"
      ? `PINNED — max pain ${painLabel}; ${edgeLabel} and ${boxLabel}. A break from here usually sweeps and reverts: sell the range, and only trust a break with two consecutive 1-min closes beyond the wall.`
      : level === "MEDIUM"
        ? `Pin risk building — max pain ${painLabel}; ${edgeLabel}; ${boxLabel}. Demand two consecutive 1-min closes before buying the break.`
        : `Not pinned — max pain ${painLabel}; ${edgeLabel}; ${boxLabel}.`;

  return {
    level,
    maxPainDistance,
    edgeStrike,
    edgeDistance,
    magnet,
    contained,
    detail,
  };
}

/** Compact visible hint next to the level, e.g. `MP +208 · 22,500 (8)`. */
export function pinHint(read: PinRead | null): string {
  if (!read) return "spot / max pain missing";
  const pain = `${read.maxPainDistance > 0 ? "+" : ""}${Math.round(
    read.maxPainDistance,
  )}`;
  if (read.edgeStrike == null || read.edgeDistance == null) {
    return `MP ${pain} · no wall`;
  }
  const edge = `${formatNumberIN(Math.round(read.edgeStrike))} (${Math.round(
    read.edgeDistance,
  )})`;
  return `MP ${pain} · ${edge}`;
}