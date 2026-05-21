import { useEffect, useState } from "react";
import { Flex, Text, Paper, SimpleGrid, Loader, Center, SegmentedControl } from "@mantine/core";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { getPaperTradingState, subscribe } from "../../state/paperTrading";
import { fetchAnalytics } from "../../api/paperTrading";
import { CompactStat, CompactStatGrid } from "../common/compact";
import type { AnalyticsData, DailyPnLPoint, EquityCurvePoint } from "../../types/paperTrading";
import ReactECharts from "echarts-for-react";

const splitLine = { lineStyle: { color: "rgba(128,128,128,0.12)" } };

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
            lineStyle: { color: "#228be6", width: 2 },
            areaStyle: { color: "rgba(34,139,230,0.1)" },
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
              itemStyle: { color: d.net_pnl >= 0 ? "#40c057" : "#fa5252" },
            })),
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
            lineStyle: { color: "#fa5252", width: 2 },
            areaStyle: { color: "rgba(250,82,82,0.1)" },
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
              itemStyle: { color: d.pnl >= 0 ? "#40c057" : "#fa5252" },
            })),
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
      <CompactStat label="Total" value={`₹${summary.final_pnl.toFixed(0)}`} tone={tone(summary.final_pnl >= 0, "var(--mantine-color-teal-4)", "var(--mantine-color-red-4)")} {...base} />
      <CompactStat label="Win Rate" value={`${summary.win_rate.toFixed(1)}%`} tone="var(--mantine-color-teal-4)" {...base} />
      <CompactStat label="PF" value={summary.profit_factor === Infinity ? "∞" : summary.profit_factor.toFixed(2)} tone={tone(summary.profit_factor >= 1, "var(--mantine-color-teal-4)", "var(--mantine-color-red-4)")} {...base} />
      <CompactStat label="Trades" value={summary.total_trades.toString()} {...base} />
      <CompactStat label="Max DD" value={`${summary.max_drawdown_pct.toFixed(1)}%`} tone="var(--mantine-color-red-4)" {...base} />
      <CompactStat label="Avg Win" value={`₹${summary.avg_win.toFixed(0)}`} tone="var(--mantine-color-teal-4)" {...base} />
      <CompactStat label="Avg Loss" value={`₹${summary.avg_loss.toFixed(0)}`} tone="var(--mantine-color-red-4)" {...base} />
      <CompactStat label="Costs" value={`₹${summary.total_costs.toFixed(0)}`} tone="var(--mantine-color-gray-5)" {...base} />
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
        <Text fw={700} size="lg">Performance Analytics</Text>
        <SegmentedControl
          size="xs"
          value={daysBack.toString()}
          onChange={(v) => setDaysBack(Number(v))}
          data={[
            { label: "7d", value: "7" },
            { label: "30d", value: "30" },
            { label: "90d", value: "90" },
          ]}
        />
      </Flex>

      <Paper withBorder p="xs" radius="md">
        <SummaryCards summary={summary} />
      </Paper>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs">
        <Paper withBorder p="xs" radius="md">
          <Text fw={600} size="xs" mb={2}>Equity Curve</Text>
          <EquityCurveChart data={equity_curve} />
        </Paper>
        <Paper withBorder p="xs" radius="md">
          <Text fw={600} size="xs" mb={2}>Daily P&L</Text>
          <DailyPnLChart data={daily_pnl} />
        </Paper>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xs">
        <Paper withBorder p="xs" radius="md">
          <Text fw={600} size="xs" mb={2}>Drawdown</Text>
          <DrawdownChart data={drawdown} />
        </Paper>
        <Paper withBorder p="xs" radius="md">
          <Text fw={600} size="xs" mb={2}>Monthly P&L</Text>
          <MonthlyChart data={monthly_pnl} />
        </Paper>
      </SimpleGrid>
    </Flex>
  );
}
