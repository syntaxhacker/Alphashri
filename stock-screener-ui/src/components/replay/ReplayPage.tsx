import { useReplayState } from "../../hooks/useReplayState";
import { ReplayConfigBar } from "./ReplayConfig";
import { ReplayStats } from "./ReplayStats";
import { ReplayMainView } from "./ReplayMainView";
import { ReplayPositions } from "./ReplayPositions";
import { ReplaySummaryPanel } from "./ReplaySummary";
import { Stack, Box, Text, Title } from "@/ui";
import Container from "@mui/material/Container";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import TableContainer from "@mui/material/TableContainer";
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
    <Container maxWidth="xl" sx={{ py: 2, height: "100%", overflow: "auto" }} data-testid="replay-page">
      <Grid container spacing={2} sx={{ height: "100%" }}>
        <Grid size={{ xs: 12 }}>
          <Stack gap="sm" sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
            <Card elevation={1}>
              <CardContent>
                <TableContainer>
                  <Box>
                    <Title order={2} size="h4">
                      Replay Trading Day
                    </Title>
                    <Text size="sm" c="dimmed">
                      Simulate paper trading using historical candles
                    </Text>
                  </Box>
                </TableContainer>
              </CardContent>
            </Card>
            <Card elevation={1}>
              <CardContent>
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
              </CardContent>
            </Card>
            <Card elevation={1}>
              <CardContent>
                <ReplayStats
                  progress={state.progress}
                  totalCandles={state.totalCandles}
                  totalSymbols={state.totalSymbols}
                  trades={state.trades}
                />
              </CardContent>
            </Card>
            {state.openPositions.length > 0 && (
              <Card elevation={1}>
                <CardContent>
                  <TableContainer>
                    <ReplayPositions positions={state.openPositions} />
                  </TableContainer>
                </CardContent>
              </Card>
            )}
            <Card elevation={1} sx={{ flex: 1, minHeight: 400 }}>
              <CardContent sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
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
              </CardContent>
            </Card>
            {state.summary && (
              <Card elevation={1}>
                <CardContent>
                  <TableContainer>
                    <ReplaySummaryPanel summary={state.summary} />
                  </TableContainer>
                </CardContent>
              </Card>
            )}
          </Stack>
        </Grid>
      </Grid>
    </Container>
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
