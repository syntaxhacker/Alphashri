/**
 * Desk plan — a deterministic two-sided read of the live Nifty report.
 *
 * This module is deliberately pure: no network, no LLM, no clock. Every number
 * is derived from the report the caller already has, so the same payload always
 * produces the same plan (and the tests can pin it). The output mirrors the way
 * a desk argues both sides of a level:
 *
 *   Bear: "Don't buy puts into support — spot is 28 pts above 22,700, the PE
 *          already ran, IV/RV is rich. Do: wait for a 1-min close below 22,690,
 *          stop above resistance, target the next support."
 *   Bull: the symmetric version.
 *
 * Missing blocks are normal on old snapshots and partial payloads. Every helper
 * treats absent/non-finite values as `null`, and a reason is omitted when its
 * inputs are missing — this builder never throws.
 *
 * The module is split so each part stays readable:
 *   - `./deskPlanTypes`   — the data contract.
 *   - `./deskPlanLevels`  — the structural levels and the plan's thresholds.
 *   - `./deskPlanReasons` — one numeric sentence per reason bucket.
 *   - this file           — the entries, the "don't do this" list and the
 *                           plan builder that ties it all together.
 */

import type { NiftyReport } from "@/types/niftyReport";
import { gexRegimeAtSpot } from "./niftyGex";
import {
  CHASE_PTS,
  CHASE_PREMIUM_PCT,
  MIN_RR,
  MIN_STOP_PTS,
  PROJECT_R,
  RICH_IV_RV,
  STOP_BUFFER_PCT,
  computeLevels,
  fmtDeskNum,
  positive,
  round2,
  type Levels,
} from "./deskPlanLevels";
import {
  fiveMinMove,
  gammaReason,
  oiReason,
  premiumRun,
  readVol,
  structureReason,
  trendReason,
  volReason,
} from "./deskPlanReasons";
import type {
  DeskBias,
  DeskEntry,
  DeskPlan,
  DeskReason,
  DeskSide,
  DeskSideKey,
} from "./deskPlanTypes";

/** The plan's public surface — re-exported so callers have one import path. */
export { DESK_REASON_TAGS } from "./deskPlanTypes";
export type {
  DeskBias,
  DeskEntry,
  DeskEntryKind,
  DeskPlan,
  DeskReason,
  DeskReasonTag,
  DeskSide,
  DeskSideKey,
} from "./deskPlanTypes";
export { fmtDeskNum } from "./deskPlanLevels";

/** Reward:risk as one decimal; em dash when the plan has no measurable R:R. */
export function fmtDeskRr(rr: number | null | undefined): string {
  if (rr === null || rr === undefined || !Number.isFinite(rr) || rr <= 0) return "—";
  return rr.toFixed(1);
}

/**
 * The single directional verdict, exactly as specified by the desk.
 *
 * The gamma regime is read **spot-relative** (the sign of the cumulative net
 * gamma up to spot), never the raw payload flag: an older/stored payload can
 * carry `regime: "long"` from the book total while spot sits below the flip —
 * the plan then said BULLISH while the gamma strip said SHORT (the 09:36
 * contradiction). `gexRegimeAtSpot` re-derives it from the strike profile and
 * only falls back to the payload's own value when the profile does not cover
 * spot.
 */
export function deskBias(report: NiftyReport): DeskBias {
  const spot = positive(report.spot);
  const pp = positive(report.pivots?.pp);
  const ema20 = positive(report.strength?.ema20);
  const gex = report.gex;
  const backendRegime =
    gex?.regime && String(gex.regime).trim() ? String(gex.regime).trim() : "flat";
  const regime = gexRegimeAtSpot(gex, spot ?? 0, backendRegime);
  if (spot === null || pp === null || ema20 === null) return "neutral";
  if (spot < pp && spot < ema20 && regime === "short") return "bearish";
  if (spot > pp && spot > ema20 && regime === "long") return "bullish";
  return "neutral";
}

/** Invalidation distance: 8 index points or 0.08% of the level, whichever is wider. */
function stopBuffer(level: number): number {
  return Math.max(MIN_STOP_PTS, level * STOP_BUFFER_PCT);
}

/**
 * Pick the nearest structural level in the trade's direction that actually
 * pays `MIN_RR`. A level 10 points away against an 18-point stop is not a
 * target — skip it. When nothing pays, project `PROJECT_R` multiples of risk.
 */
function pickTarget(
  trigger: number,
  stop: number,
  candidates: Array<number | null | undefined>,
  direction: "up" | "down",
): number | null {
  const risk = Math.abs(stop - trigger);
  if (risk <= 0) return null;

  const valid: number[] = [];
  for (const raw of candidates) {
    const level = positive(raw);
    if (level === null) continue;
    if (direction === "up" ? level <= trigger : level >= trigger) continue;
    if (valid.includes(level)) continue;
    valid.push(level);
  }
  valid.sort((a, b) => (direction === "up" ? a - b : b - a));

  for (const target of valid) {
    if (Math.abs(target - trigger) / risk >= MIN_RR) return target;
  }

  const projected = direction === "up" ? trigger + PROJECT_R * risk : trigger - PROJECT_R * risk;
  return projected > 0 ? round2(projected) : null;
}

function rewardRisk(
  trigger: number | null,
  stop: number | null,
  target: number | null,
): number | null {
  if (trigger === null || stop === null || target === null) return null;
  const risk = Math.abs(stop - trigger);
  const reward = Math.abs(target - trigger);
  if (risk <= 0 || reward <= 0) return null;
  return Math.round((reward / risk) * 100) / 100;
}

/** Structural levels below the trigger: pivots, fuel-down, put walls, max pain. */
function downCandidates(report: NiftyReport, levels: Levels): number[] {
  const pivots = report.pivots ?? null;
  const gexLevels = report.gex?.levels;
  return [
    pivots?.s1,
    pivots?.s2,
    pivots?.s3,
    gexLevels?.fuelDown?.strike,
    ...levels.putWalls,
    levels.maxPain,
    levels.sessionLow,
  ].filter((level): level is number => typeof level === "number" && Number.isFinite(level));
}

/** Structural levels above the trigger: pivots, GEX resistance/fuel-up, call walls. */
function upCandidates(report: NiftyReport, levels: Levels): number[] {
  const pivots = report.pivots ?? null;
  const gexLevels = report.gex?.levels;
  return [
    pivots?.r1,
    pivots?.r2,
    pivots?.r3,
    gexLevels?.resistance?.strike,
    gexLevels?.fuelUp?.strike,
    ...levels.callWalls,
    levels.maxPain,
  ].filter((level): level is number => typeof level === "number" && Number.isFinite(level));
}

function emptyEntry(trigger: string): DeskEntry {
  return {
    kind: "none",
    trigger,
    triggerLevel: null,
    stop: null,
    target: null,
    rr: null,
  };
}

/** Bear primary: a 1-min close below support / the session low. */
function bearBreakEntry(report: NiftyReport, levels: Levels): DeskEntry {
  const trigger = levels.downsideBreak;
  if (trigger === null) return emptyEntry("wait for pivots/GEX levels to print");

  const stop = round2(trigger + stopBuffer(trigger));
  const target = pickTarget(trigger, stop, downCandidates(report, levels), "down");
  const source = trigger === levels.sessionLow ? "below session low" : "below support";
  return {
    kind: "break",
    trigger: `1-min close below ${fmtDeskNum(trigger)} (${source})`,
    triggerLevel: trigger,
    stop,
    target,
    rr: rewardRisk(trigger, stop, target),
  };
}

/** Bear counter-case: rejection at the nearest resistance above spot. */
function bearRejectionEntry(report: NiftyReport, levels: Levels): DeskEntry | null {
  const trigger = levels.resistance;
  if (trigger === null) return null;

  const stop = round2(trigger + stopBuffer(trigger));
  const target =
    levels.support !== null && levels.support < trigger
      ? levels.support
      : pickTarget(trigger, stop, downCandidates(report, levels), "down");
  return {
    kind: "rejection",
    trigger: `reject ${fmtDeskNum(trigger)}`,
    triggerLevel: trigger,
    stop,
    target,
    rr: rewardRisk(trigger, stop, target),
  };
}

/** Bull primary: a 1-min close above the nearest resistance. Never below spot. */
function bullBreakEntry(report: NiftyReport, levels: Levels): DeskEntry {
  const trigger = levels.resistance;
  if (trigger === null) return emptyEntry("wait for pivots/GEX levels to print");

  const stop = round2(trigger - stopBuffer(trigger));
  const target = pickTarget(trigger, stop, upCandidates(report, levels), "up");
  return {
    kind: "break",
    trigger: `1-min close above ${fmtDeskNum(trigger)}`,
    triggerLevel: trigger,
    stop,
    target,
    rr: rewardRisk(trigger, stop, target),
  };
}

/** Bull counter-case: support fails, price reclaims it. */
function bullFailedBreakdownEntry(report: NiftyReport, levels: Levels): DeskEntry | null {
  const trigger = levels.support;
  if (trigger === null) return null;

  const stop = round2(trigger - stopBuffer(trigger));
  const target =
    levels.resistance !== null && levels.resistance > trigger
      ? levels.resistance
      : pickTarget(trigger, stop, upCandidates(report, levels), "up");
  return {
    kind: "failed_breakdown",
    trigger: `failed breakdown at ${fmtDeskNum(trigger)}`,
    triggerLevel: trigger,
    stop,
    target,
    rr: rewardRisk(trigger, stop, target),
  };
}

function legName(side: DeskSideKey): "puts" | "calls" {
  return side === "bear" ? "puts" : "calls";
}

function buildDoNots(
  side: DeskSideKey,
  report: NiftyReport,
  levels: Levels,
  ratio: number | null,
): string[] {
  const out: string[] = [];
  const leg = legName(side);
  const level = side === "bear" ? levels.support : levels.resistance;
  const levelName = side === "bear" ? "support" : "resistance";
  const breakVerb = side === "bear" ? "below" : "above";

  if (level !== null) {
    if (ratio !== null && ratio > RICH_IV_RV) {
      out.push(
        `Don't buy ${leg} into ${fmtDeskNum(level)} ${levelName} with IV/RV ${ratio.toFixed(2)} (> ${RICH_IV_RV}) — premium is rich; wait for a 1-min close ${breakVerb}.`,
      );
    } else if (ratio !== null) {
      out.push(
        `Don't buy ${leg} into ${fmtDeskNum(level)} ${levelName} at IV/RV ${ratio.toFixed(2)} (< ${RICH_IV_RV}) — no vol edge; require a 1-min close ${breakVerb} first.`,
      );
    } else {
      out.push(
        `Don't buy ${leg} into ${fmtDeskNum(level)} ${levelName} before a 1-min close ${breakVerb}.`,
      );
    }
  }

  const chase: string[] = [];
  const move = fiveMinMove(report.intraday);
  if (move !== null && (side === "bear" ? move <= -CHASE_PTS : move >= CHASE_PTS)) {
    chase.push(`spot ${move > 0 ? "+" : ""}${move.toFixed(0)} pts in 5 min`);
  }
  const premium = premiumRun(report, side === "bear" ? "pe" : "ce");
  if (premium !== null && premium.pct >= CHASE_PREMIUM_PCT) {
    chase.push(
      `${leg === "puts" ? "PE" : "CE"} ${premium.open.toFixed(1)}→${premium.ltp.toFixed(1)} (+${premium.pct.toFixed(1)}%)`,
    );
  }
  if (chase.length > 0) {
    out.push(
      `Don't chase after the move: ${chase.join(" and ")} — wait for the retest.`,
    );
  }

  out.push(
    "Don't stack a third long-premium leg — two legs max, risk ≤ 1% of capital.",
  );
  return out;
}

function buildSide(
  side: DeskSideKey,
  planBias: DeskBias,
  report: NiftyReport,
  levels: Levels,
): DeskSide {
  const isBear = side === "bear";
  const ratioIv = readVol(report).ratio;
  const active = planBias === (isBear ? "bearish" : "bullish");

  const primary = isBear
    ? bearBreakEntry(report, levels)
    : bullBreakEntry(report, levels);
  const alternate = isBear
    ? bearRejectionEntry(report, levels)
    : bullFailedBreakdownEntry(report, levels);

  const reasons = [
    trendReason(report, side, levels.spot),
    gammaReason(report, levels.spot),
    oiReason(report, side),
    volReason(report),
    structureReason(report, side, levels),
  ].filter((reason): reason is DeskReason => reason !== null);

  const directionalAction = isBear
    ? "Sell rallies / buy puts on a failed retest"
    : "Buy dips / buy calls on a reclaim";

  return {
    side,
    bias: active ? planBias : "neutral",
    action: planBias === "neutral" ? "Wait" : directionalAction,
    entryKind: primary.kind,
    entryTrigger: primary.trigger,
    triggerLevel: primary.triggerLevel,
    stop: primary.stop,
    target: primary.target,
    rr: primary.rr,
    alternate,
    doNots: buildDoNots(side, report, levels, ratioIv),
    reasons,
  };
}

/**
 * Build both sides of the desk plan from the live report. Pure and total:
 * a report missing `gex`, `pivots`, `strikes` (or all of them) still returns a
 * NEUTRAL plan with whatever reasons its remaining blocks can support.
 */
export function buildDeskPlan(report: NiftyReport): DeskPlan {
  const levels = computeLevels(report);
  const bias = deskBias(report);
  return {
    bias,
    spot: levels.spot,
    support: levels.support,
    resistance: levels.resistance,
    downsideBreak: levels.downsideBreak,
    waitNote: buildWaitNote(levels),
    bull: buildSide("bull", bias, report, levels),
    bear: buildSide("bear", bias, report, levels),
  };
}

/** One-line neutral instruction: the two levels that would start a trade. */
function buildWaitNote(levels: Levels): string {
  const up = levels.resistance;
  const down = levels.downsideBreak;
  if (up !== null && down !== null) {
    return `Wait for a reclaim of ${fmtDeskNum(up)} or a close below ${fmtDeskNum(down)}.`;
  }
  if (up !== null) return `Wait for a reclaim of ${fmtDeskNum(up)}.`;
  if (down !== null) return `Wait for a close below ${fmtDeskNum(down)}.`;
  return "Wait for pivots/GEX levels to print.";
}
