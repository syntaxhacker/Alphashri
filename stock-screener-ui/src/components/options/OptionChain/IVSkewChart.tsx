import { Text, useColorScheme } from "@/ui";
import { Box } from "@/ui";
import { createEffect, createMemo, onCleanup, onMount } from "solid-js";
import type * as ECharts from "echarts";
import * as palette from "@/ui/palette";
import type { AnalyticsIvPoint } from "@/api/optionsAnalytics";
import { smilePoints, type OptionSide } from "@/utils/optionsAnalyticsMath";
import { CompactPanel } from "../../common/compact";
import { loadEcharts } from "@/utils/loadEcharts";

interface SmileRow {
  strike: number;
  ce: any;
  pe: any;
}

interface IVSkewChartProps {
  strikeMatrix: SmileRow[];
  spotPrice: number | null;
}

export interface SmileSeries {
  strikes: number[];
  /** One value per strike; `null` means no OTM quote on that side. Never 0. */
  ce: Array<number | null>;
  pe: Array<number | null>;
}

function ivPoints(rows: readonly SmileRow[], side: OptionSide): AnalyticsIvPoint[] {
  return rows.map((row) => {
    const leg = side === "CE" ? row.ce : row.pe;
    return {
      strike: row.strike,
      moneyness: null,
      iv: leg?.option_greeks?.iv ?? null,
      delta: leg?.option_greeks?.delta ?? null,
      oi: leg?.market_data?.oi ?? null,
    };
  });
}

/**
 * OTM smile from the chain rows already on screen. CE and PE are separate
 * series and a missing iv stays `null` — the old `ce?.iv || pe?.iv || 0` both
 * mixed the two sides and drew a fake 0 where no quote existed.
 */
export function buildSmileSeries(rows: readonly SmileRow[], spot: number | null): SmileSeries {
  const ce = smilePoints(ivPoints(rows, "CE"), spot ?? 0, "CE");
  const pe = smilePoints(ivPoints(rows, "PE"), spot ?? 0, "PE");
  const strikes = [...new Set([...ce, ...pe].map((p) => p.strike))].sort((a, b) => a - b);
  const ceByStrike = new Map(ce.map((p) => [p.strike, p.iv]));
  const peByStrike = new Map(pe.map((p) => [p.strike, p.iv]));
  return {
    strikes,
    ce: strikes.map((k) => ceByStrike.get(k) ?? null),
    pe: strikes.map((k) => peByStrike.get(k) ?? null),
  };
}

export function IVSkewChart(props: IVSkewChartProps) {
  const { colorScheme } = useColorScheme();
  const isDark = () => colorScheme() === "dark";

  let chartEl: HTMLDivElement | undefined;
  let chart: ECharts.ECharts | undefined;
  let disposed = false;

  const smile = createMemo(() => buildSmileSeries(props.strikeMatrix, props.spotPrice));

  async function applyOption(option: Record<string, unknown>) {
    const lib = await loadEcharts();
    if (disposed || !chartEl || !lib) return;
    if (!chart) chart = lib.init(chartEl, null, { renderer: "svg" }) as ECharts.ECharts;
    chart.setOption(option, true);
    chart.resize();
  }

  createEffect(() => {
    const { strikes, ce, pe } = smile();
    const option = {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        formatter: (params: any) => {
          const rows = Array.isArray(params) ? params : [params];
          const strike = rows[0]?.axisValue ?? rows[0]?.name ?? "";
          const lines = rows
            .filter((p: any) => p.value != null)
            .map((p: any) => `${p.seriesName}: ${Number(p.value).toFixed(1)}%`);
          return lines.length ? `Strike: ${strike}<br/>${lines.join("<br/>")}` : `Strike: ${strike}`;
        },
        backgroundColor: isDark() ? palette.CHART_DROPDOWN : palette.SURFACE,
        textStyle: {
          color: isDark() ? palette.TEXT : palette.TOOLTIP_LIGHT_TEXT,
          fontSize: 12,
        },
      },
      legend: {
        data: ["Call OTM IV", "Put OTM IV"],
        textStyle: { color: palette.TEXT_MUTED, fontSize: 12 },
        bottom: 0,
      },
      grid: {
        top: 10,
        left: 40,
        right: 10,
        bottom: 25,
      },
      xAxis: {
        type: "category",
        data: strikes,
        axisLabel: { color: palette.TEXT_MUTED, fontSize: 12 },
        axisLine: { lineStyle: { color: palette.BORDER } },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: palette.TEXT_MUTED, fontSize: 12, formatter: "{value}%" },
        splitLine: {
          lineStyle: { color: palette.BORDER, type: "dashed" },
        },
      },
      series: [
        {
          name: "Call OTM IV",
          type: "line",
          smooth: true,
          symbol: "none",
          connectNulls: false,
          data: ce,
          lineStyle: { width: 3, color: palette.INFO },
        },
        {
          name: "Put OTM IV",
          type: "line",
          smooth: true,
          symbol: "none",
          connectNulls: false,
          data: pe,
          lineStyle: { width: 3, color: palette.WARNING },
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
    <CompactPanel className="iv-skew-chart-panel" data-testid="options-iv-skew-chart">
      <Box className="flex items-center justify-center w-full iv-skew-header" gap={1} p="sm">
        <Text size="sm" fw={800} className="text-fin-primary" style={{ "letter-spacing": "0.5px" }}>
          VOLATILITY SMILE (OTM IV)
        </Text>
        <Text size="sm" className="text-fin-text-muted">
          Calls and puts, missing quotes left blank
        </Text>
      </Box>
      <div
        ref={(el) => (chartEl = el)}
        className="iv-skew-chart"
        data-testid="options-iv-skew-chart-canvas"
        style={{ height: "148px", width: "100%" }}
      />
    </CompactPanel>
  );
}
