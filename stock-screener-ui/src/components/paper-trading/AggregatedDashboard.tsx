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
import { withAlpha } from "../../utils/color";
import { TanStackTable } from "../common/TanStackTable";
import type { ColumnDef } from "@tanstack/react-table";
import type {
  PaperDashboardAnalyticsData,
  PaperDashboardBotRanking,
  PaperDashboardStrategyRanking,
  PaperDashboardSymbolPerformance,
  PaperDashboardTradeItem,
} from "../../types/paperTrading";

const PRESETS = ["7D", "30D", "90D", "YTD", "All"];
const splitLine = { lineStyle: { color: withAlpha(TEXT_MUTED, 0.14) } };

// Card + chart rhythm: hero 240, distribution row 200, tables scroll at 280.
const CHART_HERO = 240;
const CHART_ROW = 200;

// Exit reasons get semantic colors (TP green / SL red); anything else neutrals.
const EXIT_NEUTRALS = [CREAM, TEXT_MUTED, BROWN, BROWN_DARK, SECTOR_GREEN, SECTOR_RED];
function exitColor(reason: string, index: number) {
  const r = reason.toLowerCase();
  if (/tp|profit|target|take/.test(r)) return POSITIVE;
  if (/sl|stop|loss/.test(r)) return NEGATIVE;
  if (/trail/.test(r)) return SECTOR_GREEN;
  if (/breakeven|\bbe\b|time|expir/.test(r)) return TEXT_MUTED;
  return EXIT_NEUTRALS[index % EXIT_NEUTRALS.length];
}

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
      style={{ height: CHART_HERO, minHeight: CHART_HERO }}
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
      style={{ height: CHART_ROW, minHeight: CHART_ROW }}
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
      style={{ height: CHART_ROW, minHeight: CHART_ROW }}
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
      style={{ height: CHART_ROW, minHeight: CHART_ROW }}
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
      style={{ height: CHART_ROW, minHeight: CHART_ROW }}
      option={{
        tooltip: { trigger: "item" as const },
        series: [{
          type: "pie",
          radius: ["42%", "70%"],
          data: data.exit_reasons.map((r, i) => ({
            name: r.reason,
            value: r.count,
            itemStyle: { color: exitColor(r.reason, i), borderColor: withAlpha(BLACK, 0.1), borderWidth: 1 },
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
  const columns = useMemo<ColumnDef<PaperDashboardBotRanking>[]>(() => [
    {
      header: "#",
      accessorKey: "bot_id",
      cell: ({ row }) => (
        <Text fw={700} size="sm" c={row.index === 0 ? "gold" : row.index < 3 ? undefined : "dimmed"}>
          {row.index === 0 ? "🥇" : row.index === 1 ? "🥈" : row.index === 2 ? "🥉" : row.index + 1}
        </Text>
      ),
    },
    {
      header: "Bot",
      accessorKey: "bot_name",
      cell: ({ getValue, row }) => (
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text size="sm" fw={700} truncate>{getValue<string>()}</Text>
          <Text size="xs" c="dimmed">{row.original.total_trades} trades · {pct(row.original.win_rate)} win</Text>
        </Stack>
      ),
    },
    { header: "PF", accessorKey: "profit_factor", cell: ({ getValue }) => formatPf(getValue<number | null>()) },
    { header: "Net P&L", accessorKey: "total_net_pnl", cell: ({ getValue }) => <PnlValue value={getValue<number>()} /> },
  ], []);
  return (
    <CompactPanel className="paper-dashboard-bot-ranking" title="Bot Ranking" description={`${bots.length} bots with closed trades`}>
      <TanStackTable columns={columns} data={bots.slice(0, 8)} />
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
  const accentColor = isWinners ? "success" : "error";
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
    <Flex direction="column" gap={16} p={2} data-testid="paper-dashboard" className="paper-dashboard" id="paper-dashboard">
      <Group justify="space-between" align="flex-end" className="paper-dashboard-header" id="paper-dashboard-header">
        <Stack gap={0}>
          <SectionHeader title="Dashboard" badge={data?.period.trade_count ? `${data.period.trade_count} trades` : undefined} color="primary" />
          <Text size="xs" c="dimmed">
            {data?.period.from_date || "first trade"} to {data?.period.to_date || "today"}
          </Text>
        </Stack>
        <Button className="paper-dashboard-refresh" size="xs" leftSection={<IconRefresh size={14} />} onClick={load} loading={state.dashboardAnalyticsLoading}>
          Refresh
        </Button>
      </Group>

      <Group gap={16} wrap="wrap" className="paper-dashboard-filters" id="paper-dashboard-filters">
        <Select size="sm" w={180} value={botId} onChange={(value) => setBotId(value || "all")} data={botOptions} data-testid="dashboard-bot-filter" />
        <Group gap={8}>
          {PRESETS.map((item) => (
            <Button
              key={item}
              size="xs"
              variant={preset === item ? "filled" : "outline"}
              color="primary"
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
        <Center h={420} className="paper-dashboard-loading">
          <Stack align="center" gap={8}>
            <Loader />
            <Text size="sm" c="dimmed">Loading dashboard...</Text>
          </Stack>
        </Center>
      ) : !data || data.summary.total_trades === 0 ? (
        <Center h={260} className="paper-dashboard-empty">
          <Text c="dimmed">No closed trades found for this period.</Text>
        </Center>
      ) : (
        <>
          <SummaryStrip data={data} />

          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing={16} className="paper-dashboard-row-hero">
            <CompactPanel
              className="paper-dashboard-card"
              title={<SectionHeader title="Equity Curve" color="primary" />}
            >
              <EquityChart data={data} />
            </CompactPanel>
            <BotRankingPanel bots={data.bot_rankings} />
          </SimpleGrid>

          <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing={16} className="paper-dashboard-row-dist">
            <CompactPanel title={<SectionHeader title="Bot Comparison" color="primary" />}>
              <BotComparisonChart data={data} />
            </CompactPanel>
            <CompactPanel title={<SectionHeader title="Daily P&L" color="primary" />}>
              <DailyPnlChart data={data} />
            </CompactPanel>
            <CompactPanel title={<SectionHeader title="Drawdown" color="primary" />}>
              <DrawdownChart data={data} />
            </CompactPanel>
            <CompactPanel title={<SectionHeader title="Exit Mix" color="primary" />}>
              <ExitReasonChart data={data} />
            </CompactPanel>
          </SimpleGrid>

          <CompactPanel
            className="paper-dashboard-strategy"
            title={<SectionHeader title="Strategy Performance" color="primary" />}
          >
            <StrategyTable rows={data.strategy_rankings} />
          </CompactPanel>

          <SimpleGrid cols={{ base: 1, lg: 2 }} spacing={16} className="paper-dashboard-winners-losers">
            <TradesTable title="Biggest Winners" trades={data.biggest_winners} />
            <TradesTable title="Biggest Losers" trades={data.biggest_losers} />
          </SimpleGrid>

          <SymbolPanel data={data} />
        </>
      )}
    </Flex>
  );
}
