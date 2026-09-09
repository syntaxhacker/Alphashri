import { Text, Badge, useColorScheme, useTheme } from "@/ui";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Grid from "@mui/material/Grid";
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { OptionAlerts } from "./OptionAlerts";
import { IVSkewChart } from "./IVSkewChart";
import { fontWeights } from "../../../config/theme";
import { CompactPanel } from "../../common/compact";

interface OIAnalysisProps {
  strikeMatrix: Array<{ strike: number; ce: any; pe: any }>;
  spotPrice: number | null;
}

export function OIAnalysis({ strikeMatrix, spotPrice }: OIAnalysisProps) {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  const analysisData = useMemo(() => {
    // Top 5 OI Gainers (Spikes)
    const allOptions = strikeMatrix
      .flatMap(({ strike, ce, pe }) => [
        { strike, type: "CE", contract: ce },
        { strike, type: "PE", contract: pe },
      ])
      .filter((opt) => opt.contract);

    const spikes = allOptions
      .map((opt) => {
        const oi = opt.contract.market_data?.oi ?? 0;
        const prevOi = opt.contract.market_data?.prev_oi ?? 0;
        const volume = opt.contract.market_data?.volume ?? 0;
        const change = oi - prevOi;
        const changePct = prevOi > 0 ? (change / prevOi) * 100 : 0;

        const volOiRatio = change !== 0 ? volume / Math.abs(change) : volume;
        const activityType = volOiRatio > 10 ? "Speculative" : "Positional";

        return { ...opt, change, changePct, oi, activityType };
      })
      .filter((opt) => opt.change > 0)
      .sort((a, b) => b.changePct - a.changePct)
      .slice(0, 6);

    // Distribution for ECharts
    const chartData = strikeMatrix
      .map(({ strike, ce, pe }) => ({
        strike,
        ceChange: (ce?.market_data?.oi ?? 0) - (ce?.market_data?.prev_oi ?? 0),
        peChange: (pe?.market_data?.oi ?? 0) - (pe?.market_data?.prev_oi ?? 0),
      }))
      .filter((d) => Math.abs(d.ceChange) > 100 || Math.abs(d.peChange) > 100);

    return { spikes, chartData };
  }, [strikeMatrix]);

  const distributionOption = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: isDark ? "rgba(0,0,0,0.8)" : "var(--mui-palette-background-paper)",
      textStyle: {
        color: isDark ? "var(--mui-palette-common-white)" : "var(--mui-palette-text-primary)",
        fontSize: theme.fontSizes.sm,
      },
    },
    legend: {
      data: ["Call OI Chg", "Put OI Chg"],
      textStyle: { color: "var(--mui-palette-text-secondary)", fontSize: theme.fontSizes.sm },
      bottom: 0,
    },
    grid: {
      top: 10,
      left: 60,
      right: 20,
      bottom: 40,
    },
    xAxis: {
      type: "value",
      axisLabel: { show: false },
      splitLine: { show: false },
    },
    yAxis: {
      type: "category",
      data: analysisData.chartData.map((d) => d.strike),
      axisLabel: { color: "var(--mui-palette-text-secondary)", fontSize: theme.fontSizes.sm, fontWeight: fontWeights.semibold },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        name: "Call OI Chg",
        type: "bar",
        stack: "total",
        label: { show: false },
        emphasis: { focus: "series" },
        data: analysisData.chartData.map((d) => -Math.abs(d.ceChange)),
        itemStyle: { color: (theme as any).palette?.success?.main ?? "var(--mui-palette-success-main)", borderRadius: [2, 0, 0, 2] },
      },
      {
        name: "Put OI Chg",
        type: "bar",
        stack: "total",
        label: { show: false },
        emphasis: { focus: "series" },
        data: analysisData.chartData.map((d) => Math.abs(d.peChange)),
        itemStyle: { color: (theme as any).palette?.error?.main ?? "var(--mui-palette-error-main)", borderRadius: [0, 2, 2, 0] },
      },
    ],
  };

  const itemStyle = {
    background: "background.paper",
    borderRadius: 4,
  } as any;

  return (
    <Stack id="oi-analysis" className="oi-analysis" spacing={1} sx={{ alignItems: "center", justifyContent: "center", width: "100%" }} data-testid="oi-analysis">
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, p: 1, width: "100%" }}>
        <OptionAlerts strikeMatrix={strikeMatrix} spotPrice={spotPrice} />
      </Box>

      <Grid container spacing={1} sx={{ justifyContent: "center", alignItems: "center", width: "100%" }} className="oi-analysis-grid">
        <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex", justifyContent: "center" }}>
          <Stack spacing={1} sx={{ width: "100%" }} className="oi-analysis-left">
            <IVSkewChart strikeMatrix={strikeMatrix} />
            <CompactPanel className="oi-spikes-panel" data-testid="options-oi-spikes-panel">
              <Text size="xs" fw={800} mb="sm" c="primary" style={{ letterSpacing: "0.5px" }}>
                🔥 INTENSITY (OI SPIKES)
              </Text>
              <Stack spacing={1} className="oi-spikes-list" data-testid="options-oi-spikes-list">
                {analysisData.spikes.map((s, i) => (
                  <Box key={i} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", p: 1, bgcolor: "background.paper" }} className="oi-spike-item" data-testid={`options-oi-spike-${i}`}>
                    <Stack spacing={0}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                        <Text size="sm" fw={800} c={s.type === "CE" ? "success" : "error"}>
                          {s.type} {s.strike}
                        </Text>
                        <Badge size="sm" variant="light" color="secondary">
                          {s.activityType}
                        </Badge>
                      </Box>
                      <Text size="sm" c="dimmed">
                        {s.contract.trading_symbol}
                      </Text>
                    </Stack>
                    <Stack spacing={0} sx={{ alignItems: "flex-end" }}>
                      <Text size="sm" fw={800} c="warning">
                        +{s.changePct.toFixed(1)}%
                      </Text>
                      <Text size="sm" c="dimmed">
                        +{Math.round(s.change / 1000)}k
                      </Text>
                    </Stack>
                  </Box>
                ))}
              </Stack>
            </CompactPanel>
          </Stack>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }} sx={{ display: "flex", justifyContent: "center" }}>
          <Stack spacing={1} sx={{ width: "100%" }} className="oi-analysis-right">
            <CompactPanel className="oi-distribution-panel" data-testid="options-oi-distribution-panel">
              <Text size="xs" fw={800} mb="sm" c="primary" style={{ letterSpacing: "0.5px" }}>
                📊 OI CHANGE DISTRIBUTION
              </Text>
              <ReactECharts option={distributionOption} style={{ height: "360px" }} opts={{ renderer: "svg" }} className="oi-distribution-chart" />
            </CompactPanel>
            <CompactPanel className="oi-sentiment-panel" data-testid="options-oi-sentiment-panel">
              <Box sx={{ display: "flex", alignItems: "flex-start" }}>
                <Box>
                  <Text fw={800} size="sm">
                    MARKET CONTEXT
                  </Text>
                  <Text size="sm" mt={4} style={{ lineHeight: 1.5 }}>
                    Aggressive position building seen at{" "}
                    <Text component="span" fw={800} c="warning">
                      {analysisData.spikes[0]?.strike}
                    </Text>
                    .{analysisData.spikes[0]?.activityType === "Positional" ? " This looks like a long-term directional bet by institutional players." : " This is likely high-frequency intraday churn or hedging activity."}
                    <Text component="span" display="block" mt={5} c="dimmed" size="sm">
                      PCR is currently signaling a{" "}
                      <Text component="span" fw={700}>
                        {Math.max(...analysisData.chartData.map((d) => d.peChange)) > Math.max(...analysisData.chartData.map((d) => d.ceChange)) ? "Bullish" : "Bearish"}
                      </Text>{" "}
                      trend in new contracts.
                    </Text>
                  </Text>
                </Box>
              </Box>
            </CompactPanel>
          </Stack>
        </Grid>
      </Grid>
    </Stack>
  );
}
