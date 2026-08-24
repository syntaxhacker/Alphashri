import { useCallback, useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { IconRefresh } from "@tabler/icons-react";
import {
  Badge,
  Box,
  Button,
  Center,
  Flex,
  Group,
  Loader,
  Paper,
  Select,
  SimpleGrid,
  Stack,
  Text,
} from "@/ui";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { getPaperTradingState, subscribe } from "../../state/paperTrading";
import { fetchDashboardAnalytics } from "../../api/paperTrading";
import { TradingDatePicker } from "../common/TradingDatePicker";
import { CompactPanel, CompactStat, CompactStatGrid } from "../common/compact";
import { SectionHeader } from "../common/SectionHeader";
import { formatCurrencyCompact, formatSignedPnl, getPnLTextColor } from "../../utils/ui-helpers";
import {
  PERF_POSITIVE,
  PERF_NEGATIVE,
  POSITIVE,
  NEGATIVE,
  CREAM,
  BLACK,
  TEXT_MUTED,
  BROWN,
  BROWN_DARK,
  SECTOR_GREEN,
  SECTOR_RED,
} from "../../config/colors";
import { TanStackTable } from "../common/TanStackTable";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  PaperDashboardAnalyticsData,
  PaperDashboardBotRanking,
  PaperDashboardStrategyRanking,
  PaperDashboardSymbolPerformance,
  PaperDashboardTradeItem,
} from "../../types/paperTrading";

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const PRESETS = ["7D", "30D", "90D", "YTD", "All"];
const PRESET_COLORS = ["primary", "info", "info", "secondary", "secondary"] as const;
const splitLine = { lineStyle: { color: withAlpha(TEXT_MUTED, 0.14) } };

const EXIT_PIE_COLORS = [
  POSITIVE, NEGATIVE, SECTOR_GREEN, SECTOR_RED,
  CREAM, TEXT_MUTED, BROWN, BROWN_DARK,
];

function formatPf(value: number | null) {
  if (value === null) return "∞";
  return value.toFixed(2);
}

function formatHold(minutes: number | null | undefined) {
  if (!minutes) return "-";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  return `${(minutes / 60).toFixed(1)}h`;
}

function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

function chartBase(xData: string[], series: any[], yFormatter = "₹{value}") {
  return {
    grid: { left: 48, right: 12, top: 16, bottom: 24 },
    tooltip: { trigger: "axis" as const },
    xAxis: { type: "category" as const, data: xData, axisLabel: { fontSize: 10 }, splitLine },
    yAxis: { type: "value" as const, axisLabel: { fontSize: 10, formatter: yFormatter }, splitLine },
    series,
  };
}

function EquityChart({ data }: { data: PaperDashboardAnalyticsData }) {
  const points = data.equity_curve;
  const isPositive = points.length > 0 && points[points.length - 1].cumulative_pnl >= 0;
  const lineColor = isPositive ? PERF_POSITIVE : PERF_NEGATIVE;
  return (
    <ReactECharts
      style={{ height: 230, minHeight: 230 }}
      option={chartBase(
        points.map((p) => p.date.slice(5)),
        [{
          type: "line",
          data: points.map((p) => p.cumulative_pnl),
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: lineColor },
          areaStyle: {
            color: {
              type: "linear",
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: withAlpha(isPositive ? PERF_POSITIVE : PERF_NEGATIVE, 0.28) },
                { offset: 1, color: withAlpha(isPositive ? PERF_POSITIVE : PERF_NEGATIVE, 0.02) },
              ],
            },
          },
        }],
      )}
    />
  );
}

function DailyPnlChart({ data }: { data: PaperDashboardAnalyticsData }) {
  return (
    <ReactECharts
      style={{ height: 230, minHeight: 230 }}
      option={chartBase(
        data.daily_pnl.map((p) => p.date.slice(5)),
        [{
          type: "bar",
          data: data.daily_pnl.map((p) => ({
            value: p.net_pnl,
            itemStyle: {
              color: p.net_pnl >= 0 ? POSITIVE : NEGATIVE,
              borderRadius: [3, 3, 0, 0],
            },
          })),
          barMaxWidth: 22,
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
        }],
      )}
    />
  );
}

function DrawdownChart({ data }: { data: PaperDashboardAnalyticsData }) {
  return (
    <ReactECharts
      style={{ height: 190, minHeight: 190 }}
      option={chartBase(
        data.drawdown.map((p) => p.date.slice(5)),
        [{
          type: "line",
          data: data.drawdown.map((p) => p.drawdown_pct),
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: NEGATIVE },
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
        }],
        "{value}%",
      )}
    />
  );
}

function BotComparisonChart({ data }: { data: PaperDashboardAnalyticsData }) {
  const bots = data.bot_rankings.slice(0, 8);
  return (
    <ReactECharts
      style={{ height: 190, minHeight: 190 }}
      option={{
        grid: { left: 88, right: 12, top: 12, bottom: 20 },
        tooltip: { trigger: "axis" as const },
        xAxis: { type: "value" as const, axisLabel: { fontSize: 10, formatter: "₹{value}" }, splitLine },
        yAxis: { type: "category" as const, data: bots.map((b) => b.bot_name), axisLabel: { fontSize: 10 }, splitLine },
        series: [{
          type: "bar",
          data: bots.map((b) => ({
            value: b.total_net_pnl,
            itemStyle: {
              color: b.total_net_pnl >= 0 ? POSITIVE : NEGATIVE,
              borderRadius: [0, 3, 3, 0],
            },
          })),
          barMaxWidth: 18,
        }],
      }}
    />
  );
}

function ExitReasonChart({ data }: { data: PaperDashboardAnalyticsData }) {
  return (
    <ReactECharts
      style={{ height: 190, minHeight: 190 }}
      option={{
        tooltip: { trigger: "item" as const },
        series: [{
          type: "pie",
          radius: ["42%", "70%"],
          data: data.exit_reasons.map((r, i) => ({
            name: r.reason,
            value: r.count,
            itemStyle: { color: EXIT_PIE_COLORS[i % EXIT_PIE_COLORS.length], borderColor: withAlpha(BLACK, 0.1), borderWidth: 1 },
          })),
          label: { fontSize: 10, formatter: "{b} {d}%" },
          emphasis: {
            scale: true,
            itemStyle: {
              shadowBlur: 12,
              shadowOffsetX: 0,
              shadowColor: withAlpha(BLACK, 0.4),
            },
          },
        }],
      }}
    />
  );
}

function PnlValue({ value }: { value: number }) {
  return <Text span fw={700} c={getPnLTextColor(value)}>{formatSignedPnl(value)}</Text>;
}

function SummaryStrip({ data }: { data: PaperDashboardAnalyticsData }) {
  const s = data.summary;
  return (
    <CompactStatGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="xs">
      <CompactStat label="Net P&L" value={<PnlValue value={s.total_net_pnl} />} />
      <CompactStat label="Win Rate" value={pct(s.win_rate)} />
      <CompactStat label="Profit Factor" value={formatPf(s.profit_factor)} />
      <CompactStat label="Max DD" value={<PnlValue value={-s.max_drawdown} />} />
      <CompactStat label="Trades" value={String(s.total_trades)} />
      <CompactStat label="Costs" value={formatCurrencyCompact(s.total_costs)} />
    </CompactStatGrid>
  );
}

function BotRankingPanel({ bots }: { bots: PaperDashboardBotRanking[] }) {
  return (
    <CompactPanel title="Bot Ranking" description={`${bots.length} bots with closed trades`} h="100%">
      <Stack gap={6}>
        {bots.slice(0, 8).map((bot, index) => (
          <Flex key={bot.bot_id} align="center" gap="xs">
            <Text w={22} size="xs" c="dimmed">{index + 1}</Text>
            <Stack gap={0} style={{ minWidth: 0, flex: 1 }}>
              <Text size="sm" fw={700} truncate>{bot.bot_name}</Text>
              <Text size="xs" c="dimmed">{bot.total_trades} trades · {pct(bot.win_rate)} win · PF {formatPf(bot.profit_factor)}</Text>
            </Stack>
            <PnlValue value={bot.total_net_pnl} />
          </Flex>
        ))}
      </Stack>
    </CompactPanel>
  );
}

function StrategyTable({ rows }: { rows: PaperDashboardStrategyRanking[] }) {
  const columns = useMemo<ColumnDef<PaperDashboardStrategyRanking>[]>(() => [
    { header: "Bot", accessorKey: "bot_name" },
    { header: "Strategy", accessorKey: "strategy_name" },
    { header: "Trades", accessorKey: "total_trades" },
    { header: "Win%", accessorKey: "win_rate", cell: ({ getValue }) => pct(getValue<number>()) },
    { header: "PF", accessorKey: "profit_factor", cell: ({ getValue }) => formatPf(getValue<number | null>()) },
    { header: "Hold", accessorKey: "avg_hold_minutes", cell: ({ getValue }) => formatHold(getValue<number>()) },
    { header: "Net P&L", accessorKey: "total_net_pnl", cell: ({ getValue }) => <PnlValue value={getValue<number>()} /> },
  ], []);
  return <TanStackTable columns={columns} data={rows.slice(0, 12)} />;
}

function TradesTable({ title, trades }: { title: string; trades: PaperDashboardTradeItem[] }) {
  const isWinners = title.toLowerCase().includes("win");
  const accentColor = isWinners ? "info" : "error";
  const columns = useMemo<ColumnDef<PaperDashboardTradeItem>[]>(() => [
    { header: "Symbol", accessorKey: "symbol", cell: ({ getValue }) => <Text fw={700} size="sm">{getValue<string>()}</Text> },
    { header: "Bot", accessorKey: "bot_name" },
    { header: "Strategy", accessorKey: "strategy_name" },
    { header: "Exit Reason", accessorKey: "exit_reason", cell: ({ getValue }) => <Badge size="xs" variant="light">{getValue<string>() || "UNKNOWN"}</Badge> },
    { header: "P&L", accessorKey: "net_pnl", cell: ({ getValue }) => <PnlValue value={getValue<number>()} /> },
  ], []);
  return (
    <CompactPanel scrollable style={{ height: 280 }}>
      <Box mb="xs"><SectionHeader title={title} badge={trades.length} color={accentColor} /></Box>
      <TanStackTable columns={columns} data={trades} />
    </CompactPanel>
  );
}

function SymbolPanel({ data }: { data: PaperDashboardAnalyticsData }) {
  const columns = useMemo<ColumnDef<PaperDashboardSymbolPerformance>[]>(() => [
    { header: "Symbol", accessorKey: "symbol", cell: ({ getValue }) => <Text fw={700} size="sm">{getValue<string>()}</Text> },
    { header: "Trades", accessorKey: "total_trades" },
    { header: "Win%", accessorKey: "win_rate", cell: ({ getValue }) => pct(getValue<number>()) },
    { header: "Net P&L", accessorKey: "total_net_pnl", cell: ({ getValue }) => <PnlValue value={getValue<number>()} /> },
  ], []);
  return (
    <CompactPanel scrollable style={{ height: 280 }}>
      <Box mb="xs"><SectionHeader title="Symbol Performance" badge={data.symbol_performance.length} color="secondary" /></Box>
      <TanStackTable columns={columns} data={data.symbol_performance.slice(0, 12)} />
    </CompactPanel>
  );
}

export function AggregatedDashboard() {
  useStoreSubscription(subscribe);
  const state = getPaperTradingState();
  const [preset, setPreset] = useState("30D");
  const [botId, setBotId] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const load = useCallback(() => {
    fetchDashboardAnalytics({
      preset,
      botId,
      fromDate: fromDate || null,
      toDate: toDate || null,
    });
  }, [botId, fromDate, preset, toDate]);

  useEffect(() => {
    load();
  }, [load]);

  const botOptions = useMemo(
    () => [
      { value: "all", label: "All Bots" },
      ...state.availableBots.map((bot) => ({ value: bot.id, label: bot.name })),
    ],
    [state.availableBots],
  );

  const data = state.dashboardAnalyticsData;

  return (
    <Flex direction="column" gap="xs" p="xs" data-testid="paper-dashboard">
      <Stack gap={2}>
        <SectionHeader title="Dashboard" badge={data?.period.trade_count ? `${data.period.trade_count} trades` : undefined} color="primary" />
        <Text size="xs" c="dimmed">
          {data?.period.from_date || "first trade"} to {data?.period.to_date || "today"}
        </Text>
      </Stack>
      <Button size="xs" leftSection={<IconRefresh size={14} />} onClick={load} loading={state.dashboardAnalyticsLoading}>
        Refresh
      </Button>

      <Group gap="xs" wrap="wrap">
        <Select size="sm" w={180} value={botId} onChange={(value) => setBotId(value || "all")} data={botOptions} data-testid="dashboard-bot-filter" />
        <Group gap={4}>
          {PRESETS.map((item, idx) => (
            <Button
              key={item}
              size="xs"
              variant={preset === item ? "filled" : "light"}
              color={PRESET_COLORS[idx]}
              onClick={() => {
                setPreset(item);
                setFromDate("");
                setToDate("");
              }}
            >
              {item}
            </Button>
          ))}
        </Group>
        <TradingDatePicker value={fromDate} onChange={setFromDate} w={140} placeholder="From" data-testid="dashboard-from-date" />
        <TradingDatePicker value={toDate} onChange={setToDate} w={140} placeholder="To" data-testid="dashboard-to-date" />
      </Group>

      {state.dashboardAnalyticsLoading && !data ? (
        <Center h={420}>
          <Stack align="center" gap="sm">
            <Loader />
            <Text size="sm" c="dimmed">Loading dashboard...</Text>
          </Stack>
        </Center>
      ) : !data || data.summary.total_trades === 0 ? (
        <Center h={260}>
          <Text c="dimmed">No closed trades found for this period.</Text>
        </Center>
      ) : (
        <>
          <SummaryStrip data={data} />

          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xs">
            <BotRankingPanel bots={data.bot_rankings} />
            <Paper p="xs" radius="xs">
              <Box mb="xs"><SectionHeader title="Equity Curve" color="primary" /></Box>
              <EquityChart data={data} />
            </Paper>
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="xs">
            <Paper p="xs" radius="xs">
              <Box mb="xs"><SectionHeader title="Bot Comparison" color="info" /></Box>
              <BotComparisonChart data={data} />
            </Paper>
            <Paper p="xs" radius="xs">
              <Box mb="xs"><SectionHeader title="Daily P&L" color="secondary" /></Box>
              <DailyPnlChart data={data} />
            </Paper>
            <Paper p="xs" radius="xs">
              <Box mb="xs"><SectionHeader title="Drawdown" color="error" /></Box>
              <DrawdownChart data={data} />
            </Paper>
          </SimpleGrid>

          <Paper p="xs" radius="xs">
            <Box mb="xs"><SectionHeader title="Strategy Performance" color="info" /></Box>
            <StrategyTable rows={data.strategy_rankings} />
          </Paper>

          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xs">
            <TradesTable title="Biggest Winners" trades={data.biggest_winners} />
            <TradesTable title="Biggest Losers" trades={data.biggest_losers} />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="xs">
            <SymbolPanel data={data} />
            <Paper p="xs" radius="xs">
              <Box mb="xs"><SectionHeader title="Exit Reason Breakdown" color="warning" /></Box>
              <ExitReasonChart data={data} />
            </Paper>
          </SimpleGrid>
        </>
      )}
    </Flex>
  );
}
