import { Badge, Box, Stack, Text, useColorScheme } from "@/ui";
import * as palette from "@/ui/palette";
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { OptionAlerts } from "./OptionAlerts";
import { IVSkewChart } from "./IVSkewChart";
import { fontWeights } from "../../../config/theme";
import { CHART_DROPDOWN } from "@/ui/palette";
import { CompactPanel } from "../../common/compact";

interface OIAnalysisProps {
  strikeMatrix: Array<{ strike: number; ce: any; pe: any }>;
  spotPrice: number | null;
}

export function OIAnalysis({ strikeMatrix, spotPrice }: OIAnalysisProps) {
  const { colorScheme } = useColorScheme();
  const isDark = colorScheme === "dark";

  const analysisData = useMemo(() => {
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
      backgroundColor: isDark ? CHART_DROPDOWN : palette.SURFACE,
      textStyle: {
        color: isDark ? palette.TEXT : palette.TEXT,
        fontSize: 12,
      },
    },
    legend: {
      data: ["Call OI Chg", "Put OI Chg"],
      textStyle: { color: palette.TEXT_MUTED, fontSize: 12 },
      bottom: 0,
    },
    grid: { top: 10, left: 60, right: 20, bottom: 40 },
    xAxis: { type: "value", axisLabel: { show: false }, splitLine: { show: false } },
    yAxis: {
      type: "category",
      data: analysisData.chartData.map((d) => d.strike),
      axisLabel: { color: palette.TEXT_MUTED, fontSize: 12, fontWeight: fontWeights.semibold },
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
        itemStyle: { color: palette.POSITIVE, borderRadius: [2, 0, 0, 2] },
      },
      {
        name: "Put OI Chg",
        type: "bar",
        stack: "total",
        label: { show: false },
        emphasis: { focus: "series" },
        data: analysisData.chartData.map((d) => Math.abs(d.peChange)),
        itemStyle: { color: palette.NEGATIVE, borderRadius: [0, 2, 2, 0] },
      },
    ],
  };

  return (
    <Stack id="oi-analysis" className="oi-analysis w-full" spacing={1} data-testid="oi-analysis">
      <Box className="flex w-full items-center justify-center gap-2 p-2">
        <OptionAlerts strikeMatrix={strikeMatrix} spotPrice={spotPrice} />
      </Box>

      <div className="oi-analysis-grid grid w-full grid-cols-1 items-center justify-center gap-2 md:grid-cols-2">
        <div className="flex justify-center">
          <Stack spacing={1} className="oi-analysis-left w-full">
            <IVSkewChart strikeMatrix={strikeMatrix} />
            <CompactPanel className="oi-spikes-panel" data-testid="options-oi-spikes-panel">
              <Text size="xs" fw={800} c="primary" className="mb-2" style={{ letterSpacing: "0.5px" }}>
                🔥 INTENSITY (OI SPIKES)
              </Text>
              <Stack spacing={1} className="oi-spikes-list" data-testid="options-oi-spikes-list">
                {analysisData.spikes.map((s, i) => (
                  <Box
                    key={i}
                    className="oi-spike-item flex items-center justify-between bg-fin-surface p-2"
                    data-testid={`options-oi-spike-${i}`}
                  >
                    <Stack spacing={0}>
                      <Box className="flex items-center gap-1">
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
                    <Stack spacing={0} className="items-end">
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
        </div>

        <div className="flex justify-center">
          <Stack spacing={1} className="oi-analysis-right w-full">
            <CompactPanel className="oi-distribution-panel" data-testid="options-oi-distribution-panel">
              <Text size="xs" fw={800} c="primary" className="mb-2" style={{ letterSpacing: "0.5px" }}>
                📊 OI CHANGE DISTRIBUTION
              </Text>
              <ReactECharts
                option={distributionOption}
                style={{ height: "360px" }}
                opts={{ renderer: "svg" }}
                className="oi-distribution-chart"
              />
            </CompactPanel>
            <CompactPanel className="oi-sentiment-panel" data-testid="options-oi-sentiment-panel">
              <Box className="flex items-start">
                <Box>
                  <Text fw={800} size="sm">
                    MARKET CONTEXT
                  </Text>
                  <Text size="sm" className="mt-1" style={{ lineHeight: 1.5 }}>
                    Aggressive position building seen at{" "}
                    <Text span fw={800} c="warning">
                      {analysisData.spikes[0]?.strike}
                    </Text>
                    .
                    {analysisData.spikes[0]?.activityType === "Positional"
                      ? " This looks like a long-term directional bet by institutional players."
                      : " This is likely high-frequency intraday churn or hedging activity."}
                    <Text span c="dimmed" size="sm" className="mt-1.5 block">
                      PCR is currently signaling a{" "}
                      <Text span fw={700}>
                        {Math.max(...analysisData.chartData.map((d) => d.peChange)) >
                        Math.max(...analysisData.chartData.map((d) => d.ceChange))
                          ? "Bullish"
                          : "Bearish"}
                      </Text>{" "}
                      trend in new contracts.
                    </Text>
                  </Text>
                </Box>
              </Box>
            </CompactPanel>
          </Stack>
        </div>
      </div>
    </Stack>
  );
}
