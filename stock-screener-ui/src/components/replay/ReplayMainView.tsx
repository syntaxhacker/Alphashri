
import type {
  ReplayTrade,
  ReplayChartOptions,
  ReplayORLevels,
  ReplayPivotLevels,
  Replay52WLevel,
  ReplayEMAData,
} from "../../types/replay";
import { ReplayChart } from "./ReplayChart";
import { ReplayTradeLog } from "./ReplayTradeLog";
import { Box, Flex } from "@/ui";
type ChartHandle = { zoomToTrade: (entryTime: string, exitTime: string) => void } | null;

interface ReplayMainViewProps {
  candlesBySymbol: Map<string, any[]>;
  trades: ReplayTrade[];
  orLevels: Map<string, ReplayORLevels>;
  pivotLevels: Map<string, ReplayPivotLevels>;
  high52wLevels: Map<string, Replay52WLevel>;
  emaData: Map<string, ReplayEMAData>;
  selectedSymbol: string | null;
  setSelectedSymbol: (symbol: string) => void;
  chartOptions: ReplayChartOptions;
  setChartOptions: (opts: Partial<ReplayChartOptions>) => void;
  highlightedTradeId: number | null;
  strategyFilter: string | null;
  setStrategyFilter: (filter: string | null) => void;
  isRunning: boolean;
  chartRef: { current: ChartHandle };
  onTradeClick: (tradeId: number) => void;
  onTradeRowClick: (trade: ReplayTrade) => void;
}

export function ReplayMainView(props: ReplayMainViewProps) {
  return (
    <Box style={{ flex: 1, minHeight: 0, minWidth: 0, height: "100%" }} data-testid="replay-main-view">
      <Flex gap="sm" h="100%">
        <Box style={{ flex: "0 0 60%", minHeight: 0 }}>
          <ReplayChart
            ref={props.chartRef}
            candlesBySymbol={props.candlesBySymbol}
            trades={props.trades}
            orLevels={props.orLevels}
            pivotLevels={props.pivotLevels}
            high52wLevels={props.high52wLevels}
            emaData={props.emaData}
            selectedSymbol={props.selectedSymbol ?? ""}
            setSelectedSymbol={props.setSelectedSymbol}
            chartOptions={props.chartOptions}
            setChartOptions={props.setChartOptions}
            highlightedTradeId={props.highlightedTradeId}
            onTradeClick={props.onTradeClick}
          />
        </Box>
        <Box style={{ flex: "1 1 40%", minHeight: 0, display: "flex", flexDirection: "column" }}>
          <ReplayTradeLog
            trades={props.trades}
            strategyFilter={props.strategyFilter ?? "ALL"}
            setStrategyFilter={(f) => props.setStrategyFilter(f)}
            isRunning={props.isRunning}
            highlightedTradeId={props.highlightedTradeId}
            onTradeClick={props.onTradeRowClick}
          />
        </Box>
      </Flex>
    </Box>
  );
}
