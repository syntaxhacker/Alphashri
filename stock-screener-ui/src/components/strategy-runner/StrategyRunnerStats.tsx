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

export function StrategyRunnerStats(props: Props) {
  const progressPct = () =>
    props.progress.totalBots > 0
      ? Math.round((props.progress.currentBot / props.progress.totalBots) * 100)
      : 0;

  const totalCosts = () => props.summary?.total_costs ?? 0;

  return (
    <TradeStatsGrid
      trades={props.trades}
      summary={props.summary}
      isRunning={props.isRunning}
      emptyText="Run a strategy comparison to see stats"
      extraStats={
        totalCosts() > 0 ? (
          <CompactStat label="Total Costs" value={formatCurrencySigned(totalCosts())} tone="error" />
        ) : undefined
      }
      progressStat={
        props.isRunning && props.progress.totalBots > 0
          ? {
              value: `${props.progress.currentBot} / ${props.progress.totalBots}`,
              hint: props.progress.currentBotName,
            }
          : null
      }
      progressBar={props.isRunning && props.progress.totalBots > 0 ? { percent: progressPct() } : null}
    />
  );
}
