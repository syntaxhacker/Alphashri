import { TradeStatsGrid } from "../common/TradeStatsGrid";
import type { ReplayTrade, ReplaySummary, ReplayProgress } from "../../types/replay";

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
  const candleProgress = progress ? Math.round((progress.candle / progress.total) * 100) : 0;

  return (
    <TradeStatsGrid
      trades={trades}
      summary={summary}
      isRunning={isRunning}
      emptyText="Run a replay to see stats"
      testId="replay-stats"
      progressStat={
        isRunning && progress
          ? {
              value: `${progress.candle} / ${progress.total}`,
              hint: `${progress.symbol} — ${progress.time}`,
            }
          : null
      }
      progressBar={
        isRunning && totalCandles > 0 ? { percent: candleProgress, style: { flex: "none" } } : null
      }
    />
  );
}
