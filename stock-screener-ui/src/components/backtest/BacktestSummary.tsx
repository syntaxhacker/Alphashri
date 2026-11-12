import { Text } from "@/ui";
import type { BacktestTotals } from "../../types/backtest";
import { formatPnl as formatPnlShared, getPnLTextColor } from "../../utils/ui-helpers";
import { Stack } from "../paper-trading/primitives";

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
  <Stack className="flex-1 min-w-[92px] px-1.5 py-0.75 gap-0.5 justify-center" style={{ flex: "1 1 0", minWidth: 92, gap: 4 }}>
    <Text size="xs" fw={600} c="muted" style={{ fontSize: 10, lineHeight: 1.1, letterSpacing: 0.6, textAlign: "center" }}>
      {label}
    </Text>
    <Text size="sm" fw={700} c={tone ?? "text-primary"} data-testid={testid} style={{ fontSize: 18, lineHeight: 1.15, fontVariantNumeric: "tabular-nums" }}>
      {value}
    </Text>
  </Stack>
);

export function BacktestSummary({ totals }: BacktestSummaryProps) {
  if (!totals) return null;

  const netPnl = totals.net_pnl ?? 0;
  const totalCosts = totals.total_costs ?? 0;
  const winRate = totals.win_rate ?? 0;
  const pnlColor = getPnLTextColor(netPnl);

  return (
    <Stack
      direction="row"
      id="backtest-summary"
      className="backtest-summary flex-wrap border-b border-fin-border"
      data-testid="results-summary"
    >
      <Metric
        label="Net PnL"
        value={formatPnlShared(netPnl)}
        tone={pnlColor === "success" ? "positive" : "negative"}
        testid="summary-net-pnl"
      />
      <Metric label="Costs" value={`₹${(totalCosts / 1000).toFixed(1)}K`} tone="negative" testid="summary-costs" />
      <Metric label="WR" value={`${winRate.toFixed(0)}%`} testid="summary-wr" />
      <Metric label="Trades" value={String(totals.trades ?? 0)} testid="summary-trades" />
    </Stack>
  );
}
