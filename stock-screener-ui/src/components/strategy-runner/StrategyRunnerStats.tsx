import { TradeStatsGrid, formatCurrencySigned } from "../common/TradeStatsGrid";
import { CompactStat } from "../common/compact";
import type {
  StrategyRunnerTrade,
  StrategyRunnerSummary,
} from "../../types/strategyRunner";

interface Props {
  trades: StrategyRunnerTrade[];
  summary: StrategyRunnerSummary | null;
  isRunning: boolean;
  progress: { currentBot: number; totalBots: number; currentBotName: string };
}

export function StrategyRunnerStats({ trades, summary, isRunning, progress }: Props) {
  const totalCosts = summary?.total_costs ?? 0;

  const progressPct =
    progress.totalBots > 0
      ? Math.round((progress.currentBot / progress.totalBots) * 100)
      : 0;

  return (
    <TradeStatsGrid
      trades={trades}
      summary={summary}
      isRunning={isRunning}
      emptyText="Run a strategy comparison to see stats"
      extraStats={
        totalCosts > 0 && (
          <CompactStat label="Total Costs" value={formatCurrencySigned(totalCosts)} tone="error" />
        )
      }
      progressStat={
        isRunning && progress.totalBots > 0
          ? {
              value: `${progress.currentBot} / ${progress.totalBots}`,
              hint: progress.currentBotName,
            }
          : null
      }
      progressBar={isRunning && progress.totalBots > 0 ? { percent: progressPct } : null}
    />
  );
}
