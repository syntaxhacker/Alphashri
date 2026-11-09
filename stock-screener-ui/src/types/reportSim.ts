/**
 * Strategy simulator types for the Index Report.
 *
 * A sim strategy is split into a STRUCTURE (legs / payoff) and EXECUTION
 * (when to enter and exit). The backend runs the recorded tape through the
 * same no-lookahead rules as `options_paper`, so the payload is the result of
 * one deterministic run — the UI never marks positions itself.
 */

export type SimAction = "BUY" | "SELL";
export type SimOpt = "CE" | "PE";

/** Strike reference: `ATM`, `ATM+2`, `ATM-2`, or an absolute strike ("24900"). */
export type SimStrikeRef = string;

export interface SimLegSpec {
  action: SimAction;
  opt: SimOpt;
  strike: SimStrikeRef;
  lots: number;
}

export interface SimExecSpec {
  /** `HH:MM` IST — the signal bar; the fill is the NEXT recorded minute. */
  entryTime: string;
  /** Stop as a percentage of the net debit/premium at risk. */
  slPct: number;
  /** Target as a percentage of the net debit/premium at risk. */
  tpPct: number;
  /** 0 = no time stop. */
  maxHoldMin: number;
  /** 0 = off; otherwise exit this far (pp) off the peak P&L percentage. */
  trailPct: number;
  /** `HH:MM` IST — flatten here. */
  eodExit: string;
}

export interface SimStrategySpec {
  id: string;
  name: string;
  legs: SimLegSpec[];
  exec: SimExecSpec;
}

export interface SimRunRequest {
  symbol: string;
  /** Omit for today's session. */
  date?: string;
  /** `HH:MM` — truncate the tape here (live = now). Omit for the full day. */
  asOf?: string;
  strategies: SimStrategySpec[];
  costs: boolean;
  slippageTicks: number;
}

export interface SimResolvedLeg {
  action: SimAction;
  opt: SimOpt;
  strike: number;
  lots: number;
  qty: number;
  entryPremium: number;
}

export interface SimOpenLeg {
  action: SimAction;
  opt: SimOpt;
  strike: number;
  lots: number;
  qty: number;
  entryPremium: number;
  mark: number;
  pnl: number;
}

export interface SimTrade {
  id: string;
  strategyId: string;
  strategyName: string;
  legs: SimResolvedLeg[];
  /** ISO timestamps (IST offset) for entry/exit bars. */
  entryTime: string;
  exitTime: string;
  entrySpot: number;
  exitSpot: number;
  /** Net premium paid (BUY) / received (SELL) per unit, signed. */
  entryPremium: number;
  exitPremium: number;
  lots: number;
  qty: number;
  grossPnl: number;
  costs: number;
  netPnl: number;
  /** Net P&L in premium points per unit. */
  points: number;
  exitReason: string;
  holdMin: number;
  /** False when a held leg could not be priced — never booked as a real trade. */
  priced: boolean;
}

export interface SimOpenPosition {
  strategyId: string;
  strategyName: string;
  legs: SimOpenLeg[];
  entryTime: string;
  entrySpot: number;
  markTime: string;
  markSpot: number;
  entryPremium: number;
  markPremium: number;
  grossPnl: number;
  netPnl: number;
  points: number;
  priced: boolean;
}

export interface SimPayoff {
  spots: number[];
  /** Gross structural P&L at expiry at each spot (costs shown separately). */
  expiry: number[];
}

export interface SimStats {
  trades: number;
  winRate: number;
  /** Gross wins / gross losses; 0 when there are no losses. */
  profitFactor: number;
  avgHoldMin: number;
  maxDrawdown: number;
}

export interface SimStrategyResult {
  id: string;
  name: string;
  legs: SimResolvedLeg[];
  /** Net debit (positive) / credit (negative) in rupees at entry. */
  netDebit: number;
  maxProfit: number;
  maxLoss: number;
  breakevens: number[];
  /** Indicative margin for short legs (0 when none). */
  marginEst: number;
  trades: SimTrade[];
  open: SimOpenPosition[];
  realized: number;
  unrealized: number;
  total: number;
  stats: SimStats;
  equity: Array<{ t: string; pnl: number }>;
  payoff: SimPayoff;
  /** Present when the strategy could not be entered (missing strike, no tape). */
  skipped?: string | null;
}

export interface SimCombinedResult {
  realized: number;
  unrealized: number;
  total: number;
  equity: Array<{ t: string; pnl: number }>;
}

export interface SimCoverage {
  frames: number;
  first: string | null;
  last: string | null;
  gaps: number;
}

export interface SimRunResult {
  symbol: string;
  date: string;
  expiry: string;
  dte: number;
  /** Last tape minute used (ISO). */
  asOf: string | null;
  spot: number;
  lotSize: number;
  lotVerified: boolean;
  coverage: SimCoverage;
  strategies: SimStrategyResult[];
  combined: SimCombinedResult;
  /** Seconds between the requested as-of and the last usable tape row. */
  tapeLagSec: number;
  /** Assumptions echoed back by the engine so the UI can print them. */
  fillModel: string;
  /** Set when the recorded chain is not the session's true expiry. */
  expiryNote?: string | null;
}

export interface SimTemplate {
  id: string;
  name: string;
  blurb: string;
  legs: SimLegSpec[];
  exec: SimExecSpec;
}
