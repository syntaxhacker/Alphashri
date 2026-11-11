/**
 * Option-volume pressure — pure, no React, no clock, no network.
 *
 * The tape stores cumulative CE/PE premium volume per minute. The signal that
 * led the 2026-10-23 13:37 squeeze by four minutes was not OI (calls were being
 * *sold*) but **volume**: CE volume went 3.7M → 17.5M at 13:33 while price was
 * still inside a 46-pt coil. By the breakout minute it was 34M, then 65M.
 *
 * So the desk reads volume relative to its OWN recent baseline, not against a
 * daily total: a bar at ≥2× the 20-minute median is participation, ≥4× is a
 * climax. Absolute millions are meaningless without that baseline.
 */

import { chainLeg } from "./chainTuple";

export interface PressureTapeRow {
  t: string;
  /** Cumulative premium volume from the session start (CE / PE). */
  ce_vol?: number | null;
  pe_vol?: number | null;
  /** Older tapes carry per-strike volumes instead of the totals. */
  chain?: Record<string, Array<number | null>>;
  /** Spot at this minute — needed to strip the delta move out of premium. */
  spot?: number | null;
  /** This minute's OI change per leg (contracts). */
  call_doi?: number | null;
  put_doi?: number | null;
  /** ATM premium per leg (₹). Absent on older tapes → chain fallback. */
  atm_ce_ltp?: number | null;
  atm_pe_ltp?: number | null;
}

/**
 * Who was the aggressor on a leg this minute.
 *
 * Raw ATM premium direction is NOT usable: premium moves ≈ delta × spot, so on
 * a 20-point up-move the call is "up" and the put is "down" even if both were
 * being sold. We subtract the delta-implied move (ATM delta ≈ 0.5) and call the
 * residual the flow: richer than implied = aggressive BUY, cheaper = SELL.
 */
export type PressureFlow = "buy" | "sell" | null;

/** ATM delta used to strip the spot move out of the premium. */
export const PRESSURE_ATM_DELTA = 0.5;
/** Residual must exceed 0.5% of the premium to count as flow, not noise. */
export const PRESSURE_FLOW_EPS = 0.005;

export type PressureState = "normal" | "burst" | "climax";

export interface PressurePoint {
  /** HH:MM label. */
  t: string;
  /** CE contracts traded this minute. */
  ce: number;
  /** PE contracts traded this minute. */
  pe: number;
  /** |CE| + |PE| for the minute. */
  total: number;
  /** Rolling median of the previous `window` minutes (0 on the first bar). */
  base: number;
  /** total / base (0 when the base is unknown). */
  ratio: number;
  state: PressureState;
  /** Aggressor per leg this minute (null = no premium tape / no move). */
  ceFlow: PressureFlow;
  peFlow: PressureFlow;
}

export interface PressureFlowTotals {
  /** Contracts traded this session by aggressive buyers / sellers per leg. */
  ceBuy: number;
  ceSell: number;
  peBuy: number;
  peSell: number;
}

export interface PressureSeries {
  points: PressurePoint[];
  /** Median of all minute totals — the "normal" bar height. */
  median: number;
  /** Largest ratio in the session. */
  maxRatio: number;
  /** How many minutes printed ≥2×. */
  bursts: number;
  /** Mean ratio of the last three minutes (the radar's RVOL gate). */
  last3Ratio: number;
  /** Ratio of the final minute. */
  lastRatio: number;
  /** Session volume split by aggressor side (buy/sell per leg). */
  flow: PressureFlowTotals;
}

import { safeNum, median } from "@/utils/reportParsers";

export const PRESSURE_WINDOW = 20;
export const PRESSURE_BURST_RATIO = 2;
export const PRESSURE_CLIMAX_RATIO = 4;

/** Sum of a row's per-strike volumes (fallback for tapes without totals). */
function chainVolume(row: PressureTapeRow, side: "ce" | "pe"): number {
  const chain = row.chain;
  if (!chain) return 0;
  const idx = side === "ce" ? 4 : 5;
  let sum = 0;
  for (const tuple of Object.values(chain)) {
    if (!Array.isArray(tuple)) continue;
    const val = tuple[idx];
    if (val !== null && val !== undefined && Number.isFinite(val)) {
      sum += Math.abs(val);
    }
  }
  return sum;
}

/**
 * Premium for ONE fixed strike (chain = [ceLtp, peLtp, ceOi, peOi, ceVol, peVol]).
 *
 * The ATM premium cannot be used: the ATM strike rolls as spot moves, so the
 * series jumps by tens of rupees at every 50-point boundary and the residual
 * classifier reads the roll as a huge buy/sell. A fixed reference strike keeps
 * the series continuous — that is the whole point of the residual.
 */
function chainPremiums(
  row: PressureTapeRow,
  refStrike: number,
): { ce: number | null; pe: number | null } {
  const chain = row.chain;
  if (!chain || !(refStrike > 0)) return { ce: null, pe: null };
  const leg = chainLeg(chain, refStrike);
  return { ce: leg.ceLtp, pe: leg.peLtp };
}

/**
 * Aggressor for one leg: premium change minus the delta-implied change.
 * A richer-than-implied premium = buyers lifting offers (BUY); a cheaper one =
 * writers pressing offers (SELL).
 */
function legFlow(
  premNow: number | null,
  premPrev: number | null,
  spotNow: number | null,
  spotPrev: number | null,
  side: "ce" | "pe",
): PressureFlow {
  if (premNow == null || premPrev == null || spotNow == null || spotPrev == null) return null;
  if (!(premNow > 0) || !(premPrev > 0)) return null;
  const dSpot = spotNow - spotPrev;
  // CE gains with spot; PE loses with spot.
  const implied = (side === "ce" ? 1 : -1) * PRESSURE_ATM_DELTA * dSpot;
  const residual = premNow - premPrev - implied;
  const rel = residual / premPrev;
  if (rel > PRESSURE_FLOW_EPS) return "buy";
  if (rel < -PRESSURE_FLOW_EPS) return "sell";
  return null;
}

/**
 * Build the per-minute pressure series. Volume fields are cumulative, so the
 * minute delta is `cur - prev`; a reset (new session / bad row) clamps to 0
 * instead of printing a negative bar.
 */
export function buildPressure(
  rows: PressureTapeRow[],
  window = PRESSURE_WINDOW,
): PressureSeries {
  const asc = (rows ?? [])
    .filter((r) => r && typeof r.t === "string" && r.t.length > 0)
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));

  const deltas: {
    t: string;
    ce: number;
    pe: number;
    total: number;
    ceFlow: PressureFlow;
    peFlow: PressureFlow;
  }[] = [];
  // Fixed reference strike: nearest 50 to the session's MEDIAN spot. The median
  // (not the last print) keeps the strike near the money for most of the day,
  // so the 0.5 delta assumption stays honest; the last spot would make it a
  // deep-ITM contract by the close and inflate every residual.
  const spots = asc.map((r) => safeNum(r.spot)).filter((v) => v > 0);
  const refSpot = spots.length ? [...spots].sort((a, b) => a - b)[Math.floor(spots.length / 2)] : 0;
  const refStrike = refSpot > 0 ? Math.round(refSpot / 50) * 50 : 0;
  let prevCe = 0;
  let prevPe = 0;
  let prevSpot: number | null = null;
  let prevCePrem: number | null = null;
  let prevPePrem: number | null = null;
  for (const row of asc) {
    const ceCum = safeNum(row.ce_vol) || chainVolume(row, "ce");
    const peCum = safeNum(row.pe_vol) || chainVolume(row, "pe");
    const ce = prevCe > 0 ? Math.max(0, ceCum - prevCe) : Math.max(0, ceCum);
    const pe = prevPe > 0 ? Math.max(0, peCum - prevPe) : Math.max(0, peCum);
    prevCe = ceCum;
    prevPe = peCum;

    const spot = safeNum(row.spot) > 0 ? safeNum(row.spot) : null;
    const premium = chainPremiums(row, refStrike);
    const cePrem = premium.ce;
    const pePrem = premium.pe;
    const ceFlow = legFlow(cePrem, prevCePrem, spot, prevSpot, "ce");
    const peFlow = legFlow(pePrem, prevPePrem, spot, prevSpot, "pe");
    prevSpot = spot;
    prevCePrem = cePrem;
    prevPePrem = pePrem;

    const total = ce + pe;
    deltas.push({ t: row.t.slice(11, 16), ce, pe, total, ceFlow, peFlow });
  }

  const points: PressurePoint[] = deltas.map((d, i) => {
    const prior = deltas.slice(Math.max(0, i - window), i).map((x) => x.total);
    const base = prior.length > 0 ? median(prior) : 0;
    const ratio = base > 0 ? d.total / base : 0;
    const state: PressureState =
      ratio >= PRESSURE_CLIMAX_RATIO
        ? "climax"
        : ratio >= PRESSURE_BURST_RATIO
          ? "burst"
          : "normal";
    return { ...d, base, ratio, state };
  });

  const totals = deltas.map((d) => d.total);
  const last3 = points.slice(-3).map((p) => p.ratio).filter((r) => r > 0);
  const flow: PressureFlowTotals = { ceBuy: 0, ceSell: 0, peBuy: 0, peSell: 0 };
  for (const d of deltas) {
    if (d.ceFlow === "buy") flow.ceBuy += d.ce;
    else if (d.ceFlow === "sell") flow.ceSell += d.ce;
    if (d.peFlow === "buy") flow.peBuy += d.pe;
    else if (d.peFlow === "sell") flow.peSell += d.pe;
  }
  return {
    points,
    median: median(totals),
    maxRatio: points.reduce((m, p) => Math.max(m, p.ratio), 0),
    bursts: points.filter((p) => p.state !== "normal").length,
    last3Ratio: last3.length ? last3.reduce((a, b) => a + b, 0) / last3.length : 0,
    lastRatio: points.length ? points[points.length - 1].ratio : 0,
    flow,
  };
}
