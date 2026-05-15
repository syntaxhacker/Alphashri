import { Flex, Group, Select, Text, Box } from "@mantine/core";
import { useMemo } from "react";
import ReactECharts from "echarts-for-react";
import type { HeatmapStock } from "../../api/heatmap";
import {
  TOOLTIP_DARK_BG,
  TOOLTIP_LIGHT_BG,
  TOOLTIP_DARK_BORDER,
  TOOLTIP_LIGHT_BORDER,
  TOOLTIP_DARK_TEXT,
  TOOLTIP_LIGHT_TEXT,
} from "../../config/colors";

interface ScatterViewProps {
  stocks: HeatmapStock[];
  metricX: string;
  metricY: string;
  onMetricXChange: (v: string) => void;
  onMetricYChange: (v: string) => void;
  getMetricValue: (stock: HeatmapStock, metric: string) => number;
  getMetricColor: (value: number, min: number, max: number) => string;
  METRICS: { value: string; label: string; fmt: (v: number) => string }[];
}

const PALETTE = ['#5470c6','#91cc75','#fac858','#ee6666','#73c0de','#3ba272','#fc8452','#9a60b4','#ea7ccc'];

export function ScatterView({ stocks, metricX, metricY, onMetricXChange, onMetricYChange, getMetricValue, METRICS }: ScatterViewProps) {
  const isDark = document.documentElement.getAttribute('data-dark') === 'true';
  const tooltipBg = isDark ? TOOLTIP_DARK_BG : TOOLTIP_LIGHT_BG;
  const tooltipText = isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT;

  const { sectors, sectorColors } = useMemo(() => {
    const unique = [...new Set(stocks.map(s => s.sector).filter(Boolean))];
    const colors: Record<string, string> = {};
    unique.forEach((s, i) => { colors[s] = PALETTE[i % PALETTE.length]; });
    return { sectors: unique, sectorColors: colors };
  }, [stocks]);

  const metricXLabel = METRICS.find(m => m.value === metricX)?.label || metricX;
  const metricYLabel = METRICS.find(m => m.value === metricY)?.label || metricY;

  const option = useMemo(() => {
    const series = sectors.map(sector => {
      const sectorStocks = stocks.filter(s => s.sector === sector);
      return {
        name: sector,
        type: 'scatter',
        data: sectorStocks.map(s => ({
          value: [getMetricValue(s, metricX), getMetricValue(s, metricY)],
          symbol: s.symbol,
          sector: s.sector,
        })),
        itemStyle: { color: sectorColors[sector] },
        emphasis: {
          label: {
            show: true,
            formatter: (params: any) => params.data?.symbol || '',
            position: 'top',
            fontSize: 11,
            fontWeight: 'bold',
            color: tooltipText,
          },
        },
      };
    });

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const d = params.data;
          if (!d) return '';
          const xVal = METRICS.find(m => m.value === metricX)?.fmt(d.value[0]) ?? d.value[0];
          const yVal = METRICS.find(m => m.value === metricY)?.fmt(d.value[1]) ?? d.value[1];
          return [
            `<div style="font-weight:bold;font-size:14px;color:${tooltipText}">${d.symbol}</div>`,
            `<div style="color:${tooltipText};font-size:12px;margin-top:4px">Sector: ${d.sector}</div>`,
            `<div style="margin-top:8px">`,
            `  <div style="color:${tooltipText}">${metricXLabel}: <b>${xVal}</b></div>`,
            `  <div style="color:${tooltipText}">${metricYLabel}: <b>${yVal}</b></div>`,
            `</div>`,
          ].join('\n');
        },
        backgroundColor: tooltipBg,
        borderColor: isDark ? TOOLTIP_DARK_BORDER : TOOLTIP_LIGHT_BORDER,
        textStyle: { color: tooltipText },
      },
      legend: {
        type: 'scroll',
        orient: 'vertical',
        right: 10,
        top: 40,
        textStyle: { color: isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT, fontSize: 10 },
        pageTextStyle: { color: isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT },
      },
      grid: {
        left: 50,
        right: 130,
        bottom: 50,
        top: 10,
      },
      xAxis: {
        type: 'value',
        name: metricXLabel,
        nameLocation: 'center',
        nameGap: 30,
        nameTextStyle: { fontSize: 12, fontWeight: 'bold', color: isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT },
        axisLabel: { show: false },
        axisLine: { lineStyle: { color: isDark ? '#373a40' : '#dee2e6' } },
        splitLine: { lineStyle: { color: isDark ? '#1a1b1e' : '#f1f3f5' } },
      },
      yAxis: {
        type: 'value',
        name: metricYLabel,
        nameLocation: 'center',
        nameGap: 40,
        nameTextStyle: { fontSize: 12, fontWeight: 'bold', color: isDark ? TOOLTIP_DARK_TEXT : TOOLTIP_LIGHT_TEXT },
        axisLabel: { show: false },
        axisLine: { lineStyle: { color: isDark ? '#373a40' : '#dee2e6' } },
        splitLine: { lineStyle: { color: isDark ? '#1a1b1e' : '#f1f3f5' } },
      },
      series,
    };
  }, [stocks, sectors, sectorColors, metricX, metricY, metricXLabel, metricYLabel, getMetricValue, isDark, tooltipBg, tooltipText]);

  const metricOptions = METRICS.map(m => ({ value: m.value, label: m.label }));

  return (
    <Flex direction="column" style={{ height: '100%', flex: 1 }}>
      <Group p="xs" gap="sm">
        <Select
          size="xs"
          label="X Axis"
          value={metricX}
          onChange={(v) => onMetricXChange(v || metricX)}
          data={metricOptions}
          style={{ width: 140 }}
        />
        <Select
          size="xs"
          label="Y Axis"
          value={metricY}
          onChange={(v) => onMetricYChange(v || metricY)}
          data={metricOptions}
          style={{ width: 140 }}
        />
      </Group>
      <Box style={{ flex: 1, minHeight: 0 }}>
        <ReactECharts
          option={option}
          style={{ height: '100%', width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </Box>
    </Flex>
  );
}
