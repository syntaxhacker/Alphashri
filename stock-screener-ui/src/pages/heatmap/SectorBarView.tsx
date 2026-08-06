import { Flex, Text } from "@/ui";
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import { TOOLTIP_DARK_BG, TOOLTIP_LIGHT_BG, TOOLTIP_DARK_BORDER, TOOLTIP_LIGHT_BORDER, TOOLTIP_DARK_TEXT, TOOLTIP_LIGHT_TEXT, AXIS_DARK_LINE, AXIS_LIGHT_LINE, AXIS_DARK_SPLIT, AXIS_LIGHT_SPLIT } from "../../config/colors";

interface SectorBarViewProps {
  stocks: { sector: string; [key: string]: any }[];
  metric: string;
  getMetricValue: (stock: any, metric: string) => number;
  getMetricColor: (value: number, min: number, max: number) => string;
  METRICS: { value: string; label: string; fmt: (v: number) => string }[];
}

export function SectorBarView({ stocks, metric, getMetricValue, getMetricColor, METRICS }: SectorBarViewProps) {
  const isDark = document.documentElement.getAttribute('data-dark') === 'true';
  const tooltipBg = isDark ? TOOLTIP_DARK_BG : TOOLTIP_LIGHT_BG;
  const tooltipText = isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT;
  const axisLineColor = isDark ? AXIS_DARK_LINE : AXIS_LIGHT_LINE;
  const splitLineColor = isDark ? AXIS_DARK_SPLIT : AXIS_LIGHT_SPLIT;
  const metricConfig = METRICS.find(m => m.value === metric);
  const fmt = metricConfig?.fmt ?? ((v: number) => v.toFixed(2));
  const label = metricConfig?.label ?? metric;

  const option = useMemo(() => {
    const groupMap: Record<string, { sum: number; count: number }> = {};
    for (const stock of stocks) {
      const sector = stock.sector;
      if (!sector) continue;
      const v = getMetricValue(stock, metric);
      if (v === null || v === undefined || !isFinite(v)) continue;
      if (!groupMap[sector]) groupMap[sector] = { sum: 0, count: 0 };
      groupMap[sector].sum += v;
      groupMap[sector].count++;
    }

    const entries = Object.entries(groupMap).map(([sector, { sum, count }]) => ({
      sector,
      avg: sum / count,
      count,
    }));

    if (entries.length === 0) return {};

    entries.sort((a, b) => b.avg - a.avg);

    const minAvg = entries[entries.length - 1].avg;
    const maxAvg = entries[0].avg;

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: tooltipBg,
        borderColor: isDark ? TOOLTIP_DARK_BORDER : TOOLTIP_LIGHT_BORDER,
        textStyle: { color: tooltipText },
        formatter: (params: any) => {
          const d = params[0];
          if (!d) return '';
          const entry = entries[d.dataIndex];
          return [
            `<div style="color:${tooltipText};font-size:13px;font-weight:bold">${entry.sector}</div>`,
            `<div style="color:${tooltipText};margin-top:4px">Avg ${label}: <b>${fmt(entry.avg)}</b></div>`,
            `<div style="color:${tooltipText};margin-top:2px">Stocks: <b>${entry.count}</b></div>`,
          ].join('\n');
        },
      },
      grid: { left: 110, right: 60, bottom: 20, top: 40 },
      xAxis: {
        type: 'value',
        name: label,
        nameTextStyle: { fontSize: 11, color: tooltipText },
        axisLabel: {
          fontSize: 10,
          color: tooltipText,
          formatter: (v: number) => fmt(v),
        },
        axisLine: { lineStyle: { color: axisLineColor } },
        splitLine: { lineStyle: { color: splitLineColor } },
      },
      yAxis: {
        type: 'category',
        data: entries.map(e => e.sector),
        axisLabel: { fontSize: 10, color: tooltipText },
        axisLine: { lineStyle: { color: axisLineColor } },
        splitLine: { show: false },
      },
      series: [{
        type: 'bar',
        data: entries.map(e => ({
          value: e.avg,
          itemStyle: { color: getMetricColor(e.avg, minAvg, maxAvg) },
        })),
        barMaxWidth: 28,
        emphasis: { itemStyle: { shadowBlur: 4, shadowColor: 'rgba(0,0,0,0.3)' } },
        label: {
          show: true,
          position: 'right',
          fontSize: 10,
          color: tooltipText,
          formatter: (p: any) => fmt(p.value),
        },
      }],
    };
  }, [stocks, metric, getMetricValue, getMetricColor, fmt, label, isDark, tooltipBg, tooltipText, axisLineColor, splitLineColor]);

  return (
    <Flex direction="column" style={{ height: '100%', flex: 1 }}>
      <Flex p="xs" align="center" gap="xs">
        <Text size="sm" fw={600}>Avg {label} by Sector</Text>
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
