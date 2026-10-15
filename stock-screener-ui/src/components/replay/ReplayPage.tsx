import { useReplayState } from "../../hooks/useReplayState";
import { ReplayConfigBar } from "./ReplayConfig";
import { ReplayStats } from "./ReplayStats";
import { ReplayMainView } from "./ReplayMainView";
import { ReplayPositions } from "./ReplayPositions";
import { ReplaySummaryPanel } from "./ReplaySummary";
import { Box, Text, Title, ToolbarRow } from "@/ui";
import { useEffect, useRef } from "react";
import type { ReplayTrade } from "../../types/replay";

function useAutoSelectTrade(
  state: ReturnType<typeof useReplayState>,
  chartRef: React.RefObject<{ zoomToTrade: (entryTime: string, exitTime: string) => void } | null>,
) {
  const handleTradeClick = (trade: ReplayTrade) => {
    state.setSelectedSymbol(trade.symbol);
    state.setHighlightedTrade(trade.id);
    setTimeout(() => {
      chartRef.current?.zoomToTrade(trade.entry_time, trade.exit_time);
    }, 200);
  };

  useEffect(() => {
    if (!state.isRunning && state.trades.length > 0 && !state.highlightedTradeId) {
      handleTradeClick(state.trades[0]);
    }
  }, [state.isRunning, state.trades.length]);

  return handleTradeClick;
}

function ReplayPageContent(
  state: ReturnType<typeof useReplayState>,
  chartRef: React.RefObject<{ zoomToTrade: (entryTime: string, exitTime: string) => void } | null>,
  handleTradeClick: (trade: ReplayTrade) => void,
) {
  return (
    <Box sx={{ width: "100%", height: "100%", minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", bgcolor: "background.default" }} data-testid="replay-page">
      <ToolbarRow gap={8} wrap={false} style={{ flex: "0 0 auto", height: 48, padding: "0 16px", borderBottom: "1px solid var(--mui-palette-divider)" }}>
        <Title order={2} size="h4">
          Replay Trading Day
        </Title>
        <Text size="sm" c="dimmed" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          Simulate paper trading using historical candles
        </Text>
      </ToolbarRow>
      <Box sx={{ flex: "0 0 auto", borderBottom: "1px solid var(--mui-palette-divider)", px: 2, py: 1 }}>
        <ReplayConfigBar
          config={state.config}
          isRunning={state.isRunning}
          setConfig={state.setConfig}
          startReplay={state.startReplay}
          stopReplay={state.stopReplay}
          reset={state.reset}
          loadSymbols={state.loadSymbols}
          error={state.error}
        />
      </Box>
      <Box sx={{ flex: "0 0 auto", borderBottom: "1px solid var(--mui-palette-divider)", px: 2, py: 1 }}>
        <ReplayStats
          progress={state.progress}
          totalCandles={state.totalCandles}
          totalSymbols={state.totalSymbols}
          trades={state.trades}
        />
      </Box>
      {state.openPositions.length > 0 && (
        <Box sx={{ flex: "0 0 auto", borderBottom: "1px solid var(--mui-palette-divider)", px: 2, py: 1, overflow: "auto", maxHeight: 220 }}>
          <ReplayPositions positions={state.openPositions} />
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden", display: "flex", flexDirection: "column", px: 2, py: 1 }}>
        <ReplayMainView
          candlesBySymbol={state.candlesBySymbol}
          trades={state.trades}
          orLevels={state.orLevels}
          pivotLevels={state.pivotLevels}
          high52wLevels={state.high52wLevels}
          emaData={state.emaData}
          selectedSymbol={state.selectedSymbol}
          setSelectedSymbol={state.setSelectedSymbol}
          chartOptions={state.chartOptions}
          setChartOptions={state.setChartOptions}
          highlightedTradeId={state.highlightedTradeId}
          strategyFilter={state.strategyFilter}
          setStrategyFilter={state.setStrategyFilter}
          isRunning={state.isRunning}
          chartRef={chartRef}
          onTradeClick={(tradeId) => {
            const trade = state.trades.find((t) => t.id === tradeId);
            if (trade) {
              state.setHighlightedTrade(tradeId);
              setTimeout(() => chartRef.current?.zoomToTrade(trade.entry_time, trade.exit_time), 100);
            }
          }}
          onTradeRowClick={handleTradeClick}
        />
      </Box>
      {state.summary && (
        <Box sx={{ flex: "0 0 auto", borderTop: "1px solid var(--mui-palette-divider)", px: 2, py: 1, overflow: "auto", maxHeight: 220 }}>
          <ReplaySummaryPanel summary={state.summary} />
        </Box>
      )}
    </Box>
  );
}

export function ReplayPage() {
  const state = useReplayState();
  const chartRef = useRef<{ zoomToTrade: (entryTime: string, exitTime: string) => void } | null>(
    null,
  );
  const handleTradeClick = useAutoSelectTrade(state, chartRef);
  return ReplayPageContent(state, chartRef, handleTradeClick);
}
