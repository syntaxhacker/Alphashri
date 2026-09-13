import { memo } from "react";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import Divider from "@mui/material/Divider";
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

const Metric = ({
  label,
  value,
  tone,
  testid,
}: {
  label: string;
  value: string;
  tone?: string;
  testid: string;
}) => (
  <Stack sx={{ flex: "1 1 0", minWidth: 92, px: 1.5, py: 0.75, gap: 0.25, justifyContent: "center" }}>
    <Typography
      variant="overline"
      sx={{ fontSize: 10, lineHeight: 1.1, letterSpacing: 0.6, fontWeight: 600, color: "text.secondary" }}
    >
      {label}
    </Typography>
    <Typography
      variant="subtitle1"
      data-testid={testid}
      sx={{ fontSize: 18, fontWeight: 700, lineHeight: 1.15, color: tone ?? "text.primary", fontVariantNumeric: "tabular-nums" }}
    >
      {value}
    </Typography>
  </Stack>
);

export const BacktestSummary = memo(function BacktestSummary({ totals }: BacktestSummaryProps) {
  if (!totals) return null;

  const netPnl = totals.net_pnl ?? 0;
  const totalCosts = totals.total_costs ?? 0;
  const winRate = totals.win_rate ?? 0;
  const pnlColor = getPnLTextColor(netPnl);

  return (
    <Stack
      direction="row"
      id="backtest-summary"
      className="backtest-summary"
      data-testid="results-summary"
      divider={<Divider orientation="vertical" flexItem />}
      sx={{ flexWrap: "wrap", borderBottom: 1, borderColor: "divider" }}
    >
      <Metric
        label="Net PnL"
        value={formatPnlShared(netPnl)}
        tone={pnlColor === "success" ? "success.main" : "error.main"}
        testid="summary-net-pnl"
      />
      <Metric label="Costs" value={`₹${(totalCosts / 1000).toFixed(1)}K`} tone="#FF7B72" testid="summary-costs" />
      <Metric label="WR" value={`${winRate.toFixed(0)}%`} testid="summary-wr" />
      <Metric label="Trades" value={String(totals.trades ?? 0)} testid="summary-trades" />
    </Stack>
  );
});
