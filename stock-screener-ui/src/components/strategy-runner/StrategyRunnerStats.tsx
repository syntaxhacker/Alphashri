import { Box, Text, Progress, Stack } from "@/ui";
import { CompactStat, CompactStatGrid } from "../common/compact";
import { getPnLTextColor } from "../../utils/ui-helpers";
import type {
  StrategyRunnerTrade,
  StrategyRunnerSummary,
} from "../../types/strategyRunner";

const pnlFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  signDisplay: "exceptZero",
});

function formatNetPnl(value: number): string {
  return pnlFormat.format(value);
}

interface Props {
  trades: StrategyRunnerTrade[];
  summary: StrategyRunnerSummary | null;
  isRunning: boolean;
  progress: { currentBot: number; totalBots: number; currentBotName: string };
}

export function StrategyRunnerStats({ trades, summary, isRunning, progress }: Props) {
  const hasTrades = trades.length > 0;

  if (!hasTrades && !isRunning) {
    return (
      <Box>
        <Text c="dimmed" ta="center" py="lg">
          Run a strategy comparison to see stats
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
  const totalCosts = summary?.total_costs ?? 0;

  const progressPct =
    progress.totalBots > 0
      ? Math.round((progress.currentBot / progress.totalBots) * 100)
      : 0;

  return (
    <Stack gap="sm">
      <CompactStatGrid>
        <CompactStat label="Total Trades" value={trades.length} />
        <CompactStat
          label="Win Rate"
          value={`${winRate.toFixed(1)}%`}
          tone={winRate >= 50 ? "green" : "red"}
        />
        <CompactStat
          label="Profit Factor"
          value={pf === 0 ? "\u2014" : pf.toFixed(2)}
          tone={pf > 1 ? "green" : pf < 1 ? "red" : "var(--mantine-color-text)"}
        />
        <CompactStat
          label="Net P&L"
          value={formatNetPnl(netPnl)}
          tone={getPnLTextColor(netPnl)}
        />
        <CompactStat label="Winners / Losers" value={`${winners} / ${losers}`} />
        {totalCosts > 0 && (
          <CompactStat label="Total Costs" value={formatNetPnl(totalCosts)} tone="red" />
        )}
        {isRunning && progress.totalBots > 0 && (
          <CompactStat
            label="Progress"
            value={`${progress.currentBot} / ${progress.totalBots}`}
            hint={progress.currentBotName}
          />
        )}
      </CompactStatGrid>

      {isRunning && progress.totalBots > 0 && (
        <Progress value={progressPct} size="sm" animated />
      )}
    </Stack>
  );
}
