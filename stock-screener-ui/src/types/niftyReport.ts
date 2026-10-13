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
