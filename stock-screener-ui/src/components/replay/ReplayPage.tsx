import { useReplayState } from "../../hooks/useReplayState";
import { ReplayConfigBar } from "./ReplayConfig";
import { ReplayStats } from "./ReplayStats";
import { ReplayMainView } from "./ReplayMainView";
import { ReplayPositions } from "./ReplayPositions";
import { ReplaySummaryPanel } from "./ReplaySummary";
import { Text, Title, ToolbarRow } from "@/ui";
import { useEffect, useRef } from "react";
import * as palette from "@/ui/palette";
import type { ReplayTrade } from "../../types/replay";
import { Box } from "../paper-trading/primitives";

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
    <Box
      w="100%"
      h="100%"
      mih={0}
      style={{ display: "flex", "flex-direction": "column", overflow: "hidden", "background-color": palette.BG }}
      data-testid="replay-page"
    >
      <ToolbarRow
        gap={8}
        wrap={false}
        style={{ flex: "0 0 auto", height: 36, padding: `0 ${palette.FIN_OUTER_PAD}px`, borderBottom: `1px solid ${palette.BORDER}` }}
      >
        <Title order={2} size="h4">
          Replay Trading Day
        </Title>
        <Text size="sm" c="dimmed" style={{ "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
          Simulate paper trading using historical candles
        </Text>
      </ToolbarRow>
      <Box flex="0 0 auto" px="sm" py="xs" style={{ borderBottom: `1px solid ${palette.BORDER}` }}>
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
      <Box flex="0 0 auto" px="sm" py="xs" style={{ borderBottom: `1px solid ${palette.BORDER}` }}>
        <ReplayStats
          trades={state.trades}
          summary={state.summary}
          progress={state.progress}
          totalCandles={state.totalCandles}
          isRunning={state.isRunning}
        />
      </Box>
      {state.openPositions.length > 0 && (
        <Box flex="0 0 auto" px="sm" py="xs" style={{ borderBottom: `1px solid ${palette.BORDER}`, overflow: "auto", "max-height": 180 }}>
          <ReplayPositions positions={state.openPositions} />
        </Box>
      )}
      <Box flex="1" mih={0} miw={0} px="sm" py="xs" style={{ overflow: "hidden", display: "flex", "flex-direction": "column" }}>
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
        <Box flex="0 0 auto" px="sm" py="xs" style={{ borderTop: `1px solid ${palette.BORDER}`, overflow: "auto", "max-height": 180 }}>
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
