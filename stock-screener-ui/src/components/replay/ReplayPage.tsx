import { createEffect, Show } from "solid-js";
import { useReplayState } from "./useReplayState";
import { ReplayConfigBar } from "./ReplayConfig";
import { ReplayStats } from "./ReplayStats";
import { ReplayMainView } from "./ReplayMainView";
import { ReplayPositions } from "./ReplayPositions";
import { ReplaySummaryPanel } from "./ReplaySummary";
import { Text, Title, ToolbarRow, Box } from "@/ui";
import * as palette from "@/ui/palette";
import type { ReplayTrade } from "../../types/replay";
type ReplayStateHandle = ReturnType<typeof useReplayState>;
type ChartRef = { zoomToTrade: (entryTime: string, exitTime: string) => void } | null;

function ReplayPageContent(
  props: {
    handle: ReplayStateHandle;
    chartRef: { current: ChartRef };
    onTradeClick: (trade: ReplayTrade) => void;
  },
) {
  const state = () => props.handle.state();
  const handleTradeClick = props.onTradeClick;

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
        style={{ flex: "0 0 auto", height: "36px", padding: `0 ${palette.FIN_OUTER_PAD}px`, "border-bottom": `1px solid ${palette.BORDER}` }}
      >
        <Title order={2} size="h4">
          Replay Trading Day
        </Title>
        <Text size="sm" c="dimmed" style={{ "white-space": "nowrap", overflow: "hidden", "text-overflow": "ellipsis" }}>
          Simulate paper trading using historical candles
        </Text>
      </ToolbarRow>
      <Box flex="0 0 auto" px="sm" py="xs" style={{ "border-bottom": `1px solid ${palette.BORDER}` }}>
        <ReplayConfigBar
          config={state().config}
          isRunning={state().isRunning}
          setConfig={props.handle.setConfig}
          startReplay={props.handle.startReplay}
          stopReplay={props.handle.stopReplay}
          reset={props.handle.reset}
          loadSymbols={props.handle.loadSymbols}
          error={state().error}
        />
      </Box>
      <Box flex="0 0 auto" px="sm" py="xs" style={{ "border-bottom": `1px solid ${palette.BORDER}` }}>
        <ReplayStats
          trades={state().trades}
          summary={state().summary}
          progress={state().progress}
          totalCandles={state().totalCandles}
          isRunning={state().isRunning}
        />
      </Box>
      <Show when={state().openPositions.length > 0}>
        <Box flex="0 0 auto" px="sm" py="xs" style={{ "border-bottom": `1px solid ${palette.BORDER}`, overflow: "auto", "max-height": "180px" }}>
          <ReplayPositions positions={state().openPositions} />
        </Box>
      </Show>
      <Box flex="1" mih={0} miw={0} px="sm" py="xs" style={{ overflow: "hidden", display: "flex", "flex-direction": "column" }}>
        <ReplayMainView
          candlesBySymbol={state().candlesBySymbol}
          trades={state().trades}
          orLevels={state().orLevels}
          pivotLevels={state().pivotLevels}
          high52wLevels={state().high52wLevels}
          emaData={state().emaData}
          selectedSymbol={state().selectedSymbol}
          setSelectedSymbol={props.handle.setSelectedSymbol}
          chartOptions={state().chartOptions}
          setChartOptions={props.handle.setChartOptions}
          highlightedTradeId={state().highlightedTradeId}
          strategyFilter={state().strategyFilter}
          setStrategyFilter={props.handle.setStrategyFilter}
          isRunning={state().isRunning}
          chartRef={props.chartRef}
          onTradeClick={(tradeId) => {
            const trade = state().trades.find((t: ReplayTrade) => t.id === tradeId);
            if (trade) {
              props.handle.setHighlightedTrade(tradeId);
              setTimeout(() => props.chartRef.current?.zoomToTrade(trade.entry_time, trade.exit_time), 100);
            }
          }}
          onTradeRowClick={handleTradeClick}
        />
      </Box>
      <Show when={state().summary}>
        {(summary) => (
          <Box flex="0 0 auto" px="sm" py="xs" style={{ "border-top": `1px solid ${palette.BORDER}`, overflow: "auto", "max-height": "180px" }}>
            <ReplaySummaryPanel summary={summary()} />
          </Box>
        )}
      </Show>
    </Box>
  );
}

export function ReplayPage() {
  const replay = useReplayState();
  const chartRef: { current: ChartRef } = { current: null };

  const handleTradeClick = (trade: ReplayTrade) => {
    replay.setSelectedSymbol(trade.symbol);
    replay.setHighlightedTrade(trade.id);
    setTimeout(() => {
      chartRef.current?.zoomToTrade(trade.entry_time, trade.exit_time);
    }, 200);
  };

  createEffect(() => {
    const s = replay.state();
    if (!s.isRunning && s.trades.length > 0 && !s.highlightedTradeId) {
      handleTradeClick(s.trades[0]);
    }
  });

  return (
    <ReplayPageContent
      handle={replay}
      chartRef={chartRef}
      onTradeClick={handleTradeClick}
    />
  );
}
