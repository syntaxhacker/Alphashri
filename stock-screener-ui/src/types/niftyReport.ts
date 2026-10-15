import type { ReplayCandle } from "./replay";

export type NiftyReportMode = "live" | "eod";

export interface NiftyOptionSide {
  ltp: number;
  close: number;
  oi: number;
  prevOi: number;
  oiChange: number;
  priceChange: number;
  sentiment: string;
  /** Per-leg cumulative volume — present in live/EOD payloads. */
  volume?: number;
  /** Option delta; `null` when the greeks block was absent. */
  delta?: number | null;
}

export interface NiftyStrike {
  strike: number;
  ce: NiftyOptionSide;
  pe: NiftyOptionSide;
}

export interface NiftyWall {
  strike: number;
  oi: number;
}

export interface NiftyOhlc {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface NiftyTimelineEvent {
  time: string;
  title: string;
  detail: string;
}

export interface NiftyGexStrike {
  strike: number;
  callGex: number;
  putGex: number;
  netGex: number;
}

export interface NiftyGexLevel {
  strike: number;
  netGex: number;
}

export interface NiftyGex {
  strikes: NiftyGexStrike[];
  netTotal: number;
  regime: "long" | "short" | "flat";
  topPositive: NiftyGexLevel[];
  topNegative: NiftyGexLevel[];
  zeroCross: number | null;
}

/** Who is in control of the session — `control` block on the live payload. */
export type NiftyControlVerdict = "call_writers" | "put_writers" | "balanced";

/** Session regime — `regime` block on the live payload. */
export type NiftyRegimeVerdict = "range_sell_premium" | "trend_buy" | "neutral";

/** Trend strength bucket — `strength` block on the live payload. */
export type NiftyStrengthVerdict = "strong" | "neutral" | "weak";

/**
 * Session-control block. Every field is nullable: the backend may omit the
 * block entirely (older deployments) or send a partial payload, and the UI
 * renders a dash for anything missing. Absence of the whole block is
 * represented by `undefined`.
 */
export interface NiftyControlBlock {
  verdict: NiftyControlVerdict | null;
  ce_doi: number | null;
  pe_doi: number | null;
  atm_ce_iv: number | null;
  atm_pe_iv: number | null;
  skew: number | null;
  gex_regime: string | null;
}

/** Range-vs-trend regime block. All numeric fields null-safe. */
export interface NiftyRegimeBlock {
  verdict: NiftyRegimeVerdict | null;
  range_pts: number | null;
  range_baseline_pts: number | null;
  range_pct: number | null;
  rv: number | null;
  iv: number | null;
  straddle_open: number | null;
  straddle_now: number | null;
  straddle_pct: number | null;
}

/** India VIX block. */
export interface NiftyVixBlock {
  ltp: number | null;
  prev_close: number | null;
  change_pct: number | null;
  day_high: number | null;
  day_low: number | null;
}

/** Trend-strength block. */
export interface NiftyStrengthBlock {
  verdict: NiftyStrengthVerdict | null;
  score: number | null;
  ema20: number | null;
  ema50: number | null;
  rsi: number | null;
  pos_in_range: number | null;
}

/**
 * Exchange session gate — `market` block on the live payload. Lets the UI stop
 * polling after hours and stop labelling a stale close as "live".
 */
export interface NiftyMarketBlock {
  is_open: boolean | null;
  session_date: string | null;
  as_of: string | null;
}

/** Delta-positioning direction — `positioning` block on the live payload. */
export type NiftyPositioningVerdict = "bullish" | "bearish" | "balanced";

/** One leg's class + session ΔOI + initiated delta exposure (Cr). */
export interface NiftyPositioningLeg {
  class: string;
  doi: number;
  initiated: number;
}

/** Per-strike delta-positioning breakdown. */
export interface NiftyPositioningStrike {
  strike: number;
  ce: NiftyPositioningLeg;
  pe: NiftyPositioningLeg;
  netInitiated: number;
}

/**
 * Delta-positioning block. Values are signed crore (positive = bullish tilt).
 * Every field is nullable — absent/partial payloads render as dashes.
 */
export interface NiftyPositioningBlock {
  verdict: NiftyPositioningVerdict | null;
  /** Σ OI × |delta|, calls + / puts − (signed Cr). */
  state: number | null;
  /** Same sum over today's ΔOI (signed Cr). */
  flow: number | null;
  /** ΔOI × |delta| signed by class (signed Cr; + = bullish). */
  initiated: number | null;
  /** Gross bullish initiated magnitude (Cr). */
  bullCr: number | null;
  /** Gross bearish initiated magnitude (Cr). */
  bearCr: number | null;
  /** Dominant side's share of gross initiated, 0-100. */
  splitPct: number | null;
  ceDoi: number | null;
  peDoi: number | null;
  lotSize: number | null;
  strikes: NiftyPositioningStrike[];
}

/** Structural-shift kinds the option-tape detector emits. */
export const NIFTY_STRUCTURE_KINDS = [
  "wall_flip",
  "wall_move",
  "max_pain_drift",
  "pcr_shift",
  "volume_spike",
  "level_break",
] as const;

export type NiftyStructureKind = (typeof NIFTY_STRUCTURE_KINDS)[number];

/** Structural-shift severities, weakest → strongest. */
export const NIFTY_STRUCTURE_SEVERITIES = ["watch", "alert", "critical"] as const;

export type NiftyStructureSeverity = (typeof NIFTY_STRUCTURE_SEVERITIES)[number];

/**
 * One timestamped structural shift in the option tape — the "why" behind a
 * move (e.g. a support wall flipping into resistance). `kind` and `severity`
 * stay plain strings on purpose: a newer detector may emit a value this build
 * doesn't know, and the UI falls back to a neutral label/accent rather than
 * dropping the row. Absence of the whole array is `undefined`.
 */
export interface NiftyStructureShift {
  /** IST ISO timestamp, e.g. `2026-10-14T13:06:00+05:30`. */
  t: string;
  kind: string;
  detail: string;
  severity: string;
  /** Number whose meaning varies by `kind`; non-finite → `null`. */
  magnitude: number | null;
  side?: "call" | "put";
  level?: number | null;
}

export interface NiftyReport {
  mode: NiftyReportMode;
  date: string;
  expiry: string;
  spot: number;
  ohlc: NiftyOhlc;
  pcrOi: number;
  pcrVol: number;
  maxPain: number;
  walls: {
    calls: NiftyWall[];
    puts: NiftyWall[];
  };
  strikes: NiftyStrike[];
  timeline: NiftyTimelineEvent[];
  candles?: ReplayCandle[];
  fetchedAt?: string;
  snapshotAt?: string;
  gex?: NiftyGex;
  /** Session-control block — absent/partial payloads render as dashes. */
  control?: NiftyControlBlock;
  /** Range-vs-trend regime block — absent/partial payloads render as dashes. */
  regime?: NiftyRegimeBlock;
  /** India VIX block — absent/partial payloads render as dashes. */
  vix?: NiftyVixBlock;
  /** Trend-strength block — absent/partial payloads render as dashes. */
  strength?: NiftyStrengthBlock;
  /** Exchange session gate — absent means "unknown", keep polling. */
  market?: NiftyMarketBlock;
  /** Delta-positioning block — absent/partial payloads render as dashes. */
  positioning?: NiftyPositioningBlock;
  /** Structural tape shifts — absent renders nothing, `[]` renders empty. */
  structure?: NiftyStructureShift[];
}

/** Live Sensex context shown beside the Nifty report. */
export interface NiftySensex {
  symbol: "SENSEX";
  spot: number;
  expiry: string;
  pcrOi: number;
  pcrVol: number;
  maxPain: number;
  walls: {
    calls: NiftyWall[];
    puts: NiftyWall[];
  };
  ohlc: NiftyOhlc;
  fetchedAt?: string;
  market?: NiftyMarketBlock;
}

/** One per-minute OI tape row — `GET /api/reports/nifty/tape`. */
export interface NiftyTapeRow {
  t: string;
  spot: number;
  call_doi: number;
  put_doi: number;
  net: number;
  net_pct: number;
  call_tick: number;
  put_tick: number;
  pcr_vol: number;
  pcr_oi: number;
  pcr_doi: number;
  spot_flip: number | null;
  max_pain: number;
  flip: number;
  walls: {
    call: number;
    put: number;
  };
  /** ATM leg snapshot captured per minute (may be absent on older tapes). */
  atm_strike?: number;
  atm_ce_ltp?: number | null;
  atm_pe_ltp?: number | null;
  /** Per-minute net dealer gamma (Cr/point); absent on older tapes. */
  net_gex?: number | null;
  /** Per-minute ATM implied vol; absent on older tapes. */
  atm_ce_iv?: number | null;
  atm_pe_iv?: number | null;
}

/** A ready-to-trade burst signal block — `null` when the burst only merits a flag. */
export interface NiftyBurstSignal {
  leg: "CE" | "PE";
  strike: number;
  entry: number;
  sl: number;
  target: number;
  qty: number;
  lots: number;
  basis: string;
}

/** A stored headline near a burst, attached by the backend (±10 min window). */
export interface NiftyBurstNews {
  heading: string;
  link: string;
  source: string;
  /** Headline publish time minus burst time, in minutes (negative = before). */
  minutesAway: number;
}

/** One OI-burst alert — `GET /api/reports/nifty/bursts`. */
export interface NiftyBurst {
  id: string;
  side: "call" | "put";
  t: string;
  delta: number;
  baseline: number;
  score: number;
  severity: "info" | "watch" | "alert" | "critical";
  cumDoi: number;
  spot: number;
  tickVol: number;
  signal: NiftyBurstSignal | null;
  /** Candidate catalysts within ±10 min; empty when the news store had none. */
  news?: NiftyBurstNews[];
  /** "squeeze" = wall break w/ unwinding OI (momentum); "strike" = single-strike
   * explosion; absent = index OI burst (fade). */
  type?: "burst" | "squeeze" | "strike" | "premium" | "coil";
  /** Wall strike the squeeze broke through. */
  wall?: number;
}

export interface NiftyTape {
  date: string;
  interval_sec: number;
  rows: NiftyTapeRow[];
  /** First recorded row's `t` — ΔOI deltas are measured vs this timestamp,
   * which may be after the open when the recorder booted late. */
  baseline_t?: string;
  /** Optional session summary — the header falls back to these when the
   * last row carries zeros (e.g. sparse fixtures). */
  pcr_oi?: number;
  max_pain?: number;
  flip?: number;
  walls?: {
    call: number;
    put: number;
  };
}
