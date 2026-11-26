import { currencyFor } from "../../config/currency";
import type { StrategyProfitRow } from "../../types/profitability";

/** Money with the sign ahead of the symbol: -₹300, +₹1.2K (never ₹-300). */
export function formatSignedMoney(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount)) return "—";
  const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
  return `${sign}${currencyFor("INR").symbol}${currencyFor("INR").compact(Math.abs(amount))}`;
}

export interface ProfitKpis {
  net: number;
  /** null when there are no losing strategies to form a denominator. */
  profitFactor: number | null;
  /** Positive magnitude; the rail renders it with a leading minus. */
  maxDrawdown: number;
}

export function deriveProfitKpis(strategies: readonly StrategyProfitRow[]): ProfitKpis {
  let net = 0;
  let gains = 0;
  let losses = 0;
  let maxDrawdown = 0;
  for (const row of strategies) {
    const value = row.net_pnl ?? 0;
    net += value;
    if (value > 0) gains += value;
    else losses -= value;
    maxDrawdown = Math.max(maxDrawdown, row.max_dd ?? 0);
  }
  return { net, profitFactor: losses > 0 ? gains / losses : null, maxDrawdown };
}
