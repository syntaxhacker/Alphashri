import { memo, useState, useMemo, useCallback, useEffect } from "react";
import dayjs from "dayjs";
import {
  Select,
  Text,
  Group,
  Loader,
  SegmentedControl,
  Flex,
  ScrollArea,
  Anchor,
  Badge,
  ActionIcon,
  Grid,
  Stack,
  Textarea,
  Button,
} from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
import type { PaperTrade } from "../../types/paperTrading";
import {
  formatNumber,
  formatSignedPnl,
  formatTimeOnly,
  formatDateHeader,
  formatDuration,
  getPnLTextColor,
  getStrategyTypeFromName,
} from "../../utils/ui-helpers";
import { SideBadge, ExitReasonBadge, ClickableSymbol } from "../common";
import { TanStackTable } from "../common/TanStackTable";
import {
  getPaperTradingState,
  subscribe as subscribeToPaperTrading,
  setSelectedSymbol,
  setFilterStrategy,
  setFilterBot,
  setFilterFromDate,
  setFilterToDate,
  setSelectedTradeId,
  updateTradeNotesAction,
} from "../../state/paperTrading";
import { fetchPaperChart, refreshHistoryData } from "../../api/paperTrading";
import {
  getUniqueStrategies,
  getUniqueBots,
  filterByRange,
  getPeriodFromDateRange,
} from "../../utils/tradeHistoryUtils";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";

function useQuickFilter() {
  const handleQuickFilter = (period: string) => {
    let fromDate: string | null = null;
    let toDate: string | null = null;
    switch (period) {
      case "today":
        fromDate = dayjs().format("YYYY-MM-DD");
        toDate = fromDate;
        break;
      case "week":
        fromDate = dayjs().subtract(7, "day").format("YYYY-MM-DD");
        break;
      case "month":
        fromDate = dayjs().subtract(1, "month").format("YYYY-MM-DD");
        break;
      case "year":
        fromDate = dayjs().subtract(1, "year").format("YYYY-MM-DD");
        break;
      default:
        break;
    }
    setFilterFromDate(fromDate);
    setFilterToDate(toDate);
    const state = getPaperTradingState();
    const botId = state.filterBot || null;
    refreshHistoryData(botId, fromDate, toDate);
  };

  const getCurrentPeriod = () => {
    const state = getPaperTradingState();
    return getPeriodFromDateRange(state.filterFromDate, state.filterToDate);
  };

  return { handleQuickFilter, getCurrentPeriod };
}

function HistoryFilters({
  bots,
  strategies,
  state,
}: {
  bots: Array<{ id: string; name: string }>;
  strategies: { id: number; name: string }[];
  state: ReturnType<typeof getPaperTradingState>;
}) {
  const { handleQuickFilter, getCurrentPeriod } = useQuickFilter();

  return (
    <>
      <Flex flex="none" py={1} className="paper-history-filters" id="history-filters">
        <Group gap="xs" justify="space-between" w="100%">
          <Group gap="xs">
            {bots.length > 1 && (
              <Select
                placeholder="All Bots"
                data={[
                  { value: "", label: "All Bots" },
                  ...bots.map((b) => ({ value: b.id, label: b.name })),
                ]}
                value={state.filterBot || ""}
                onChange={(v) => setFilterBot(v)}
                style={{ width: 160 }}
                size="xs"
                data-testid="bot-filter-select"
              />
            )}
            {strategies.length > 1 && (
              <Select
                placeholder="All Strategies"
                data={[
                  { value: "", label: "All Strategies" },
                  ...strategies.map((s) => ({ value: String(s.id), label: s.name })),
                ]}
                value={state.filterStrategy != null ? String(state.filterStrategy) : ""}
                onChange={(v) => setFilterStrategy(v ? Number(v) : null)}
                style={{ width: 160 }}
                size="xs"
                data-testid="strategy-filter-select"
              />
            )}
          </Group>
          <SegmentedControl
            value={getCurrentPeriod()}
            onChange={handleQuickFilter}
            data={[
              { value: "today", label: "Today" },
              { value: "week", label: "Week" },
              { value: "month", label: "Month" },
              { value: "year", label: "Year" },
              { value: "all", label: "All" },
            ]}
            size="xs"
            data-testid="quick-filter"
          />
        </Group>
      </Flex>

      <Flex
        flex="none"
        className="paper-history-list-wrapper"
        data-testid="trades-header"
        id="trades-header"
      >
        <Group justify="space-between" px={4} py={2}>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">
            Trade History
          </Text>
        </Group>
      </Flex>
    </>
  );
}

/* ─────────────────────────────────────────────────────────────
 * Day summary header row (rendered inside the single table as a
 * full-width group row) + trade detail sub-components.
 * ───────────────────────────────────────────────────────────── */

const DaySummary = memo(function DaySummary({
  date,
  trades,
  expanded,
}: {
  date: string;
  trades: PaperTrade[];
  expanded: boolean;
}) {
  const dayPnl = trades.reduce((sum, t) => sum + t.net_pnl, 0);
  const wins = trades.filter((t) => t.net_pnl > 0).length;
  const losses = trades.filter((t) => t.net_pnl < 0).length;
  const pnlColor = getPnLTextColor(dayPnl);

  return (
    <Group justify="space-between" px={4} py={1} wrap="nowrap" data-testid={`day-header-${date}`}>
      <Group gap={6} wrap="nowrap">
        <Text size="xs" c="dimmed">
          {expanded ? "▾" : "▸"}
        </Text>
        <Text size="xs" fw={600} c="dimmed" tt="uppercase">
          {formatDateHeader(date)}
        </Text>
      </Group>
      <Group gap="xs" wrap="nowrap">
        <Text size="xs" c={pnlColor} fw={600}>
          {formatSignedPnl(dayPnl)}
        </Text>
        <Badge color={wins > 0 ? "green" : "gray"} variant="light" size="xs">
          ▲{wins}
        </Badge>
        <Badge color={losses > 0 ? "red" : "gray"} variant="light" size="xs">
          ▼{losses}
        </Badge>
      </Group>
    </Group>
  );
});

const TradeStats = memo(function TradeStats({ trade }: { trade: PaperTrade }) {
  const grossPnl = trade.pnl;
  const grossColor = getPnLTextColor(grossPnl);
  const netPnl = trade.net_pnl;
  const netColor = getPnLTextColor(netPnl);

  const entryContext = [
    { label: "Trade ID", value: `#${trade.trade_id}` },
    { label: "Entry Time", value: formatTimeOnly(trade.entry_time) },
    { label: "Peak", value: `₹${trade.peak_price?.toFixed(2) ?? "-"}` },
    { label: "Low", value: `₹${trade.low_price?.toFixed(2) ?? "-"}` },
    { label: "Hold", value: trade.hold_duration_minutes != null ? formatDuration(trade.hold_duration_minutes) : "-" },
  ];

  const exitContext = [
    { label: "Exit Time", value: formatTimeOnly(trade.exit_time) },
    { label: "Exit Price", value: trade.exit_price != null ? `₹${trade.exit_price.toFixed(2)}` : "-" },
    { label: "Costs", value: `₹${formatNumber(trade.costs)}` },
    { label: "Gross P&L", value: formatSignedPnl(grossPnl), color: grossColor },
    { label: "Net P&L", value: formatSignedPnl(netPnl), color: netColor },
  ];

  return (
    <Grid gutter={2}>
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Stack gap={2}>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">Entry</Text>
          {entryContext.map((item) => (
            <Group key={item.label} gap="xs" justify="space-between">
              <Text size="xs" c="dimmed">{item.label}</Text>
              <Text size="sm" fw={500} c={item.color}>{item.value}</Text>
            </Group>
          ))}
        </Stack>
      </Grid.Col>
      <Grid.Col span={{ base: 12, md: 6 }}>
        <Stack gap={2}>
          <Text size="xs" fw={600} c="dimmed" tt="uppercase">Exit</Text>
          {exitContext.map((item) => (
            <Group key={item.label} gap="xs" justify="space-between">
              <Text size="xs" c="dimmed">{item.label}</Text>
              <Text size="sm" fw={500} c={item.color}>{item.value}</Text>
            </Group>
          ))}
          <Group gap="xs" justify="space-between">
            <Text size="xs" c="dimmed">Exit Reason</Text>
            <ExitReasonBadge reason={trade.exit_reason} />
          </Group>
        </Stack>
      </Grid.Col>
    </Grid>
  );
});

const TradeNotesEditor = memo(function TradeNotesEditor({ trade }: { trade: PaperTrade }) {
  const reason = trade.reason || "";
  const [notes, setNotes] = useState(trade.notes || "");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await updateTradeNotesAction(trade.trade_id, notes, reason);
    setSaving(false);
  };

  return (
    <Stack gap={2}>
      <Group gap="xs" align="flex-start" grow>
        <Stack gap={1} style={{ flex: 1 }}>
          <Text size="xs" c="dimmed">Reason</Text>
          <Text size="xs" style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }} data-testid={`trade-reason-${trade.trade_id}`}>
            {trade.reason || "-"}
          </Text>
        </Stack>
      </Group>
      <Group gap="sm" align="flex-start" grow>
        <Stack gap={1} style={{ flex: 1 }}>
          <Text size="xs" c="dimmed">Notes</Text>
          <Textarea
            size="xs"
            minRows={2}
            maxRows={4}
            value={notes}
            onChange={(val) => setNotes(val)}
            placeholder="Any additional notes..."
            styles={{ input: { background: "var(--mantine-color-body)" } }}
            data-testid={`trade-notes-${trade.trade_id}`}
          />
        </Stack>
      </Group>
      <Group justify="flex-end">
        <Button size="xs" variant="light" loading={saving} onClick={handleSave} data-testid={`trade-notes-save-${trade.trade_id}`}>
          Save
        </Button>
      </Group>
    </Stack>
  );
});

const TradeDetail = memo(function TradeDetail({ trade }: { trade: PaperTrade }) {
  return (
    <Stack gap="xs">
      <TradeStats trade={trade} />
      <TradeNotesEditor trade={trade} />
    </Stack>
  );
});

/* ─────────────────────────────────────────────────────────────
 * Single trade history table: one <table> grouped by exit date.
 * Day summary rows (full-width) collapse/expand each day; trade
 * rows expand to show the TradeDetail sub-component.
 * ───────────────────────────────────────────────────────────── */

function tradeDate(trade: PaperTrade): string {
  return (trade.exit_time || "").split("T")[0];
}

function TradeHistoryTable({
  trades,
  selectedTradeId,
  onSelectSymbol,
}: {
  trades: PaperTrade[];
  selectedTradeId: string | null;
  onSelectSymbol: (
    symbol: string,
    exitTime?: string,
    tradeId?: string,
    strategyType?: string,
    strategyId?: number,
    entryTime?: string,
  ) => void;
}) {
  // Newest-first so day groups render newest date on top.
  const sortedTrades = useMemo(
    () => [...trades].sort((a, b) => (b.exit_time || "").localeCompare(a.exit_time || "")),
    [trades],
  );

  const dates = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of sortedTrades) {
      const d = tradeDate(t);
      if (d && !seen.has(d)) {
        seen.add(d);
        out.push(d);
      }
    }
    return out;
  }, [sortedTrades]);

  // Remount the table whenever the set of days changes so every day starts expanded.
  const datesKey = dates.join("|");
  const initialExpanded = useMemo(
    () => Object.fromEntries(dates.map((d) => [`date:${d}`, true])),
    [dates],
  );

  useEffect(() => {
    if (selectedTradeId) {
      const el = document.querySelector(`[data-testid="trade-row-${selectedTradeId}"]`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [selectedTradeId]);

  const handleSelect = useCallback(
    (trade: PaperTrade) => {
      onSelectSymbol(
        trade.symbol,
        trade.exit_time,
        trade.trade_id,
        trade.strategy_type || getStrategyTypeFromName(trade.strategy_name),
        trade.strategy_id,
        trade.entry_time,
      );
    },
    [onSelectSymbol],
  );

  const columns = useMemo<ColumnDef<PaperTrade>[]>(
    () => [
      {
        id: "toggle",
        header: "",
        enableSorting: false,
        cell: ({ row }) => (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              row.toggleExpanded();
            }}
            data-testid={`trade-detail-toggle-${row.original.trade_id}`}
          >
            {row.getIsExpanded() ? "▼" : "▶"}
          </ActionIcon>
        ),
      },
      {
        // Grouping-only column: the full-width day header rows display the
        // date, so per-row cells are empty to avoid a redundant wide column.
        id: "date",
        header: "",
        accessorFn: tradeDate,
        cell: () => null,
      },
      {
        id: "symbol",
        header: "Symbol",
        accessorKey: "symbol",
        cell: ({ row }) => <ClickableSymbol symbol={row.original.symbol} />,
      },
      {
        id: "side",
        header: "Side",
        accessorKey: "side",
        cell: ({ row }) => <SideBadge side={row.original.side} />,
      },
      { id: "quantity", header: "Qty", accessorKey: "quantity", cell: ({ row }) => <>{row.original.quantity}</> },
      {
        id: "entry_price",
        header: "Entry",
        accessorKey: "entry_price",
        cell: ({ row }) => <>₹{row.original.entry_price.toFixed(2)}</>,
      },
      {
        id: "exit_price",
        header: "Exit Price",
        accessorKey: "exit_price",
        cell: ({ row }) => <>{row.original.exit_price != null ? `₹${row.original.exit_price.toFixed(2)}` : "-"}</>,
      },
      {
        id: "hold_duration_minutes",
        header: "Hold",
        accessorKey: "hold_duration_minutes",
        cell: ({ row }) => (
          <Text size="sm" c="dimmed">
            {row.original.hold_duration_minutes != null ? formatDuration(row.original.hold_duration_minutes) : "-"}
          </Text>
        ),
      },
      {
        id: "stop_loss",
        header: "SL",
        accessorKey: "stop_loss",
        cell: ({ row }) => <>{row.original.stop_loss != null ? `₹${row.original.stop_loss.toFixed(2)}` : "-"}</>,
      },
      {
        id: "take_profit",
        header: "TP",
        accessorKey: "take_profit",
        cell: ({ row }) => (
          <>{row.original.take_profit != null && row.original.take_profit > 0 ? `₹${row.original.take_profit.toFixed(2)}` : "-"}</>
        ),
      },
      {
        id: "pnl_pct",
        header: "P&L%",
        accessorKey: "pnl_pct",
        cell: ({ row }) => {
          const pct = row.original.pnl_pct;
          return (
            <Text c={getPnLTextColor(pct)} fw={600} size="sm">
              {pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "-"}
            </Text>
          );
        },
      },
      {
        id: "net_pnl",
        header: "P&L",
        accessorKey: "net_pnl",
        cell: ({ row }) => (
          <Text c={getPnLTextColor(row.original.net_pnl)} fw={600} size="sm">
            ₹{formatNumber(row.original.net_pnl)}
          </Text>
        ),
      },
      {
        id: "exit_reason",
        header: "Exit Reason",
        accessorKey: "exit_reason",
        enableSorting: false,
        cell: ({ row }) => <ExitReasonBadge reason={row.original.exit_reason} />,
      },
      {
        id: "strategy_name",
        header: "Strategy",
        enableSorting: false,
        cell: ({ row }) => (
          <Anchor
            component="button"
            size="xs"
            onClick={(e) => { e.stopPropagation(); setFilterStrategy(row.original.strategy_id || null); }}
            data-testid={`trade-strategy-filter-${row.original.trade_id}`}
          >
            {row.original.strategy_name || "default"}
          </Anchor>
        ),
      },
      {
        id: "bot_name",
        header: "Bot",
        enableSorting: false,
        cell: ({ row }) => (
          <Anchor
            component="button"
            size="xs"
            onClick={(e) => { e.stopPropagation(); setFilterBot(row.original.bot_id || null); }}
            data-testid={`trade-bot-filter-${row.original.trade_id}`}
          >
            {row.original.bot_name || "-"}
          </Anchor>
        ),
      },
    ],
    [],
  );

  return (
    <TanStackTable<PaperTrade>
      key={datesKey}
      data={sortedTrades}
      columns={columns}
      enableGrouping
      grouping={["date"]}
      initialState={{
        // Sort day groups newest-first; trades inside a day keep the
        // pre-sorted (exit_time desc) order.
        sorting: [{ id: "date", desc: true }],
        expanded: initialExpanded,
      }}
      getRowCanExpand={() => true}
      renderSubComponent={(trade) => <TradeDetail trade={trade} />}
      renderGroupHeader={({ value, rows, isExpanded }) => (
        <DaySummary date={String(value)} trades={rows} expanded={isExpanded} />
      )}
      getGroupRowTestId={(value) => `day-group-${String(value)}`}
      getRowTestId={(trade) => `trade-row-${trade.trade_id}`}
      getRowClassName={(trade) =>
        selectedTradeId === trade.trade_id ? "trade-row-highlighted" : undefined
      }
      onRowClick={handleSelect}
    />
  );
}

function HistoryList({
  filteredTrades,
  state,
  handleSelectSymbol,
}: {
  filteredTrades: PaperTrade[];
  state: ReturnType<typeof getPaperTradingState>;
  handleSelectSymbol: (symbol: string, exitTime?: string, tradeId?: string) => Promise<void>;
}) {
  return (
    <ScrollArea flex={1} className="paper-history-list" id="history-list" type="scroll">
      {filteredTrades.length === 0 ? (
        <Flex py="sm" justify="center" align="center" direction="column" gap={4}>
          <Text size="xs" fw={500} c="dimmed">
            No trades found
          </Text>
        </Flex>
      ) : (
        <TradeHistoryTable
          trades={filteredTrades}
          selectedTradeId={state.selectedTradeId}
          onSelectSymbol={handleSelectSymbol}
        />
      )}
    </ScrollArea>
  );
}

function useFilteredTrades() {
  const state = getPaperTradingState();
  const filteredTrades = useMemo(() => {
    let trades = [...state.trades];
    if (state.filterSymbol) trades = trades.filter((t) => t.symbol === state.filterSymbol);
    if (state.filterFromDate || state.filterToDate)
      trades = filterByRange(trades, state.filterFromDate, state.filterToDate);
    if (state.filterStrategy) trades = trades.filter((t) => t.strategy_id === state.filterStrategy);
    if (state.filterBot) trades = trades.filter((t) => t.bot_id === state.filterBot);
    return trades;
  }, [
    state.trades,
    state.filterSymbol,
    state.filterFromDate,
    state.filterToDate,
    state.filterStrategy,
    state.filterBot,
  ]);

  const strategies = useMemo(() => getUniqueStrategies(state.trades), [state.trades]);
  const bots = useMemo(() => getUniqueBots(state.trades), [state.trades]);

  return { state, filteredTrades, strategies, bots };
}

export function PaperHistoryTable() {
  useStoreSubscription(subscribeToPaperTrading);
  const { state, filteredTrades, strategies, bots } = useFilteredTrades();

  const handleSelectSymbol = useCallback(async (
    symbol: string,
    exitTime?: string,
    tradeId?: string,
    strategyType?: string,
    strategyId?: number,
    entryTime?: string,
  ) => {
    setSelectedSymbol(symbol);
    if (tradeId) setSelectedTradeId(tradeId, strategyType, strategyId);
    const entryDate = entryTime ? entryTime.split("T")[0] : undefined;
    const fromDate = entryDate
      ? dayjs(entryDate).subtract(7, "day").format("YYYY-MM-DD")
      : undefined;
    const currentState = getPaperTradingState();
    const date = exitTime ? exitTime.split("T")[0] : dayjs().format("YYYY-MM-DD");
    await fetchPaperChart(symbol, date, currentState.chartTimeframe, strategyId, fromDate);
  }, []);

  if (state.isLoading && state.trades.length === 0) {
    return (
      <Flex
        justify="center"
        py="sm"
        data-testid="history-panel"
        className="paper-history-panel"
        id="history-panel"
      >
        <Group gap="xs">
          <Loader size="sm" />
          <Text size="xs" c="dimmed">
            Loading trade history...
          </Text>
        </Group>
      </Flex>
    );
  }

  return (
    <Flex
      direction="column"
      h="100%"
      className="paper-history-container"
      id="history-container"
      data-testid="history-panel"
    >
      <HistoryFilters bots={bots} strategies={strategies} state={state} />
      <HistoryList
        filteredTrades={filteredTrades}
        state={state}
        handleSelectSymbol={handleSelectSymbol}
      />
    </Flex>
  );
}
