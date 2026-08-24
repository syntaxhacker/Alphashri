import { useEffect, useState } from "react";
import { Box, Flex, Text, Paper, SimpleGrid, Loader, Center, SegmentedControl, Group, Badge } from "@/ui";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { getPaperTradingState, subscribe } from "../../state/paperTrading";
import { fetchAnalytics } from "../../api/paperTrading";
import { CompactStat, CompactStatGrid } from "../common/compact";
import type { AnalyticsData, DailyPnLPoint, EquityCurvePoint } from "../../types/paperTrading";
import { PERF_POSITIVE, PERF_NEGATIVE, POSITIVE, NEGATIVE, TEXT_MUTED } from "../../config/colors";
import ReactECharts from "echarts-for-react";

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const splitLine = { lineStyle: { color: withAlpha(TEXT_MUTED, 0.12) } };

function chartOption({
  xData,
  yFormatter,
  tooltipFormatter,
  series,
}: {
  xData: string[];
  yFormatter: string;
  tooltipFormatter?: (v: number) => string;
  series: any[];
}) {
  return {
    grid: { left: 44, right: 8, top: 8, bottom: 18 },
    tooltip: { trigger: "axis" as const, valueFormatter: tooltipFormatter },
    xAxis: { type: "category" as const, data: xData, axisLabel: { fontSize: 9 }, splitLine },
    yAxis: { type: "value" as const, axisLabel: { fontSize: 9, formatter: yFormatter }, splitLine },
    series,
  };
}

const currencyFmt = (v: number) => `₹${v.toFixed(2)}`;
const pctFmt = (v: number) => `${v.toFixed(2)}%`;

function EquityCurveChart({ data }: { data: EquityCurvePoint[] }) {
  const isPositive = data.length > 0 && data[data.length - 1].cumulative_pnl >= 0;
  const lineColor = isPositive ? PERF_POSITIVE : PERF_NEGATIVE;
  return (
    <ReactECharts
      style={{ height: 140 }}
      option={chartOption({
        xData: data.map((d) => d.date.slice(5)),
        yFormatter: "₹{value}",
        tooltipFormatter: currencyFmt,
        series: [
          {
            type: "line",
            data: data.map((d) => d.cumulative_pnl),
            smooth: true,
            lineStyle: { color: lineColor, width: 2 },
            areaStyle: {
              color: {
                type: "linear",
                x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: withAlpha(isPositive ? PERF_POSITIVE : PERF_NEGATIVE, 0.3) },
                  { offset: 1, color: withAlpha(isPositive ? PERF_POSITIVE : PERF_NEGATIVE, 0.02) },
                ],
              },
            },
            showSymbol: false,
          },
        ],
      })}
    />
  );
}

function DailyPnLChart({ data }: { data: DailyPnLPoint[] }) {
  return (
    <ReactECharts
      style={{ height: 140 }}
      option={chartOption({
        xData: data.map((d) => d.date.slice(5)),
        yFormatter: "₹{value}",
        tooltipFormatter: currencyFmt,
        series: [
          {
            type: "bar",
            data: data.map((d) => ({
              value: d.net_pnl,
              itemStyle: {
                color: d.net_pnl >= 0 ? POSITIVE : NEGATIVE,
                borderRadius: [2, 2, 0, 0],
              },
            })),
            barMaxWidth: 20,
          },
          {
            type: "line",
            data: [],
            markLine: {
              silent: true,
              symbol: "none",
              lineStyle: { color: withAlpha(TEXT_MUTED, 0.3), type: "dashed", width: 1 },
              data: [{ yAxis: 0 }],
              label: { show: false },
            },
          },
        ],
      })}
    />
  );
}

function DrawdownChart({ data }: { data: any[] }) {
  return (
    <ReactECharts
      style={{ height: 120 }}
      option={chartOption({
        xData: data.map((d) => d.date.slice(5)),
        yFormatter: "{value}%",
        tooltipFormatter: pctFmt,
        series: [
          {
            type: "line",
            data: data.map((d) => d.drawdown_pct),
            smooth: true,
            lineStyle: { color: NEGATIVE, width: 2 },
            areaStyle: {
              color: {
                type: "linear",
                x: 0, y: 0, x2: 0, y2: 1,
                colorStops: [
                  { offset: 0, color: withAlpha(NEGATIVE, 0.25) },
                  { offset: 1, color: withAlpha(NEGATIVE, 0.02) },
                ],
              },
            },
            showSymbol: false,
          },
        ],
      })}
    />
  );
}

function MonthlyChart({ data }: { data: any[] }) {
  return (
    <ReactECharts
      style={{ height: 120 }}
      option={chartOption({
        xData: data.map((d) => d.month),
        yFormatter: "₹{value}",
        tooltipFormatter: currencyFmt,
        series: [
          {
            type: "bar",
            data: data.map((d) => ({
              value: d.pnl,
              itemStyle: {
                color: d.pnl >= 0 ? POSITIVE : NEGATIVE,
                borderRadius: [2, 2, 0, 0],
              },
            })),
            barMaxWidth: 24,
          },
          {
            type: "line",
            data: [],
            markLine: {
              silent: true,
              symbol: "none",
              lineStyle: { color: withAlpha(TEXT_MUTED, 0.3), type: "dashed", width: 1 },
              data: [{ yAxis: 0 }],
              label: { show: false },
            },
          },
        ],
      })}
    />
  );
}

function SummaryCards({ summary }: { summary: AnalyticsData["summary"] }) {
  const tone = (condition: boolean, yes: string, no: string) => (condition ? yes : no);
  const base = { p: 4 as const, valueSize: "xs" as const, labelSize: "xs" as const };
  return (
    <CompactStatGrid cols={8} spacing={4}>
      <CompactStat label="Total" value={`₹${summary.final_pnl.toFixed(0)}`} tone={tone(summary.final_pnl >= 0, "success.main", "error.main")} {...base} />
      <CompactStat label="Win Rate" value={`${summary.win_rate.toFixed(1)}%`} tone="success.main" {...base} />
      <CompactStat label="PF" value={summary.profit_factor === Infinity ? "∞" : summary.profit_factor.toFixed(2)} tone={tone(summary.profit_factor >= 1, "success.main", "error.main")} {...base} />
      <CompactStat label="Trades" value={summary.total_trades.toString()} {...base} />
      <CompactStat label="Max DD" value={`${summary.max_drawdown_pct.toFixed(1)}%`} tone="error.main" {...base} />
      <CompactStat label="Avg Win" value={`₹${summary.avg_win.toFixed(0)}`} tone="success.main" {...base} />
      <CompactStat label="Avg Loss" value={`₹${summary.avg_loss.toFixed(0)}`} tone="error.main" {...base} />
      <CompactStat label="Costs" value={`₹${summary.total_costs.toFixed(0)}`} tone="text.secondary" {...base} />
    </CompactStatGrid>
  );
}

export function PerformanceAnalytics() {
  useStoreSubscription(subscribe);
  const state = getPaperTradingState();
  const [daysBack, setDaysBack] = useState(30);

  useEffect(() => {
    fetchAnalytics(daysBack);
  }, [daysBack]);

  if (state.analyticsLoading) {
    return (
      <Center h={400}>
        <Loader />
      </Center>
    );
  }

  if (!state.analyticsData) {
    return (
      <Center h={200}>
        <Text c="dimmed">No analytics data available yet.</Text>
      </Center>
    );
  }

  const { summary, daily_pnl, equity_curve, drawdown, monthly_pnl } = state.analyticsData;

  return (
    <Flex direction="column" gap="xs">
      <Flex justify="space-between" align="center">
        <Group gap="xs">
            <Box w={4} h={20} sx={(theme) => ({ borderRadius: 2, backgroundColor: theme.palette.info.main })} />
            <Text fw={700} size="lg">Performance Analytics</Text>
        </Group>
        <SegmentedControl
          size="xs"
          color="info"
          value={daysBack.toString()}
          onChange={(v) => setDaysBack(Number(v))}
          data={[
            { label: "7d", value: "7" },
            { label: "30d", value: "30" },
            { label: "90d", value: "90" },
          ]}
        />
      </Flex>

      <Paper p="xs" radius="md">
        <SummaryCards summary={summary} />
      </Paper>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs">
        <Paper p="xs" radius="md">
          <Group gap="xs" mb={2}>
            <Box w={4} h={14} sx={(theme) => ({ borderRadius: 2, backgroundColor: theme.palette.primary.main })} />
            <Text fw={600} size="xs">Equity Curve</Text>
          </Group>
          <EquityCurveChart data={equity_curve} />
        </Paper>
        <Paper p="xs" radius="md">
          <Group gap="xs" mb={2}>
            <Box w={4} h={14} sx={(theme) => ({ borderRadius: 2, backgroundColor: theme.palette.secondary.main })} />
            <Text fw={600} size="xs">Daily P&L</Text>
          </Group>
          <DailyPnLChart data={daily_pnl} />
        </Paper>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs">
        <Paper p="xs" radius="md">
          <Group gap="xs" mb={2}>
            <Box w={4} h={14} sx={(theme) => ({ borderRadius: 2, backgroundColor: theme.palette.error.main })} />
            <Text fw={600} size="xs">Drawdown</Text>
          </Group>
          <DrawdownChart data={drawdown} />
        </Paper>
        <Paper p="xs" radius="md">
          <Group gap="xs" mb={2}>
            <Box w={4} h={14} sx={(theme) => ({ borderRadius: 2, backgroundColor: theme.palette.info.main })} />
            <Text fw={600} size="xs">Monthly P&L</Text>
          </Group>
          <MonthlyChart data={monthly_pnl} />
        </Paper>
      </SimpleGrid>
    </Flex>
  );
}
