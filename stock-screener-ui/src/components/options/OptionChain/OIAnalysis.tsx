import { Badge, Box, Stack, Text, useColorScheme } from "@/ui";
import * as palette from "@/ui/palette";
import { createEffect, createMemo, onCleanup, onMount, For } from "solid-js";
import type * as ECharts from "echarts";
import { OptionAlerts } from "./OptionAlerts";
import { IVSkewChart } from "./IVSkewChart";
import { fontWeights } from "../../../config/theme";
import { CHART_DROPDOWN } from "@/ui/palette";
import { CompactPanel } from "../../common/compact";
import { loadEcharts } from "@/utils/loadEcharts";

interface OIAnalysisProps {
  strikeMatrix: Array<{ strike: number; ce: any; pe: any }>;
  spotPrice: number | null;
}

export function OIAnalysis(props: OIAnalysisProps) {
  const { colorScheme } = useColorScheme();
  const isDark = () => colorScheme() === "dark";

  let chartEl: HTMLDivElement | undefined;
  let chart: ECharts.ECharts | undefined;
  let disposed = false;

  const analysisData = createMemo(() => {
    const allOptions = props.strikeMatrix
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

    const chartData = props.strikeMatrix
      .map(({ strike, ce, pe }) => ({
        strike,
        ceChange: (ce?.market_data?.oi ?? 0) - (ce?.market_data?.prev_oi ?? 0),
        peChange: (pe?.market_data?.oi ?? 0) - (pe?.market_data?.prev_oi ?? 0),
      }))
      .filter((d) => Math.abs(d.ceChange) > 100 || Math.abs(d.peChange) > 100);

    return { spikes, chartData };
  });

  const pcrTrend = createMemo(() => {
    const cd = analysisData().chartData;
    if (cd.length === 0) return "Bullish";
    return Math.max(...cd.map((d) => d.peChange)) > Math.max(...cd.map((d) => d.ceChange))
      ? "Bullish"
      : "Bearish";
  });

  const speculationNote = createMemo(() =>
    analysisData().spikes[0]?.activityType === "Positional"
      ? " This looks like a long-term directional bet by institutional players."
      : " This is likely high-frequency intraday churn or hedging activity.",
  );

  async function applyOption(option: Record<string, unknown>) {
    const lib = await loadEcharts();
    if (disposed || !chartEl || !lib) return;
    if (!chart) chart = lib.init(chartEl, null, { renderer: "svg" }) as ECharts.ECharts;
    chart.setOption(option, true);
    chart.resize();
  }

  createEffect(() => {
    const data = analysisData().chartData;
    const option = {
      "background-color": "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        "background-color": isDark() ? CHART_DROPDOWN : palette.SURFACE,
        textStyle: {
          color: palette.TEXT,
          "font-size": 12,
        },
      },
      legend: {
        data: ["Call OI Chg", "Put OI Chg"],
        textStyle: { color: palette.TEXT_MUTED, "font-size": 12 },
        bottom: 0,
      },
      grid: { top: 10, left: 60, right: 20, bottom: 40 },
      xAxis: { type: "value", axisLabel: { show: false }, splitLine: { show: false } },
      yAxis: {
        type: "category",
        data: data.map((d) => d.strike),
        axisLabel: { color: palette.TEXT_MUTED, "font-size": 12, "font-weight": fontWeights.semibold },
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
          data: data.map((d) => -Math.abs(d.ceChange)),
          itemStyle: { color: palette.POSITIVE, "border-radius": [2, 0, 0, 2] },
        },
        {
          name: "Put OI Chg",
          type: "bar",
          stack: "total",
          label: { show: false },
          emphasis: { focus: "series" },
          data: data.map((d) => Math.abs(d.peChange)),
          itemStyle: { color: palette.NEGATIVE, "border-radius": [0, 2, 2, 0] },
        },
      ],
    };
    void applyOption(option);
  });

  onMount(() => {
    const handleResize = () => chart?.resize();
    window.addEventListener("resize", handleResize);
    onCleanup(() => window.removeEventListener("resize", handleResize));
  });

  onCleanup(() => {
    disposed = true;
    chart?.dispose();
    chart = undefined;
  });

  return (
    <Stack id="oi-analysis" className="oi-analysis w-full" spacing={1} data-testid="oi-analysis">
      <Box className="flex w-full items-center justify-center gap-2 p-2">
        <OptionAlerts strikeMatrix={props.strikeMatrix} spotPrice={props.spotPrice} />
      </Box>

      <div className="oi-analysis-grid grid w-full grid-cols-1 items-center justify-center gap-2 md:grid-cols-2">
        <div className="flex justify-center">
          <Stack spacing={1} className="oi-analysis-left w-full">
            <IVSkewChart strikeMatrix={props.strikeMatrix} />
            <CompactPanel className="oi-spikes-panel" data-testid="options-oi-spikes-panel">
              <Text size="xs" fw={800} c="primary" className="mb-2" style={{ "letter-spacing": "0.5px" }}>
                🔥 INTENSITY (OI SPIKES)
              </Text>
              <Stack spacing={1} className="oi-spikes-list" data-testid="options-oi-spikes-list">
                <For each={analysisData().spikes}>
                  {(s, i) => (
                    <Box
                      className="oi-spike-item flex items-center justify-between bg-fin-surface p-2"
                      data-testid={`options-oi-spike-${i()}`}
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
                  )}
                </For>
              </Stack>
            </CompactPanel>
          </Stack>
        </div>

        <div className="flex justify-center">
          <Stack spacing={1} className="oi-analysis-right w-full">
            <CompactPanel className="oi-distribution-panel" data-testid="options-oi-distribution-panel">
              <Text size="xs" fw={800} c="primary" className="mb-2" style={{ "letter-spacing": "0.5px" }}>
                📊 OI CHANGE DISTRIBUTION
              </Text>
              <div
                ref={(el) => (chartEl = el)}
                className="oi-distribution-chart"
                data-testid="options-oi-distribution-chart"
                style={{ height: "360px", width: "100%" }}
              />
            </CompactPanel>
            <CompactPanel className="oi-sentiment-panel" data-testid="options-oi-sentiment-panel">
              <Box className="flex items-start">
                <Box>
                  <Text fw={800} size="sm">
                    MARKET CONTEXT
                  </Text>
                  <Text size="sm" className="mt-1" style={{ "line-height": 1.5 }}>
                    Aggressive position building seen at{" "}
                    <Text span fw={800} c="warning">
                      {analysisData().spikes[0]?.strike}
                    </Text>
                    .
                    {speculationNote()}
                    <Text span c="dimmed" size="sm" className="mt-1.5 block">
                      PCR is currently signaling a{" "}
                      <Text span fw={700}>
                        {pcrTrend()}
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
