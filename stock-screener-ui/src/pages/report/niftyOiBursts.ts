import { formatNumberIN } from "@/utils/ui-helpers";
import type { AlertSeverity, MarketAlert } from "@/components/notifications/MarketAlertCard";
import type { NiftyBurstNews, NiftyTapeRow } from "@/types/niftyReport";
import { hhmmToMinutes, minutesToHhmm } from "./tapeRange";

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

/** The level the underlying closed beyond, and the direction (backend). */
export interface OiStructure {
  /** The level that was closed beyond (e.g. 22,697). */
  level: number;
  /** Direction of the break. */
  direction: "up" | "down";
  /** What kind of level it was. */
  kind?: "day_high" | "day_low" | "pivot" | "wall" | "max_pain" | "other";
  /** The confirming close. */
  close?: number;
  /** Timestamp of the confirming close. */
  confirmed_at?: string;
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
  /** Buyer/writer flow label (`buyers`/`writers`/`covering`/`liquidation`)
   * from the backend; absent on pre-restart bursts. Takes precedence over
   * the OI-only direction rule when present. */
  flow?: string;
  /** Backend direction verdict (true = bearish → buy puts). Beats `flow`
   * when both are present. */
  bearish?: boolean | null;
  /** Same-side ATM premium change (₹) over the burst minute — the client
   * fallback for bursts without a backend flow label (attached by the panel
   * from the tape). Mirrors the backend's `classify_flow` input. */
  premChg?: number | null;
  /** 5-minute spot direction at the burst minute (attached by the panel from
   * the tape). The alignment gate passes when EITHER trend agrees with the leg. */
  trend5m?: "up" | "down" | null;
  /** Candidate catalysts within ±10 min (backend-attached). */
  news?: NiftyBurstNews[];
  /** Session trend at this minute (attached by the panel from the tape). */
  trend?: "up" | "down" | null;
  /** Backend setup classification + playbook (added 2026-11). */
  setup?:
    | "short_squeeze"
    | "wall_squeeze"
    | "put_squeeze"
    | "fresh_long"
    | "fresh_short"
    | "put_floor"
    | "call_cap"
    | string;
  setup_label?: string;
  horizon?: "scalp" | "swing" | "watch" | string;
  trigger?: number | null;
  playbook?: string;
  confidence?: string;
  /** "squeeze" = wall break (momentum); "strike" = single-strike explosion;
   *  wall events = strike-wall test/rejection/break; "data_stale" = system
   *  warning that the tape stopped updating. */
  type?:
    | "burst"
    | "squeeze"
    | "strike"
    | "premium"
    | "coil"
    | "wall"
    | "wall_test"
    | "rejection"
    | "break"
    | "wall_break"
    | "data_stale";
  /** Wall strike the squeeze broke through / the wall event tested. */
  wall?: number;
  /** Exact strike a per-strike burst names (overrides nearest-to-spot). */
  strike?: number;
  /** Wall event: the level the move is expected to reach (max pain). */
  target?: number | null;
  /** Backend headline / longer explanation (wall + data-stale events). */
  label?: string | null;
  detail?: string | null;
  /** "CE" | "PE" for per-strike / premium bursts. */
  leg?: string;
  /** ATM premium move in % (premium bursts). */
  pct?: number;
  /** Coil only: spot range as % over the window. */
  range_pct?: number;
  /** Coil only: distance to the wall as % of spot. */
  dist_pct?: number;
  /** Structure evidence for the burst minute: the named level the underlying
   * closed beyond, and the direction (backend-attached). */
  structure?: OiStructure | null;
  /** Level that invalidates the idea (e.g. the pivot that was broken). */
  invalidation?: number | null;
  /** Backend says the plan was withheld (spent fuel, no structure break). */
  plan_suppressed?: boolean;
  /** Backend fuel state — the OI × premium 2×2 cell. */
  fuel_state?: OiFuelState;
}

/** Wall event kinds the backend attaches to the bursts feed. */
export function isWallEventType(type?: string | null): boolean {
  return type === "wall_test" || type === "rejection" || type === "break" || type === "wall_break";
}

/** Events that carry no trade plan (wall geometry + system warnings). */
export function isNonTradeAlertType(type?: string | null): boolean {
  return isWallEventType(type) || type === "data_stale";
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
 * Direction follows WHO traded, not just the OI move (backend `classify_flow`
 * verdict, mirrored here). The full mapping:
 *
 *   put  UNWIND + covering   (PE premium up)    → bullish  → buy CE
 *   put  UNWIND + liquidation(PE premium down)  → bearish  → buy PE
 *   put  BUILD  + buyers     (PE premium up)    → bearish  → buy PE
 *   put  BUILD  + writers     (PE premium down)  → bullish  → buy CE
 *   call UNWIND + covering   (CE premium up)    → bullish  → buy CE
 *   call UNWIND + liquidation(CE premium down)   → bearish  → buy PE
 *   call BUILD  + buyers     (CE premium up)    → bullish  → buy CE
 *   call BUILD  + writers     (CE premium down)  → bearish  → buy PE
 *
 * Source precedence: backend `bearish` verdict → backend `flow` label →
 * same-side ATM premium direction over the burst minute (`premChg`) →
 * legacy OI-only rule. A squeeze is MOMENTUM (buy the break, leg from the
 * burst); a premium impulse buys the moved leg; both skip the flow reading.
 *
 * Strike = nearest listed strike to spot with a tradeable premium. Sizing
 * assumes a fixed risk budget and a 25% premium stop.
 *
 * This is a heuristic, not advice, and it does not place orders.
 */

/** Backend buyer/writer flow labels (`classify_flow`). */
export type OiFlowKind = "buyers" | "writers" | "covering" | "liquidation";

/** OI direction × premium direction: fresh money, or a book being spent. */
export type OiFuelState =
  | "fresh_buyers"
  | "fresh_sellers"
  | "writers_covering"
  | "longs_liquidating";

/** Fuel states where the move runs on a book being unwound (no fresh money). */
export const SPENT_FUEL_STATES: ReadonlySet<OiFuelState> = new Set<OiFuelState>([
  "writers_covering",
  "longs_liquidating",
]);

/** Alert headline for a fuel state. */
export const FUEL_STATE_LABEL: Record<OiFuelState, string> = {
  fresh_buyers: "FRESH BUYING",
  fresh_sellers: "FRESH SELLING",
  writers_covering: "WRITERS COVERING",
  longs_liquidating: "LONGS LIQUIDATING",
};

/** Flow label → fuel state. */
export function fuelStateFromFlow(flow: string): OiFuelState | null {
  switch (flow.trim().toLowerCase()) {
    case "buyers":
      return "fresh_buyers";
    case "writers":
      return "fresh_sellers";
    case "covering":
      return "writers_covering";
    case "liquidation":
      return "longs_liquidating";
    default:
      return null;
  }
}

/** Backend flow label, else the client mirror. Null = unknown (never fresh). */
export function resolveFuelState(
  burst: Pick<OiBurst, "side" | "delta" | "flow" | "premChg"> & {
    fuel_state?: OiFuelState | null;
  },
): OiFuelState | null {
  // The backend's reading wins: it has the SAME-STRIKE premium change, the
  // client only has an ATM guess that can be a strike artefact.
  if (burst.fuel_state && FUEL_STATE_LABEL[burst.fuel_state]) {
    return burst.fuel_state;
  }
  if (typeof burst.flow === "string") {
    const f = fuelStateFromFlow(burst.flow);
    if (f) return f;
  }
  const inferred = inferFlowFromPremium(burst.premChg, burst.delta > 0);
  return inferred ? fuelStateFromFlow(inferred) : null;
}

/**
 * The direction a covering burst on `side` implies: the side's own premium
 * rose because shorts on that side bought back, so the market moved in that
 * side's direction (a put-side covering = the market fell).
 */
export function coveringDirection(side: "call" | "put"): "up" | "down" {
  return side === "put" ? "down" : "up";
}

/** True when the fuel is spent (the book is being unwound, no new money). */
export function isSpentFuel(state: OiFuelState | null): boolean {
  return state !== null && SPENT_FUEL_STATES.has(state);
}

/** Drift of the plan's entry against the live premium. A stale plan is void. */
export const OI_SIGNAL_STALE_PCT = 5;

/** Freshness of a signal's entry against the live premium. */
export interface OiEntryFreshness {
  /** Live premium for the signalled leg/strike, when it could be read. */
  live: number | null;
  /** (live − entry) / entry in % — positive means the market ran UP past it. */
  driftPct: number | null;
  /** True when the drift is big enough to void the plan. */
  stale: boolean;
}

/** Compare a signal's entry with the live premium for its leg/strike. */
export function entryFreshness(
  signal: Pick<OiSignal, "leg" | "strike" | "entry">,
  chain: Array<{ strike: number; ce?: { ltp?: number }; pe?: { ltp?: number } }>,
): OiEntryFreshness {
  const row = (chain ?? []).find((s) => Math.abs(Number(s.strike) - signal.strike) < 1);
  const live = row
    ? Number(signal.leg === "CE" ? row.ce?.ltp : row.pe?.ltp)
    : NaN;
  if (!Number.isFinite(live) || live <= 0 || !(signal.entry > 0)) {
    return { live: null, driftPct: null, stale: false };
  }
  const driftPct = ((live - signal.entry) / signal.entry) * 100;
  return { live, driftPct, stale: Math.abs(driftPct) >= OI_SIGNAL_STALE_PCT };
}

/** Where the trade direction came from. */
export type OiDirectionSource = "flow" | "premium" | "oi";

export interface OiDirection {
  leg: "CE" | "PE";
  /** Backend verdict when known (true = bearish → PE). */
  bearish: boolean | null;
  via: OiDirectionSource;
  /** One-line rationale for the alert. */
  basis: string;
}

/** Backend flow label → direction. Covering/liquidation are both-legs
 * verdicts (shorts bought back = bullish; longs sold out = bearish); buyers
 * vs writers splits by side (buyers pay up = bearish puts / bullish calls). */
function directionFromFlow(
  flow: string,
  side: "call" | "put",
): { leg: "CE" | "PE"; bearish: boolean } | null {
  switch (flow.trim().toLowerCase()) {
    case "covering":
      return { leg: "CE", bearish: false };
    case "liquidation":
      return { leg: "PE", bearish: true };
    case "buyers":
      return side === "put" ? { leg: "PE", bearish: true } : { leg: "CE", bearish: false };
    case "writers":
      return side === "put" ? { leg: "CE", bearish: false } : { leg: "PE", bearish: true };
    default:
      return null;
  }
}

/** Flow label implied by the same-side ATM premium change — the client-side
 * mirror of the backend's `classify_flow` (build+up=buyers, build+down=
 * writers, unwind+up=covering, unwind+down=liquidation). Null when the
 * premium is missing or flat: a guess is worse than the legacy rule. */
export function inferFlowFromPremium(
  premChg: number | null | undefined,
  building: boolean,
): OiFlowKind | null {
  if (premChg === null || premChg === undefined || !Number.isFinite(premChg) || premChg === 0) {
    return null;
  }
  if (building) return premChg > 0 ? "buyers" : "writers";
  return premChg > 0 ? "covering" : "liquidation";
}

/** One-line rationale for a flow-read direction. */
function flowBasis(side: "call" | "put", flow: OiFlowKind, leg: "CE" | "PE"): string {
  const s = side === "call" ? "call" : "put";
  switch (flow) {
    case "covering":
      return `${s} OI unwind + covering — shorts bought back → upside fuel → buy calls`;
    case "liquidation":
      return `${s} OI unwind + liquidation — longs sold out → downside fuel → buy puts`;
    case "buyers":
      return leg === "PE"
        ? "put OI build + buyers — buyers paid up → downside fuel → buy puts"
        : "call OI build + buyers — buyers lifting offers → upside fuel → buy calls";
    case "writers":
      return side === "put"
        ? "put OI build + writers — writers sold premium → support holds → buy calls"
        : "call OI build + writers — writers adding ceiling → fade with puts";
  }
}

/**
 * Resolve the trade direction for a plain burst. Precedence: backend
 * `bearish` verdict → backend `flow` label → same-side ATM premium direction
 * (`premChg`) → legacy OI-only rule.
 */
export function resolveOiDirection(
  burst: Pick<OiBurst, "side" | "delta" | "flow" | "bearish" | "premChg">,
): OiDirection {
  const building = burst.delta > 0;
  // 1. The backend verdict is the reading — no inference needed.
  if (typeof burst.bearish === "boolean") {
    const leg = burst.bearish ? "PE" : "CE";
    const flowLabel = typeof burst.flow === "string" ? burst.flow : null;
    const flow = flowLabel ? directionFromFlow(flowLabel, burst.side) : null;
    const basis =
      flow && flow.leg === leg
        ? flowBasis(burst.side, flowLabel!.trim().toLowerCase() as OiFlowKind, leg)
        : `${burst.side === "call" ? "call" : "put"} OI ${
            building ? "build" : "unwind"
          } — backend flow ${burst.bearish ? "bearish" : "bullish"} → ${
            leg === "CE" ? "buy calls" : "buy puts"
          }`;
    return { leg, bearish: burst.bearish, via: "flow", basis };
  }
  // 2. A flow label without the verdict maps deterministically.
  if (typeof burst.flow === "string") {
    const d = directionFromFlow(burst.flow, burst.side);
    if (d) {
      return {
        ...d,
        via: "flow",
        basis: flowBasis(burst.side, burst.flow.trim().toLowerCase() as OiFlowKind, d.leg),
      };
    }
  }
  // 3. Same-side ATM premium direction over the burst minute.
  const inferred = inferFlowFromPremium(burst.premChg, building);
  if (inferred) {
    const d = directionFromFlow(inferred, burst.side);
    if (d) {
      return { ...d, via: "premium", basis: flowBasis(burst.side, inferred, d.leg) };
    }
  }
  // 4. Legacy OI-only rule (no flow information at all).
  const leg = (burst.side === "call") === building ? "PE" : "CE";
  const call = burst.side === "call";
  const basis = call
    ? building
      ? "call OI build — writers adding ceiling → fade with puts"
      : "call OI unwind — writers covering → upside fuel → buy calls"
    : building
      ? "put OI build — writers adding floor → fade with calls"
      : "put OI unwind — support removed → downside fuel → buy puts";
  return { leg, bearish: null, via: "oi", basis };
}
export function deriveOiSignal(
  burst: OiBurst,
  strikes: Array<{ strike: number; ce?: { ltp?: number }; pe?: { ltp?: number } }>,
  spot: number,
  opts: { riskBudget?: number; slPct?: number; tpPct?: number; minPremium?: number; trend?: "up" | "down" | null; trend5m?: "up" | "down" | null } = {},
): OiSignal | null {
  const riskBudget = opts.riskBudget ?? OI_SIGNAL_RISK_BUDGET;
  const slPct = opts.slPct ?? OI_SIGNAL_SL_PCT;
  const tpPct = opts.tpPct ?? OI_SIGNAL_TP_PCT;
  const minPremium = opts.minPremium ?? OI_SIGNAL_MIN_PREMIUM;

  // A coil is a heads-up, not a trade.
  if (burst.type === "coil") return null;
  // Wall geometry and stale-data warnings never carry a mechanical plan.
  if (isNonTradeAlertType(burst.type)) return null;

  const call = burst.side === "call";
  const building = burst.delta > 0;
  const isSqueeze = burst.type === "squeeze";
  const isPremium = burst.type === "premium";
  // Plain bursts read WHO traded (flow → premium → OI-only). A squeeze is
  // MOMENTUM: the broken side is being run over, so buy the break.
  const dir = isSqueeze || isPremium ? null : resolveOiDirection(burst);
  const leg: "CE" | "PE" = dir
    ? dir.leg
    : (burst.leg ?? (call ? "CE" : "PE")) === "CE"
      ? "CE"
      : "PE";

  const candidates = (strikes ?? [])
    .map((s) => ({
      strike: Number(s.strike),
      ltp: Number(leg === "CE" ? s.ce?.ltp : s.pe?.ltp),
    }))
    .filter((c) => Number.isFinite(c.strike) && Number.isFinite(c.ltp) && c.ltp >= minPremium)
    .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot));

  // Flow/plan consistency: a "call writers adding" burst is bearish; a
  // "BUY CE" plan on it is a contradictory banner (seen live 2026-10-28 at
  // 14:58). If the flow-derived leg and the chosen leg disagree, withhold the
  // plan rather than print two opposite instructions.
  const fuelState = resolveFuelState(burst);
  const fuelFlow =
    fuelState === "fresh_buyers"
      ? "buyers"
      : fuelState === "fresh_sellers"
        ? "writers"
        : fuelState === "writers_covering"
          ? "covering"
          : fuelState === "longs_liquidating"
            ? "liquidation"
            : null;
  const fuelLeg = fuelFlow ? directionFromFlow(fuelFlow, burst.side)?.leg ?? null : null;
  if (!isSqueeze && !isPremium && fuelLeg && leg !== fuelLeg) return null;

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
        typeof burst.strike === "number" ? formatNumberIN(burst.strike) : "?"
      })`
    : isSqueeze
      ? `short-covering squeeze — ${burst.side} wall ${
        typeof burst.wall === "number" ? formatNumberIN(burst.wall) : "?"
        } broken while that side unwound ${formatNumberIN(Math.abs(burst.delta))} units`
      : (dir?.basis ??
        (call
          ? building
            ? "call OI build — writers adding ceiling → fade with puts"
            : "call OI unwind — writers covering → upside fuel → buy calls"
          : building
            ? "put OI build — writers adding floor → fade with calls"
            : "put OI unwind — support removed → downside fuel → buy puts"));

  // Trend gate: a plan fighting the tape is the wrong side, so no plan is
  // emitted. The gate passes when the leg matches EITHER the session trend
  // or the 5-minute trend — a covering burst aligned with the current
  // 5-minute move is actionable even when the session trend disagrees
  // (a reversal). Only a plan opposed by every known trend is suppressed
  // (counter-trend resolved 0.32 vs 0.80 aligned on 2026-10-15).
  // A squeeze is with the break by construction, so it is always aligned.
  const trends = [opts.trend ?? null, opts.trend5m ?? null].filter(
    (t): t is "up" | "down" => t === "up" || t === "down",
  );
  let aligned: boolean | null = null;
  if (isSqueeze || isPremium) {
    aligned = true;
  } else if (trends.length === 0) {
    aligned = null;
  } else {
    aligned = trends.some(
      (t) => (leg === "CE" && t === "up") || (leg === "PE" && t === "down"),
    );
    if (!aligned) return null;
  }

  // The backend's own verdict wins: a plan the backend withheld stays
  // withheld (spent fuel with no structure break, a counter-trend plan, …).
  if (burst.plan_suppressed) return null;

  // Fuel gate: a covering burst (premium rising on an unwind) is only
  // tradeable when the underlying closed beyond a level IN THE SAME
  // DIRECTION. When the backend supplies evidence that contradicts the leg,
  // there is no trade. With no evidence the trend gate stands — the
  // conservative default belongs to the backend, and the freshness check in
  // useNiftyOiAlerts catches a plan priced off a stale chain.
  if (!isSqueeze && !isPremium) {
    const fuel = burst.fuel_state ?? resolveFuelState(burst);
    if (fuel === "writers_covering") {
      const structure = burst.structure ?? null;
      if (structure && structure.direction !== coveringDirection(burst.side)) return null;
    }
  }

  return { leg, strike: chosen.strike, entry, sl, target, qty, lots, basis, trend: opts.trend ?? null, aligned };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** One minute's ATM snapshot for the premium-direction fallback. */
export interface MinutePremium {
  strike?: number | null;
  ce?: number | null;
  pe?: number | null;
}

/**
 * Same-side ATM premium change between two tape rows — the client mirror of
 * the backend's `_premium_change`. The ATM strike rolling between rows makes
 * the change a strike artefact, and a non-positive premium is incomparable,
 * so both read as null (no label, not a guess).
 */
export function atmPremiumChange(
  prev: MinutePremium | null | undefined,
  cur: MinutePremium | null | undefined,
  side: "call" | "put",
): number | null {
  if (!prev || !cur) return null;
  const a = side === "call" ? prev.ce : prev.pe;
  const b = side === "call" ? cur.ce : cur.pe;
  if (typeof a !== "number" || typeof b !== "number") return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  const pa = prev.strike;
  const pb = cur.strike;
  if (
    typeof pa === "number" &&
    typeof pb === "number" &&
    pa > 0 &&
    pb > 0 &&
    pa !== pb
  ) {
    return null;
  }
  return b - a;
}

/**
 * Spot `minutesBack` before `hhmm`, tolerating tape gaps by walking further
 * back (up to `tolerance` extra minutes). Null when the tape has no row
 * there — the 5-minute gate then stays unknown rather than guessing.
 */
export function spotMinutesBefore(
  spots: Map<string, number>,
  hhmm: string,
  minutesBack: number,
  tolerance = 5,
): number | null {
  const base = hhmmToMinutes(hhmm);
  if (base === null) return null;
  for (let back = minutesBack; back <= minutesBack + tolerance; back++) {
    const t = base - back;
    if (t < 0) return null;
    const v = spots.get(minutesToHhmm(t));
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

/**
 * Same-side ATM premium change at `hhmm` vs the nearest earlier minute (up
 * to `tolerance` back) — the client fallback for bursts without a backend
 * flow label. Null when unreadable; the caller then keeps the legacy rule.
 */
export function premiumChangeBefore(
  prems: Map<string, MinutePremium>,
  hhmm: string,
  side: "call" | "put",
  tolerance = 5,
): number | null {
  const base = hhmmToMinutes(hhmm);
  if (base === null) return null;
  const cur = prems.get(hhmm);
  if (!cur) return null;
  for (let back = 1; back <= 1 + tolerance; back++) {
    const t = base - back;
    if (t < 0) return null;
    const prev = prems.get(minutesToHhmm(t));
    if (!prev) continue;
    const chg = atmPremiumChange(prev, cur, side);
    if (chg !== null) return chg;
  }
  return null;
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
export function detectOiBursts(rows: NiftyTapeRow[], opts: DetectOptions = {}): OiBurst[] {  const window = opts.window ?? OI_BURST_WINDOW;
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

function levelText(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? formatNumberIN(Math.round(v)) : "";
}

/** Alert timestamp from a burst clock (bare `HH:MM` has no date → now). */
function burstTs(t: string): number {
  const parsed = Date.parse(t);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

/**
 * Strike-wall event → alert.
 *
 * Icons carry the event class so the row reads at a glance:
 *   ◇ wall_test  (watch — the wall is being tested, no break yet)
 *   ✕ rejection  (alert — the wall held; target = the move's magnet)
 *   ↑ / ↓ break  (alert — the wall broke; arrow follows the side)
 *
 * All wall events are `kind: "oi_burst"` so they join the existing trail/toast
 * pipeline; the severity rail is what colours them (watch = muted,
 * rejection/break = warning).
 */
function wallEventToAlert(burst: OiBurst): MarketAlert {
  const type = burst.type ?? "wall_test";
  const level = burst.strike ?? burst.wall ?? null;
  const target = burst.target ?? null;
  const sideCode = burst.side === "put" ? "PW" : "CW";
  const levelTxt = levelText(level);
  const targetTxt = levelText(target);
  const isTest = type === "wall_test";
  const isBreak = type === "break" || type === "wall_break";
  const icon = isTest ? "◇" : type === "rejection" ? "✕" : burst.side === "put" ? "↓" : "↑";
  const verb = isTest ? "TESTED" : type === "rejection" ? "REJECTED" : "BROKEN";
  const title = isTest
    ? `${icon} ${sideCode} ${levelTxt} ${verb}`
    : targetTxt
      ? `${icon} ${sideCode} ${levelTxt} → ${targetTxt}`
      : `${icon} ${sideCode} ${levelTxt} ${verb}`;

  const fallback = isTest
    ? `${sideCode} ${levelTxt} is being tested · no break yet`
    : type === "rejection"
      ? `${sideCode} ${levelTxt} held${targetTxt ? ` · magnet ${targetTxt}` : ""}`
      : `${sideCode} ${levelTxt} broke${targetTxt ? ` · next ${targetTxt}` : ""}`;
  const detail = [burst.detail?.trim(), burst.label?.trim(), fallback]
    .filter((part): part is string => typeof part === "string" && part.length > 0)
    .filter((part, i, all) => all.indexOf(part) === i)
    .join(" · ");

  const metrics = [
    ...(levelTxt ? [{ label: isBreak ? "BROKE" : "STRIKE", value: levelTxt }] : []),
    ...(targetTxt ? [{ label: "TGT", value: targetTxt, tone: "down" as const }] : []),
    ...(Number.isFinite(burst.spot) && burst.spot > 0
      ? [{ label: "SPOT", value: formatNumberIN(Math.round(burst.spot)) }]
      : []),
  ];

  return {
    id: burst.id,
    kind: "oi_burst",
    // A test is a heads-up; a rejection/break is the event itself.
    severity: isTest ? "watch" : "alert",
    symbol: "NIFTY",
    title,
    detail,
    metrics,
    ts: burstTs(burst.t),
    source: `Nifty walls · ${burstTimeLabel(burst.t)} IST`,
    href: "/report/index",
  };
}

/** Backend `data_stale` warning → critical system alert. */
function dataStaleToAlert(burst: OiBurst): MarketAlert {
  const since = burst.t ? ` since ${burstTimeLabel(burst.t)} IST` : "";
  const title = burst.label?.trim() || "DATA STALE";
  const detail =
    burst.detail?.trim() ||
    `The tape stopped updating${since}. Treat prices and OI as indicative until it resumes.`;
  return {
    id: burst.id,
    kind: "system",
    severity: "critical",
    symbol: "NIFTY",
    title,
    detail,
    metrics: [
      ...(burst.t ? [{ label: "TAPE", value: `${burstTimeLabel(burst.t)} IST` }] : []),
      ...(Number.isFinite(burst.spot) && burst.spot > 0
        ? [{ label: "SPOT", value: formatNumberIN(Math.round(burst.spot)) }]
        : []),
    ],
    ts: burstTs(burst.t),
    source: "Nifty tape watchdog",
    href: "/report/index",
  };
}

/**
 * Burst → alert. Grammar: WHAT (fuel) · WHERE (level) · WITH (reason) ·
 * GUARD (invalidation). A spent-fuel burst without a structure break prints
 * "NO TRADE"; a plan whose entry the market has run away from prints
 * "RE-PRICE". Both are actionable=false, so they never take the banner.
 */
export function burstToAlert(
  burst: OiBurst,
  signal?: OiSignal | null,
  opts: { freshness?: OiEntryFreshness | null } = {},
): MarketAlert {
  // Wall geometry and system warnings bypass the OI-burst grammar entirely.
  if (isWallEventType(burst.type)) return wallEventToAlert(burst);
  if (burst.type === "data_stale") return dataStaleToAlert(burst);

  const sideLabel = burst.side === "call" ? "Call" : "Put";
  const tone: "up" | "down" = burst.delta >= 0 ? "up" : "down";
  const scoreTxt = `${burst.score.toFixed(1)}× a normal minute`;

  // WHAT: fresh money, or a book being spent. Plain English, not "fuel" jargon.
  const fuel = resolveFuelState(burst);
  const spent = isSpentFuel(fuel);
  const plainFuel =
    fuel === "writers_covering"
      ? "shorts covering"
      : fuel === "longs_liquidating"
        ? "longs exiting"
        : fuel === "fresh_buyers"
          ? "buyers adding"
          : fuel === "fresh_sellers"
            ? "writers adding"
            : burst.delta >= 0
              ? "writers adding"
              : "shorts covering";
  const what = `${sideLabel} ${plainFuel} ${compact(burst.delta)}`;

  // WHERE: the level the underlying closed beyond.
  const structure = burst.structure ?? null;
  const where = structure
    ? `@ ${formatNumberIN(Math.round(burst.spot))} (${
        structure.direction === "up" ? "above" : "below"
      } the ${formatNumberIN(structure.level)} ${structure.kind ?? "level"})`
    : `@ ${formatNumberIN(Math.round(burst.spot))}`;

  const setupMetrics = burst.setup_label
    ? [
        { label: "SETUP", value: burst.setup_label },
        ...(burst.horizon ? [{ label: "MODE", value: burst.horizon.toUpperCase() }] : []),
        ...(burst.trigger != null ? [{ label: "TRIGGER", value: formatNumberIN(burst.trigger) }] : []),
      ]
    : [];

  // A covering burst at/near a call wall is a *scalp watch*, not the usual
  // "no trade" suppressed plan: spot was still below the wall at detection
  // (e.g. 24,995 vs 25,000 on 2026-11-09 11:35:58) and the break happens
  // seconds later. Surface the playbook without pretending it is a swing plan.
  if (burst.setup === "short_squeeze" && (!signal || burst.plan_suppressed === true)) {
    const trig = burst.trigger != null ? formatNumberIN(burst.trigger) : "the wall";
    return {
      id: burst.id,
      kind: "oi_burst",
      severity: burst.severity,
      symbol: "NIFTY",
      title: `SHORT SQUEEZE · scalp · wait for ${trig}`,
      detail: `${what} ${where}. ${
        burst.playbook ?? "Wait for a 1-min close through the wall; exit if the OI rebuilds."
      } ${scoreTxt}. Heuristic, not advice.`,
      metrics: [
        ...setupMetrics,
        { label: "ΔOI", value: compact(burst.delta), tone },
        { label: "SPOT", value: burst.spot.toLocaleString("en-IN", { maximumFractionDigits: 0 }) },
      ],
      ts: Date.parse(burst.t) || Date.now(),
      source: `Nifty tape · ${burstTimeLabel(burst.t)} IST · setup watch`,
      href: "/report/index",
      actionable: false,
    } as MarketAlert;
  }
  // The level the plan needs before it is a trade, and the "already spent" flag.
  const level = structure?.level ?? signal?.strike ?? null;
  const levelTxt = level != null ? formatNumberIN(level) : "";
  const dirWord = structure?.direction === "up" ? "above" : "below";
  const late = spent && !structure && !!signal;

  // GUARD: the level that invalidates the idea.
  const invalidation =
    burst.invalidation ??
    (structure && structure.direction === "down" ? structure.level : null);
  const guardTxt =
    invalidation !== null
      ? `while spot stays ${structure?.direction === "down" ? "below" : "above"} ${formatNumberIN(invalidation)}`
      : "";

  const freshness = opts.freshness ?? null;
  const stale = freshness?.stale === true;
  const staleTxt =
    stale && freshness?.live != null && signal
      ? `entry ${signal.entry.toFixed(2)} vs live ${freshness.live.toFixed(2)} (${
          freshness.driftPct! > 0 ? "+" : ""
        }${freshness.driftPct!.toFixed(1)}%)`
      : "";

  const metrics = signal
    ? [
        ...setupMetrics,
        { label: "ENTRY", value: signal.entry.toFixed(2) },
        ...(freshness?.live != null
          ? [{ label: "LIVE", value: freshness.live.toFixed(2) }]
          : []),
        { label: "SL", value: signal.sl.toFixed(2), tone: "down" as const },
        { label: "TGT", value: signal.target.toFixed(2), tone: "up" as const },
        { label: "QTY", value: signal.qty > 0 ? String(signal.qty) : "—" },
        { label: "ΔOI", value: compact(burst.delta), tone },
        ...(fuel ? [{ label: "FUEL", value: spent ? "spent" : "fresh" }] : []),
      ]
    : [
        ...setupMetrics,
        { label: "ΔOI", value: compact(burst.delta), tone },
        { label: "CUM", value: compact(burst.cumDoi), tone: burst.cumDoi >= 0 ? ("up" as const) : ("down" as const) },
        { label: "TICK", value: compact(burst.tickVol) },
        { label: "SPOT", value: burst.spot.toLocaleString("en-IN", { maximumFractionDigits: 0 }) },
        ...(fuel ? [{ label: "FUEL", value: spent ? "spent" : "fresh" }] : []),
      ];

  // Verdict: the backend withheld the plan, or spent fuel has no break in
  // this direction — either way it is not a trade.
  const suppressed =
    burst.plan_suppressed === true ||
    (fuel === "writers_covering" &&
      structure !== null &&
      structure.direction !== coveringDirection(burst.side));

  // WHY there is no trade: spent fuel without a break, or the backend's own
  // filter (trend / structure) withholding the plan.
  const noTradeWhy =
    fuel && isSpentFuel(fuel)
      ? `${FUEL_STATE_LABEL[fuel].toLowerCase()} — ${
          structure ? "no level closed in this direction" : "no structure break"
        }`
      : "plan withheld by the trend/structure filter";

  const setupPrefix =
    burst.setup === "wall_squeeze"
      ? "WALL SQUEEZE · "
      : burst.setup === "fresh_long"
        ? "FRESH BUY · "
        : "";
  const baseTitle = stale && signal
    ? `RE-PRICE · BUY ${signal.leg} ${formatNumberIN(signal.strike)} · ${staleTxt}`
    : suppressed
      ? `NO TRADE · ${noTradeWhy}`
      : signal
        ? late
          ? `BUY ${signal.leg} ${formatNumberIN(signal.strike)} only after the ${levelTxt} break`
          : `→ BUY ${signal.leg} ${formatNumberIN(signal.strike)} · qty ${signal.qty > 0 ? signal.qty : "—"}`
        : burst.type === "coil"
          ? `COILING @ ${typeof burst.wall === "number" ? formatNumberIN(burst.wall) : "wall"}`
          : `${sideLabel} OI burst ${compact(burst.delta)} in 1 min`;
  const title = setupPrefix && !baseTitle.startsWith("NO TRADE") ? `${setupPrefix}${baseTitle}` : baseTitle;

  const whyTxt =
    burst.type === "squeeze"
      ? "short-covering squeeze through a wall"
      : fuel === "writers_covering"
      ? "shorts buying back lifts the index"
      : fuel === "longs_liquidating"
        ? "longs exiting presses the index"
        : fuel === "fresh_buyers"
          ? "fresh buying supports the index"
          : fuel === "fresh_sellers"
            ? "fresh selling caps the index"
            : "flow shifted";
  const doTxt = late
    ? `wait for a 1-min close ${dirWord} ${levelTxt} before buying`
    : signal
      ? `buy ${signal.leg} ${formatNumberIN(signal.strike)} — entry ${signal.entry}, stop ${signal.sl}, target ${signal.target}`
      : "no trade — wait for a level break";

  const detail =
    burst.type === "coil"
      ? `spot ${formatNumberIN(burst.spot)} pressed on the ${burst.side} wall ${
          typeof burst.wall === "number" ? formatNumberIN(burst.wall) : "?"
        } · ${burst.range_pct?.toFixed(3) ?? "?"}% range, ${burst.dist_pct?.toFixed(3) ?? "?"}% away · heads-up, no plan`
      : suppressed
        ? `${what} ${where}. ${noTradeWhy}. ${doTxt}. Not a trade.`
        : signal
          ? `${what} ${where}. ${whyTxt}. ${doTxt}.${guardTxt ? ` ${guardTxt}.` : ""}${
              staleTxt ? ` ${staleTxt} — re-price before trading.` : ""
            } ${scoreTxt}. Heuristic, not advice.`
          : `${what} ${where}. ${whyTxt}. ${doTxt}.${guardTxt ? ` ${guardTxt}.` : ""}${burst.playbook ? ` ${burst.playbook}` : ""} ${scoreTxt} · ${burstTimeLabel(burst.t)} IST`;

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
    href: "/report/index",
    // A suppressed or stale plan must not take the sticky banner.
    ...(suppressed || stale ? { actionable: false } : {}),
  } as MarketAlert;
}

/* --------------------------------------- critical prominence */

/**
 * Critical-first sort for the OI-burst trail: critical alerts lead, every
 * other severity keeps its relative (newest-first) order. Stable, so a
 * non-critical trail is returned unchanged.
 */
export function sortAlertsCriticalFirst<T extends { severity: AlertSeverity }>(
  alerts: T[],
): T[] {
  return alerts
    .map((a, i) => ({ a, i }))
    .sort((x, y) => {
      const xr = x.a.severity === "critical" ? 0 : 1;
      const yr = y.a.severity === "critical" ? 0 : 1;
      return xr - yr || x.i - y.i;
    })
    .map(({ a }) => a);
}

/** Drop a trailing ".00" so banner levels read like the desk (`185`, not `185.00`). */
function shortNum(v: string): string {
  return v.endsWith(".00") ? v.slice(0, -3) : v;
}

/**
 * One-line sticky-banner label for a critical alert, e.g.
 * `CRITICAL PUT UNWIND -1.48M · 22,701 · → BUY CE 22,700 · entry 185 · SL 139 · TGT 277`.
 *
 * The head (side / build-vs-unwind / ΔOI / spot) comes from the burst; the
 * action and levels are read back off the `burstToAlert` output (title +
 * ENTRY/SL/TGT metrics) so the banner can never disagree with the row and no
 * signal math is duplicated here.
 */
export function criticalBannerText(
  burst: OiBurst | undefined,
  alert: MarketAlert,
): string {
  const doi =
    alert.metrics?.find((m) => m.label === "ΔOI")?.value ??
    (burst ? compact(burst.delta) : "");
  const fuel = burst ? resolveFuelState(burst) : null;
  const plain: Record<string, string> = {
    fresh_buyers: "BUYERS ADDING",
    fresh_sellers: "WRITERS ADDING",
    writers_covering: "SHORTS COVERING",
    longs_liquidating: "LONGS EXITING",
  };
  const head = burst
    ? `CRITICAL ${burst.side === "call" ? "CALL" : "PUT"} ${
        fuel ? plain[fuel] : burst.delta >= 0 ? "BUILD" : "UNWIND"
      } ${doi}`
    : "CRITICAL";
  const spotTxt =
    burst && Number.isFinite(burst.spot) && burst.spot > 0
      ? formatNumberIN(Math.round(burst.spot))
      : "";
  const entry = alert.metrics?.find((m) => m.label === "ENTRY")?.value;
  const sl = alert.metrics?.find((m) => m.label === "SL")?.value;
  const tgt = alert.metrics?.find((m) => m.label === "TGT")?.value;
  const plan =
    entry !== undefined && sl !== undefined && tgt !== undefined
      ? `${alert.title} · entry ${shortNum(entry)} · SL ${shortNum(sl)} · TGT ${shortNum(tgt)}`
      : alert.title;
  return [head, spotTxt, plan].filter((p) => p.length > 0).join(" · ");
}

/**
 * Two-sided writer builds are a pin, not a trade.
 *
 * 2026-10-29 09:19: call OI +3.6M and put OI +2.2M at 22,700 in the same
 * minute. The per-side plans are opposite (call writers -> fade with puts,
 * put writers -> floor holds, buy calls). Emitting both is a contradiction;
 * drop every burst in a minute whose per-side plans disagree.
 */
export function dropConflictingSides(bursts: OiBurst[]): OiBurst[] {
  const byMinute = new Map<string, OiBurst[]>();
  for (const b of bursts) {
    // Wall geometry and stale-data warnings are not per-side trade plans, so
    // they must never be counted as a two-sided pin (a call wall test + a put
    // wall test in the same minute used to cancel both rows).
    if (isNonTradeAlertType(b.type)) continue;
    const key = burstTimeLabel(b.t);
    const group = byMinute.get(key);
    if (group) group.push(b);
    else byMinute.set(key, [b]);
  }
  const drop = new Set<string>();
  for (const group of byMinute.values()) {
    if (group.length < 2) continue;
    const legs = new Set(
      group
        .map((b) => resolveOiDirection(b)?.leg)
        .filter((l): l is "CE" | "PE" => l === "CE" || l === "PE"),
    );
    if (legs.size > 1) {
      for (const b of group) drop.add(b.id);
    }
  }
  return drop.size === 0 ? bursts : bursts.filter((b) => !drop.has(b.id));
}
