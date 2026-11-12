import { createSignal, createMemo, For, Show } from "solid-js";
import dayjs from "dayjs";
import { Select, Text, Loader, SegmentedControl, Anchor, Badge, ActionIcon, Textarea, Button, LoadingOverlay } from "@/ui";
import type { TableColumnDef } from "./TanStackTable";
import type { PaperTrade, TradeSourceFilter } from "../../types/paperTrading";
import {
  formatNumber,
  formatSignedPnl,
  formatTimeOnly,
  formatDateHeader,
  formatDuration,
  getPnLTextColor,
  getStrategyTypeFromName,
} from "../../utils/ui-helpers";
import { SideBadge, ExitReasonBadge } from "../common";
import { ClickableSymbolSolid } from "./ClickableSymbolSolid";
import { IconChevronRight, IconChevronDown } from "@/components/common/Icons";
import * as palette from "@/ui/palette";
import { TanStackTable } from "./TanStackTable";
import {
  getPaperTradingState,
  subscribe as subscribeToPaperTrading,
  setSelectedSymbol,
  setFilterStrategy,
  setFilterBot,
  setFilterSource,
  setFilterFromDate,
  setFilterToDate,
  setSelectedTradeId,
  updateTradeNotesAction,
} from "../../state/paperTrading";
import { fetchPaperChart, refreshHistoryData } from "../../api/paperTrading";
import { resolveUnderlyingSymbol, listBookFilters, tradeMatchesBook } from "./optionTradeUtils";
import {
  getUniqueStrategies,
  getUniqueBots,
  filterByRange,
  getPeriodFromDateRange,
} from "../../utils/tradeHistoryUtils";
import { useStoreSnapshot } from "./storeSnapshot";
import { Group, Stack } from "./primitives";

type PaperTradingSnapshot = ReturnType<typeof getPaperTradingState>;

function useQuickFilter(state: () => PaperTradingSnapshot) {
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
    const botId = state().filterBot || null;
    refreshHistoryData(botId, fromDate, toDate);
  };

  const getCurrentPeriod = () => {
    return getPeriodFromDateRange(state().filterFromDate, state().filterToDate);
  };

  return { handleQuickFilter, getCurrentPeriod };
}

function HistoryFilters(props: {
  bots: Array<{ id: string; name: string }>;
  strategies: { id: number; name: string }[];
  state: () => PaperTradingSnapshot;
}) {
  const { handleQuickFilter, getCurrentPeriod } = useQuickFilter(props.state);
  const bookFilters = createMemo(() => listBookFilters(props.state().trades));

  return (
    <>
      <div class="paper-history-filters flex-none py-1 px-1" id="history-filters">
        <Stack className="paper-history-filters-stack flex-col sm:flex-row justify-between items-stretch sm:items-center gap-2 w-full" id="paper-history-filters-stack">
          <div class="paper-history-filters-left flex items-center gap-2 flex-wrap flex-1 min-w-0">
            <Show when={props.bots.length > 1}>
              <Select
                placeholder="All Bots"
                data={[
                  { value: "", label: "All Bots" },
                  ...props.bots.map((b) => ({ value: b.id, label: b.name })),
                ]}
                value={props.state().filterBot || ""}
                onChange={(v) => setFilterBot(v)}
                style={{ width: "160px", borderRadius: "1px" }}
                size="xs"
                data-testid="bot-filter-select"
              />
            </Show>
            <Show when={props.strategies.length > 1}>
              <Select
                placeholder="All Strategies"
                data={[
                  { value: "", label: "All Strategies" },
                  ...props.strategies.map((s) => ({ value: String(s.id), label: s.name })),
                ]}
                value={props.state().filterStrategy != null ? String(props.state().filterStrategy!) : ""}
                onChange={(v) => setFilterStrategy(v ? Number(v) : null)}
                style={{ width: "160px", borderRadius: "1px" }}
                size="xs"
                data-testid="strategy-filter-select"
              />
            </Show>
            <Select
              placeholder="All"
              data={bookFilters()}
              value={props.state().filterSource || "all"}
              onChange={(v) => setFilterSource(((v || "all") as TradeSourceFilter))}
              w={120}
              size="xs"
              data-testid="source-filter-select"
            />
          </div>
          <div class="paper-history-filters-right flex items-center justify-start sm:justify-end flex-wrap gap-1 shrink-0">
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
          </div>
        </Stack>
      </div>

      <div class="paper-trades-header flex-none flex items-center justify-between px-1.5 py-1" data-testid="trades-header" id="trades-header">
        <Text className="paper-trades-header-title uppercase" size="xs" fw={600} c="dimmed">
          Trade History
        </Text>
      </div>
    </>
  );
}

function DaySummary(props: {
  date: string;
  trades: PaperTrade[];
  expanded: boolean;
}) {
  const dayPnl = () => props.trades.reduce((sum, t) => sum + t.net_pnl, 0);
  const wins = () => props.trades.filter((t) => t.net_pnl > 0).length;
  const losses = () => props.trades.filter((t) => t.net_pnl < 0).length;
  const pnlColor = () => getPnLTextColor(dayPnl());

  return (
    <div class="paper-day-summary flex items-center justify-between px-1.5 py-0.5 gap-1 flex-nowrap" id={`paper-day-summary-${props.date}`} data-testid={`day-header-${props.date}`}>
      <div class="paper-day-summary-left flex items-center gap-2 flex-nowrap">
        <Text className="paper-day-summary-toggle" size="xs" c="dimmed" style={{ lineHeight: 1 }}>
          {props.expanded ? "▾" : "▸"}
        </Text>
        <Text className="paper-day-summary-date uppercase font-mono tabular-nums" size="xs" fw={700}>
          {formatDateHeader(props.date)}
        </Text>
      </div>
      <div class="paper-day-summary-right flex items-center gap-2 flex-nowrap">
        <Text className="paper-day-summary-pnl font-mono tabular-nums" size="xs" c={pnlColor()} fw={700} style={{ textAlign: "right" }}>
          {formatSignedPnl(dayPnl())}
        </Text>
        <Badge className="paper-day-summary-wins" color={wins() > 0 ? "success" : "secondary"} variant="filled" size="xs">
          ▲{wins()}
        </Badge>
        <Badge className="paper-day-summary-losses" color={losses() > 0 ? "error" : "secondary"} variant="filled" size="xs">
          ▼{losses()}
        </Badge>
      </div>
    </div>
  );
}

function TradeStats(props: { trade: PaperTrade }) {
  const grossPnl = () => props.trade.pnl;
  const netPnl = () => props.trade.net_pnl;
  const grossColor = () => getPnLTextColor(grossPnl());
  const netColor = () => getPnLTextColor(netPnl());

  const entryContext = () => [
    { label: "Trade ID", value: `#${props.trade.trade_id}`, color: palette.PRIMARY },
    { label: "Entry Time", value: formatTimeOnly(props.trade.entry_time), color: palette.TEXT },
    { label: "Peak", value: `₹${props.trade.peak_price?.toFixed(2) ?? "-"}`, color: props.trade.peak_price ? palette.POSITIVE : palette.TEXT_MUTED },
    { label: "Low", value: `₹${props.trade.low_price?.toFixed(2) ?? "-"}`, color: props.trade.low_price ? palette.NEGATIVE : palette.TEXT_MUTED },
    { label: "Hold", value: props.trade.hold_duration_minutes != null ? formatDuration(props.trade.hold_duration_minutes) : "-", color: palette.TEXT_MUTED },
  ];

  const exitContext = () => [
    { label: "Exit Time", value: formatTimeOnly(props.trade.exit_time), color: palette.TEXT },
    { label: "Exit Price", value: props.trade.exit_price != null ? `₹${props.trade.exit_price.toFixed(2)}` : "-", color: palette.TEXT },
    { label: "Costs", value: `₹${formatNumber(props.trade.costs)}`, color: palette.NEGATIVE },
    { label: "Gross P&L", value: formatSignedPnl(grossPnl()), color: grossColor() === "success" ? palette.POSITIVE : palette.NEGATIVE },
    { label: "Net P&L", value: formatSignedPnl(netPnl()), color: netColor() === "success" ? palette.POSITIVE : palette.NEGATIVE },
  ];

  return (
    <div class="paper-trade-stats grid grid-cols-1 md:grid-cols-2 gap-1 w-full" id={`paper-trade-stats-${props.trade.trade_id}`}>
      <div class="paper-trade-stats-entry p-1 border-0 rounded-none bg-transparent min-w-0 w-full" id={`paper-trade-stats-entry-${props.trade.trade_id}`}>
        <Text className="paper-trade-stats-entry-title uppercase pb-1 mb-0.5 border-b border-fin-border" id={`paper-trade-stats-entry-title-${props.trade.trade_id}`} size="xs" fw={700} c="dimmed" style={{ letterSpacing: 0.6 }}>
          Entry
        </Text>
        <For each={entryContext()}>{(item) => (
          <div class="paper-trade-stats-row flex items-center border-b border-fin-border py-[2.8px] gap-[2.8px]" id={`paper-trade-stats-row-${props.trade.trade_id}-${item.label.replace(/\s+/g, "-").toLowerCase()}`}>
            <Text className="paper-trade-stats-label min-w-[62px] shrink-0 leading-[1.1]" size="xs" c="dimmed">{item.label}</Text>
            <Text className="paper-trade-stats-value font-mono tabular-nums leading-[1.2] text-[0.78rem]" size="xs" fw={600} c={item.color}>{item.value}</Text>
          </div>
        )}</For>
      </div>
      <div class="paper-trade-stats-exit p-1 border-0 rounded-none bg-transparent min-w-0 w-full" id={`paper-trade-stats-exit-${props.trade.trade_id}`}>
        <Text className="paper-trade-stats-exit-title uppercase pb-1 mb-0.5 border-b border-fin-border" id={`paper-trade-stats-exit-title-${props.trade.trade_id}`} size="xs" fw={700} c="dimmed" style={{ letterSpacing: 0.6 }}>
          Exit
        </Text>
        <For each={exitContext()}>{(item) => (
          <div class="paper-trade-stats-row flex items-center border-b border-fin-border py-[2.8px] gap-[2.8px]" id={`paper-trade-stats-row-${props.trade.trade_id}-${item.label.replace(/\s+/g, "-").toLowerCase()}`}>
            <Text className="paper-trade-stats-label min-w-[62px] shrink-0 leading-[1.1]" size="xs" c="dimmed">{item.label}</Text>
            <Text className="paper-trade-stats-value font-mono tabular-nums leading-[1.2] text-[0.78rem]" size="xs" fw={600} c={item.color}>{item.value}</Text>
          </div>
        )}</For>
        <div class="paper-trade-stats-exit-reason flex items-center py-[2.8px] gap-[2.8px]" id={`paper-trade-stats-exit-reason-${props.trade.trade_id}`}>
          <Text className="paper-trade-stats-label min-w-[62px] shrink-0 leading-[1.1]" size="xs" c="dimmed">Exit Reason</Text>
          <ExitReasonBadge reason={props.trade.exit_reason} />
        </div>
      </div>
    </div>
  );
}

// Expanded rows remount on store ticks, so notes drafts persist at module scope.
const _tradeNotesDrafts = new Map<string, string>();

function TradeNotesEditor(props: { trade: PaperTrade }) {
  const draftKey = () => String(props.trade.trade_id);
  const [notes, setNotes] = createSignal(_tradeNotesDrafts.get(draftKey()) ?? props.trade.notes ?? "");
  const [saving, setSaving] = createSignal(false);

  const reason = () => props.trade.reason || "";

  const handleSave = async () => {
    setSaving(true);
    await updateTradeNotesAction(props.trade.trade_id, notes(), reason());
    setSaving(false);
  };

  const updateNotes = (v: string) => {
    _tradeNotesDrafts.set(draftKey(), v);
    setNotes(v);
  };

  return (
    <div class="paper-trade-notes-editor p-1.5 border border-fin-border rounded-[1px] bg-fin-surface" id={`paper-trade-notes-${props.trade.trade_id}`}>
      <Stack className="paper-trade-notes-stack gap-2">
        <div class="paper-trade-notes-reason-row flex items-center justify-between gap-2 py-1 border-b border-fin-border" id={`paper-trade-notes-reason-row-${props.trade.trade_id}`}>
          <Text className="paper-trade-notes-label uppercase shrink-0" size="xs" c="dimmed" fw={600} style={{ letterSpacing: 0.5 }}>
            Reason
          </Text>
          <Text className="paper-trade-notes-reason whitespace-pre-wrap leading-[1.5] text-right flex-1" id={`paper-trade-notes-reason-${props.trade.trade_id}`} size="xs" data-testid={`trade-reason-${props.trade.trade_id}`}>
            {props.trade.reason || "-"}
          </Text>
        </div>
        <div class="paper-trade-notes-input-group flex flex-col gap-2" id={`paper-trade-notes-input-group-${props.trade.trade_id}`}>
          <Text className="paper-trade-notes-notes-label uppercase shrink-0" size="xs" c="dimmed" fw={600} style={{ letterSpacing: 0.5 }}>
            Notes
          </Text>
          <div class="paper-trade-notes-input-row flex items-center gap-2">
            <div class="paper-trade-notes-textarea-wrap flex-1 flex items-center">
              <Textarea
                className="paper-trade-notes-textarea"
                size="xs"
                minRows={2}
                maxRows={4}
                value={notes()}
                onChange={(val) => updateNotes(val)}
                placeholder="Any additional notes..."
                data-testid={`trade-notes-${props.trade.trade_id}`}
              />
            </div>
            <Button className="paper-trade-notes-save self-center" id={`paper-trade-notes-save-${props.trade.trade_id}`} size="xs" variant="light" loading={saving()} onClick={handleSave} data-testid={`trade-notes-save-${props.trade.trade_id}`}>
              Save
            </Button>
          </div>
        </div>
      </Stack>
    </div>
  );
}

function TradeDetail(props: { trade: PaperTrade }) {
  return (
    <div class="paper-trade-detail px-2 py-1 bg-fin-bg border-t border-fin-border" id={`paper-trade-detail-${props.trade.trade_id}`}>
      <Stack className="paper-trade-detail-stack gap-2 w-full" id={`paper-trade-detail-stack-${props.trade.trade_id}`}>
        <TradeStats trade={props.trade} />
        <TradeNotesEditor trade={props.trade} />
      </Stack>
    </div>
  );
}

function tradeDate(trade: PaperTrade): string {
  return (trade.exit_time || "").split("T")[0];
}

function TradeHistoryTable(props: {
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
  const sortedTrades = createMemo(() => [...props.trades].sort((a, b) => (b.exit_time || "").localeCompare(a.exit_time || "")));

  const handleSelect = (trade: PaperTrade) => {
    const chartSymbol = resolveUnderlyingSymbol(trade.symbol);
    props.onSelectSymbol(
      chartSymbol,
      trade.exit_time,
      trade.trade_id,
      trade.strategy_type || getStrategyTypeFromName(trade.strategy_name),
      trade.strategy_id,
      trade.entry_time,
    );
  };

  const columns = createMemo<TableColumnDef<PaperTrade>[]>(() => [
    {
      id: "toggle",
      header: "",
      meta: { align: "center" },
      enableSorting: false,
      cell: ({ row }) => (
        <ActionIcon
          variant="subtle"
          color="secondary"
          size="sm"
          aria-label={row.isExpanded() ? "Collapse" : "Expand"}
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            row.toggle();
          }}
          data-testid={`trade-detail-toggle-${row.original.trade_id}`}
        >
          {row.isExpanded() ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
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
      meta: { align: "left" },
      cell: ({ row }) => <ClickableSymbolSolid symbol={row.original.symbol} />,
    },
    {
      id: "side",
      header: "Side",
      accessorKey: "side",
      meta: { align: "center" },
      cell: ({ row }) => <SideBadge side={row.original.side} />,
    },
    { id: "quantity", header: "Qty", accessorKey: "quantity", meta: { align: "right" }, cell: ({ row }) => <>{row.original.quantity}</> },
    {
      id: "entry_price",
      header: "Entry",
      accessorKey: "entry_price",
      meta: { align: "right" },
      cell: ({ row }) => <>₹{row.original.entry_price.toFixed(2)}</>,
    },
    {
      id: "exit_price",
      header: "Exit Price",
      accessorKey: "exit_price",
      meta: { align: "right" },
      cell: ({ row }) => <>{row.original.exit_price != null ? `₹${row.original.exit_price.toFixed(2)}` : "-"}</>,
    },
    {
      id: "hold_duration_minutes",
      header: "Hold",
      accessorKey: "hold_duration_minutes",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Text className="paper-cell-hold font-mono tabular-nums" size="sm">
          {row.original.hold_duration_minutes != null ? formatDuration(row.original.hold_duration_minutes) : "-"}
        </Text>
      ),
    },
    {
      id: "stop_loss",
      header: "SL",
      accessorKey: "stop_loss",
      meta: { align: "right" },
      cell: ({ row }) => <>{row.original.stop_loss != null ? `₹${row.original.stop_loss.toFixed(2)}` : "-"}</>,
    },
    {
      id: "take_profit",
      header: "TP",
      accessorKey: "take_profit",
      meta: { align: "right" },
      cell: ({ row }) => (
        <>{row.original.take_profit != null && row.original.take_profit > 0 ? `₹${row.original.take_profit.toFixed(2)}` : "-"}</>
      ),
    },
    {
      id: "pnl_pct",
      header: "P&L%",
      accessorKey: "pnl_pct",
      meta: { align: "right" },
      cell: ({ row }) => {
        const pct = row.original.pnl_pct;
        return (
          <Text className="paper-cell-pnlpct font-mono tabular-nums" c={getPnLTextColor(pct)} fw={600} size="sm">
            {pct != null ? `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%` : "-"}
          </Text>
        );
      },
    },
    {
      id: "net_pnl",
      header: "P&L",
      accessorKey: "net_pnl",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Text className="paper-cell-pnl font-mono tabular-nums" c={getPnLTextColor(row.original.net_pnl)} fw={600} size="sm">
          ₹{formatNumber(row.original.net_pnl)}
        </Text>
      ),
    },
    {
      id: "exit_reason",
      header: "Exit Reason",
      accessorKey: "exit_reason",
      meta: { align: "center" },
      enableSorting: false,
      cell: ({ row }) => <ExitReasonBadge reason={row.original.exit_reason} />,
    },
    {
      id: "strategy_name",
      header: "Strategy",
      meta: { align: "left" },
      enableSorting: false,
      cell: ({ row }) => (
        <Anchor
          component="button"
          size="xs"
          onClick={(e: MouseEvent) => { e.stopPropagation(); setFilterStrategy(row.original.strategy_id || null); }}
          data-testid={`trade-strategy-filter-${row.original.trade_id}`}
        >
          {row.original.strategy_name || "default"}
        </Anchor>
      ),
    },
    {
      id: "bot_name",
      header: "Bot",
      meta: { align: "left" },
      enableSorting: false,
      cell: ({ row }) => (
        <Anchor
          component="button"
          size="xs"
          onClick={(e: MouseEvent) => { e.stopPropagation(); setFilterBot(row.original.bot_id || null); }}
          data-testid={`trade-bot-filter-${row.original.trade_id}`}
        >
          {row.original.bot_name || "-"}
        </Anchor>
      ),
    },
  ]);

  return (
    <TanStackTable<PaperTrade>
      className="paper-trade-history-table"
      data={sortedTrades()}
      columns={columns()}
      rowWindowSize={120}
      fillContainer
      stickyHeader
      dense
      enableGrouping
      grouping={["date"]}
      initialState={{
        sorting: [{ id: "date", desc: true }],
        expanded: {},
      }}
      getRowCanExpand={() => true}
      renderSubComponent={(trade) => <TradeDetail trade={trade} />}
      renderGroupHeader={({ value, rows, isExpanded }) => (
        <DaySummary date={String(value)} trades={rows} expanded={isExpanded()} />
      )}
      getGroupRowTestId={(value) => `day-group-${String(value)}`}
      getRowTestId={(trade) => `trade-row-${trade.trade_id}`}
      getRowClassName={(trade) =>
        props.selectedTradeId === trade.trade_id ? "trade-row-highlighted" : undefined
      }
      onRowClick={handleSelect}
    />
  );
}

function HistoryList(props: {
  filteredTrades: PaperTrade[];
  state: () => PaperTradingSnapshot;
  handleSelectSymbol: (symbol: string, exitTime?: string, tradeId?: string) => Promise<void>;
}) {
  return (
    <div class="paper-history-list flex-1 min-h-0 flex flex-col overflow-hidden relative" id="history-list">
      <LoadingOverlay visible={props.state().isLoading} zIndex={5} overlayProps={{ radius: "sm", blur: 1 }} className="paper-history-loading-overlay" />
      <Show
        when={!(props.filteredTrades.length === 0 && !props.state().isLoading)}
        fallback={
          <div class="paper-history-empty flex flex-col items-center justify-center gap-2 py-16 flex-1 min-h-[200px] text-center" id="paper-history-empty">
            <Text className="paper-history-empty-text" size="xs" fw={500} c="dimmed">
              No trades found
            </Text>
          </div>
        }
      >
        <div class="flex-1 min-h-0 flex flex-col" style={{ opacity: props.state().isLoading ? 0.6 : 1, transition: "opacity 0.15s" }}>
          <TradeHistoryTable
            trades={props.filteredTrades}
            selectedTradeId={props.state().selectedTradeId}
            onSelectSymbol={props.handleSelectSymbol}
          />
        </div>
      </Show>
    </div>
  );
}

export function PaperHistoryTable() {
  const state = useStoreSnapshot(subscribeToPaperTrading, getPaperTradingState);

  const filteredTrades = createMemo(() => {
    const s = state();
    let trades = [...s.trades];
    if (s.filterSymbol) trades = trades.filter((t) => t.symbol === s.filterSymbol);
    if (s.filterFromDate || s.filterToDate)
      trades = filterByRange(trades, s.filterFromDate, s.filterToDate);
    if (s.filterStrategy) trades = trades.filter((t) => t.strategy_id === s.filterStrategy);
    if (s.filterBot) trades = trades.filter((t) => t.bot_id === s.filterBot);
    const book = s.filterSource;
    if (book && book !== "all") {
      trades = trades.filter((t) => tradeMatchesBook(t, book));
    }
    return trades;
  });

  const strategies = createMemo(() => getUniqueStrategies(state().trades));
  const bots = createMemo(() => getUniqueBots(state().trades));

  const handleSelectSymbol = async (
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
  };

  const loading = () => state().isLoading && state().trades.length === 0;

  return (
    <Show
      when={!loading()}
      fallback={
        <div class="paper-history-loading flex justify-center py-2" data-testid="history-panel" id="history-panel">
          <Group className="paper-history-loading-group" gap="xs">
            <Loader size="sm" />
            <Text className="paper-history-loading-text" size="xs" c="dimmed">
              Loading trade history...
            </Text>
          </Group>
        </div>
      }
    >
      <div class="paper-history-panel flex flex-col h-full flex-1 min-h-0" data-testid="history-panel" id="history-container">
        <HistoryFilters bots={bots()} strategies={strategies()} state={state} />
        <HistoryList
          filteredTrades={filteredTrades()}
          state={state}
          handleSelectSymbol={handleSelectSymbol}
        />
      </div>
    </Show>
  );
}
