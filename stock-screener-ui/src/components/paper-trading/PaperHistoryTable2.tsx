import { memo, useState, useMemo, useCallback, useEffect } from "react";
import dayjs from "dayjs";
import {
  Select,
  Text,
  Group,
  Loader,
  SegmentedControl,
  Anchor,
  Badge,
  ActionIcon,
  Stack,
  Textarea,
  Button,
} from "@/ui";
import Box from "@mui/material/Box";
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
      <Box sx={{ flex: "none", py: 1 }} id="history-filters">
        <Stack direction={{ xs: "column", sm: "row" } as any} justify="space-between" align="center" gap={1} sx={{ width: "100%" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
            {bots.length > 1 && (
              <Select
                placeholder="All Bots"
                data={[
                  { value: "", label: "All Bots" },
                  ...bots.map((b) => ({ value: b.id, label: b.name })),
                ]}
                value={state.filterBot || ""}
                onChange={(v) => setFilterBot(v)}
                sx={{ width: 160, borderRadius: 1 }}
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
                sx={{ width: 160, borderRadius: 1 }}
                size="xs"
                data-testid="strategy-filter-select"
              />
            )}
          </Box>
          <Box sx={{ display: "flex", alignItems: "center" }}>
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
          </Box>
        </Stack>
      </Box>

      <Box sx={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", px: 1, py: 1 }} data-testid="trades-header" id="trades-header">
        <Text size="xs" fw={600} c="dimmed" tt="uppercase">
          Trade History
        </Text>
      </Box>
    </>
  );
}

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
    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1, py: 0.5, gap: 1, flexWrap: "nowrap" }} data-testid={`day-header-${date}`}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "nowrap" }}>
        <Text size="xs" c="dimmed" sx={{ lineHeight: 1 }}>
          {expanded ? "▾" : "▸"}
        </Text>
        <Text size="xs" fw={600} c="dimmed" tt="uppercase">
          {formatDateHeader(date)}
        </Text>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "nowrap" }}>
        <Text size="xs" c={pnlColor} fw={600} sx={{ textAlign: "right" }}>
          {formatSignedPnl(dayPnl)}
        </Text>
        <Badge color={wins > 0 ? "success" : "secondary"} variant="light" size="xs">
          ▲{wins}
        </Badge>
        <Badge color={losses > 0 ? "error" : "secondary"} variant="light" size="xs">
          ▼{losses}
        </Badge>
      </Box>
    </Box>
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
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 3, maxWidth: 800, mx: "auto", width: "100%" }}>
      <Box sx={{ minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Stack spacing={1} sx={{ width: "100%", maxWidth: 320 }}>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" sx={{ letterSpacing: 0.5, pb: 0.5, textAlign: "center", width: "100%" }}>Entry</Text>
          {entryContext.map((item) => (
            <Box key={item.label} sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", py: 1, gap: 0.5, textAlign: "center" }}>
              <Text size="xs" c="dimmed" sx={{ lineHeight: 1 }}>{item.label}</Text>
              <Text size="sm" fw={600} c={item.color} sx={{ lineHeight: 1.2 }}>{item.value}</Text>
            </Box>
          ))}
        </Stack>
      </Box>
      <Box sx={{ minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center" }}>
        <Stack spacing={1} sx={{ width: "100%", maxWidth: 320 }}>
          <Text size="xs" fw={700} c="dimmed" tt="uppercase" sx={{ letterSpacing: 0.5, pb: 0.5, textAlign: "center", width: "100%" }}>Exit</Text>
          {exitContext.map((item) => (
            <Box key={item.label} sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", py: 1, gap: 0.5, textAlign: "center" }}>
              <Text size="xs" c="dimmed" sx={{ lineHeight: 1 }}>{item.label}</Text>
              <Text size="sm" fw={600} c={item.color} sx={{ lineHeight: 1.2 }}>{item.value}</Text>
            </Box>
          ))}
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", py: 1, gap: 0.5, textAlign: "center" }}>
            <Text size="xs" c="dimmed" sx={{ lineHeight: 1 }}>Exit Reason</Text>
            <ExitReasonBadge reason={trade.exit_reason} />
          </Box>
        </Stack>
      </Box>
    </Box>
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
    <Stack spacing={1}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, py: 0.5 }}>
        <Text size="xs" c="dimmed" sx={{ flexShrink: 0, minWidth: 80 }}>Reason</Text>
        <Text size="xs" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.5, textAlign: "right", flex: 1 }} data-testid={`trade-reason-${trade.trade_id}`}>
          {trade.reason || "-"}
        </Text>
      </Box>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Text size="xs" c="dimmed">Notes</Text>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Box sx={{ flex: 1, display: "flex", alignItems: "center" }}>
            <Textarea
              size="xs"
              minRows={2}
              maxRows={4}
              value={notes}
              onChange={(val) => setNotes(val)}
              placeholder="Any additional notes..."
              styles={{ input: { background: "var(--mui-palette-background-paper)" } }}
              data-testid={`trade-notes-${trade.trade_id}`}
            />
          </Box>
          <Button size="xs" variant="light" loading={saving} onClick={handleSave} data-testid={`trade-notes-save-${trade.trade_id}`} sx={{ alignSelf: "center" }}>
            Save
          </Button>
        </Box>
      </Box>
    </Stack>
  );
});

const TradeDetail = memo(function TradeDetail({ trade }: { trade: PaperTrade }) {
  return (
    <Stack spacing={1}>
      <TradeStats trade={trade} />
      <TradeNotesEditor trade={trade} />
    </Stack>
  );
});

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
            color="secondary"
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
    <Box sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }} id="history-list">
      {filteredTrades.length === 0 ? (
        <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 1, py: 4, flex: 1, minHeight: 200, textAlign: "center" }}>
          <Text size="xs" fw={500} c="dimmed">
            No trades found
          </Text>
        </Box>
      ) : (
        <TradeHistoryTable
          trades={filteredTrades}
          selectedTradeId={state.selectedTradeId}
          onSelectSymbol={handleSelectSymbol}
        />
      )}
    </Box>
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
      <Box sx={{ display: "flex", justifyContent: "center", py: 1 }} data-testid="history-panel" id="history-panel">
        <Group gap="xs">
          <Loader size="sm" />
          <Text size="xs" c="dimmed">
            Loading trade history...
          </Text>
        </Group>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", flex: 1, minHeight: 0 }} data-testid="history-panel" id="history-container">
      <HistoryFilters bots={bots} strategies={strategies} state={state} />
      <HistoryList
        filteredTrades={filteredTrades}
        state={state}
        handleSelectSymbol={handleSelectSymbol}
      />
    </Box>
  );
}
