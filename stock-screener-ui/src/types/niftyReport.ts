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
