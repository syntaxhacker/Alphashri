/** Daily report API response shapes (GET /api/reports/daily, /api/reports/breakouts,
 * GET /api/reports/follow-through). All backend-round additions are optional so
 * the UI keeps rendering when the server omits them. */

export interface DailyMoveRow {
  symbol: string;
  name?: string;
  close: number;
  change: number;
  logo?: string | null;
  sub_label?: string;
  sub_value?: string;
  spark?: number[];
  rsi?: number | null;
  vwap?: number | null;
  atr?: number | null;
  price_52_week_high?: number | null;
  market_cap?: number | null;
}

export interface DailyBreadth {
  total: number;
  advances: number;
  declines: number;
  unchanged: number;
  new_highs: number;
  new_lows: number;
  avg_change: number;
  median_change: number;
  up_volume: number;
  down_volume: number;
}

export type DailyMovesPanelId =
  | "gainers"
  | "losers"
  | "volume_surge"
  | "gap_up"
  | "gap_down"
  | "range_expansion"
  | "new_52w_high"
  | "new_52w_low"
  | "turnover";

export type DailyMoves = Record<DailyMovesPanelId, DailyMoveRow[]>;

export interface SectorLeader {
  name: string;
  change: number;
  stock_count: number;
  advances: number;
  declines: number;
}

export interface SectorLeaderBoard {
  top: SectorLeader[];
  bottom: SectorLeader[];
}

export interface ReportIndexSnapshot {
  name: string;
  change: number;
  close: number;
}

export interface DailyReportResponse {
  date: string;
  universe: string;
  as_of: string;
  cached: boolean;
  age_sec?: number;
  breadth: DailyBreadth;
  moves: Partial<DailyMoves>;
  index?: ReportIndexSnapshot | null;
  sector_leaders?: SectorLeader[] | SectorLeaderBoard;
  theme_leaders?: SectorLeader[] | SectorLeaderBoard;
}

export interface BreakoutRow {
  symbol: string;
  name?: string;
  type: string;
  level: number;
  close: number;
  pct_above: number;
  volume_ratio?: number | null;
  change: number;
  to_52w_high?: number | null;
  sector?: string;
  spark?: number[];
  /** Optional 5-day daily-close spark source. When absent the row keeps its
   * single intraday (0..1) spark and no range toggle is shown. */
  daily_closes?: number[];
}

export interface BreakoutSide {
  count: number;
  by_type: Record<string, number>;
  rows: BreakoutRow[];
}

export interface ReportBreakoutsResponse {
  date: string;
  universe: string;
  as_of: string;
  cached: boolean;
  scanned: number;
  breakouts: BreakoutSide;
  breakdowns: BreakoutSide;
}

export interface DeliveryRow {
  symbol: string;
  delivery_qty: number;
  delivery_pct: number;
  traded_qty: number;
  close: number;
}

export interface DeliveryResponse {
  date: string;
  universe: string;
  as_of: string;
  cached: boolean;
  age_sec?: number;
  source: string;
  rows: DeliveryRow[];
}

export type ReportEventKind = "results" | "dividend" | "split";

export interface ReportEvent {
  date: string;
  symbol: string;
  kind: ReportEventKind;
  title: string;
}

export interface ReportEventsResponse {
  from: string;
  to: string;
  as_of: string;
  cached: boolean;
  age_sec?: number;
  events: ReportEvent[];
  symbols_covered: number;
  symbols_total: number;
  coverage_note?: string;
}

export interface FollowThroughRow {
  symbol: string;
  name?: string;
  type: string;
  level: number;
  ref_close: number;
  last_close: number;
  ret_pct: number;
  max_fav_pct: number;
  max_adv_pct: number;
  held: boolean;
}

export interface FollowThroughSide {
  count: number;
  winners: number;
  losers: number;
  avg_ret: number;
  rows: FollowThroughRow[];
}

export interface FollowThroughResponse {
  date: string;
  universe: string;
  as_of: string;
  breakouts: FollowThroughSide;
  breakdowns: FollowThroughSide;
}
