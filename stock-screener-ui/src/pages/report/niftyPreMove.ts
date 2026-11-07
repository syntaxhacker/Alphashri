import { indexAgo, premiumResidual, rollingRead, type OiPoint } from "./niftyFlowRead";

/**
 * Pre-move score — the positioning read that precedes a squeeze.
 *
 * On 2026-10-26 the 13:19 call squeeze was visible 7 minutes early in the 10 s
 * chain (put writing 13:12:48 → call buying 13:16:56) while every price/volume
 * trigger stayed quiet. The blasts confirm; this score arms.
 *
 * Pure: no React, no clock, no network. The caller owns the "held for 2 reads"
 * gate and the alert cooldown.
 */

export interface PreMoveTapeRow {
  t: string;
  net_gex?: number | null;
}

export interface PreMoveInput {
  /** 10 s chain summaries (newest last). */
  points: OiPoint[];
  /** 1-minute tape rows (newest last) — only GEX is read. */
  rows?: PreMoveTapeRow[];
  /** Pressure series ratios (RVOL). */
  pressure?: { lastRatio?: number; last3Ratio?: number } | null;
  /** Session vol block: IV/RV > 1.2 means premium is rich, don't chase. */
  regime?: { rv?: number | null; iv?: number | null } | null;
}

export interface PreMoveComponent {
  key: string;
  label: string;
  points: number;
  detail: string;
}

export interface PreMoveScore {
  score: number;
  max: number;
  state: "armed" | "watch" | "quiet";
  components: PreMoveComponent[];
  /** Positive components in plain English, e.g. ["puts sold 2m", "calls bought"]. */
  reasons: string[];
}

import type { PreMovePoint } from "./niftyPreMoveHistory";

export const PREMOVE_ARMED = 5;
export const PREMOVE_WATCH = 3;

/** "Put writing persists" is a 5-minute question, not a 2-minute one. */
const STREAK_SAMPLES = 30;
const STREAK_MIN = 8;

function readAt(points: OiPoint[], i: number) {
  return rollingRead(points, i);
}

/**
 * Seed the history from the 10 s window the API already returns (15 min).
 *
 * Only the 10 s components are replayed (put writing / call build / premium):
 * GEX and RVOL are 1-minute series and would need a per-prefix rebuild. That
 * still captures the arming sequence — on 2026-10-26 those three alone scored
 * 5/9 at 13:10, nine minutes before the blast.
 */
export function seedPreMoveHistory(points: OiPoint[]): PreMovePoint[] {
  const out: PreMovePoint[] = [];
  if (!points || points.length < 10) return out;
  for (let i = 8; i < points.length; i++) {
    const s = scorePreMove({ points: points.slice(0, i + 1) });
    const t = Date.parse(points[i].t);
    if (!Number.isFinite(t)) continue;
    out.push({
      t,
      score: s.score,
      spot: points[i].spot ?? null,
      comps: s.components.filter((c) => c.points > 0).map((c) => c.key),
    });
  }
  return out;
}

export function scorePreMove(input: PreMoveInput): PreMoveScore {
  const points = (input.points ?? []).filter((p) => p && typeof p.t === "string");
  const components: PreMoveComponent[] = [];
  if (points.length < 8) {
    return { score: 0, max: 11, state: "quiet", components, reasons: [] };
  }

  const last = points.length - 1;

  // 1) Put writing persists: enough of the last 5 minutes reads "puts sold".
  let putSold = 0;
  let samples = 0;
  for (let i = Math.max(0, last - STREAK_SAMPLES + 1); i <= last; i++) {
    samples++;
    const r = readAt(points, i);
    if (r?.reason === "puts sold") putSold++;
  }
  if (samples > 0 && putSold >= STREAK_MIN) {
    components.push({
      key: "put-writing",
      label: "puts sold",
      points: 2,
      detail: `${putSold}/${samples} of the last 5 min`,
    });
  }

  // 2) Call OI builds over 2 minutes.
  const i2m = indexAgo(points, last, 120);
  const dCe = points[last].ce - points[i2m].ce;
  if (dCe >= 500_000) {
    components.push({
      key: "call-build",
      label: "calls bought",
      points: 2,
      detail: `CE OI +${(dCe / 1e6).toFixed(2)}M / 2m`,
    });
  }

  // 2b) Call short-covering: OI falls while premium is bid. This is the
  // squeeze fuel the build-only score missed on 2026-10-28: call writers
  // covered 6.6M of CE OI into the 12:58 move while the wall eroded.
  const cePremNow = points[last].cePrem;
  const cePremPrev = points[i2m].cePrem;
  if (
    dCe <= -500_000 &&
    cePremNow != null &&
    cePremPrev != null &&
    cePremNow - cePremPrev >= 1
  ) {
    components.push({
      key: "call-cover",
      label: "calls covered",
      points: 2,
      detail: `CE OI ${(dCe / 1e6).toFixed(2)}M / 2m, premium bid`,
    });
  }

  // 3) Call premium bid richer than the delta-implied move.
  const ceResidual = premiumResidual(
    points[last].cePrem,
    points[i2m].cePrem,
    points[last].spot,
    points[i2m].spot,
    "ce",
  );
  if (ceResidual != null && ceResidual > 0.01) {
    components.push({
      key: "call-premium",
      label: "calls bid",
      points: 1,
      detail: `premium ${(ceResidual * 100).toFixed(1)}% over implied`,
    });
  }

  // 4) Dealer gamma: positive and rising, or a fresh negative→positive flip.
  const rows = (input.rows ?? []).filter((r) => r && typeof r.net_gex === "number");
  if (rows.length >= 3) {
    const gexLast = Number(rows[rows.length - 1].net_gex);
    const gexPrev = Number(rows[Math.max(0, rows.length - 6)].net_gex);
    const flipped = gexLast > 0 && rows.slice(-6).some((r) => Number(r.net_gex) < 0);
    // "Positive all day" is not a signal (the EDA showed +1 on for hours);
    // only a fresh flip or a real 5-min rise counts.
    if (flipped || gexLast - gexPrev >= 10) {
      components.push({
        key: "gex",
        label: flipped ? "GEX flipped positive" : "GEX rising",
        points: 1,
        detail: `net GEX ${gexLast.toFixed(1)} (was ${gexPrev.toFixed(1)})`,
      });
    }
  }

  // 5) Participation: volume running above its own baseline.
  const rvol = Math.max(input.pressure?.last3Ratio ?? 0, input.pressure?.lastRatio ?? 0);
  if (rvol >= 1.8) {
    components.push({
      key: "rvol",
      label: "volume expanding",
      points: 1,
      detail: `${rvol.toFixed(1)}× the 20-min median`,
    });
  }

  // 6) Penalty: rich premium. Buying into IV/RV > 1.2 is the classic chase.
  const iv = input.regime?.iv ?? null;
  const rv = input.regime?.rv ?? null;
  if (iv != null && rv != null && rv > 0 && iv / rv > 1.2) {
    components.push({
      key: "iv-rich",
      label: "IV rich",
      points: -2,
      detail: `IV/RV ${(iv / rv).toFixed(2)}`,
    });
  }

  // Clamp: a penalty with nothing to penalise is still "quiet", not negative.
  const score = Math.max(0, components.reduce((sum, c) => sum + c.points, 0));
  const state = score >= PREMOVE_ARMED ? "armed" : score >= PREMOVE_WATCH ? "watch" : "quiet";
  return {
    score,
    max: 11,
    state,
    components,
    reasons: components.filter((c) => c.points > 0).map((c) => c.label),
  };
}
