import { Box, Flex } from "@/ui";
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
  chartRef: React.RefObject<{ zoomToTrade: (entryTime: string, exitTime: string) => void } | null>;
  onTradeClick: (tradeId: number) => void;
  onTradeRowClick: (trade: ReplayTrade) => void;
}

export function ReplayMainView({
  candlesBySymbol,
  trades,
  orLevels,
  pivotLevels,
  high52wLevels,
  emaData,
  selectedSymbol,
  setSelectedSymbol,
  chartOptions,
  setChartOptions,
  highlightedTradeId,
  strategyFilter,
  setStrategyFilter,
  isRunning,
  chartRef,
  onTradeClick,
  onTradeRowClick,
}: ReplayMainViewProps) {
  return (
    <Box flex="0 0 auto" style={{ height: 500, minHeight: 400 }}>
      <Flex gap="sm" h="100%">
        <Box style={{ flex: "0 0 60%", minHeight: 0 }}>
          <ReplayChart
            ref={chartRef}
            candlesBySymbol={candlesBySymbol}
            trades={trades}
            orLevels={orLevels}
            pivotLevels={pivotLevels}
            high52wLevels={high52wLevels}
            emaData={emaData}
            selectedSymbol={selectedSymbol}
            setSelectedSymbol={setSelectedSymbol}
            chartOptions={chartOptions}
            setChartOptions={setChartOptions}
            highlightedTradeId={highlightedTradeId}
            onTradeClick={onTradeClick}
          />
        </Box>
        <Box style={{ flex: "1 1 40%", minHeight: 0, display: "flex", flexDirection: "column" }}>
          <ReplayTradeLog
            trades={trades}
            strategyFilter={strategyFilter}
            setStrategyFilter={setStrategyFilter}
            isRunning={isRunning}
            highlightedTradeId={highlightedTradeId}
            onTradeClick={onTradeRowClick}
          />
        </Box>
      </Flex>
    </Box>
  );
}
