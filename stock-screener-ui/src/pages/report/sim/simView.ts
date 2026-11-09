import type {
  SimOpenPosition,
  SimRunResult,
  SimStats,
  SimStrategyResult,
  SimTrade,
} from "@/types/reportSim";
import { sliceEquityAt } from "./simFormat";

export interface StrategyView {
  equity: Array<{ t: string; pnl: number }>;
  trades: SimTrade[];
  realized: number;
  unrealized: number;
  total: number;
  /** Computed from trades closed by the playhead, never the finished day. */
  stats: SimStats;
}

function timeMs(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

function compareTime(a: string, b: string): number {
  const am = timeMs(a);
  const bm = timeMs(b);
  if (am !== null && bm !== null) return am - bm;
  return a < b ? -1 : a > b ? 1 : 0;
}

function atOrBefore(value: string, asOf: string): boolean {
  return compareTime(value, asOf) <= 0;
}

/** Trades whose entry bar is at or before the playhead; all when unset. */
export function filterTradesAt(
  trades: SimTrade[],
  asOf: string | null | undefined,
): SimTrade[] {
  if (!asOf) return trades;
  return trades.filter((trade) => atOrBefore(trade.entryTime, asOf));
}

/** Trades already exited at the playhead; all when unset. */
export function closedTradesAt(
  trades: SimTrade[],
  asOf: string | null | undefined,
): SimTrade[] {
  if (!asOf) return trades;
  return trades.filter((trade) => Boolean(trade.exitTime) && atOrBefore(trade.exitTime, asOf));
}

function lastPnl(equity: Array<{ t: string; pnl: number }>): number {
  if (equity.length === 0) return 0;
  const pnl = equity[equity.length - 1].pnl;
  return Number.isFinite(pnl) ? pnl : 0;
}

function sumNet(trades: SimTrade[]): number {
  return trades.reduce(
    (sum, trade) => (Number.isFinite(trade.netPnl) ? sum + trade.netPnl : sum),
    0,
  );
}

function maxDrawdown(equity: Array<{ t: string; pnl: number }>): number {
  let peak = Number.NEGATIVE_INFINITY;
  let worst = 0;
  for (const point of equity) {
    if (!Number.isFinite(point.pnl)) continue;
    peak = Math.max(peak, point.pnl);
    worst = Math.max(worst, peak - point.pnl);
  }
  return worst;
}

function buildStats(
  closed: SimTrade[],
  openCount: number,
  equity: Array<{ t: string; pnl: number }>,
): SimStats {
  const wins = closed.filter((trade) => trade.netPnl > 0);
  const losses = closed.filter((trade) => trade.netPnl < 0);
  const grossWins = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLosses = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const holds = closed.reduce((sum, trade) => sum + trade.holdMin, 0);
  return {
    trades: closed.length + openCount,
    winRate: closed.length > 0 ? (wins.length / closed.length) * 100 : 0,
    profitFactor: grossLosses > 0 ? grossWins / grossLosses : 0,
    avgHoldMin: closed.length > 0 ? holds / closed.length : 0,
    maxDrawdown: maxDrawdown(equity),
  };
}

function unitsOf(trade: SimTrade): number {
  return trade.lots > 0 ? trade.qty / trade.lots : 0;
}

/** Mark a still-open trade at the playhead instead of leaking its future exit. */
function asOpenAt(trade: SimTrade, markPnl: number, asOf: string): SimTrade {
  const units = unitsOf(trade);
  const entryMs = timeMs(trade.entryTime);
  const asOfMs = timeMs(asOf);
  const holdMin =
    entryMs !== null && asOfMs !== null
      ? Math.max(0, (asOfMs - entryMs) / 60_000)
      : trade.holdMin;
  return {
    ...trade,
    exitTime: "",
    exitSpot: trade.entrySpot,
    exitPremium: units > 0 ? trade.entryPremium + markPnl / units : trade.entryPremium,
    grossPnl: markPnl,
    costs: 0,
    netPnl: markPnl,
    points: units > 0 ? markPnl / units : 0,
    exitReason: "OPEN",
    holdMin,
    priced: true,
  };
}

function fromOpenPosition(open: SimOpenPosition): SimTrade {
  const entryMs = timeMs(open.entryTime);
  const markMs = timeMs(open.markTime);
  const holdMin =
    entryMs !== null && markMs !== null
      ? Math.max(0, (markMs - entryMs) / 60_000)
      : 0;
  return {
    id: `${open.strategyId}#open`,
    strategyId: open.strategyId,
    strategyName: open.strategyName,
    legs: open.legs.map((leg) => ({
      action: leg.action,
      opt: leg.opt,
      strike: leg.strike,
      lots: leg.lots,
      qty: leg.qty,
      entryPremium: leg.entryPremium,
    })),
    entryTime: open.entryTime,
    exitTime: "",
    entrySpot: open.entrySpot,
    exitSpot: open.markSpot,
    entryPremium: open.entryPremium,
    exitPremium: open.markPremium,
    lots: open.legs[0]?.lots ?? 1,
    qty: open.legs[0]?.qty ?? 0,
    grossPnl: open.grossPnl,
    costs: 0,
    netPnl: open.netPnl,
    points: open.points,
    exitReason: "OPEN",
    holdMin,
    priced: open.priced,
  };
}

/**
 * Snapshot of one strategy at the playhead. A trade that has not exited by
 * `asOf` is shown as OPEN at the current mark — never with its future exit
 * price, reason or hold time.
 */
export function strategyViewAt(
  result: SimStrategyResult,
  asOf: string | null,
): StrategyView {
  const equity = sliceEquityAt(result.equity, asOf);
  const total = lastPnl(equity);
  const closed = asOf
    ? result.trades.filter((trade) => Boolean(trade.exitTime) && atOrBefore(trade.exitTime, asOf))
    : result.trades;
  const realized = sumNet(closed);
  const openPnl = total - realized;

  const trades: SimTrade[] = [];
  let openCount = 0;
  for (const trade of result.trades) {
    if (asOf && !atOrBefore(trade.entryTime, asOf)) continue;
    if (!asOf || (trade.exitTime && atOrBefore(trade.exitTime, asOf))) {
      trades.push(trade);
      continue;
    }
    trades.push(asOpenAt(trade, openCount === 0 ? openPnl : 0, asOf));
    openCount += 1;
  }
  if (!asOf) {
    for (const open of result.open) {
      trades.push(fromOpenPosition(open));
      openCount += 1;
    }
  }

  return {
    equity,
    trades,
    realized,
    unrealized: openPnl,
    total,
    stats: buildStats(closed, openCount, equity),
  };
}

/** Desk-wide snapshot; realized is the sum of the per-strategy playhead views. */
export function combinedViewAt(
  result: SimRunResult,
  asOf: string | null,
): StrategyView {
  const equity = sliceEquityAt(result.combined.equity, asOf);
  const total = lastPnl(equity);
  const realized = result.strategies.reduce(
    (sum, strategy) => sum + strategyViewAt(strategy, asOf).realized,
    0,
  );
  return {
    equity,
    trades: [],
    realized,
    unrealized: total - realized,
    total,
    stats: buildStats([], 0, equity),
  };
}

export function isOpenTrade(trade: SimTrade, asOf: string | null): boolean {
  if (trade.exitReason === "OPEN" || !trade.exitTime) return true;
  if (!asOf) return false;
  return (
    atOrBefore(trade.entryTime, asOf) && compareTime(trade.exitTime, asOf) > 0
  );
}

export function selectedStrategy(
  result: SimRunResult | null,
  id: string | null,
): SimStrategyResult | null {
  if (!result || !id) return null;
  return result.strategies.find((strategy) => strategy.id === id) ?? null;
}
