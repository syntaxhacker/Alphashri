import { createSignal, createEffect, Show } from "solid-js";
import { Text, Loader, Center, SegmentedControl, Box, Flex, Paper, Group } from "@/ui";
import { useStoreSnapshot } from "./storeSnapshot";
import { getPaperTradingState, subscribe } from "../../state/paperTrading";
import { fetchAnalytics } from "../../api/paperTrading";
import { CompactStat } from "../common/compact";
import { EChartSolid } from "./EChartSolid";
import type { AnalyticsData, DailyPnLPoint, EquityCurvePoint } from "../../types/paperTrading";
import { PERF_POSITIVE, PERF_NEGATIVE, POSITIVE, NEGATIVE, TEXT_MUTED, PRIMARY, INFO } from "../../config/colors";
import { withAlpha } from "../../utils/color";
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

function EquityCurveChart(props: { data: EquityCurvePoint[] }) {
  const option = () => {
    const isPositive = props.data.length > 0 && props.data[props.data.length - 1].cumulative_pnl >= 0;
    const lineColor = isPositive ? PERF_POSITIVE : PERF_NEGATIVE;
    return chartOption({
      xData: props.data.map((d) => d.date.slice(5)),
      yFormatter: "₹{value}",
      tooltipFormatter: currencyFmt,
      series: [
        {
          type: "line",
          data: props.data.map((d) => d.cumulative_pnl),
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
    });
  };
  return <EChartSolid option={option} style={{ height: "140px" }} data-testid="equity-curve-chart" />;
}

function DailyPnLChart(props: { data: DailyPnLPoint[] }) {
  const option = () => chartOption({
    xData: props.data.map((d) => d.date.slice(5)),
    yFormatter: "₹{value}",
    tooltipFormatter: currencyFmt,
    series: [
      {
        type: "bar",
        data: props.data.map((d) => ({
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
  });
  return <EChartSolid option={option} style={{ height: "140px" }} data-testid="daily-pnl-chart" />;
}

function DrawdownChart(props: { data: any[] }) {
  const option = () => chartOption({
    xData: props.data.map((d) => d.date.slice(5)),
    yFormatter: "{value}%",
    tooltipFormatter: pctFmt,
    series: [
      {
        type: "line",
        data: props.data.map((d) => d.drawdown_pct),
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
  });
  return <EChartSolid option={option} style={{ height: "120px" }} data-testid="drawdown-chart" />;
}

function MonthlyChart(props: { data: any[] }) {
  const option = () => chartOption({
    xData: props.data.map((d) => d.month),
    yFormatter: "₹{value}",
    tooltipFormatter: currencyFmt,
    series: [
      {
        type: "bar",
        data: props.data.map((d) => ({
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
  });
  return <EChartSolid option={option} style={{ height: "120px" }} data-testid="monthly-pnl-chart" />;
}

function SummaryCards(props: { summary: AnalyticsData["summary"] }) {
  const s = () => props.summary;
  return (
    <div class="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-1">
      <CompactStat label="Total" value={`₹${s().final_pnl.toFixed(0)}`} tone={s().final_pnl >= 0 ? "success" : "error"} valueSize="xs" labelSize="xs" />
      <CompactStat label="Win Rate" value={`${s().win_rate.toFixed(1)}%`} tone="success" valueSize="xs" labelSize="xs" />
      <CompactStat label="PF" value={s().profit_factor === Infinity ? "∞" : s().profit_factor.toFixed(2)} tone={s().profit_factor >= 1 ? "success" : "error"} valueSize="xs" labelSize="xs" />
      <CompactStat label="Trades" value={s().total_trades.toString()} valueSize="xs" labelSize="xs" />
      <CompactStat label="Max DD" value={`${s().max_drawdown_pct.toFixed(1)}%`} tone="error" valueSize="xs" labelSize="xs" />
      <CompactStat label="Avg Win" value={`₹${s().avg_win.toFixed(0)}`} tone="success" valueSize="xs" labelSize="xs" />
      <CompactStat label="Avg Loss" value={`₹${s().avg_loss.toFixed(0)}`} tone="error" valueSize="xs" labelSize="xs" />
      <CompactStat label="Costs" value={`₹${s().total_costs.toFixed(0)}`} tone="dimmed" valueSize="xs" labelSize="xs" />
    </div>
  );
}

export function PerformanceAnalytics() {
  const state = useStoreSnapshot(subscribe, getPaperTradingState);
  const [daysBack, setDaysBack] = createSignal(30);

  createEffect(() => {
    fetchAnalytics(daysBack());
  });

  return (
    <Show
      when={!state().analyticsLoading}
      fallback={
        <Center h={400}>
          <Loader />
        </Center>
      }
    >
      <Show
        when={state().analyticsData}
        fallback={
          <Center h={200}>
            <Text c="dimmed">No analytics data available yet.</Text>
          </Center>
        }
      >
        {(data) => {
          const summary = () => data().summary;
          const dailyPnl = () => data().daily_pnl;
          const equityCurve = () => data().equity_curve;
          const drawdown = () => data().drawdown;
          const monthlyPnl = () => data().monthly_pnl;
          return (
            <Flex direction="column" gap="xs">
              <Flex justify="space-between" align="center">
                <Group gap="xs">
                  <Box w={4} h={20} style={{ borderRadius: 2, backgroundColor: INFO }} />
                  <Text fw={700} size="lg">Performance Analytics</Text>
                </Group>
                <SegmentedControl
                  size="xs"
                  color="info"
                  value={daysBack().toString()}
                  onChange={(v) => setDaysBack(Number(v))}
                  data={[
                    { label: "7d", value: "7" },
                    { label: "30d", value: "30" },
                    { label: "90d", value: "90" },
                  ]}
                />
              </Flex>

              <Paper p="xs" radius="md">
                <SummaryCards summary={summary()} />
              </Paper>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                <Paper p="xs" radius="md">
                  <Group gap="xs" mb={2}>
                    <Box w={4} h={14} style={{ borderRadius: 2, backgroundColor: PRIMARY }} />
                    <Text fw={600} size="xs">Equity Curve</Text>
                  </Group>
                  <EquityCurveChart data={equityCurve()} />
                </Paper>
                <Paper p="xs" radius="md">
                  <Group gap="xs" mb={2}>
                    <Box w={4} h={14} style={{ borderRadius: 2, backgroundColor: TEXT_MUTED }} />
                    <Text fw={600} size="xs">Daily P&L</Text>
                  </Group>
                  <DailyPnLChart data={dailyPnl()} />
                </Paper>
                <Paper p="xs" radius="md">
                  <Group gap="xs" mb={2}>
                    <Box w={4} h={14} style={{ borderRadius: 2, backgroundColor: NEGATIVE }} />
                    <Text fw={600} size="xs">Drawdown</Text>
                  </Group>
                  <DrawdownChart data={drawdown()} />
                </Paper>
                <Paper p="xs" radius="md">
                  <Group gap="xs" mb={2}>
                    <Box w={4} h={14} style={{ borderRadius: 2, backgroundColor: INFO }} />
                    <Text fw={600} size="xs">Monthly P&L</Text>
                  </Group>
                  <MonthlyChart data={monthlyPnl()} />
                </Paper>
              </div>
            </Flex>
          );
        }}
      </Show>
    </Show>
  );
}
