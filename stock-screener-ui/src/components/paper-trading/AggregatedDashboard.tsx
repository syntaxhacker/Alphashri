import { createSignal, createMemo, createEffect, For, Show } from "solid-js";
import { IconRefresh } from "@/components/common/Icons";
import { Badge, Button, Center, Loader, Select, Text } from "@/ui";
import { useStoreSnapshot } from "./storeSnapshot";
import { getPaperTradingState, subscribe } from "../../state/paperTrading";
import { fetchDashboardAnalytics } from "../../api/paperTrading";
import { TradingDatePicker } from "../common/TradingDatePicker";
import { CompactPanel, CompactStat } from "../common/compact";
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
import { TanStackTable, type TableColumnDef } from "./TanStackTable";
import { EChartSolid } from "./EChartSolid";
import { Box, Flex, Group, Stack } from "./primitives";
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

function EquityChart(props: { data: PaperDashboardAnalyticsData }) {
  const option = () => {
    const points = props.data.equity_curve;
    const isPositive = points.length > 0 && points[points.length - 1].cumulative_pnl >= 0;
    const lineColor = isPositive ? PERF_POSITIVE : PERF_NEGATIVE;
    return chartBase(
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
    );
  };
  return <EChartSolid option={option} style={{ height: `${CHART_HERO}px`, minHeight: `${CHART_HERO}px` }} data-testid="equity-curve-chart" />;
}

function DailyPnlChart(props: { data: PaperDashboardAnalyticsData }) {
  const option = () => chartBase(
    props.data.daily_pnl.map((p) => p.date.slice(5)),
    [{
      type: "bar",
      data: props.data.daily_pnl.map((p) => ({
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
  );
  return <EChartSolid option={option} style={{ height: `${CHART_ROW}px`, minHeight: `${CHART_ROW}px` }} data-testid="daily-pnl-chart" />;
}

function DrawdownChart(props: { data: PaperDashboardAnalyticsData }) {
  const option = () => chartBase(
    props.data.drawdown.map((p) => p.date.slice(5)),
    [{
      type: "line",
      data: props.data.drawdown.map((p) => p.drawdown_pct),
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
  );
  return <EChartSolid option={option} style={{ height: `${CHART_ROW}px`, minHeight: `${CHART_ROW}px` }} data-testid="drawdown-chart" />;
}

function BotComparisonChart(props: { data: PaperDashboardAnalyticsData }) {
  const option = () => {
    const bots = props.data.bot_rankings.slice(0, 8);
    return {
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
    };
  };
  return <EChartSolid option={option} style={{ height: `${CHART_ROW}px`, minHeight: `${CHART_ROW}px` }} data-testid="bot-comparison-chart" />;
}

function ExitReasonChart(props: { data: PaperDashboardAnalyticsData }) {
  const option = () => ({
    tooltip: { trigger: "item" as const },
    series: [{
      type: "pie",
      radius: ["42%", "70%"],
      data: props.data.exit_reasons.map((r, i) => ({
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
  });
  return <EChartSolid option={option} style={{ height: `${CHART_ROW}px`, minHeight: `${CHART_ROW}px` }} data-testid="exit-reason-chart" />;
}

function PnlValue(props: { value: number }) {
  return <Text span fw={700} c={getPnLTextColor(props.value)} className="font-mono tabular-nums">{formatSignedPnl(props.value)}</Text>;
}

function SummaryStrip(props: { data: PaperDashboardAnalyticsData }) {
  const s = () => props.data.summary;
  return (
    <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1">
      <CompactStat label="Net P&L" value={<PnlValue value={s().total_net_pnl} />} />
      <CompactStat label="Win Rate" value={pct(s().win_rate)} />
      <CompactStat label="Profit Factor" value={formatPf(s().profit_factor)} />
      <CompactStat label="Max DD" value={<PnlValue value={-s().max_drawdown} />} />
      <CompactStat label="Trades" value={String(s().total_trades)} />
      <CompactStat label="Costs" value={formatCurrencyCompact(s().total_costs)} />
    </div>
  );
}

function BotRankingPanel(props: { bots: PaperDashboardBotRanking[] }) {
  const columns: TableColumnDef<PaperDashboardBotRanking>[] = [
    {
      id: "rank",
      header: "#",
      meta: { align: "center" },
      accessorKey: "bot_id",
      cell: ({ row }) => (
        <Text fw={700} size="sm" c={row.index === 0 ? "warning" : row.index < 3 ? undefined : "dimmed"}>
          {row.index === 0 ? "🥇" : row.index === 1 ? "🥈" : row.index === 2 ? "🥉" : row.index + 1}
        </Text>
      ),
    },
    {
      id: "bot",
      header: "Bot",
      accessorKey: "bot_name",
      meta: { align: "left" },
      cell: ({ row }) => (
        <Stack gap={0} style={{ minWidth: 0 }}>
          <Text size="sm" fw={700} truncate>{row.original.bot_name}</Text>
          <Text size="xs" c="dimmed">{row.original.total_trades} trades · {pct(row.original.win_rate)} win</Text>
        </Stack>
      ),
    },
    { id: "pf", header: "PF", accessorKey: "profit_factor", meta: { align: "right" }, cell: ({ row }) => formatPf(row.original.profit_factor) },
    { id: "pnl", header: "Net P&L", accessorKey: "total_net_pnl", meta: { align: "right" }, cell: ({ row }) => <PnlValue value={row.original.total_net_pnl} /> },
  ];
  return (
    <CompactPanel className="paper-dashboard-bot-ranking" title="Bot Ranking" description={`${props.bots.length} bots with closed trades`}>
      <TanStackTable columns={columns} data={props.bots.slice(0, 8)} dense />
    </CompactPanel>
  );
}

function StrategyTable(props: { rows: PaperDashboardStrategyRanking[] }) {
  const columns: TableColumnDef<PaperDashboardStrategyRanking>[] = [
    { id: "bot", header: "Bot", accessorKey: "bot_name", meta: { align: "left" } },
    { id: "strategy", header: "Strategy", accessorKey: "strategy_name", meta: { align: "left" } },
    { id: "trades", header: "Trades", accessorKey: "total_trades", meta: { align: "right" } },
    { id: "winrate", header: "Win%", accessorKey: "win_rate", meta: { align: "right" }, cell: ({ row }) => pct(row.original.win_rate) },
    { id: "pf", header: "PF", accessorKey: "profit_factor", meta: { align: "right" }, cell: ({ row }) => formatPf(row.original.profit_factor) },
    { id: "hold", header: "Hold", accessorKey: "avg_hold_minutes", meta: { align: "right" }, cell: ({ row }) => formatHold(row.original.avg_hold_minutes) },
    { id: "pnl", header: "Net P&L", accessorKey: "total_net_pnl", meta: { align: "right" }, cell: ({ row }) => <PnlValue value={row.original.total_net_pnl} /> },
  ];
  return <TanStackTable columns={columns} data={props.rows.slice(0, 12)} dense />;
}

function TradesTable(props: { title: string; trades: PaperDashboardTradeItem[] }) {
  const isWinners = () => props.title.toLowerCase().includes("win");
  const accentColor = () => isWinners() ? "success" as const : "error" as const;
  const columns: TableColumnDef<PaperDashboardTradeItem>[] = [
    { id: "symbol", header: "Symbol", accessorKey: "symbol", meta: { align: "left" }, cell: ({ row }) => <Text fw={700} size="sm">{row.original.symbol}</Text> },
    { id: "bot", header: "Bot", accessorKey: "bot_name", meta: { align: "left" } },
    { id: "strategy", header: "Strategy", accessorKey: "strategy_name", meta: { align: "left" } },
    { id: "exit", header: "Exit Reason", accessorKey: "exit_reason", meta: { align: "center" }, cell: ({ row }) => <Badge size="xs" variant="light">{row.original.exit_reason || "UNKNOWN"}</Badge> },
    { id: "pnl", header: "P&L", accessorKey: "net_pnl", meta: { align: "right" }, cell: ({ row }) => <PnlValue value={row.original.net_pnl} /> },
  ];
  return (
    <CompactPanel scrollable style={{ height: 280 }}>
      <Box mb={0.5}><SectionHeader title={props.title} badge={props.trades.length} color={accentColor()} /></Box>
      <TanStackTable columns={columns} data={props.trades} dense />
    </CompactPanel>
  );
}

function SymbolPanel(props: { data: PaperDashboardAnalyticsData }) {
  const columns: TableColumnDef<PaperDashboardSymbolPerformance>[] = [
    { id: "symbol", header: "Symbol", accessorKey: "symbol", meta: { align: "left" }, cell: ({ row }) => <Text fw={700} size="sm">{row.original.symbol}</Text> },
    { id: "trades", header: "Trades", accessorKey: "total_trades", meta: { align: "right" } },
    { id: "winrate", header: "Win%", accessorKey: "win_rate", meta: { align: "right" }, cell: ({ row }) => pct(row.original.win_rate) },
    { id: "pnl", header: "Net P&L", accessorKey: "total_net_pnl", meta: { align: "right" }, cell: ({ row }) => <PnlValue value={row.original.total_net_pnl} /> },
  ];
  return (
    <CompactPanel scrollable style={{ height: 280 }}>
      <Box mb={0.5}><SectionHeader title="Symbol Performance" badge={props.data.symbol_performance.length} color="secondary" /></Box>
      <TanStackTable columns={columns} data={props.data.symbol_performance.slice(0, 12)} dense />
    </CompactPanel>
  );
}

export function AggregatedDashboard() {
  const state = useStoreSnapshot(subscribe, getPaperTradingState);
  const [preset, setPreset] = createSignal("30D");
  const [botId, setBotId] = createSignal("all");
  const [fromDate, setFromDate] = createSignal("");
  const [toDate, setToDate] = createSignal("");

  const load = () => {
    fetchDashboardAnalytics({
      preset: preset(),
      botId: botId(),
      fromDate: fromDate() || null,
      toDate: toDate() || null,
    });
  };

  createEffect(() => {
    load();
  });

  const botOptions = createMemo(() => [
    { value: "all", label: "All Bots" },
    ...state().availableBots.map((bot) => ({ value: bot.id, label: bot.name })),
  ]);

  const data = () => state().dashboardAnalyticsData;

  return (
    <Flex direction="column" gap={8} p={1} data-testid="paper-dashboard" className="paper-dashboard" id="paper-dashboard">
      <Group justify="space-between" align="flex-end" className="paper-dashboard-header" id="paper-dashboard-header">
        <Stack gap={0}>
          <SectionHeader title="Dashboard" badge={data()?.period.trade_count ? `${data()!.period.trade_count} trades` : undefined} color="primary" />
          <Text size="xs" c="dimmed">
            {data()?.period.from_date || "first trade"} to {data()?.period.to_date || "today"}
          </Text>
        </Stack>
        <Button className="paper-dashboard-refresh" size="xs" leftSection={<IconRefresh size={14} />} onClick={load} loading={state().dashboardAnalyticsLoading}>
          Refresh
        </Button>
      </Group>

      <Group gap={8} wrap="wrap" className="paper-dashboard-filters" id="paper-dashboard-filters">
        <Select size="sm" w={180} value={botId()} onChange={(value) => setBotId(value || "all")} data={botOptions()} data-testid="dashboard-bot-filter" />
        <Group gap={8}>
          <For each={PRESETS}>{(item) => (
            <Button
              size="xs"
              variant={preset() === item ? "filled" : "outline"}
              color="primary"
              onClick={() => {
                setPreset(item);
                setFromDate("");
                setToDate("");
              }}
            >
              {item}
            </Button>
          )}</For>
        </Group>
        <TradingDatePicker value={fromDate()} onChange={setFromDate} w={140} placeholder="From" data-testid="dashboard-from-date" />
        <TradingDatePicker value={toDate()} onChange={setToDate} w={140} placeholder="To" data-testid="dashboard-to-date" />
      </Group>

      <Show
        when={!(state().dashboardAnalyticsLoading && !data())}
        fallback={
          <Center h={420} className="paper-dashboard-loading">
            <Stack align="center" gap={8}>
              <Loader />
              <Text size="sm" c="dimmed">Loading dashboard...</Text>
            </Stack>
          </Center>
        }
      >
        <Show
          when={data() && data()!.summary.total_trades > 0}
          fallback={
            <Center h={260} className="paper-dashboard-empty">
              <Text c="dimmed">No closed trades found for this period.</Text>
            </Center>
          }
        >
          {(d) => (
            <>
              <SummaryStrip data={d()} />

              <div class="grid grid-cols-1 lg:grid-cols-2 gap-2 paper-dashboard-row-hero">
                <CompactPanel
                  className="paper-dashboard-card"
                  title={<SectionHeader title="Equity Curve" color="primary" />}
                >
                  <EquityChart data={d()} />
                </CompactPanel>
                <BotRankingPanel bots={d().bot_rankings} />
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 paper-dashboard-row-dist">
                <CompactPanel title={<SectionHeader title="Bot Comparison" color="primary" />}>
                  <BotComparisonChart data={d()} />
                </CompactPanel>
                <CompactPanel title={<SectionHeader title="Daily P&L" color="primary" />}>
                  <DailyPnlChart data={d()} />
                </CompactPanel>
                <CompactPanel title={<SectionHeader title="Drawdown" color="primary" />}>
                  <DrawdownChart data={d()} />
                </CompactPanel>
                <CompactPanel title={<SectionHeader title="Exit Mix" color="primary" />}>
                  <ExitReasonChart data={d()} />
                </CompactPanel>
              </div>

              <CompactPanel
                className="paper-dashboard-strategy"
                title={<SectionHeader title="Strategy Performance" color="primary" />}
              >
                <StrategyTable rows={d().strategy_rankings} />
              </CompactPanel>

              <div class="grid grid-cols-1 lg:grid-cols-2 gap-2 paper-dashboard-winners-losers">
                <TradesTable title="Biggest Winners" trades={d().biggest_winners} />
                <TradesTable title="Biggest Losers" trades={d().biggest_losers} />
              </div>

              <SymbolPanel data={d()} />
            </>
          )}
        </Show>
      </Show>
    </Flex>
  );
}
