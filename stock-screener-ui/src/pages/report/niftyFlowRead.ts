
import type {
  NiftyControlVerdict,
  NiftyFlowLeg,
  NiftyFlowWindow,
} from "@/types/niftyReport";

export interface OiPoint {
  t: string;
  ce: number;
  pe: number;
  spot?: number | null;
  cePrem?: number | null;
  pePrem?: number | null;
}

export interface FlowRead {
  reason: string;
  bias: "bull" | "bear";
}

/** Default absolute noise floor for NIFTY (contracts) — legacy constant.
 *  Kept at 100k so existing callers (Nifty10sStrip, niftyPreMove) that don't
 *  pass per-report noise preserve NIFTY behavior. Per-symbol noise uses
 *  flowNoiseFor() which has a 50k internal floor + 0.1% relative. */
export const FLOW_NOISE = 100_000;
export const FLOW_NOISE_REL = 0.001;

const FLOW_NOISE_INTERNAL_FLOOR = 50_000;

export function flowNoiseFor(report: { strikes?: Array<{ ce?: { oi: number }; pe?: { oi: number } }> }): number {
  const strikes = report.strikes ?? [];
  let totalOi = 0;
  for (const s of strikes) {
    totalOi += (s.ce?.oi ?? 0) + (s.pe?.oi ?? 0);
  }
  return Math.max(FLOW_NOISE_INTERNAL_FLOOR, Math.round(totalOi * FLOW_NOISE_REL));
}

export function readFlow(
  d: { ce: number; pe: number },
  dPremCe: number | null,
  dPremPe: number | null,
  noise: number = FLOW_NOISE,
): FlowRead | null {
  const ceMoved = Math.abs(d.ce) >= noise;
  const peMoved = Math.abs(d.pe) >= noise;
  if (!ceMoved && !peMoved) return null;
  const side = ceMoved && (!peMoved || Math.abs(d.ce) >= Math.abs(d.pe)) ? "ce" : "pe";
  const doi = side === "ce" ? d.ce : d.pe;
  const dprem = side === "ce" ? dPremCe : dPremPe;

  if (dprem == null) {
    if (side === "ce") {
      return doi < 0
        ? { reason: "calls unwound", bias: "bull" }
        : { reason: "calls added", bias: "bear" };
    }
    return doi > 0
      ? { reason: "puts added", bias: "bull" }
      : { reason: "puts unwound", bias: "bear" };
  }

  const up = doi > 0;
  const premUp = dprem > 0;
  if (side === "ce") {
    if (up && premUp) return { reason: "calls bought", bias: "bull" };
    if (up && !premUp) return { reason: "calls sold", bias: "bear" };
    if (!up && premUp) return { reason: "calls bought back", bias: "bull" };
    return { reason: "calls closed", bias: "bear" };
  }
  if (up && premUp) return { reason: "puts bought", bias: "bear" };
  if (up && !premUp) return { reason: "puts sold", bias: "bull" };
  if (!up && premUp) return { reason: "puts bought back", bias: "bear" };
  return { reason: "puts closed", bias: "bull" };
}

export function indexAgo(points: OiPoint[], i: number, sec: number): number {
  const t = Date.parse(points[i].t);
  let j = i;
  while (j > 0 && t - Date.parse(points[j].t) < sec * 1000) j--;
  return j;
}

export function rollingRead(points: OiPoint[], i: number, noise: number = FLOW_NOISE): FlowRead | null {
  const j = indexAgo(points, i, 60);
  const d = { ce: points[i].ce - points[j].ce, pe: points[i].pe - points[j].pe };
  const cePrem = points[i].cePrem ?? null;
  const baseCe = points[j].cePrem ?? null;
  const pePrem = points[i].pePrem ?? null;
  const basePe = points[j].pePrem ?? null;
  return readFlow(
    d,
    cePrem != null && baseCe != null ? cePrem - baseCe : null,
    pePrem != null && basePe != null ? pePrem - basePe : null,
    noise,
  );
}

export function premiumResidual(
  premNow: number | null | undefined,
  premPrev: number | null | undefined,
  spotNow: number | null | undefined,
  spotPrev: number | null | undefined,
  side: "ce" | "pe",
  atmDelta = 0.5,
): number | null {
  if (premNow == null || premPrev == null || spotNow == null || spotPrev == null) return null;
  if (!(premNow > 0) || !(premPrev > 0)) return null;
  const implied = (side === "ce" ? 1 : -1) * atmDelta * (spotNow - spotPrev);
  return (premNow - premPrev - implied) / premPrev;
}


export type FlowTone = "bull" | "bear" | "mixed" | "flat";

export interface FlowLastFlip {
  at: string;
  reason: string;
}

export interface FlowTapeRow {
  t: string;
  ce_oi?: number | null;
  pe_oi?: number | null;
}

export function flowWindowFromTape(
  rows: FlowTapeRow[] | null | undefined,
  cutoff?: string | null,
): NiftyFlowWindow | null {
  const clean = (rows ?? [])
    .filter((r) => r && typeof r.t === "string" && r.t)
    .sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const cutoffMs = cutoff ? Date.parse(cutoff) : NaN;
  const inWindow = Number.isFinite(cutoffMs)
    ? clean.filter((r) => {
        const ms = Date.parse(r.t);
        return Number.isFinite(ms) && ms <= cutoffMs;
      })
    : clean;
  if (inWindow.length < 2) return null;
  const last = inWindow[inWindow.length - 1];
  const lastMs = Date.parse(last.t);
  const lastCe = Number(last.ce_oi);
  const lastPe = Number(last.pe_oi);
  if (!Number.isFinite(lastMs) || !Number.isFinite(lastCe) || !Number.isFinite(lastPe)) {
    return null;
  }
  const leg = (minutes: number) => {
    const cutMs = lastMs - minutes * 60_000;
    let base = inWindow[0];
    let best = Number.POSITIVE_INFINITY;
    for (const r of inWindow) {
      const ms = Date.parse(r.t);
      if (!Number.isFinite(ms)) continue;
      const d = Math.abs(ms - cutMs);
      if (d < best) {
        best = d;
        base = r;
      }
    }
    const baseCe = Number(base.ce_oi);
    const basePe = Number(base.pe_oi);
    if (!Number.isFinite(baseCe) || !Number.isFinite(basePe)) return null;
    const ce = Math.round(lastCe - baseCe);
    const pe = Math.round(lastPe - basePe);
    return { from: base.t, ce, pe, net: ce - pe };
  };
  const m5 = leg(5);
  const m15 = leg(15);
  if (!m5 && !m15) return null;
  return {
    as_of: last.t,
    ...(m5 ? { "5m": m5 } : {}),
    ...(m15 ? { "15m": m15 } : {}),
  };
}

export function flowFlipClock(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const time = iso.includes("T") ? iso.split("T")[1] ?? "" : iso;
  const hhmm = /^(\d{2}):(\d{2})/.exec(time);
  return hhmm ? `${hhmm[1]}:${hhmm[2]}` : null;
}

/** Compact signed contracts: +3.3M / −0.9M / +646K. */
export function fmtFlowOi(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const abs = Math.abs(value);
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${Math.round(abs / 1e3)}K`;
  return `${sign}${Math.round(abs)}`;
}

/** ₹ crore flow with Indian grouping and an explicit sign. */
export function fmtFlowCr(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}₹${Math.round(Math.abs(value)).toLocaleString("en-IN")}cr`;
}

/**
 * Classify a rolling OI leg WITHOUT claiming who bought or wrote it (OI alone
 * cannot tell buyer from writer). A call build with put unwind is a bid;
 * the opposite is an offer/hedge.
 */
export function classifyFlowLeg(leg: NiftyFlowLeg | null | undefined): {
  label: string;
  tone: FlowTone;
} {
  if (!leg || !Number.isFinite(leg.ce) || !Number.isFinite(leg.pe)) {
    return { label: "—", tone: "flat" };
  }
  if (leg.ce > 0 && leg.pe < 0) return { label: "CALL BID", tone: "bull" };
  if (leg.ce < 0 && leg.pe > 0) return { label: "PUT BID", tone: "bear" };
  if (leg.ce > 0 && leg.pe > 0) return { label: "BOTH BUILD", tone: "mixed" };
  if (leg.ce < 0 && leg.pe < 0) return { label: "BOTH UNWIND", tone: "mixed" };
  return { label: "FLAT", tone: "flat" };
}

/** Session premium flow → direction. Kept separate from the OI legs. */
export function sessionTone(verdict: NiftyControlVerdict | null | undefined): FlowTone {
  if (verdict === "call_buyers" || verdict === "put_writers") return "bull";
  if (verdict === "call_writers" || verdict === "put_buyers") return "bear";
  return "flat";
}

export interface FlowFlip {
  flipped: boolean;
  /** Which comparison flipped: the short leg against the medium leg, or the
   *  short leg against the session premium flow. */
  reason: "5m vs 15m" | "5m vs session" | null;
}

export function detectFlowFlip(
  leg5: NiftyFlowLeg | null | undefined,
  leg15: NiftyFlowLeg | null | undefined,
  session: FlowTone,
): FlowFlip {
  const s5 = leg5 && Number.isFinite(leg5.net) ? Math.sign(leg5.net) : 0;
  const s15 = leg15 && Number.isFinite(leg15.net) ? Math.sign(leg15.net) : 0;
  if (s5 !== 0 && s15 !== 0 && s5 !== s15) return { flipped: true, reason: "5m vs 15m" };
  const ss = session === "bull" ? 1 : session === "bear" ? -1 : 0;
  if (s5 !== 0 && ss !== 0 && s5 !== ss) return { flipped: true, reason: "5m vs session" };
  return { flipped: false, reason: null };
}

/** Persisted flip lifetime — a flip older than this is no longer shown. */
export const FLIP_TTL_MS = 30 * 60 * 1000;

/** Seed for the poll-to-poll watcher (sign of `5m.net` + current flip flag). */
export interface FlipWatchState {
  sign: number;
  flipped: boolean;
}

/**
 * Compare the current 5m leg with the previous poll. The FIRST observation
 * only seeds the watcher — a page load must never manufacture a flip. A flip
 * is recorded when the 5m net sign changes, or when the 5m leg newly
 * disagrees with the 15m leg / session premium read.
 */
export function detectFlipChange(
  prev: FlipWatchState | null,
  leg5: NiftyFlowLeg | null | undefined,
  leg15: NiftyFlowLeg | null | undefined,
  session: FlowTone,
  at: string,
): { state: FlipWatchState; flip: FlowLastFlip | null } {
  const sign = leg5 && Number.isFinite(leg5.net) ? Math.sign(leg5.net) : 0;
  const flip = detectFlowFlip(leg5, leg15, session);
  const state: FlipWatchState = { sign, flipped: flip.flipped };
  if (prev === null) return { state, flip: null };

  const turned = sign !== 0 && prev.sign !== 0 && sign !== prev.sign;
  let reason: string | null = null;
  if (turned) {
    reason = flip.flipped
      ? flip.reason
      : `5m net turned ${sign > 0 ? "CALL-led" : "PUT-led"}`;
  } else if (flip.flipped && !prev.flipped) {
    reason = flip.reason;
  }
  return { state, flip: reason ? { at, reason } : null };
}

/** One localStorage key per symbol/mode/date so a reload keeps the day's flip. */
export function flipStorageKey(symbol: string, mode: string, date: string): string {
  return `nifty.lastFlip.${symbol}|${mode}|${date || "live"}`;
}

/** Read a persisted flip, discarding anything older than `FLIP_TTL_MS`. */
export function loadStoredFlip(key: string, now = Date.now()): FlowLastFlip | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FlowLastFlip & { savedAt: number }>;
    if (typeof parsed.at !== "string" || typeof parsed.reason !== "string") return null;
    const eventMs = Date.parse(parsed.at);
    const savedMs = typeof parsed.savedAt === "number" ? parsed.savedAt : NaN;
    const base = Number.isFinite(eventMs) ? eventMs : savedMs;
    if (!Number.isFinite(base) || now - base > FLIP_TTL_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    return { at: parsed.at, reason: parsed.reason };
  } catch {
    return null;
  }
}

/** Persist a flip. Storage failures (private mode/quota) are non-fatal. */
export function saveStoredFlip(key: string, flip: FlowLastFlip, now = Date.now()): void {
  try {
    window.localStorage.setItem(key, JSON.stringify({ ...flip, savedAt: now }));
  } catch {
    /* localStorage can be blocked */
  }
}