import { memo } from "react";
import Box from "@mui/material/Box";
import type { BacktestTotals } from "../../types/backtest";
import { formatPnl as formatPnlShared, getPnLTextColor } from "../../utils/ui-helpers";

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

  const Stat = ({ label, value, tone, testid }: { label: string; value: string; tone?: string; testid: string }) => (
    <Box
      sx={{
        flex: "1 1 0",
        minWidth: 0,
        px: 0.75,
        py: "3px",
        borderRight: "1px solid var(--mui-palette-divider)",
        "&:last-of-type": { borderRight: 0 },
      }}
    >
      <Box sx={{ fontSize: 8, lineHeight: 1.1, letterSpacing: 0.4, textTransform: "uppercase", color: "var(--mui-palette-text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {label}
      </Box>
      <Box
        data-testid={testid}
        sx={{ fontSize: 12, fontWeight: 700, lineHeight: 1.25, color: tone ?? "var(--mui-palette-text-primary)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
      >
        {value}
      </Box>
    </Box>
  );

  return (
    <Box
      id="backtest-summary"
      className="backtest-summary"
      data-testid="results-summary"
      sx={{ display: "flex", flexWrap: "wrap", borderBottom: "1px solid var(--mui-palette-divider)" }}
    >
      <Stat label="Net PnL" value={formatPnlShared(netPnl)} tone={pnlColor === "success" ? "var(--mui-palette-success-main)" : "var(--mui-palette-error-main)"} testid="summary-net-pnl" />
      <Stat label="Costs" value={`₹${(totalCosts / 1000).toFixed(1)}K`} tone="#FF7B72" testid="summary-costs" />
      <Stat label="WR" value={`${winRate.toFixed(0)}%`} testid="summary-wr" />
      <Stat label="Trades" value={String(totals.trades ?? 0)} testid="summary-trades" />
    </Box>
  );
});
