
import { chainLeg } from "./chainTuple";

export interface PressureTapeRow {
  t: string;
  ce_vol?: number | null;
  pe_vol?: number | null;
  chain?: Record<string, Array<number | null>>;
  spot?: number | null;
  call_doi?: number | null;
  put_doi?: number | null;
  atm_ce_ltp?: number | null;
  atm_pe_ltp?: number | null;
}

export type PressureFlow = "buy" | "sell" | null;

export const PRESSURE_ATM_DELTA = 0.5;
export const PRESSURE_FLOW_EPS = 0.005;

export type PressureState = "normal" | "burst" | "climax";

export interface PressurePoint {
  t: string;
  ce: number;
  pe: number;
  total: number;
  base: number;
  ratio: number;
  state: PressureState;
  ceFlow: PressureFlow;
  peFlow: PressureFlow;
}

export interface PressureFlowTotals {
  ceBuy: number;
  ceSell: number;
  peBuy: number;
  peSell: number;
}

export interface PressureSeries {
  points: PressurePoint[];
  median: number;
  maxRatio: number;
  bursts: number;
  last3Ratio: number;
  lastRatio: number;
  flow: PressureFlowTotals;
}

import { safeNum, median } from "@/utils/reportParsers";

export const PRESSURE_WINDOW = 20;
export const PRESSURE_BURST_RATIO = 2;
export const PRESSURE_CLIMAX_RATIO = 4;

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

function chainPremiums(
  row: PressureTapeRow,
  refStrike: number,
): { ce: number | null; pe: number | null } {
  const chain = row.chain;
  if (!chain || !(refStrike > 0)) return { ce: null, pe: null };
  const leg = chainLeg(chain, refStrike);
  return { ce: leg.ceLtp, pe: leg.peLtp };
}

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
  const implied = (side === "ce" ? 1 : -1) * PRESSURE_ATM_DELTA * dSpot;
  const residual = premNow - premPrev - implied;
  const rel = residual / premPrev;
  if (rel > PRESSURE_FLOW_EPS) return "buy";
  if (rel < -PRESSURE_FLOW_EPS) return "sell";
  return null;
}

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
