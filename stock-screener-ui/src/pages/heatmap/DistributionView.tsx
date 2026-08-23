import { Flex, Text } from "@/ui";
import { alpha } from "@mui/material/styles";
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { TOOLTIP_DARK_BG, TOOLTIP_LIGHT_BG, TOOLTIP_DARK_BORDER, TOOLTIP_LIGHT_BORDER, TOOLTIP_DARK_TEXT, TOOLTIP_LIGHT_TEXT, AXIS_DARK_LINE, AXIS_LIGHT_LINE, AXIS_DARK_SPLIT, AXIS_LIGHT_SPLIT, BLACK } from "../../config/colors";

interface DistributionViewProps {
  stocks: { pe_ratio: number; market_cap: number; [key: string]: any }[];
  metric: string;
  getMetricValue: (stock: any, metric: string) => number;
  getMetricColor: (value: number, min: number, max: number) => string;
  METRICS: { value: string; label: string; fmt: (v: number) => string }[];
}

export function DistributionView({ stocks, metric, getMetricValue, getMetricColor, METRICS }: DistributionViewProps) {
  const isDark = document.documentElement.getAttribute('data-dark') === 'true';
  const tooltipBg = isDark ? TOOLTIP_DARK_BG : TOOLTIP_LIGHT_BG;
  const tooltipText = isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT;
  const axisLineColor = isDark ? AXIS_DARK_LINE : AXIS_LIGHT_LINE;
  const splitLineColor = isDark ? AXIS_DARK_SPLIT : AXIS_LIGHT_SPLIT;
  const metricConfig = METRICS.find(m => m.value === metric);
  const fmt = metricConfig?.fmt ?? ((v: number) => v.toFixed(2));
  const label = metricConfig?.label ?? metric;

  const option = useMemo(() => {
    const values = stocks.map(s => getMetricValue(s, metric)).filter(v => v !== null && v !== undefined && isFinite(v));
    if (values.length === 0) return {};

    const min = Math.min(...values);
    const max = Math.max(...values);
    if (max === min) {
      return {
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis' },
        xAxis: { type: 'category', data: [fmt(min)], axisLine: { lineStyle: { color: axisLineColor } } },
        yAxis: { type: 'value', axisLine: { lineStyle: { color: axisLineColor } }, splitLine: { lineStyle: { color: splitLineColor } } },
        series: [{ type: 'bar', data: [values.length], itemStyle: { color: getMetricColor(min, min, max) } }],
      };
    }

    const numBins = Math.ceil(1 + 3.322 * Math.log(values.length));
    const binWidth = (max - min) / numBins;

    const bins: { min: number; max: number; count: number }[] = [];
    for (let i = 0; i < numBins; i++) {
      const bMin = min + i * binWidth;
      const bMax = i === numBins - 1 ? max : min + (i + 1) * binWidth;
      bins.push({ min: bMin, max: bMax, count: 0 });
    }

    for (const v of values) {
      let idx = Math.min(Math.floor((v - min) / binWidth), numBins - 1);
      idx = Math.max(0, idx);
      bins[idx].count++;
    }

    const maxLabelCount = 6;
    const labelStep = Math.max(1, Math.floor(numBins / maxLabelCount));

    const xData = bins.map((b, i) => {
      if (i % labelStep === 0 || i === numBins - 1) {
        return `${fmt(b.min)} - ${fmt(b.max)}`;
      }
      return '';
    });

    const barData = bins.map(b => b.count);
    const barColors = bins.map(b => {
      const mid = (b.min + b.max) / 2;
      return getMetricColor(mid, min, max);
    });

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        backgroundColor: tooltipBg,
        borderColor: isDark ? TOOLTIP_DARK_BORDER : TOOLTIP_LIGHT_BORDER,
        textStyle: { color: tooltipText },
        formatter: (params: any) => {
          const idx = params[0]?.dataIndex;
          if (idx === undefined) return '';
          const b = bins[idx];
          if (!b) return '';
          return [
            `<div style="color:${tooltipText};font-size:12px">${label}</div>`,
            `<div style="color:${tooltipText};font-weight:bold;margin-top:4px">${fmt(b.min)} - ${fmt(b.max)}</div>`,
            `<div style="color:${tooltipText};margin-top:6px">Count: <b>${b.count}</b></div>`,
          ].join('\n');
        },
      },
      grid: { left: 60, right: 20, bottom: 60, top: 20 },
      xAxis: {
        type: 'category',
        data: xData,
        axisLabel: {
          rotate: 45,
          fontSize: 10,
          color: tooltipText,
          interval: 0,
          formatter: (val: string) => val || '',
        },
        axisLine: { lineStyle: { color: axisLineColor } },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'Count',
        nameTextStyle: { fontSize: 11, color: tooltipText },
        axisLabel: { fontSize: 10, color: tooltipText },
        axisLine: { lineStyle: { color: axisLineColor } },
        splitLine: { lineStyle: { color: splitLineColor } },
      },
      series: [{
        type: 'bar',
        data: barData.map((count, i) => ({
          value: count,
          itemStyle: { color: barColors[i] },
        })),
        barMaxWidth: 40,
        emphasis: { itemStyle: { shadowBlur: 4, shadowColor: alpha(BLACK, 0.3) } },
      }],
    };
  }, [stocks, metric, getMetricValue, getMetricColor, fmt, label, isDark, tooltipBg, tooltipText, axisLineColor, splitLineColor]);

  return (
    <Flex direction="column" style={{ height: '100%', flex: 1 }}>
      <Flex p="xs" align="center" gap="xs">
        <Text size="sm" fw={600}>{label} Distribution</Text>
        <Text size="xs" c="dimmed">({stocks.length} stocks)</Text>
      </Flex>
      <div style={{ flex: 1, minHeight: 0 }}>
        <ReactECharts
          option={option}
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
    </Flex>
  );
}
