import { Badge, Box, Stack, Text, useColorScheme, typeSize } from "@/ui";
import * as palette from "@/ui/palette";
import { IconActivity, IconChartBar } from "@/ui/icons";
import { createEffect, createMemo, onCleanup, onMount, For } from "solid-js";
import type * as ECharts from "echarts";
import { OptionAlerts } from "./OptionAlerts";
import { IVSkewChart } from "./IVSkewChart";
import { fontWeights } from "../../../config/theme";
import { HIGH_TURNOVER_VOL_OI_RATIO, pcrTone } from "@/config/optionsMath";
import { CHART_DROPDOWN } from "@/ui/palette";
import { CompactPanel } from "../../common/compact";
import { loadEcharts } from "@/utils/loadEcharts";

interface OIAnalysisProps {
  strikeMatrix: Array<{ strike: number; ce: any; pe: any }>;
  spotPrice: number | null;
  summary?: { pcr?: number | null } | null;
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
        const activityType = volOiRatio > HIGH_TURNOVER_VOL_OI_RATIO ? "High churn" : "OI build";
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

  // PCR is put OI ÷ call OI and comes from the summary. The old "PCR trend"
  // compared the largest PE and CE OI changes on the spike chart, which is a
  // different quantity — share the table tab's tone helper instead.
  const pcr = createMemo(() => {
    const raw = props.summary?.pcr;
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  });
  const pcrLabel = createMemo(() => {
    const tone = pcrTone(pcr());
    return tone === "bullish" ? "Bullish bias" : tone === "bearish" ? "Bearish bias" : "Neutral";
  });
  const pcrDisplay = createMemo(() => (pcr() == null ? "unavailable" : (pcr() as number).toFixed(2)));
  const pcrText = createMemo(() =>
    pcr() == null
      ? "PCR (put/call OI) unavailable"
      : `PCR (put/call OI) ${pcrDisplay()} — ${pcrLabel()}`,
  );

  const turnoverNote = createMemo(() => {
    const top = analysisData().spikes[0];
    if (!top) return "";
    return top.activityType === "High churn"
      ? " Volume here is large relative to the OI change."
      : " Volume here is in line with the OI change.";
  });

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
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: isDark() ? CHART_DROPDOWN : palette.SURFACE,
        textStyle: {
          color: palette.TEXT,
          fontSize: typeSize("micro"),
        },
      },
      legend: {
        data: ["Call OI Chg", "Put OI Chg"],
        textStyle: { color: palette.TEXT_MUTED, fontSize: typeSize("micro") },
        bottom: 0,
      },
      grid: { top: 10, left: 60, right: 20, bottom: 40 },
      xAxis: { type: "value", axisLabel: { show: false }, splitLine: { show: false } },
      yAxis: {
        type: "category",
        data: data.map((d) => d.strike),
        axisLabel: { color: palette.TEXT_MUTED, fontSize: typeSize("micro"), fontWeight: fontWeights.semibold },
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
          itemStyle: { color: palette.POSITIVE, borderRadius: [2, 0, 0, 2] },
        },
        {
          name: "Put OI Chg",
          type: "bar",
          stack: "total",
          label: { show: false },
          emphasis: { focus: "series" },
          data: data.map((d) => Math.abs(d.peChange)),
          itemStyle: { color: palette.NEGATIVE, borderRadius: [0, 2, 2, 0] },
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
            <IVSkewChart strikeMatrix={props.strikeMatrix} spotPrice={props.spotPrice} />
            <CompactPanel className="oi-spikes-panel" data-testid="options-oi-spikes-panel">
              <Text size="xs" fw={800} c="primary" className="mb-2" style={{ "letter-spacing": "0.5px" }}>
                <IconActivity size={14} aria-hidden="true" /> INTENSITY (OI SPIKES)
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
                <IconChartBar size={14} aria-hidden="true" /> OI CHANGE DISTRIBUTION
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
                    {turnoverNote()}
                    <Text span c="dimmed" size="sm" className="mt-1.5 block" data-testid="options-pcr-read">
                      {pcrText()}
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
