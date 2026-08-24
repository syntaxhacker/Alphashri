import { Box, Text, Progress, Stack } from "@/ui";
import { CompactStat, CompactStatGrid } from "../common/compact";
import { getPnLTextColor } from "../../utils/ui-helpers";
import type { ReplayTrade, ReplaySummary, ReplayProgress } from "../../types/replay";

const pnlFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  signDisplay: "exceptZero",
});

function formatNetPnl(value: number): string {
  return pnlFormat.format(value);
}

interface ReplayStatsProps {
  trades: ReplayTrade[];
  summary: ReplaySummary | null;
  progress: ReplayProgress | null;
  totalCandles: number;
  isRunning: boolean;
}

export function ReplayStats({
  trades,
  summary,
  progress,
  totalCandles,
  isRunning,
}: ReplayStatsProps) {
  const hasTrades = trades.length > 0;

  if (!hasTrades && !isRunning) {
    return (
      <Box data-testid="replay-stats">
        <Text c="dimmed" ta="center" py="lg">
          Run a replay to see stats
        </Text>
      </Box>
    );
  }

  const winRate = summary
    ? summary.win_rate
    : trades.length > 0
      ? (trades.filter((t) => t.pnl > 0).length / trades.length) * 100
      : 0;

  const pf = summary?.profit_factor ?? 0;
  const netPnl = summary?.net_pnl ?? trades.reduce((s, t) => s + t.net_pnl, 0);
  const winners = summary?.winners ?? trades.filter((t) => t.pnl > 0).length;
  const losers = summary?.losers ?? trades.filter((t) => t.pnl <= 0).length;

  const candleProgress = progress ? Math.round((progress.candle / progress.total) * 100) : 0;

  return (
    <Stack gap="sm" data-testid="replay-stats">
      <CompactStatGrid>
        <CompactStat label="Total Trades" value={trades.length} />
        <CompactStat
          label="Win Rate"
          value={`${winRate.toFixed(1)}%`}
          tone={winRate >= 50 ? "success" : "error"}
        />
        <CompactStat
          label="Profit Factor"
          value={pf === 0 ? "—" : pf.toFixed(2)}
          tone={pf > 1 ? "success" : pf < 1 ? "error" : "text.primary"}
        />
        <CompactStat label="Net P&L" value={formatNetPnl(netPnl)} tone={getPnLTextColor(netPnl)} />
        <CompactStat label="Winners / Losers" value={`${winners} / ${losers}`} />
        {isRunning && progress && (
          <CompactStat
            label="Progress"
            value={`${progress.candle} / ${progress.total}`}
            hint={`${progress.symbol} — ${progress.time}`}
          />
        )}
      </CompactStatGrid>

      {isRunning && totalCandles > 0 && (
        <Progress value={candleProgress} size="sm" animated style={{ flex: "none" }} />
      )}
    </Stack>
  );
}
