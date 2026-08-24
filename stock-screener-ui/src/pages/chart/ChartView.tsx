import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Box } from "@mui/material";
import { useColorScheme } from "@/ui";
import { useChartData } from "../../hooks/useChartData";
import { useChartInstance } from "../../hooks/useChartInstance";
import { ChartHeader } from "./ChartHeader";
import { ChartBody } from "./ChartBody";
import { ChartFooter } from "./ChartFooter";
import { ChartError } from "./ChartError";

function useChartViewModel() {
  const { symbol } = useParams<{ symbol: string }>();
  const navigate = useNavigate();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  const [timeframe, setTimeframe] = useState(15);
  const [orMinutes, setOrMinutes] = useState(45);
  const [showPivots, setShowPivots] = useState(false);
  const [show52wHigh, setShow52wHigh] = useState(false);

  const { data, loading, error } = useChartData({
    symbol: symbol || "",
    timeframe,
    orMinutes,
  });

  const { chartRef, error: chartError } = useChartInstance({
    data,
    showPivots,
    show52wHigh,
    isDark,
    loading,
  });

  return {
    symbol,
    navigate,
    isDark,
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
    chartRef,
    chartError,
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
      sx={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden", bgcolor: "background.default" }}
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
        ref={vm.chartRef}
        loading={vm.loading}
        error={vm.error}
        chartError={vm.chartError}
        hasData={!!vm.data}
      />

      {vm.data && <ChartFooter data={vm.data} timeframe={vm.timeframe} orMinutes={vm.orMinutes} />}
    </Box>
  );
};

export default ChartView;
