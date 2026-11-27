import { TradeStatsGrid } from "../common/TradeStatsGrid";
import type { ReplayTrade, ReplaySummary, ReplayProgress } from "../../types/replay";

interface ReplayStatsProps {
  trades: ReplayTrade[];
  summary: ReplaySummary | null;
  progress: ReplayProgress | null;
  totalCandles: number;
  isRunning: boolean;
}

export function ReplayStats(props: ReplayStatsProps) {
  const candleProgress = () =>
    props.progress ? Math.round((props.progress.candle / props.progress.total) * 100) : 0;

  return (
    <TradeStatsGrid
      trades={props.trades}
      summary={props.summary}
      isRunning={props.isRunning}
      emptyText="Run a replay to see stats"
      testId="replay-stats"
      progressStat={
        props.isRunning && props.progress
          ? {
              value: `${props.progress.candle} / ${props.progress.total}`,
              hint: `${props.progress.symbol} — ${props.progress.time}`,
            }
          : null
      }
      progressBar={
        props.isRunning && props.totalCandles > 0 ? { percent: candleProgress(), style: { flex: "none" } } : null
      }
    />
  );
}
