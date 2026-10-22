/** US futures tape types (`/api/reports/us`). */

export type UsRoot = "NQ" | "ES" | "GC";
export type UsMode = "live" | "eod";

export interface UsStrike {
  k: number;
  c_oi: number;
  c_vol: number;
  p_oi: number;
  p_vol: number;
  /** Net dealer gamma at this strike, $m per 1% move (calls +, puts −). */
  g: number;
}

export interface UsRow {
  t: string;
  root: string;
  contract: string;
  series: string;
  expiry: string;
  spot: number;
  change_pct: number | null;
  change_pts: number | null;
  call_oi: number;
  put_oi: number;
  call_vol: number;
  put_vol: number;
  pcr_oi: number | null;
  pcr_vol: number | null;
  max_pain: number;
  call_wall: number;
  call_wall_oi: number;
  put_wall: number;
  put_wall_oi: number;
  exp_move_pct: number | null;
  atm_strike: number | null;
  net_gex: number;
  gex_flip: number | null;
  strikes: UsStrike[];
  n_strikes: number;
}

export interface UsLive {
  date: string;
  row: UsRow;
  source: "tape" | "live";
}

export interface UsTape {
  root: string;
  date: string;
  interval_sec: number;
  minutes: number;
  rows: UsRow[];
}

export interface UsEod {
  root: string;
  date: string;
  contract: string;
  series: string;
  expiry: string;
  minutes: number;
  first_t: string | null;
  last_t: string | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  change_pct: number | null;
  call_oi: number | null;
  put_oi: number | null;
  pcr_oi: number | null;
  pcr_vol: number | null;
  max_pain: number | null;
  call_wall: number | null;
  put_wall: number | null;
  exp_move_pct: number | null;
  wall_migrations: number;
  max_pain_touches: number;
  total_call_vol: number;
  total_put_vol: number;
}

export interface UsStatus {
  last_tick: string | null;
  last_error: string | null;
  iterations: number;
  interval_sec: number;
  roots: string[];
  market_open: boolean;
  now_et: string;
  dir: string;
}
