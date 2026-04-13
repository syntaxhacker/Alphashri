import { useReplayState } from "../../hooks/useReplayState";
import { ReplayConfigBar } from "./ReplayConfig";
import { ReplayStats } from "./ReplayStats";
import { ReplayChart } from "./ReplayChart";
import { ReplayTradeLog } from "./ReplayTradeLog";
import { ReplaySummaryPanel } from "./ReplaySummary";
import { Stack, Box, Text, Title, Flex } from "@mantine/core";
import { useRef } from "react";
import type { ReplayTrade } from "../../types/replay";

export function ReplayPage() {
  const state = useReplayState();
  const chartRef = useRef<{ zoomToTrade: (entryTime: string, exitTime: string) => void } | null>(
    null,
  );

  const handleTradeClick = (trade: ReplayTrade) => {
    state.setSelectedSymbol(trade.symbol);
    state.setHighlightedTrade(trade.id);
    setTimeout(() => {
      chartRef.current?.zoomToTrade(trade.entry_time, trade.exit_time);
    }, 200);
  };

  return (
    <Stack
      gap="sm"
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
        padding: "var(--mantine-spacing-md)",
      }}
      data-testid="replay-page"
    >
      <Box flex="0 0 auto">
        <Title order={2} size="h4">
          Replay Trading Day
        </Title>
        <Text size="sm" c="dimmed">
          Simulate paper trading using historical candles
        </Text>
      </Box>
      <Box flex="0 0 auto">
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
      <Box flex="0 0 auto">
        <ReplayStats
          progress={state.progress}
          totalCandles={state.totalCandles}
          totalSymbols={state.totalSymbols}
          trades={state.trades}
        />
      </Box>
      <Box flex="0 0 auto" style={{ height: 500, minHeight: 400 }}>
        <Flex gap="sm" h="100%">
          <Box style={{ flex: "0 0 60%", minHeight: 0 }}>
            <ReplayChart
              ref={chartRef}
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
              onTradeClick={(tradeId) => {
                const trade = state.trades.find((t) => t.id === tradeId);
                if (trade) {
                  state.setHighlightedTrade(tradeId);
                  setTimeout(() => {
                    chartRef.current?.zoomToTrade(trade.entry_time, trade.exit_time);
                  }, 100);
                }
              }}
            />
          </Box>
          <Box style={{ flex: "1 1 40%", minHeight: 0, display: "flex", flexDirection: "column" }}>
            <ReplayTradeLog
              trades={state.trades}
              strategyFilter={state.strategyFilter}
              setStrategyFilter={state.setStrategyFilter}
              isRunning={state.isRunning}
              highlightedTradeId={state.highlightedTradeId}
              onTradeClick={handleTradeClick}
            />
          </Box>
        </Flex>
      </Box>
      {state.summary && (
        <Box flex="0 0 auto">
          <ReplaySummaryPanel summary={state.summary} />
        </Box>
      )}
    </Stack>
  );
}
