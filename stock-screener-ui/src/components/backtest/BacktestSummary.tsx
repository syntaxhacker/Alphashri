import { memo } from "react";
import type { BacktestTotals } from "../../types/backtest";
import { formatPnl as formatPnlShared, getPnLTextColor } from "../../utils/ui-helpers";
import { CompactStat, CompactStatGrid } from "../common/compact";

interface BacktestSummaryProps {
  totals: BacktestTotals | null;
}

export function resolveTotals(totals: BacktestTotals | null): {
  netPnl: number;
  totalCosts: number;
  winRate: number;
  trades: number;
} | null {
  if (!totals) return null;
  return {
    netPnl: totals.net_pnl ?? 0,
    totalCosts: totals.total_costs ?? 0,
    winRate: totals.win_rate ?? 0,
    trades: totals.trades ?? 0,
  };
}

export function formatCosts(totalCosts: number): string {
  return `₹${(totalCosts / 1000).toFixed(1)}K`;
}

export function formatWinRate(winRate: number): string {
  return `${winRate.toFixed(0)}%`;
}

export const BacktestSummary = memo(function BacktestSummary({ totals }: BacktestSummaryProps) {
  if (!totals) return null;

  const netPnl = totals.net_pnl ?? 0;
  const totalCosts = totals.total_costs ?? 0;
  const winRate = totals.win_rate ?? 0;

  const pnlColor = getPnLTextColor(netPnl);

  return (
    <CompactStatGrid
      id="backtest-summary"
      className="backtest-summary"
      data-testid="results-summary"
    >
      <CompactStat
        label="Net PnL"
        value={formatPnlShared(netPnl)}
        tone={pnlColor}
        className="summary-item summary-net-pnl"
        data-testid="summary-net-pnl"
      />
      <CompactStat
        label="Costs"
        value={`₹${(totalCosts / 1000).toFixed(1)}K`}
        tone="red"
        className="summary-item summary-costs"
        data-testid="summary-costs"
      />
      <CompactStat
        label="WR"
        value={`${winRate.toFixed(0)}%`}
        className="summary-item summary-wr"
        data-testid="summary-wr"
      />
      <CompactStat
        label="Trades"
        value={totals.trades ?? 0}
        className="summary-item summary-trades"
        data-testid="summary-trades"
      />
    </CompactStatGrid>
  );
});
