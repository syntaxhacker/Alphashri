/**
 * UI contract for the options paper book.
 *
 * A position is a multi-leg option structure owned by the logged-in user.
 * `source: "replay"` means the entry was backdated from a recorded chain and
 * committed at replay start; it is a real paper position from that moment on.
 */

export type OptionPaperSource = "live" | "replay";
export type OptionPaperStatus = "open" | "closed" | "expired";
export type OptionAction = "BUY" | "SELL";
export type OptionType = "CE" | "PE";

export interface OptionPaperLegInput {
  action: OptionAction;
  opt: OptionType;
  /** Absolute strike or a reference such as ATM / ATM+1 resolved by the server. */
  strike: number | string;
  lots: number;
  instrumentKey?: string;
  /** Only sent when adding a leg to an existing position (staggered entries). */
  entryTs?: string;
  /** ATM IV in vol points, carried across the dock→replay navigation. */
  atmIv?: number | null;
}

export interface OptionPaperOrderRequest {
  underlying: string;
  expiry: string;
  source: OptionPaperSource;
  /** ISO timestamp, required when source is "replay". */
  entryTs?: string;
  legs: OptionPaperLegInput[];
  slippageTicks?: number;
  name?: string;
  notes?: string;
  dryRun?: boolean;
}

/** Dock preview payload; ``atmIv`` is UI-only and ignored by the order API. */
export interface OptionPaperPendingOrder extends OptionPaperOrderRequest {
  atmIv?: number | null;
}

export interface OptionPaperLeg {
  id: number;
  positionId: number;
  action: OptionAction;
  optType: OptionType;
  strike: number;
  lots: number;
  qty: number;
  instrumentKey: string | null;
  /** Per-leg entry time; null/absent means inherited from the parent position. */
  entryTs?: string | null;
  entryPremium: number;
  markPremium: number;
  markTs: string | null;
  exitPremium: number | null;
}

export interface OptionPaperPosition {
  id: number;
  uuid: string;
  userId: number;
  source: OptionPaperSource;
  status: OptionPaperStatus;
  underlying: string;
  expiry: string;
  name: string;
  entryTs: string;
  entrySpot: number;
  lots: number;
  netDebit: number;
  costsEst: number;
  maxProfit: number;
  maxLoss: number;
  breakevens: number[];
  realizedPnl: number;
  closeReason: string | null;
  closedAt: string | null;
  notes: string;
  legs: OptionPaperLeg[];
  /** Live mark-to-market P&L, supplied by the list/detail readers. */
  unrealizedPnl: number;
  totalPnl: number;
  markSpot: number;
  markTs: string | null;
  dte: number;
  createdAt: string;
  updatedAt: string;
}

export interface OptionPaperOrderResult {
  dryRun: boolean;
  position: OptionPaperPosition | null;
  replay: OptionReplayResult | null;
}

export interface ReplayCoverage {
  frames: number;
  first: string | null;
  last: string | null;
  gaps: number;
}

export interface ReplayFrame {
  t: string;
  spot: number;
  marks: Record<string, number>;
  /** Legs already entered at this frame (staggered entries). */
  active?: Record<string, boolean>;
  priced: boolean;
  grossPnl: number;
  netPnl: number;
  netDebit: number;
  equity: number;
}

export interface OptionReplayResult {
  positionId: number | null;
  underlying: string;
  expiry: string;
  source: OptionPaperSource;
  frames: ReplayFrame[];
  legs: Array<{
    action: OptionAction;
    opt: OptionType;
    strike: number;
    lots: number;
    qty: number;
    entryPremium: number;
  }>;
  netDebit: number;
  summary: {
    realized: number;
    unrealized: number;
    total: number;
    maxDrawdown: number;
    costs: number;
  };
  coverage: ReplayCoverage;
  payoff: { spots: number[]; expiry: number[] };
  breakevens: number[];
  maxProfit: number;
  maxLoss: number;
  skipped: string | null;
}

export interface ReplaySession {
  underlying: string;
  expiry: string;
  date: string;
  source: "snapshot" | "chain10s" | "upstox";
  frames: number;
}

export interface ChainSnapshotLeg {
  strike: number;
  ceLtp: number;
  peLtp: number;
  ceOi: number;
  peOi: number;
}

export interface ChainSnapshot {
  t: string;
  spot: number;
  expiry: string;
  legs: ChainSnapshotLeg[];
  source: string;
  gaps: number;
}
