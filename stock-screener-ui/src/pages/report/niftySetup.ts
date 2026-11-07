import { formatNumberIN } from "@/utils/ui-helpers";
import type { NiftyGex, NiftyPivots, NiftyStrike, NiftyWall } from "@/types/niftyReport";
import type { PressureSeries } from "./niftyPressure";
import { PRESSURE_BURST_RATIO } from "./niftyPressure";
import { safeNum, median } from "@/utils/reportParsers";
import { resolveWallBoard } from "./niftyWallsFormat";
import type { SymbolMetrics } from "./symbolMetrics";

export type SetupGateKey = "COIL" | "TREND" | "RVOL" | "LEVEL" | "WALL" | "GAMMA" | "FUEL";
export type SetupState = "QUIET" | "ARMED" | "TRIGGER";

export interface SetupGate {
  key: SetupGateKey;
  pass: boolean;
  /** Human sentence for the tooltip. */
  detail: string;
}

export interface SetupRead {
  gates: SetupGate[];
  score: number;
  state: SetupState;
}

export interface SetupInput {
  /** Tape rows (spot per minute) for the session so far. */
  rows: Array<{ t: string; spot?: number }>;
  spot?: number | null;
  wallsNear?: { calls?: NiftyWall[] | null; puts?: NiftyWall[] | null } | null;
  walls?: { calls?: NiftyWall[] | null; puts?: NiftyWall[] | null } | null;
  strikes?: NiftyStrike[] | null;
  pressure?: PressureSeries | null;
  /** Dealer-gamma block — SHORT gamma at spot means moves accelerate. */
  gex?: NiftyGex | null;
  /** Classic pivots — a gate for "price is sitting on a level". */
  pivots?: NiftyPivots | null;
  /** Prior session high/low — the other level a breakout needs to clear. */
  prevDay?: { high?: number | null; low?: number | null } | null;
  /** Symbol-aware thresholds — required; never fall back to NIFTY defaults. */
  metrics: SymbolMetrics;
}

/** Coil: current 30-min range vs the median 30-min range of the session. */
export const COIL_MAX_RATIO = 0.7;
/** Legacy wall gate constants (NIFTY-calibrated). Kept for backward compatibility. */
export const WALL_MAX_DISTANCE = 100;
export const WALL_MIN_OI = 10_000_000;
/** Legacy level gate constant (NIFTY-calibrated). Kept for backward compatibility. */
export const LEVEL_MAX_DISTANCE = 60;

function ema(values: number[], span: number): number {
  if (values.length === 0) return 0;
  const k = 2 / (span + 1);
  let e = values[0];
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function blockRanges(spots: number[], size = 30): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < spots.length; i += size) {
    const block = spots.slice(i, i + size);
    if (block.length >= 10) out.push(Math.max(...block) - Math.min(...block));
  }
  return out;
}

export function setupRadar(input: SetupInput): SetupRead {
  const spot = safeNum(input.spot);
  const rows = (input.rows ?? [])
    .filter((r) => r && typeof r.t === "string")
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const spots = rows.map((r) => safeNum(r.spot)).filter((v) => v > 0);

  const metrics = input.metrics;
  const wallMaxDistance = metrics.wallMaxDist;
  const wallMinOi = metrics.wallMinOi;
  const levelMaxDistance = metrics.levelMaxDist;

  // COIL — the last 30 minutes compressed relative to the session's own blocks.
  const recent = spots.slice(-30);
  const recentRange = recent.length >= 10 ? Math.max(...recent) - Math.min(...recent) : 0;
  const baseRange = median(blockRanges(spots));
  const coilRatio = baseRange > 0 ? recentRange / baseRange : 0;
  const coilPass = baseRange > 0 && coilRatio > 0 && coilRatio <= COIL_MAX_RATIO;

  // TREND — above the 30-min average and a rising short EMA.
  const twap = recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const ema9 = ema(spots, 9);
  const ema20 = ema(spots, 20);
  const trendPass = twap > 0 && spot > twap && ema9 > ema20;

  // RVOL — the pressure series owns the volume math.
  const rvol = input.pressure?.last3Ratio ?? 0;
  const rvolPass = rvol >= PRESSURE_BURST_RATIO;

  // WALL — the nearest call wall above spot, close and heavy.
  const source = resolveWallBoard(input.wallsNear, input.walls);
  const callWalls = (source?.calls ?? []).filter(
    (w) => Number.isFinite(safeNum(w?.strike)) && safeNum(w?.strike) > spot,
  );
  const wall = callWalls
    .map((w) => ({ strike: safeNum(w.strike), oi: safeNum(w.oi) }))
    .sort((a, b) => a.strike - b.strike)[0] ?? null;
  const wallDistance = wall ? wall.strike - spot : Infinity;
  const wallPass = !!wall && wallDistance <= wallMaxDistance && wall.oi >= wallMinOi;

  // LEVEL — price sitting on a pivot or the prior session's high/low.
  const levels = [
    input.pivots?.pp,
    input.pivots?.r1,
    input.pivots?.s1,
    input.prevDay?.high,
    input.prevDay?.low,
  ]
    .map(safeNum)
    .filter((v) => v > 0);
  const nearestLevel = levels.length
    ? levels.reduce((best, l) => (Math.abs(l - spot) < Math.abs(best - spot) ? l : best), levels[0])
    : null;
  const levelDistance = nearestLevel != null ? Math.abs(nearestLevel - spot) : Infinity;
  const levelPass = nearestLevel != null && levelDistance <= levelMaxDistance;

  // GAMMA — dealers short gamma amplify a break instead of damping it.
  const regime = String(input.gex?.regime ?? "").trim().toLowerCase();
  const gammaPass = regime === "short";

  // FUEL — that wall's call OI is being covered (SC/LU), not defended (SB).
  const wallRow = wall
    ? (input.strikes ?? []).find(
        (s) => Math.round(safeNum(s.strike)) === Math.round(wall.strike),
      )
    : undefined;
  const sentiment = String(wallRow?.ce?.sentiment ?? "").trim().toUpperCase();
  const fuelPass =
    sentiment === "SC" ||
    sentiment === "SHORT COVER" ||
    sentiment === "LU" ||
    sentiment === "LONG UNWIND";

  const gates: SetupGate[] = [
    {
      key: "COIL",
      pass: coilPass,
      detail: baseRange
        ? `30-min range ${Math.round(recentRange)} pts vs ${Math.round(baseRange)} typical (${coilRatio.toFixed(2)}×, ≤${COIL_MAX_RATIO} = coil)`
        : "not enough tape for a range baseline",
    },
    {
      key: "TREND",
      pass: trendPass,
      detail: twap
        ? `spot ${spot.toFixed(1)} vs TWAP30 ${twap.toFixed(1)}; EMA9 ${ema9.toFixed(1)} vs EMA20 ${ema20.toFixed(1)}`
        : "no spot series yet",
    },
    {
      key: "RVOL",
      pass: rvolPass,
      detail: rvol
        ? `last 3-min option volume ${rvol.toFixed(1)}× the 20-min median (≥${PRESSURE_BURST_RATIO}× = participation)`
        : "no volume baseline yet",
    },
    {
      key: "LEVEL",
      pass: levelPass,
      detail:
        nearestLevel != null
          ? `nearest level ${formatNumberIN(Math.round(nearestLevel))} is ${Math.round(levelDistance)} pts away (≤${levelMaxDistance} = at a level)`
          : "no pivots or prior session range",
    },
    {
      key: "WALL",
      pass: wallPass,
      detail: wall
        ? `${formatNumberIN(wall.strike)} call wall ${Math.round(wallDistance)} pts above, OI ${(wall.oi / 1e6).toFixed(1)}M (needs ≤${wallMaxDistance} pts and ≥${(wallMinOi / 1e6).toFixed(0)}M)`
        : "no call wall above spot",
    },
    {
      key: "GAMMA",
      pass: gammaPass,
      detail: regime
        ? `dealers are ${regime.toUpperCase()} gamma at spot — ${gammaPass ? "hedging chases the move" : "hedging damps the move"}`
        : "gamma regime unavailable",
    },
    {
      key: "FUEL",
      pass: fuelPass,
      detail: sentiment
        ? `${wall ? formatNumberIN(wall.strike) : "wall"} call OI is ${sentiment} — covering fuels a break, Short Buildup caps it`
        : "wall sentiment unavailable",
    },
  ];

  const score = gates.filter((g) => g.pass).length;
  const total = gates.length;
  const state: SetupState = score === total ? "TRIGGER" : score >= total - 2 ? "ARMED" : "QUIET";
  return { gates, score, state };
}