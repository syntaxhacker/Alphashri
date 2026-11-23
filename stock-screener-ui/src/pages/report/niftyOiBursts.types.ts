import type { AlertSeverity } from "@/components/notifications/MarketAlertCard";
import type { NiftyBurstNews } from "@/types/niftyReport";

export const OI_BURST_WINDOW = 10;
export const OI_BURST_MIN_ABS = 2_000;
export const OI_BURST_WARMUP = 3;
export const OI_BURST_TIERS: Record<AlertSeverity, number> = {
  watch: 3,
  alert: 5,
  critical: 8,
  info: Infinity,
};

export interface MinuteDoi {
  t: string;
  dCall: number;
  dPut: number;
  callDoi: number;
  putDoi: number;
  spot: number;
  callTick: number;
  putTick: number;
}

/** The level the underlying closed beyond, and the direction (backend). */
export interface OiStructure {
  level: number;
  direction: "up" | "down";
  kind?: "day_high" | "day_low" | "pivot" | "wall" | "max_pain" | "other";
  close?: number;
  confirmed_at?: string;
}

export interface OiBurst {
  id: string;
  side: "call" | "put";
  t: string;
  delta: number;
  baseline: number;
  score: number;
  severity: AlertSeverity;
  cumDoi: number;
  spot: number;
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
  trend5m?: "up" | "down" | null;
  /** Candidate catalysts within ±10 min (backend-attached). */
  news?: NiftyBurstNews[];
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
  wall?: number;
  strike?: number;
  target?: number | null;
  /** Backend headline / longer explanation (wall + data-stale events). */
  label?: string | null;
  detail?: string | null;
  leg?: string;
  pct?: number;
  range_pct?: number;
  dist_pct?: number;
  /** Structure evidence for the burst minute: the named level the underlying
   * closed beyond, and the direction (backend-attached). */
  structure?: OiStructure | null;
  invalidation?: number | null;
  /** Backend says the plan was withheld (spent fuel, no structure break). */
  plan_suppressed?: boolean;
  /** Backend fuel state — the OI × premium 2×2 cell. */
  fuel_state?: OiFuelState;
}

export const OI_SIGNAL_RISK_BUDGET = 5_000;
export const OI_SIGNAL_SL_PCT = 25;
export const OI_SIGNAL_TP_PCT = 50;
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
  qty: number;
  lots: number;
  basis: string;
  trend?: "up" | "down" | null;
  aligned?: boolean | null;
}

export const TREND_EMA_SPAN = 20;

/** Backend buyer/writer flow labels (`classify_flow`). */
export type OiFlowKind = "buyers" | "writers" | "covering" | "liquidation";

export type OiFuelState =
  | "fresh_buyers"
  | "fresh_sellers"
  | "writers_covering"
  | "longs_liquidating";

export const SPENT_FUEL_STATES: ReadonlySet<OiFuelState> = new Set<OiFuelState>([
  "writers_covering",
  "longs_liquidating",
]);

export const FUEL_STATE_LABEL: Record<OiFuelState, string> = {
  fresh_buyers: "FRESH BUYING",
  fresh_sellers: "FRESH SELLING",
  writers_covering: "WRITERS COVERING",
  longs_liquidating: "LONGS LIQUIDATING",
};

/** Drift of the plan's entry against the live premium. A stale plan is void. */
export const OI_SIGNAL_STALE_PCT = 5;

/** Freshness of a signal's entry against the live premium. */
export interface OiEntryFreshness {
  live: number | null;
  driftPct: number | null;
  stale: boolean;
}

export type OiDirectionSource = "flow" | "premium" | "oi";

export interface OiDirection {
  leg: "CE" | "PE";
  /** Backend verdict when known (true = bearish → PE). */
  bearish: boolean | null;
  via: OiDirectionSource;
  basis: string;
}

/** One minute's ATM snapshot for the premium-direction fallback. */
export interface MinutePremium {
  strike?: number | null;
  ce?: number | null;
  pe?: number | null;
}

export interface DetectOptions {
  window?: number;
  minAbs?: number;
  warmup?: number;
}
