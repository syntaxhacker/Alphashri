import {
  Box,
  Group,
  Text,
  Stack,
  SimpleGrid,
  Badge,
  useMantineColorScheme,
  useMantineTheme,
} from "@mantine/core";
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { OptionAlerts } from "./OptionAlerts";
import { IVSkewChart } from "./IVSkewChart";
import { fontWeights } from "../../../theme";
import { CompactPanel } from "../../common/compact";

interface OIAnalysisProps {
  strikeMatrix: Array<{ strike: number; ce: any; pe: any }>;
  spotPrice: number | null;
}

export function OIAnalysis({ strikeMatrix, spotPrice }: OIAnalysisProps) {
  const theme = useMantineTheme();
  const { colorScheme } = useMantineColorScheme();
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
      backgroundColor: isDark ? "#25262b" : "#fff",
      borderColor: isDark ? "#373a40" : "#dee2e6",
      textStyle: { color: isDark ? "#c1c2c5" : "#1f2937", fontSize: theme.fontSizes.sm },
    },
    legend: {
      data: ["Call OI Chg", "Put OI Chg"],
      textStyle: { color: "gray", fontSize: theme.fontSizes.sm },
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
      axisLabel: { color: "gray", fontSize: theme.fontSizes.sm, fontWeight: fontWeights.semibold },
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
        data: analysisData.chartData.map((d) => -Math.abs(d.ceChange)), // Negative for left side
        itemStyle: { color: "#40c057", borderRadius: [2, 0, 0, 2] },
      },
      {
        name: "Put OI Chg",
        type: "bar",
        stack: "total",
        label: { show: false },
        emphasis: { focus: "series" },
        data: analysisData.chartData.map((d) => Math.abs(d.peChange)),
        itemStyle: { color: "#fa5252", borderRadius: [0, 2, 2, 0] },
      },
    ],
  };

  const itemStyle = {
    background: "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-6))",
    borderRadius: "var(--mantine-radius-sm)",
  };

  return (
    <Stack id="oi-analysis" className="oi-analysis" gap="sm" data-testid="oi-analysis">
      <OptionAlerts strikeMatrix={strikeMatrix} spotPrice={spotPrice} />

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="sm" className="oi-analysis-grid">
        <Stack gap="sm" className="oi-analysis-left">
          <IVSkewChart strikeMatrix={strikeMatrix} />

          {/* OI Spikes List */}
          <CompactPanel className="oi-spikes-panel" data-testid="options-oi-spikes-panel">
            <Text size="xs" fw={800} mb="sm" c="blue.6" style={{ letterSpacing: "0.5px" }}>
              🔥 INTENSITY (OI SPIKES)
            </Text>
            <Stack gap="xs" className="oi-spikes-list" data-testid="options-oi-spikes-list">
              {analysisData.spikes.map((s, i) => (
                <Group
                  key={i}
                  justify="space-between"
                  p="xs"
                  wrap="nowrap"
                  style={itemStyle}
                  className="oi-spike-item"
                  data-testid={`options-oi-spike-${i}`}
                >
                  <Stack gap={0}>
                    <Group gap={5}>
                      <Text size="sm" fw={800} c={s.type === "CE" ? "green.7" : "red.7"}>
                        {s.type} {s.strike}
                      </Text>
                      <Badge
                        size="sm"
                        variant="light"
                        color={s.activityType === "Speculative" ? "pink" : "indigo"}
                      >
                        {s.activityType}
                      </Badge>
                    </Group>
                    <Text size="sm" c="dimmed">
                      {s.contract.trading_symbol}
                    </Text>
                  </Stack>
                  <Stack gap={0} align="flex-end">
                    <Text size="sm" fw={800} c="orange.7">
                      +{s.changePct.toFixed(1)}%
                    </Text>
                    <Text size="sm" c="dimmed">
                      +{Math.round(s.change / 1000)}k
                    </Text>
                  </Stack>
                </Group>
              ))}
            </Stack>
          </CompactPanel>
        </Stack>

        <Stack gap="sm" className="oi-analysis-right">
          {/* OI Distribution Chart */}
          <CompactPanel
            className="oi-distribution-panel"
            data-testid="options-oi-distribution-panel"
          >
            <Text size="xs" fw={800} mb="sm" c="blue.6" style={{ letterSpacing: "0.5px" }}>
              📊 OI CHANGE DISTRIBUTION
            </Text>
            <ReactECharts
              option={distributionOption}
              style={{ height: "360px" }}
              opts={{ renderer: "svg" }}
              className="oi-distribution-chart"
            />
          </CompactPanel>

          {/* Sentiment Overview */}
          <CompactPanel
            className="oi-sentiment-panel"
            data-testid="options-oi-sentiment-panel"
            style={{ borderLeft: "4px solid var(--mantine-color-blue-6)", flex: 1 }}
          >
            <Group align="flex-start" wrap="nowrap">
              <Box>
                <Text fw={800} size="sm">
                  MARKET CONTEXT
                </Text>
                <Text size="sm" mt={4} style={{ lineHeight: 1.5 }}>
                  Aggressive position building seen at{" "}
                  <Text component="span" fw={800} c="orange.7">
                    {analysisData.spikes[0]?.strike}
                  </Text>
                  .
                  {analysisData.spikes[0]?.activityType === "Positional"
                    ? " This looks like a long-term directional bet by institutional players."
                    : " This is likely high-frequency intraday churn or hedging activity."}
                  <Text component="span" display="block" mt={5} c="dimmed" size="sm">
                    PCR is currently signaling a{" "}
                    <Text component="span" fw={700}>
                      {Math.max(...analysisData.chartData.map((d) => d.peChange)) >
                      Math.max(...analysisData.chartData.map((d) => d.ceChange))
                        ? "Bullish"
                        : "Bearish"}
                    </Text>{" "}
                    trend in new contracts.
                  </Text>
                </Text>
              </Box>
            </Group>
          </CompactPanel>
        </Stack>
      </SimpleGrid>
    </Stack>
  );
}
