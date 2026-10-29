/**
 * The desk plan's reason sentences — one numeric claim per bucket.
 *
 * Every builder is total: a reason is omitted (not thrown) when its inputs are
 * missing, so a partial payload still produces a readable plan.
 */

import type {
  NiftyIntradayCandle,
  NiftyOptionSide,
  NiftyReport,
  NiftyStrike,
} from "@/types/niftyReport";
import { gexFlipAtSpot, gexRegimeAtSpot } from "./niftyGex";
import {
  RICH_IV_RV,
  TOUCH_TOLERANCE_PCT,
  finite,
  fmtDeskNum,
  mean,
  positive,
  topWall,
  type Levels,
} from "./deskPlanLevels";
import type { DeskReason, DeskSideKey } from "./deskPlanTypes";
import { formatReportOiCr } from "./reportFormat";

interface SentimentCounts {
  total: number;
  ceWriters: number;
  peBuyers: number;
  putWriters: number;
  callBuyers: number;
}

/**
 * Count legs whose sentiment label says "short buildup" (a writer) or "long
 * buildup" (a buyer). The API normalizes the label to either a short code
 * (`SB`/`LB`) or the full text, so normalize both.
 */
function sentimentClass(side: NiftyOptionSide | undefined): "writer" | "buyer" | null {
  const raw = String(side?.sentiment ?? "").trim().toUpperCase();
  if (!raw) return null;
  if (raw === "SB" || raw.includes("SHORT BUILD") || raw.includes("BEARISH")) return "writer";
  if (raw === "LB" || raw.includes("LONG BUILD") || raw.includes("BULLISH")) return "buyer";
  return null;
}

function countSentiments(strikes: NiftyStrike[] | undefined): SentimentCounts {
  const rows = Array.isArray(strikes) ? strikes : [];
  const counts: SentimentCounts = {
    total: rows.length,
    ceWriters: 0,
    peBuyers: 0,
    putWriters: 0,
    callBuyers: 0,
  };
  for (const row of rows) {
    const ce = sentimentClass(row?.ce);
    const pe = sentimentClass(row?.pe);
    if (ce === "writer") counts.ceWriters += 1;
    if (ce === "buyer") counts.callBuyers += 1;
    if (pe === "writer") counts.putWriters += 1;
    if (pe === "buyer") counts.peBuyers += 1;
  }
  return counts;
}

/** Number of distinct visits to a level (consecutive bars count once). */
function countTouches(
  candles: NiftyIntradayCandle[] | undefined,
  level: number,
  field: "high" | "low",
): number {
  if (!Array.isArray(candles) || candles.length === 0) return 0;
  const tolerance = level * TOUCH_TOLERANCE_PCT;
  let visits = 0;
  let touching = false;
  for (const candle of candles) {
    const value = positive(candle?.[field]);
    const isTouch = value !== null && Math.abs(value - level) <= tolerance;
    if (isTouch && !touching) visits += 1;
    touching = isTouch;
  }
  return visits;
}

export function fiveMinMove(candles: NiftyIntradayCandle[] | undefined): number | null {
  if (!Array.isArray(candles) || candles.length < 6) return null;
  const last = positive(candles[candles.length - 1]?.close);
  const previous = positive(candles[candles.length - 6]?.close);
  if (last === null || previous === null) return null;
  return last - previous;
}

interface PremiumRun {
  open: number;
  ltp: number;
  pct: number;
}

export function premiumRun(report: NiftyReport, leg: "ce" | "pe"): PremiumRun | null {
  const reference = report.reference;
  if (!reference) return null;
  const open =
    leg === "ce" ? positive(reference.ce_open) : positive(reference.pe_open);
  const ltp =
    leg === "ce" ? positive(reference.ce_ltp) : positive(reference.pe_ltp);
  if (open === null || ltp === null) return null;
  return { open, ltp, pct: ((ltp - open) / open) * 100 };
}

/** "For the bear case:" / "Against the bull case:" — same numbers, side-aware. */
function frame(side: DeskSideKey, supports: boolean): string {
  if (supports) return `For the ${side} case: `;
  return `Against the ${side} case: `;
}

export function trendReason(
  report: NiftyReport,
  side: DeskSideKey,
  spot: number | null,
): DeskReason | null {
  const pp = positive(report.pivots?.pp);
  const ema20 = positive(report.strength?.ema20);
  const ema50 = positive(report.strength?.ema50);
  const rsi = finite(report.strength?.rsi);
  if (spot === null || (pp === null && ema20 === null && ema50 === null && rsi === null)) {
    return null;
  }

  const marks: string[] = [];
  const levels: number[] = [];
  if (pp !== null) {
    marks.push(`PP ${fmtDeskNum(pp)}`);
    levels.push(pp);
  }
  if (ema20 !== null) {
    marks.push(`EMA20 ${fmtDeskNum(ema20)}`);
    levels.push(ema20);
  }
  if (ema50 !== null) {
    marks.push(`EMA50 ${fmtDeskNum(ema50)}`);
    levels.push(ema50);
  }

  const above = levels.filter((v) => spot > v).length;
  const below = levels.filter((v) => spot < v).length;
  const lean =
    levels.length === 0
      ? "no moving-average reference"
      : below === levels.length
        ? "all trend markers above spot"
        : above === levels.length
          ? "all trend markers below spot"
          : `${above}/${levels.length} trend markers below spot`;
  const supportsSide =
    levels.length > 0 && (side === "bull" ? above === levels.length : below === levels.length);
  const rsiText = rsi === null ? "" : `; RSI ${rsi.toFixed(1)}`;

  return {
    tag: "trend",
    text: `${frame(side, supportsSide)}spot ${fmtDeskNum(spot)} vs ${
      marks.length > 0 ? marks.join(" / ") : "no pivots/EMAs"
    } — ${lean}${rsiText}.`,
  };
}

/**
 * The gamma sentence. Both the regime and the flip are read **spot-relative**
 * (cumulative gamma up to spot / a flip that agrees with it) so the plan can
 * never say "dealers long gamma" beside a flip that says the opposite.
 */
export function gammaReason(report: NiftyReport, spot: number | null): DeskReason | null {
  const gex = report.gex;
  if (!gex) return null;
  const backendRegime =
    gex.regime && String(gex.regime).trim() ? String(gex.regime).trim() : "";
  const regime = gexRegimeAtSpot(gex, spot ?? 0, backendRegime);
  const rawFlip = gexFlipAtSpot(gex, spot ?? 0);
  // A flip of 0 is not a strike — treat it as absent, like the old read did.
  const flip = rawFlip !== null && rawFlip > 0 ? rawFlip : null;
  const net = finite(gex.netTotal);
  if (!regime && flip === null && net === null) return null;

  const bits: string[] = [];
  if (regime === "short") bits.push("dealers short gamma (moves amplified)");
  else if (regime === "long") bits.push("dealers long gamma (moves dampened)");
  else if (regime === "flat") bits.push("dealer gamma flat");
  // Net GEX keeps the sentence numeric even when the flip strike is absent.
  if (net !== null) bits.push(`net GEX ${net.toFixed(2)} Cr/pt`);
  if (flip !== null) {
    const distance = spot === null ? null : Math.abs(spot - flip);
    bits.push(
      distance === null
        ? `γ flip ${fmtDeskNum(flip)}`
        : `γ flip ${fmtDeskNum(flip)} sits ${fmtDeskNum(distance)} pts ${
            spot !== null && spot >= flip ? "below" : "above"
          } spot`,
    );
  }
  return { tag: "gamma", text: `${bits.join("; ")}.` };
}

export function oiReason(report: NiftyReport, side: DeskSideKey): DeskReason | null {
  const callWall = topWall(report.walls?.calls);
  const putWall = topWall(report.walls?.puts);
  const counts = countSentiments(report.strikes);
  const hasFlow =
    counts.ceWriters + counts.peBuyers + counts.putWriters + counts.callBuyers > 0;
  if (callWall === null && putWall === null && !hasFlow) return null;

  const bits: string[] = [];
  if (callWall !== null) {
    bits.push(`call wall ${fmtDeskNum(callWall.strike)} (${formatReportOiCr(callWall.oi, { dashOnNonPositive: true })} OI)`);
  }
  if (putWall !== null) {
    bits.push(`put wall ${fmtDeskNum(putWall.strike)} (${formatReportOiCr(putWall.oi, { dashOnNonPositive: true })} OI)`);
  }
  if (counts.total > 0 && hasFlow) {
    if (side === "bear") {
      bits.push(
        `${counts.ceWriters}/${counts.total} CE legs on short buildup (writers) vs ${counts.peBuyers}/${counts.total} PE legs on long buildup (buyers)`,
      );
    } else {
      bits.push(
        `${counts.putWriters}/${counts.total} PE legs on short buildup (writers) vs ${counts.callBuyers}/${counts.total} CE legs on long buildup (buyers)`,
      );
    }
  }
  return { tag: "oi", text: `${bits.join("; ")}.` };
}

interface VolRead {
  iv: number | null;
  rv: number | null;
  ratio: number | null;
  skew: number | null;
  vixLtp: number | null;
  vixChange: number | null;
}

/** One vol read shared by the reason text and the "rich IV" DON'T guard. */
export function readVol(report: NiftyReport): VolRead {
  const control = report.control;
  const ivs = [positive(control?.atm_ce_iv), positive(control?.atm_pe_iv)].filter(
    (v): v is number => v !== null,
  );
  const iv = ivs.length > 0 ? mean(ivs) : positive(report.regime?.iv);
  const rv = positive(report.regime?.rv);
  return {
    iv,
    rv,
    ratio: iv !== null && rv !== null ? iv / rv : null,
    skew: finite(control?.skew),
    vixLtp: positive(report.vix?.ltp),
    vixChange: finite(report.vix?.change_pct),
  };
}

export function volReason(report: NiftyReport): DeskReason | null {
  const { iv, rv, ratio, skew, vixLtp, vixChange } = readVol(report);
  if (iv === null && rv === null && skew === null && vixLtp === null) return null;

  const bits: string[] = [];
  if (iv !== null && rv !== null && ratio !== null) {
    const state = ratio > RICH_IV_RV ? "rich" : ratio < 0.85 ? "cheap" : "fair";
    bits.push(
      `ATM IV ${iv.toFixed(2)} vs RV ${rv.toFixed(2)} → IV/RV ${ratio.toFixed(2)} (${state})`,
    );
  } else if (iv !== null) {
    bits.push(`ATM IV ${iv.toFixed(2)}`);
  } else if (rv !== null) {
    bits.push(`RV ${rv.toFixed(2)}`);
  }
  if (skew !== null) bits.push(`25Δ skew ${skew.toFixed(2)}`);
  if (vixLtp !== null) {
    const change = vixChange === null ? "" : ` (${vixChange > 0 ? "+" : ""}${vixChange.toFixed(2)}%)`;
    bits.push(`VIX ${vixLtp.toFixed(2)}${change}`);
  }
  return { tag: "vol", text: `${bits.join("; ")}.` };
}

export function structureReason(
  report: NiftyReport,
  side: DeskSideKey,
  levels: Levels,
): DeskReason | null {
  const { support, resistance, sessionLow, sessionHigh, spot } = levels;
  const candles = report.intraday;
  if (side === "bear") {
    if (support === null && sessionLow === null) return null;
    const bits: string[] = [];
    if (support !== null) {
      const tests = countTouches(candles, support, "low");
      bits.push(
        `support ${fmtDeskNum(support)}${
          tests > 0 ? ` held ${tests} test${tests === 1 ? "" : "s"}` : " has no intraday test"
        }`,
      );
    }
    if (sessionLow !== null) {
      const distance = spot === null ? null : spot - sessionLow;
      bits.push(
        `session low ${fmtDeskNum(sessionLow)}${
          distance === null ? "" : ` is ${fmtDeskNum(distance)} pts below spot`
        }`,
      );
    }
    return { tag: "structure", text: `${bits.join("; ")}.` };
  }

  if (resistance === null && sessionHigh === null) return null;
  const bits: string[] = [];
  if (resistance !== null) {
    const tests = countTouches(candles, resistance, "high");
    bits.push(
      `resistance ${fmtDeskNum(resistance)}${
        tests > 0 ? ` capped ${tests} test${tests === 1 ? "" : "s"}` : " has no intraday test"
      }`,
    );
  }
  if (sessionHigh !== null) {
    const distance = spot === null ? null : sessionHigh - spot;
    bits.push(
      `session high ${fmtDeskNum(sessionHigh)}${
        distance === null ? "" : ` is ${fmtDeskNum(distance)} pts above spot`
      }`,
    );
  }
  return { tag: "structure", text: `${bits.join("; ")}.` };
}
