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
  /** Option gamma; `null` when the greeks block was absent. */
  gamma?: number | null;
  /** Option theta (per day); `null` when the greeks block was absent. */
  theta?: number | null;
  /** Option vega; `null` when the greeks block was absent. */
  vega?: number | null;
  /** Implied volatility %; `null` when the greeks block was absent. */
  iv?: number | null;
}

export interface NiftyStrike {
  strike: number;
  ce: NiftyOptionSide;
  pe: NiftyOptionSide;
}

export interface NiftyWall {
  strike: number;
  oi: number;
  /** Points from spot (negative = below) — a wall is never shown bare. */
  distance?: number;
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
  /** Which side of spot the strike sits on (`spot-relative` levels only). */
  side?: "above" | "below";
}

/**
 * Spot-relative gamma levels. ``support`` / ``resistance`` are positive-gamma
 * pin magnets at/below and at/above spot; ``fuelDown`` / ``fuelUp`` are the
 * negative-gamma accelerators on the same sides. Any entry may be null when no
 * strike on that side qualifies. Absent on payloads recorded before this block
 * existed — the panel then derives the same levels from the strike profile.
 */
export interface NiftyGexLevels {
  support: NiftyGexLevel | null;
  resistance: NiftyGexLevel | null;
  fuelDown: NiftyGexLevel | null;
  fuelUp: NiftyGexLevel | null;
}

export interface NiftyGex {
  strikes: NiftyGexStrike[];
  netTotal: number;
  regime: "long" | "short" | "flat";
  topPositive: NiftyGexLevel[];
  topNegative: NiftyGexLevel[];
  levels?: NiftyGexLevels;
  zeroCross: number | null;
  /**
   * True when the profile was built without option greeks (open-interest
   * proxy). Its `netTotal` is a contract count, not ₹ Cr/point, so the UI
   * must not print it as a gamma figure.
   */
  degraded?: boolean;
}

/**
 * Who is in control of the session — `control` block on the live payload.
 *
 * `*_writers` / `*_buyers` need OI build *and* signed flow agreement: added
 * put OI on a bearish tape is put BUYING (bearish), not put writing. The
 * neutral `net_*_build` labels are used when the flow block is absent, because
 * OI share alone cannot identify the participant.
 */
export type NiftyControlVerdict =
  | "call_writers"
  | "put_writers"
  | "call_buyers"
  | "put_buyers"
  | "net_call_build"
  | "net_put_build"
  | "balanced";

/** Session regime — `regime` block on the live payload. */
export type NiftyRegimeVerdict =
  | "range_sell_premium"
  | "trend_buy"
  | "trend"
  | "neutral";

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
  /** Intraday bars backing `rv`; the RV/IV vote is ignored below a threshold. */
  bars?: number | null;
  /** True while too few bars exist for RV to be trusted. */
  warmup?: boolean | null;
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
  ema9?: number | null;
  ema20: number | null;
  ema50: number | null;
  rsi: number | null;
  pos_in_range: number | null;
}

/** One 1-minute intraday candle backing the Nifty chart + EMAs. */
export interface NiftyIntradayCandle {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

/** One EMA series aligned index-wise to `intraday`. */
export interface NiftyEmaSeries {
  period: number;
  data: (number | null)[];
}

/** Previous session's OHLC the pivots were derived from — null-safe fields. */
export interface NiftyPivotPrev {
  date: string | null;
  high: number | null;
  low: number | null;
  close: number | null;
}

/**
 * Classic pivots block — computed by the backend from the previous session's
 * H/L/C. `NiftyReport.pivots` is `null`/absent when the backend has not
 * produced the block yet (the chart draws nothing); each level is
 * individually nullable so a partial payload still draws what it carries.
 */
export interface NiftyPivots {
  type: string;
  pp: number | null;
  r1: number | null;
  r2: number | null;
  r3: number | null;
  s1: number | null;
  s2: number | null;
  s3: number | null;
  prev: NiftyPivotPrev | null;
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

/**
 * Fixed-strike ATM reference. The panel's rolling ATM leg re-anchors to the
 * nearest strike each minute and so reads ~flat; this pins the day's FIRST ATM
 * strike so the premium move vs spot is visible.
 */
export interface NiftyReference {
  strike: number | null;
  ce_open: number | null;
  pe_open: number | null;
  ce_ltp: number | null;
  pe_ltp: number | null;
  ce_change: number | null;
  pe_change: number | null;
  since: string | null;
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
  /**
   * Per-strike open-interest delta exposure (Cr) — calls positive, puts
   * negative. The running sum across strikes is what defines `deltaFlip`.
   * Absent on older snapshots recorded before the field was emitted.
   */
  netState?: number | null;
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
  /** Strike where cumulative OI×delta exposure changes sign (call-heavy above). */
  deltaFlip: number | null;
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
  /** Heaviest OI within ±300 pts of spot — the actionable walls. */
  wallsNear?: {
    calls: NiftyWall[];
    puts: NiftyWall[];
  };
  strikes: NiftyStrike[];
  timeline: NiftyTimelineEvent[];
  candles?: ReplayCandle[];
  /** 1-minute intraday candles (preferred chart source when present). */
  intraday?: NiftyIntradayCandle[];
  /** EMA series aligned index-wise to `intraday`. */
  emas?: NiftyEmaSeries[];
  /** Classic pivots from the previous session — `null` renders nothing. */
  pivots?: NiftyPivots | null;
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
  /** Fixed-strike ATM reference — absent/partial renders as dashes. */
  reference?: NiftyReference | null;
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
  /** Heaviest OI within ±300 pts of spot — the actionable walls. */
  wallsNear?: {
    calls: NiftyWall[];
    puts: NiftyWall[];
  };
  ohlc: NiftyOhlc;
  fetchedAt?: string;
  market?: NiftyMarketBlock;
}

/** One recorded per-minute snapshot — a full report envelope plus the
 *  optional Sensex context captured at the same minute by the recorder. */
export interface NiftyReplayFrame {
  t: string;
  fetched_at: string;
  report: NiftyReport;
  sensex: NiftySensex | null;
}

/** `GET /api/reports/nifty/replay?date=…` — every recorded snapshot for one
 *  date, oldest first, so EOD mode can replay the day minute-by-minute. */
export interface NiftyReplay {
  date: string;
  count: number;
  interval_sec: number;
  snapshots: NiftyReplayFrame[];
  /** Skipped-minute counts by reason (``{chain-failed: 41, timeout: 12}``).
   *  Absent for days recorded before the gap journal existed. */
  gap_reasons?: Record<string, number>;
}

/** Per-strike chain snapshot — `chain[strike] = [ce_ltp, pe_ltp, ce_oi, pe_oi, ce_vol, pe_vol]`
 *  with dead legs stored as `null` (so "no trade" stays distinguishable from
 *  "no price"). Absent on tapes recorded before the backend emitted it. */
export type NiftyTapeChainTuple = [
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
];

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
  /** That minute's gamma block was an OI proxy (no option greeks). */
  gex_degraded?: boolean;
  /** Per-minute ATM implied vol; absent on older tapes. */
  atm_ce_iv?: number | null;
  atm_pe_iv?: number | null;
  /** Per-strike chain snapshot backing the heatmap / participant-flow /
   *  volume-profile visuals; absent on tapes recorded before it existed. */
  chain?: Record<string, NiftyTapeChainTuple>;
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

/** The level the underlying closed beyond, and the direction (backend). */
export interface NiftyBurstStructure {
  /** The level that was closed beyond (e.g. 22,697). */
  level: number;
  /** Direction of the break. */
  direction: "up" | "down";
  /** What kind of level it was (day_high / day_low / pivot / wall / …). */
  kind?: string;
  /** The confirming close. */
  close?: number;
  /** Timestamp of the confirming close. */
  confirmed_at?: string;
}

/** OI direction × premium direction: fresh money, or a book being spent. */
export type NiftyBurstFuelState =
  | "fresh_buyers"
  | "fresh_sellers"
  | "writers_covering"
  | "longs_liquidating";

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
  /** Buyer/writer flow label from the backend (`classify_flow`); absent on
   * bursts recorded before the restart. One of buyers/writers/covering/
   * liquidation — WHO traded, read from OI + same-side ATM premium. */
  flow?: string;
  /** Backend direction verdict (true = bearish → buy puts). Absent with `flow`. */
  bearish?: boolean | null;
  /** Same-side ATM premium change (₹) over the burst minute — the premium
   * direction half of the fuel 2×2. */
  premChg?: number | null;
  /** Backend fuel state: fresh money, or a book being spent. */
  fuel_state?: NiftyBurstFuelState;
  /** The level the underlying closed beyond, and the direction. */
  structure?: NiftyBurstStructure | null;
  /** Level that invalidates the idea (e.g. the pivot that was broken). */
  invalidation?: number | null;
  /** The backend withheld the plan (spent fuel, no structure break). */
  plan_suppressed?: boolean;
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
