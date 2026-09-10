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
  LoadingOverlay,
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
import { IconChevronRight, IconChevronDown } from "@tabler/icons-react";
import * as palette from "@/ui/palette";
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
    const todayStr = dayjs().format("YYYY-MM-DD");
    switch (period) {
      case "today":
        fromDate = todayStr;
        toDate = todayStr;
        break;
      case "week":
        fromDate = dayjs().subtract(7, "day").format("YYYY-MM-DD");
        toDate = todayStr;
        break;
      case "month":
        fromDate = dayjs().subtract(1, "month").format("YYYY-MM-DD");
        toDate = todayStr;
        break;
      case "year":
        fromDate = dayjs().subtract(1, "year").format("YYYY-MM-DD");
        toDate = todayStr;
        break;
      case "all":
      default:
        fromDate = null;
        toDate = null;
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
      <Box className="paper-history-filters" sx={{ flex: "none", py: 0.5, px: 0.5 }} id="history-filters">
        <Stack className="paper-history-filters-stack" id="paper-history-filters-stack" direction={{ xs: "column", sm: "row" } as any} justify="space-between" align={{ xs: "stretch", sm: "center" }} gap={1} sx={{ width: "100%" }}>
          <Box className="paper-history-filters-left" sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
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
          <Box className="paper-history-filters-right" sx={{ display: "flex", alignItems: "center", justifyContent: { xs: "flex-start", sm: "flex-end" }, flexWrap: "wrap", gap: 0.5, flexShrink: 0 }}>
            <SegmentedControl
              className="paper-quick-filter"
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

      <Box className="paper-trades-header" sx={{ flex: "none", display: "flex", alignItems: "center", justifyContent: "space-between", px: 1, py: 1 }} data-testid="trades-header" id="trades-header">
        <Text className="paper-trades-header-title" size="xs" fw={600} c="dimmed" tt="uppercase">
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
    <Box className="paper-day-summary" id={`paper-day-summary-${date}`} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1, py: 0.5, gap: 1, flexWrap: "nowrap" }} data-testid={`day-header-${date}`}>
      <Box className="paper-day-summary-left" sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "nowrap" }}>
        <Text className="paper-day-summary-toggle" size="xs" c="dimmed" sx={{ lineHeight: 1 }}>
          {expanded ? "▾" : "▸"}
        </Text>
        <Text className="paper-day-summary-date" size="xs" fw={700} tt="uppercase">
          {formatDateHeader(date)}
        </Text>
      </Box>
      <Box className="paper-day-summary-right" sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "nowrap" }}>
        <Text className="paper-day-summary-pnl" size="xs" c={pnlColor} fw={700} sx={{ textAlign: "right" }}>
          {formatSignedPnl(dayPnl)}
        </Text>
        <Badge className="paper-day-summary-wins" color={wins > 0 ? "success" : "secondary"} variant="filled" size="xs">
          ▲{wins}
        </Badge>
        <Badge className="paper-day-summary-losses" color={losses > 0 ? "error" : "secondary"} variant="filled" size="xs">
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
    { label: "Trade ID", value: `#${trade.trade_id}`, color: palette.PRIMARY },
    { label: "Entry Time", value: formatTimeOnly(trade.entry_time), color: palette.TEXT },
    { label: "Peak", value: `₹${trade.peak_price?.toFixed(2) ?? "-"}`, color: trade.peak_price ? palette.POSITIVE : palette.TEXT_MUTED },
    { label: "Low", value: `₹${trade.low_price?.toFixed(2) ?? "-"}`, color: trade.low_price ? palette.NEGATIVE : palette.TEXT_MUTED },
    { label: "Hold", value: trade.hold_duration_minutes != null ? formatDuration(trade.hold_duration_minutes) : "-", color: palette.TEXT_MUTED },
  ];

  const exitContext = [
    { label: "Exit Time", value: formatTimeOnly(trade.exit_time), color: palette.TEXT },
    { label: "Exit Price", value: trade.exit_price != null ? `₹${trade.exit_price.toFixed(2)}` : "-", color: palette.TEXT },
    { label: "Costs", value: `₹${formatNumber(trade.costs)}`, color: palette.NEGATIVE },
    { label: "Gross P&L", value: formatSignedPnl(grossPnl), color: grossColor === "success" ? palette.POSITIVE : palette.NEGATIVE },
    { label: "Net P&L", value: formatSignedPnl(netPnl), color: netColor === "success" ? palette.POSITIVE : palette.NEGATIVE },
  ];

  return (
    <Box className="paper-trade-stats" id={`paper-trade-stats-${trade.trade_id}`} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, minmax(220px, 260px))" }, gap: 0.75, width: "100%", justifyContent: "center", maxWidth: 540, mx: "auto" }}>
      <Box className="paper-trade-stats-entry" id={`paper-trade-stats-entry-${trade.trade_id}`} sx={{ p: 0.5, border: "1px solid var(--mui-palette-divider)", borderRadius: 1, bgcolor: "var(--mui-palette-background-paper)", minWidth: 0, width: "100%" }}>
        <Text className="paper-trade-stats-entry-title" id={`paper-trade-stats-entry-title-${trade.trade_id}`} size="xs" fw={700} c="dimmed" tt="uppercase" sx={{ letterSpacing: 0.6, pb: 0.5, mb: 0.25, borderBottom: "1px solid var(--mui-palette-divider)" }}>Entry</Text>
        {entryContext.map((item) => (
          <Box key={item.label} className="paper-trade-stats-row" id={`paper-trade-stats-row-${trade.trade_id}-${item.label.replace(/\s+/g, "-").toLowerCase()}`} sx={{ display: "flex", alignItems: "center", py: 0.35, gap: 0.35, borderBottom: "1px solid var(--mui-palette-divider)", "&:last-child": { borderBottom: 0, pb: 0 } }}>
            <Text className="paper-trade-stats-label" size="xs" c="dimmed" sx={{ lineHeight: 1.1, minWidth: 62, flexShrink: 0 }}>{item.label}</Text>
            <Text className="paper-trade-stats-value" size="xs" fw={600} c={item.color} sx={{ lineHeight: 1.2, fontSize: "0.78rem" }}>{item.value}</Text>
          </Box>
        ))}
      </Box>
      <Box className="paper-trade-stats-exit" id={`paper-trade-stats-exit-${trade.trade_id}`} sx={{ p: 0.5, border: "1px solid var(--mui-palette-divider)", borderRadius: 1, bgcolor: "var(--mui-palette-background-paper)", minWidth: 0, width: "100%" }}>
        <Text className="paper-trade-stats-exit-title" id={`paper-trade-stats-exit-title-${trade.trade_id}`} size="xs" fw={700} c="dimmed" tt="uppercase" sx={{ letterSpacing: 0.6, pb: 0.5, mb: 0.25, borderBottom: "1px solid var(--mui-palette-divider)" }}>Exit</Text>
        {exitContext.map((item) => (
          <Box key={item.label} className="paper-trade-stats-row" id={`paper-trade-stats-row-${trade.trade_id}-${item.label.replace(/\s+/g, "-").toLowerCase()}`} sx={{ display: "flex", alignItems: "center", py: 0.35, gap: 0.35, borderBottom: "1px solid var(--mui-palette-divider)", "&:last-child": { borderBottom: 0, pb: 0 } }}>
            <Text className="paper-trade-stats-label" size="xs" c="dimmed" sx={{ lineHeight: 1.1, minWidth: 62, flexShrink: 0 }}>{item.label}</Text>
            <Text className="paper-trade-stats-value" size="xs" fw={600} c={item.color} sx={{ lineHeight: 1.2, fontSize: "0.78rem" }}>{item.value}</Text>
          </Box>
        ))}
        <Box className="paper-trade-stats-exit-reason" id={`paper-trade-stats-exit-reason-${trade.trade_id}`} sx={{ display: "flex", alignItems: "center", py: 0.35, gap: 0.35 }}>
          <Text className="paper-trade-stats-label" size="xs" c="dimmed" sx={{ lineHeight: 1.1, minWidth: 62, flexShrink: 0 }}>Exit Reason</Text>
          <ExitReasonBadge reason={trade.exit_reason} />
        </Box>
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
    <Box className="paper-trade-notes-editor" id={`paper-trade-notes-${trade.trade_id}`} sx={{ p: 0.75, border: "1px solid var(--mui-palette-divider)", borderRadius: 1, bgcolor: "var(--mui-palette-background-paper)" }}>
      <Stack className="paper-trade-notes-stack" spacing={1}>
        <Box className="paper-trade-notes-reason-row" id={`paper-trade-notes-reason-row-${trade.trade_id}`} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, py: 0.5, borderBottom: "1px solid var(--mui-palette-divider)" }}>
          <Text className="paper-trade-notes-label" size="xs" c="dimmed" fw={600} tt="uppercase" sx={{ flexShrink: 0, letterSpacing: 0.5 }}>Reason</Text>
          <Text className="paper-trade-notes-reason" id={`paper-trade-notes-reason-${trade.trade_id}`} size="xs" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.5, textAlign: "right", flex: 1 }} data-testid={`trade-reason-${trade.trade_id}`}>
            {trade.reason || "-"}
          </Text>
        </Box>
        <Box className="paper-trade-notes-input-group" id={`paper-trade-notes-input-group-${trade.trade_id}`} sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          <Text className="paper-trade-notes-notes-label" size="xs" c="dimmed" fw={600} tt="uppercase" sx={{ letterSpacing: 0.5 }}>Notes</Text>
          <Box className="paper-trade-notes-input-row" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Box className="paper-trade-notes-textarea-wrap" sx={{ flex: 1, display: "flex", alignItems: "center" }}>
              <Textarea
                className="paper-trade-notes-textarea"
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
            <Button className="paper-trade-notes-save" id={`paper-trade-notes-save-${trade.trade_id}`} size="xs" variant="light" loading={saving} onClick={handleSave} data-testid={`trade-notes-save-${trade.trade_id}`} sx={{ alignSelf: "center" }}>
              Save
            </Button>
          </Box>
        </Box>
      </Stack>
    </Box>
  );
});

const TradeDetail = memo(function TradeDetail({ trade }: { trade: PaperTrade }) {
  return (
    <Box className="paper-trade-detail" id={`paper-trade-detail-${trade.trade_id}`} sx={{ px: 1, py: 0.75, bgcolor: "var(--mui-palette-background-default)", borderTop: "1px solid var(--mui-palette-divider)" }}>
      <Stack className="paper-trade-detail-stack" id={`paper-trade-detail-stack-${trade.trade_id}`} spacing={0.75}>
        <TradeStats trade={trade} />
        <TradeNotesEditor trade={trade} />
      </Stack>
    </Box>
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
            aria-label={row.getIsExpanded() ? "Collapse" : "Expand"}
            onClick={(e) => {
              e.stopPropagation();
              row.toggleExpanded();
            }}
            data-testid={`trade-detail-toggle-${row.original.trade_id}`}
          >
            {row.getIsExpanded() ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
          </ActionIcon>
        ),
      },
      {
        id: "date",
        header: "",
        accessorFn: tradeDate,
        size: 0,
        enableSorting: false,
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
          <Text className="paper-cell-hold" size="sm">
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
            <Text className="paper-cell-pnlpct" c={getPnLTextColor(pct)} fw={600} size="sm">
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
          <Text className="paper-cell-pnl" c={getPnLTextColor(row.original.net_pnl)} fw={600} size="sm">
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
      className="paper-trade-history-table"
      key={datesKey}
      data={sortedTrades}
      columns={columns}
      rowWindowSize={120}
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
    <Box className="paper-history-list" sx={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative" }} id="history-list">
      <LoadingOverlay visible={state.isLoading} zIndex={5} overlayProps={{ radius: "sm", blur: 1 }} className="paper-history-loading-overlay" />
      {filteredTrades.length === 0 && !state.isLoading ? (
        <Box className="paper-history-empty" id="paper-history-empty" sx={{ display: "flex", justifyContent: "center", alignItems: "center", flexDirection: "column", gap: 1, py: 4, flex: 1, minHeight: 200, textAlign: "center" }}>
          <Text className="paper-history-empty-text" size="xs" fw={500} c="dimmed">
            No trades found
          </Text>
        </Box>
      ) : (
        <Box sx={{ opacity: state.isLoading ? 0.6 : 1, transition: "opacity 0.15s", flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <TradeHistoryTable
            trades={filteredTrades}
            selectedTradeId={state.selectedTradeId}
            onSelectSymbol={handleSelectSymbol}
          />
        </Box>
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
      <Box className="paper-history-loading" sx={{ display: "flex", justifyContent: "center", py: 1 }} data-testid="history-panel" id="history-panel">
        <Group className="paper-history-loading-group" gap="xs">
          <Loader size="sm" />
          <Text className="paper-history-loading-text" size="xs" c="dimmed">
            Loading trade history...
          </Text>
        </Group>
      </Box>
    );
  }

  return (
    <Box className="paper-history-panel" sx={{ display: "flex", flexDirection: "column", height: "100%", flex: 1, minHeight: 0 }} data-testid="history-panel" id="history-container">
      <HistoryFilters bots={bots} strategies={strategies} state={state} />
      <HistoryList
        filteredTrades={filteredTrades}
        state={state}
        handleSelectSymbol={handleSelectSymbol}
      />
    </Box>
  );
}
