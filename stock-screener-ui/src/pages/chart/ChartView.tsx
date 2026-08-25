import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Container from "@mui/material/Container";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
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
    <Container
      maxWidth="xl"
      data-testid="chart-view"
      id="chart-view"
      sx={{ py: 2, display: "flex", flexDirection: "column", alignItems: "center", height: "100%", minHeight: 0, flex: 1, overflow: "hidden", bgcolor: "background.default", width: "100%" }}
    >
      <Card elevation={1} sx={{ width: "100%", p: 1, mb: 1 }}>
        <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
          <Grid container spacing={2} justifyContent="center" sx={{ width: "100%" }}>
            <Grid size={12} sx={{ display: "flex", justifyContent: "center" }}>
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
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Grid container spacing={2} justifyContent="center" sx={{ flex: 1, minHeight: 0, width: "100%", overflow: "hidden" }}>
        <Grid size={12} sx={{ display: "flex", flexDirection: "column", alignItems: "center", minHeight: 0, flex: 1, overflow: "hidden" }}>
          <Card elevation={1} sx={{ flex: 1, width: "100%", p: 1, display: "flex", flexDirection: "column", alignItems: "center", minHeight: 0, overflow: "hidden" }}>
            <CardContent sx={{ flex: 1, p: 1, "&:last-child": { pb: 1 }, width: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: 0, overflow: "hidden" }}>
              <ChartBody
                ref={vm.chartRef}
                loading={vm.loading}
                error={vm.error}
                chartError={vm.chartError}
                hasData={!!vm.data}
              />
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {vm.data && (
        <Card elevation={1} sx={{ width: "100%", p: 1, mt: 1 }}>
          <CardContent sx={{ p: 1, "&:last-child": { pb: 1 } }}>
            <ChartFooter data={vm.data} timeframe={vm.timeframe} orMinutes={vm.orMinutes} />
          </CardContent>
        </Card>
      )}
    </Container>
  );
};

export default ChartView;
