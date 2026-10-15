import type { AlertSeverity, MarketAlert } from "@/components/notifications/MarketAlertCard";
import type { NiftyBurstNews, NiftyTapeRow } from "@/types/niftyReport";

/**
 * Nifty OI-burst detection — pure, client-side, no store.
 *
 * The tape's `call_doi`/`put_doi` are CUMULATIVE from the day's first row, so a
 * burst is the FIRST DIFFERENCE between consecutive minutes, not the headline
 * number:
 *     dCall(i) = call_doi(i) − call_doi(i−1)
 *     dPut(i)  = put_doi(i)  − put_doi(i−1)
 *
 * A minute is "unusual" when its |d| dwarfs the trailing typical |d| for the
 * same side. The baseline is a robust MEDIAN (not mean) over the previous
 * window of minutes, so a single earlier burst can't hide the next one.
 * Everything is scored per side, so a big call burst and a big put burst in
 * the same minute are two separate events.
 */

/** Trailing minutes used for the per-side baseline. */
export const OI_BURST_WINDOW = 10;
/** Absolute floor (contracts) — kills pre-open / thin-book noise. */
export const OI_BURST_MIN_ABS = 2_000;
/** Minimum prior minutes before scoring starts (no baseline = no alert). */
export const OI_BURST_WARMUP = 3;
/** score = |d| ÷ baseline → severity. */
export const OI_BURST_TIERS: Record<AlertSeverity, number> = {
  watch: 3,
  alert: 5,
  critical: 8,
  info: Infinity,
};

export interface MinuteDoi {
  t: string;
  /** OI contracts added this minute (can be negative = unwinding). */
  dCall: number;
  dPut: number;
  /** Cumulative-from-open ΔOI at this minute. */
  callDoi: number;
  putDoi: number;
  spot: number;
  callTick: number;
  putTick: number;
}

export interface OiBurst {
  id: string;
  side: "call" | "put";
  t: string;
  /** Contracts added this minute (signed). */
  delta: number;
  /** Trailing median |delta| used to score it. */
  baseline: number;
  score: number;
  severity: AlertSeverity;
  /** Cumulative-from-open ΔOI for that side. */
  cumDoi: number;
  spot: number;
  /** That side's traded volume this minute. */
  tickVol: number;
  /** Signal pre-computed by the backend; when absent the client derives one. */
  signal?: OiSignal | null;
  /** Candidate catalysts within ±10 min (backend-attached). */
  news?: NiftyBurstNews[];
  /** Session trend at this minute (attached by the panel from the tape). */
  trend?: "up" | "down" | null;
  /** "squeeze" = wall break (momentum); "strike" = single-strike explosion. */
  type?: "burst" | "squeeze" | "strike" | "premium" | "coil";
  /** Wall strike the squeeze broke through. */
  wall?: number;
  /** Exact strike a per-strike burst names (overrides nearest-to-spot). */
  strike?: number;
  /** "CE" | "PE" for per-strike / premium bursts. */
  leg?: string;
  /** ATM premium move in % (premium bursts). */
  pct?: number;
  /** Coil only: spot range as % over the window. */
  range_pct?: number;
  /** Coil only: distance to the wall as % of spot. */
  dist_pct?: number;
}

/* ------------------------------------------------------------------ signal */

/** Default risk budget (₹) the mechanical sizing assumes. */
export const OI_SIGNAL_RISK_BUDGET = 5_000;
/** Option-buying stop distance as % of premium. */
export const OI_SIGNAL_SL_PCT = 25;
/** Fallback target as % of premium when no level target is available. */
export const OI_SIGNAL_TP_PCT = 50;
/** Below this premium the strike is effectively dead (expiry day) — skip it. */
export const OI_SIGNAL_MIN_PREMIUM = 10;
/** NIFTY contract size. */
// NIFTY lot size. MUST match api/reports_api/nifty_bursts.py:NIFTY_LOT_SIZE.
// Was 75, which is not a tradeable NIFTY size: 23 consecutive real exchange
// prints were every one an exact multiple of 65 (GCD == 65), and nifty.py's GEX
// already computed with 65. Python was fixed and this mirror was missed, so the
// UI kept suggesting qty 75 / 150 while the API returned 65 / 130.
export const NIFTY_LOT_SIZE = 65;

export interface OiSignal {
  leg: "CE" | "PE";
  strike: number;
  entry: number;
  sl: number;
  target: number;
  /** Units = lots × lot size (0 when the premium is too rich for the budget). */
  qty: number;
  lots: number;
  /** One-line rationale shown in the alert. */
  basis: string;
  /** Session trend at the burst minute, when it could be computed. */
  trend?: "up" | "down" | null;
  /** False when the leg fights the trend — the plan should be skipped. */
  aligned?: boolean | null;
}

/** EMA span (minutes) defining the session trend for the alignment gate. */
export const TREND_EMA_SPAN = 20;

/**
 * Session trend at `atTime` (or at the end) from spot vs its EMA, mirroring
 * `session_trend()` in `api/reports_api/nifty_bursts.py`.
 *
 * A burst is only actionable *with* the trend: on 2026-10-13 trend-aligned
 * plans went 20/23 favourable (avg +95.5 pts) while counter-trend plans went
 * 2/22 (avg −110.1 pts).
 */
export function sessionTrend(
  rows: NiftyTapeRow[],
  atTime?: string,
): "up" | "down" | null {
  const spots: number[] = [];
  const asc = [...(rows ?? [])].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  for (const r of asc) {
    if (!Number.isFinite(r.spot) || r.spot === 0) continue;
    spots.push(r.spot);
    if (atTime !== undefined && r.t === atTime) break;
  }
  if (spots.length < 2) return null;

  const alpha = 2 / (TREND_EMA_SPAN + 1);
  let ema = spots[0];
  for (let i = 1; i < spots.length; i++) ema = alpha * spots[i] + (1 - alpha) * ema;
  const last = spots[spots.length - 1];
  if (last > ema) return "up";
  if (last < ema) return "down";
  return null;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/**
 * Turn a burst into a mechanical option suggestion.
 *
 * Direction follows the OI move, not just the side:
 *   call OI BUILD  (writers add ceiling)  → bearish → buy PE
 *   call OI UNWIND (writers cover)        → bullish → buy CE
 *   put  OI BUILD  (writers add floor)    → bullish → buy CE
 *   put  OI UNWIND (support removed)      → bearish → buy PE
 * Strike = nearest listed strike to spot with a tradeable premium. Sizing
 * assumes a fixed risk budget and a 25% premium stop.
 *
 * This is a heuristic, not advice, and it does not place orders.
 */
export function deriveOiSignal(
  burst: OiBurst,
  strikes: Array<{ strike: number; ce?: { ltp?: number }; pe?: { ltp?: number } }>,
  spot: number,
  opts: { riskBudget?: number; slPct?: number; tpPct?: number; minPremium?: number; trend?: "up" | "down" | null } = {},
): OiSignal | null {
  const riskBudget = opts.riskBudget ?? OI_SIGNAL_RISK_BUDGET;
  const slPct = opts.slPct ?? OI_SIGNAL_SL_PCT;
  const tpPct = opts.tpPct ?? OI_SIGNAL_TP_PCT;
  const minPremium = opts.minPremium ?? OI_SIGNAL_MIN_PREMIUM;

  // A coil is a heads-up, not a trade.
  if (burst.type === "coil") return null;

  const call = burst.side === "call";
  const building = burst.delta > 0;
  const isSqueeze = burst.type === "squeeze";
  const isPremium = burst.type === "premium";
  // A burst is a FADE (writers moved). A squeeze is MOMENTUM: the broken side
  // is being run over, so buy the break.
  const leg: "CE" | "PE" = isSqueeze || isPremium
    ? (burst.leg ?? (call ? "CE" : "PE")) === "CE"
      ? "CE"
      : "PE"
    : call === building
      ? "PE"
      : "CE";

  const candidates = (strikes ?? [])
    .map((s) => ({
      strike: Number(s.strike),
      ltp: Number(leg === "CE" ? s.ce?.ltp : s.pe?.ltp),
    }))
    .filter((c) => Number.isFinite(c.strike) && Number.isFinite(c.ltp) && c.ltp >= minPremium)
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));

  const pick = candidates[0];
  if (!pick) return null;

  // A per-strike burst names its own strike — use it instead of nearest-to-spot.
  const wantStrike = typeof burst.strike === "number" ? burst.strike : undefined;
  const exact = wantStrike !== undefined
    ? candidates.find((c) => c.strike === wantStrike)
    : undefined;
  const chosen = exact ?? pick;

  const entry = round2(chosen.ltp);
  const sl = round2(entry * (1 - slPct / 100));
  const target = round2(entry * (1 + tpPct / 100));
  const riskPerUnit = Math.max(0.05, entry - sl);
  const units = Math.floor(riskBudget / riskPerUnit);
  const lots = Math.floor(units / NIFTY_LOT_SIZE);
  const qty = lots * NIFTY_LOT_SIZE;

  let basis = isPremium
    ? `ATM premium impulse ${
        burst.pct !== undefined ? `${burst.pct >= 0 ? "+" : ""}${burst.pct.toFixed(2)}` : "?"
      }% (${leg} ${
        typeof burst.strike === "number" ? burst.strike.toLocaleString("en-IN") : "?"
      })`
    : isSqueeze
      ? `short-covering squeeze — ${burst.side} wall ${
        typeof burst.wall === "number" ? burst.wall.toLocaleString("en-IN") : "?"
        } broken while that side unwound ${Math.abs(burst.delta).toLocaleString("en-IN")}`
      : call
        ? building
          ? "call OI build — writers adding ceiling → fade with puts"
          : "call OI unwind — writers covering → upside fuel → buy calls"
        : building
          ? "put OI build — writers adding floor → fade with calls"
          : "put OI unwind — support removed → downside fuel → buy puts";

  // Trend gate: a plan fighting the session trend is the wrong side of the tape,
  // so no plan is emitted (counter-trend resolved 0.32 vs 0.80 aligned on 2026-10-15).
  // A squeeze is with the break by construction, so it is always aligned.
  const trend = opts.trend ?? null;
  let aligned: boolean | null = null;
  if (isSqueeze || isPremium) {
    aligned = true;
  } else if (trend === "up" || trend === "down") {
    aligned = (leg === "CE" && trend === "up") || (leg === "PE" && trend === "down");
    if (!aligned) return null;
  }

  return { leg, strike: chosen.strike, entry, sl, target, qty, lots, basis, trend, aligned };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Chronological per-minute ΔOI series; the first row is the baseline, not a delta.
 * Duplicate timestamps keep the LAST occurrence (the backend feed is
 * ascending, so that is the most recent write); rows without `t` are dropped. */
export function computeMinuteDoi(rows: NiftyTapeRow[]): MinuteDoi[] {
  const byT = new Map<string, NiftyTapeRow>();
  for (const r of rows ?? []) {
    if (r && typeof r.t === "string" && r.t.length > 0) byT.set(r.t, r);
  }
  const asc = [...byT.values()].sort((a, b) => (a.t < b.t ? -1 : a.t > b.t ? 1 : 0));
  const out: MinuteDoi[] = [];
  for (let i = 1; i < asc.length; i++) {
    const p = asc[i - 1];
    const c = asc[i];
    if (!p || !c) continue;
    out.push({
      t: c.t,
      dCall: (c.call_doi ?? 0) - (p.call_doi ?? 0),
      dPut: (c.put_doi ?? 0) - (p.put_doi ?? 0),
      callDoi: c.call_doi ?? 0,
      putDoi: c.put_doi ?? 0,
      spot: c.spot ?? 0,
      callTick: c.call_tick ?? 0,
      putTick: c.put_tick ?? 0,
    });
  }
  return out;
}

export function severityForScore(score: number): AlertSeverity {
  if (score >= OI_BURST_TIERS.critical) return "critical";
  if (score >= OI_BURST_TIERS.alert) return "alert";
  if (score >= OI_BURST_TIERS.watch) return "watch";
  return "info";
}

export interface DetectOptions {
  window?: number;
  minAbs?: number;
  warmup?: number;
}

/**
 * Bursts across the whole series, one entry per (minute, side). Ordered by
 * minute ascending so callers can take the tail as "most recent".
 */
export function detectOiBursts(rows: NiftyTapeRow[], opts: DetectOptions = {}): OiBurst[] {
  const window = opts.window ?? OI_BURST_WINDOW;
  const minAbs = opts.minAbs ?? OI_BURST_MIN_ABS;
  const warmup = opts.warmup ?? OI_BURST_WARMUP;

  const series = computeMinuteDoi(rows);
  const callHist: number[] = [];
  const putHist: number[] = [];
  const out: OiBurst[] = [];

  for (const m of series) {
    const sides: Array<{ side: "call" | "put"; d: number; hist: number[]; cum: number; tick: number }> = [
      { side: "call", d: m.dCall, hist: callHist, cum: m.callDoi, tick: m.callTick },
      { side: "put", d: m.dPut, hist: putHist, cum: m.putDoi, tick: m.putTick },
    ];

    for (const s of sides) {
      const abs = Math.abs(s.d);
      if (s.hist.length >= warmup) {
        // Baseline is floored at the absolute minimum so a near-zero median
        // on a quiet tape can't inflate every later move into a "burst".
        const baseline = Math.max(minAbs, median(s.hist.slice(-window)));
        const score = abs / baseline;
        if (abs >= minAbs && score >= OI_BURST_TIERS.watch) {
          out.push({
            id: `${m.t}-${s.side}`,
            side: s.side,
            t: m.t,
            delta: s.d,
            baseline,
            score,
            severity: severityForScore(score),
            cumDoi: s.cum,
            spot: m.spot,
            tickVol: s.tick,
          });
        }
      }
    }

    callHist.push(Math.abs(m.dCall));
    putHist.push(Math.abs(m.dPut));
  }

  return out;
}

/** IST HH:MM for a tape timestamp (ISO or bare HH:MM). */
export function burstTimeLabel(t: string): string {
  if (!t) return "--:--";
  if (t.includes("T")) {
    const time = t.split("T")[1] ?? "";
    return time.slice(0, 5) || "--:--";
  }
  return t.slice(0, 5);
}

function compact(v: number): string {
  const sign = v < 0 ? "-" : "+";
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(1)}K`;
  return `${sign}${abs}`;
}

/** Map a detected burst onto the shared alert shape for the in-app toast/log.
 * When a signal is supplied the title/headline lead with the trade plan. */
export function burstToAlert(burst: OiBurst, signal?: OiSignal | null): MarketAlert {
  const sideLabel = burst.side === "call" ? "Call" : "Put";
  const tone: "up" | "down" = burst.delta >= 0 ? "up" : "down";
  const scoreTxt = `${burst.score.toFixed(1)}× the trailing typical minute`;

  const metrics = signal
    ? [
        { label: "ENTRY", value: signal.entry.toFixed(2) },
        { label: "SL", value: signal.sl.toFixed(2), tone: "down" as const },
        { label: "TGT", value: signal.target.toFixed(2), tone: "up" as const },
        { label: "QTY", value: signal.qty > 0 ? String(signal.qty) : "—" },
        { label: "ΔOI", value: compact(burst.delta), tone },
      ]
    : [
        { label: "ΔOI", value: compact(burst.delta), tone },
        { label: "CUM", value: compact(burst.cumDoi), tone: burst.cumDoi >= 0 ? ("up" as const) : ("down" as const) },
        { label: "TICK", value: compact(burst.tickVol) },
        { label: "SPOT", value: burst.spot.toLocaleString("en-IN", { maximumFractionDigits: 0 }) },
      ];

  const title = signal
    ? `→ BUY ${signal.leg} ${signal.strike.toLocaleString("en-IN")} · qty ${signal.qty > 0 ? signal.qty : "—"}`
    : burst.type === "coil"
      ? `COILING @ ${typeof burst.wall === "number" ? burst.wall.toLocaleString("en-IN") : "wall"}`
      : `${sideLabel} OI burst ${compact(burst.delta)} in 1 min`;

  const detail =
    burst.type === "coil"
      ? `spot ${burst.spot.toLocaleString("en-IN")} pressed on the ${burst.side} wall ${
          typeof burst.wall === "number" ? burst.wall.toLocaleString("en-IN") : "?"
        } · ${burst.range_pct?.toFixed(3) ?? "?"}% range, ${burst.dist_pct?.toFixed(3) ?? "?"}% away · heads-up, no plan`
      : signal
        ? `${sideLabel} OI burst ${compact(burst.delta)} (${scoreTxt}) · entry ${signal.entry.toFixed(2)} · SL ${signal.sl.toFixed(2)} · TGT ${signal.target.toFixed(2)} · ${signal.basis} · heuristic, not advice`
        : `${scoreTxt} · ${burstTimeLabel(burst.t)} IST`;

  // Candidate catalyst: lead with the headline nearest the burst.
  const headline = burst.news?.[0];
  const newsTxt = headline
    ? ` · NEWS ${headline.minutesAway >= 0 ? "+" : ""}${headline.minutesAway.toFixed(0)}m: ${headline.heading}`
    : "";

  return {
    id: burst.id,
    kind: "oi_burst",
    severity: burst.severity,
    symbol: "NIFTY",
    title,
    detail: `${detail}${newsTxt}`,
    metrics,
    ts: Date.parse(burst.t) || Date.now(),
    source: `Nifty tape · ${burstTimeLabel(burst.t)} IST${signal ? " · mechanical plan" : ""}${headline ? ` · ${headline.source || "news"}` : ""}`,
    href: "/report/nifty",
  };
}
