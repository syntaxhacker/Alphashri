import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box } from "@/ui";
import { useChartData } from "../../hooks/useChartData";
import { TradingViewChart } from "../../components/chart/TradingViewChart";
import type { ReplayCandle } from "../../types/replay";
import { ChartHeader } from "./ChartHeader";
import { ChartBody } from "./ChartBody";
import { ChartFooter } from "./ChartFooter";
import { ChartError } from "./ChartError";

function useChartViewModel() {
  const { symbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();

  const [timeframe, setTimeframe] = useState(15);
  const [orMinutes, setOrMinutes] = useState(45);
  const [showPivots, setShowPivots] = useState(false);
  const [show52wHigh, setShow52wHigh] = useState(false);

  const { data, loading, error } = useChartData({
    symbol: symbol || "",
    timeframe,
    orMinutes,
  });

  const candles: ReplayCandle[] = useMemo(
    () =>
      (data?.candles ?? []).map((c) => ({
        time: `${c.date} ${c.time_str}`,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      })),
    [data],
  );

  return {
    symbol,
    navigate,
    timeframe,
    setTimeframe,
    orMinutes,
    setOrMinutes,
    showPivots,
    setShowPivots,
    show52wHigh,
    setShow52wHigh,
    data,
    loading,
    error,
    candles,
  };
}

const ChartView: React.FC = () => {
  const vm = useChartViewModel();

  if (!vm.symbol) {
    return <ChartError onBackToScreener={() => vm.navigate("/")} />;
  }

  return (
    <Box
      data-testid="chart-view"
      id="chart-view"
      sx={{ width: "100%", height: "100%", minHeight: 0, display: "flex", flexDirection: "column", p: 0, gap: 0, overflow: "hidden", bgcolor: "background.default" }}
    >
      <ChartHeader
        symbol={vm.symbol}
        timeframe={vm.timeframe}
        orMinutes={vm.orMinutes}
        showPivots={vm.showPivots}
        show52wHigh={vm.show52wHigh}
        onBack={() => vm.navigate(-1)}
        onTimeframeChange={vm.setTimeframe}
        onOrMinutesChange={vm.setOrMinutes}
        onPivotsChange={vm.setShowPivots}
        on52wHighChange={vm.setShow52wHigh}
      />

      <ChartBody
        loading={vm.loading}
        error={vm.error}
        hasData={!!vm.data}
        chart={<TradingViewChart candles={vm.candles} />}
      />

      {vm.data && (
        <ChartFooter data={vm.data} timeframe={vm.timeframe} orMinutes={vm.orMinutes} />
      )}
    </Box>
  );
};

export default ChartView;
