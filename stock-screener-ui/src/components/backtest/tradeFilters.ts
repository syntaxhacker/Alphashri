// Shared trade-list filters used by both the Trades blotter and the per-trade
// chart list so a single filter selection drives both views.
export interface TradeFilters {
  side: string;
  result: string;
  reason: string;
}

export const DEFAULT_TRADE_FILTERS: TradeFilters = { side: "ALL", result: "ALL", reason: "ALL" };

interface FilterableTrade {
  net_pnl: number;
  exit_reason?: string | null;
  side?: string | null;
}

export const tradeReason = (t: FilterableTrade): string => t.exit_reason || "EOD";

/** Canonical side across data models: per-trade uses BUY/SELL, blotter LONG/SHORT. */
export function canonicalSide(side?: string | null): "LONG" | "SHORT" {
  const v = (side || "LONG").toUpperCase();
  return v === "SHORT" || v === "SELL" ? "SHORT" : "LONG";
}

export function matchesTradeFilters(t: FilterableTrade, f: TradeFilters): boolean {
  if (f.side !== "ALL" && canonicalSide(t.side) !== f.side) return false;
  if (f.result === "WIN" && t.net_pnl <= 0) return false;
  if (f.result === "LOSS" && t.net_pnl > 0) return false;
  if (f.reason !== "ALL" && tradeReason(t) !== f.reason) return false;
  return true;
}

// The blotter, the per-trade chart list and the Edge AI panel all filter the
// same trades snapshot with the same filter selection. Trade arrays are immutable
// snapshots in this store, so key the result by array identity + filter values
// and collapse those passes into one. The WeakMap lets discarded snapshots go.
const filteredByTrades = new WeakMap<object, Map<string, FilterableTrade[]>>();

export function filterTrades<T extends FilterableTrade>(trades: T[], f: TradeFilters): T[] {
  const key = `${f.side}\u0000${f.result}\u0000${f.reason}`;
  let byKey = filteredByTrades.get(trades);
  if (!byKey) {
    byKey = new Map();
    filteredByTrades.set(trades, byKey);
  }
  const cached = byKey.get(key);
  if (cached) return cached as T[];
  const result: FilterableTrade[] = trades.filter((t) => matchesTradeFilters(t, f));
  byKey.set(key, result);
  return result as T[];
}
