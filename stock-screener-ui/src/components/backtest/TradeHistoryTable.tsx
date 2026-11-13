import { createSignal, createMemo, Show } from "solid-js";
import { Text, Badge, ActionIcon, Button, Select, SegmentedControl, Stack } from "@/ui";
import { IconX, IconArrowUp, IconArrowDown, IconDownload, IconFilterOff } from "@/components/common/Icons";
import type { TableColumnDef } from "../paper-trading/TanStackTable";
import type { Trade } from "../../types/backtest";
import { formatDateTimeHuman, formatDuration, getPnLTextColor } from "../../utils/ui-helpers";
import { TINT_LOSS_ROW } from "../../config/colors";
import * as palette from "@/ui/palette";
import { TanStackTable } from "../paper-trading/TanStackTable";
import { DEFAULT_TRADE_FILTERS, filterTrades, tradeReason, type TradeFilters } from "./tradeFilters";
/** Safe net P&L % — guards against zero entry_price/quantity. */
export function tradePnlPct(t: Trade): number {
  if (t.net_pnl_pct) return t.net_pnl_pct;
  const denom = (t.entry_price ?? 0) * (t.quantity ?? 0);
  if (!denom) return 0;
  const pct = (t.net_pnl / denom) * 100;
  return Number.isFinite(pct) ? pct : 0;
}

export function sortTrades(trades: Trade[], column: string, direction: "asc" | "desc"): Trade[] {
  return [...trades].sort((a, b) => {
    let aVal: number | string = 0;
    let bVal: number | string = 0;

    switch (column) {
      case "entry_time":
        aVal = a.entry_time || "";
        bVal = b.entry_time || "";
        break;
      case "exit_time":
        aVal = a.exit_time || "";
        bVal = b.exit_time || "";
        break;
      case "side":
        aVal = (a as any).side || "LONG";
        bVal = (b as any).side || "LONG";
        break;
      case "quantity":
        aVal = a.quantity;
        bVal = b.quantity;
        break;
      case "entry_price":
        aVal = a.entry_price;
        bVal = b.entry_price;
        break;
      case "exit_price":
        aVal = a.exit_price;
        bVal = b.exit_price;
        break;
      case "level_high":
        aVal = a.or_high ?? a.r1 ?? a["52w_high"] ?? a["52w_high_entry"] ?? 0;
        bVal = b.or_high ?? b.r1 ?? b["52w_high"] ?? b["52w_high_entry"] ?? 0;
        break;
      case "level_low":
        aVal = a.or_low ?? a.s1 ?? 0;
        bVal = b.or_low ?? b.s1 ?? 0;
        break;
      case "net_pnl":
        aVal = a.net_pnl;
        bVal = b.net_pnl;
        break;
      case "net_pnl_pct":
        aVal = tradePnlPct(a);
        bVal = tradePnlPct(b);
        break;
      case "hold_duration_minutes":
        aVal = a.hold_duration_minutes;
        bVal = b.hold_duration_minutes;
        break;
      case "exit_reason":
        aVal = a.exit_reason || "";
        bVal = b.exit_reason || "";
        break;
      default:
        return 0;
    }

    if (typeof aVal === "string" && typeof bVal === "string") {
      return direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
    }

    return direction === "asc"
      ? (aVal as number) - (bVal as number)
      : (bVal as number) - (aVal as number);
  });
}

interface TradeHistoryTableProps {
  symbol: string;
  trades: Trade[];
  sortColumn: string;
  sortDirection: "asc" | "desc";
  onSort: (column: string) => void;
  /** Called with the 1-based trade number (stable across sorting). */
  onRowClick: (tradeNumber: number) => void;
  onClose: () => void;
  /** Optional controlled filter state — when omitted the table manages its own. */
  filters?: TradeFilters;
  onFiltersChange?: (filters: TradeFilters) => void;
}

export function TradeHistoryTable(props: TradeHistoryTableProps) {
  const [internalFilters, setInternalFilters] = createSignal<TradeFilters>(DEFAULT_TRADE_FILTERS);
  const isControlled = () => props.filters !== undefined;
  const active = () => (isControlled() ? props.filters! : internalFilters());
  const setFilters = (next: TradeFilters) => {
    if (!isControlled()) setInternalFilters(next);
    props.onFiltersChange?.(next);
  };
  const sideFilter = () => active().side;
  const resultFilter = () => active().result;
  const reasonFilter = () => active().reason;

  const safeTrades = () => props.trades ?? [];

  const reasons = createMemo(() =>
    Array.from(new Set(safeTrades().map((t) => tradeReason(t)))).sort(),
  );

  const filteredTrades = createMemo(() => filterTrades(safeTrades(), active()));

  const filtersActive = () => sideFilter() !== "ALL" || resultFilter() !== "ALL" || reasonFilter() !== "ALL";

  const sortedTrades = createMemo(() => {
    return [...filteredTrades()].sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;
      switch (props.sortColumn) {
        case "entry_time": aVal = a.entry_time || ""; bVal = b.entry_time || ""; break;
        case "exit_time": aVal = a.exit_time || ""; bVal = b.exit_time || ""; break;
        case "side": aVal = (a as any).side || "LONG"; bVal = (b as any).side || "LONG"; break;
        case "quantity": aVal = a.quantity; bVal = b.quantity; break;
        case "entry_price": aVal = a.entry_price; bVal = b.entry_price; break;
        case "exit_price": aVal = a.exit_price; bVal = b.exit_price; break;
        case "level_high":
          aVal = a.or_high ?? a.r1 ?? a["52w_high"] ?? 0;
          bVal = b.or_high ?? b.r1 ?? b["52w_high"] ?? 0;
          break;
        case "level_low":
          aVal = a.or_low ?? a.s1 ?? 0;
          bVal = b.or_low ?? b.s1 ?? 0;
          break;
        case "net_pnl": aVal = a.net_pnl; bVal = b.net_pnl; break;
        case "net_pnl_pct":
          aVal = tradePnlPct(a);
          bVal = tradePnlPct(b);
          break;
        case "hold_duration_minutes": aVal = a.hold_duration_minutes; bVal = b.hold_duration_minutes; break;
        case "exit_reason": aVal = a.exit_reason || ""; bVal = b.exit_reason || ""; break;
        default: return 0;
      }
      if (typeof aVal === "string" && typeof bVal === "string") {
        return props.sortDirection === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return props.sortDirection === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  });

  const summary = createMemo(() => {
    const pnl = filteredTrades().reduce((sum, t) => sum + t.net_pnl, 0);
    const w = filteredTrades().filter((t) => t.net_pnl > 0).length;
    const wr = filteredTrades().length > 0 ? ((w / filteredTrades().length) * 100).toFixed(1) : "0";
    return { totalPnl: pnl, wins: w, winRate: wr };
  });

  const has52w = () => safeTrades().some(
    (t) => t["52w_high"] !== undefined && t["52w_high"] !== null,
  );

  // Stable 1-based trade numbers by original (unsorted) order. A Map keyed by the
  // trade object avoids `indexOf` stale-closure bugs when the list identity changes.
  const numberByTrade = createMemo(() => {
    const m = new Map<Trade, number>();
    safeTrades().forEach((t, i) => m.set(t, i + 1));
    return m;
  });
  const numberOf = (trade: Trade) => numberByTrade().get(trade) ?? 1;

  const exportCsv = () => {
    const headers = ["#", "Entry Time", "Exit Time", "Side", "Qty", "Entry Price", "Level Hi", "Level Lo", "Exit Price", "P&L", "P&L %", "Hold (min)", "Type"];
    const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [headers.join(",")];
    for (const t of sortedTrades()) {
      const levelHi = (t as any).or_high ?? (t as any).r1 ?? t["52w_high"] ?? "";
      const levelLo = (t as any).or_low ?? (t as any).s1 ?? "";
      const pct = tradePnlPct(t);
      lines.push([
        numberOf(t), t.entry_time, t.exit_time, (t as any).side ?? "LONG", t.quantity,
        t.entry_price, levelHi, levelLo, t.exit_price, t.net_pnl,
        Number.isFinite(pct) ? pct.toFixed(2) : "", t.hold_duration_minutes ?? 0, t.exit_reason,
      ].map(esc).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${props.symbol}_trades.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleHeaderClick = (column: string) => {
    props.onSort(column);
  };

  const columns = createMemo<TableColumnDef<Trade>[]>(() => {
    const cols: TableColumnDef<Trade>[] = [
      {
        id: "#",
        header: "#",
        enableSorting: false,
        meta: { align: "center" },
        cell: ({ row }) => <div class="flex items-center justify-center"><Text size="xs" ta="center">{numberOf(row.original)}</Text></div>,
      },
      {
        id: "entry_time",
        header: () => <div class="flex items-center justify-center"><span onClick={() => handleHeaderClick("entry_time")} style={{ cursor: "pointer" }}>Entry Time</span></div>,
        accessorKey: "entry_time",
        enableSorting: false,
        meta: { align: "center" },
        cell: ({ row }) => <div class="flex items-center justify-center"><Text size="xs" ta="center" className="font-mono tabular-nums">{formatDateTimeHuman(row.original.entry_time)}</Text></div>,
      },
      {
        id: "exit_time",
        header: () => <div class="flex items-center justify-center"><span onClick={() => handleHeaderClick("exit_time")} style={{ cursor: "pointer" }}>Exit Time</span></div>,
        accessorKey: "exit_time",
        enableSorting: false,
        meta: { align: "center" },
        cell: ({ row }) => <div class="flex items-center justify-center"><Text size="xs" ta="center" className="font-mono tabular-nums">{formatDateTimeHuman(row.original.exit_time)}</Text></div>,
      },
      {
        id: "side",
        header: () => <div class="flex items-center justify-center"><span onClick={() => handleHeaderClick("side")} style={{ cursor: "pointer" }}>Side</span></div>,
        enableSorting: false,
        meta: { align: "center" },
        cell: ({ row }) => {
          const side = (row.original as any).side || "LONG";
          return <div class="flex items-center justify-center">{side === "LONG" ? (
            <Text size="xs" c="success" ta="center"><IconArrowUp size={12} style={{ "margin-right": "2px" }} />LONG</Text>
          ) : (
            <Text size="xs" c="error" ta="center"><IconArrowDown size={12} style={{ "margin-right": "2px" }} />SHORT</Text>
          )}</div>;
        },
      },
      {
        id: "quantity",
        header: () => <div class="flex items-center justify-center"><span onClick={() => handleHeaderClick("quantity")} style={{ cursor: "pointer" }}>Qty</span></div>,
        enableSorting: false,
        meta: { align: "center" },
        cell: ({ row }) => <div class="flex items-center justify-center"><Text size="xs" ta="center" className="font-mono tabular-nums">{row.original.quantity ?? 0}</Text></div>,
      },
      {
        id: "entry_price",
        header: () => <div class="flex items-center justify-center"><span onClick={() => handleHeaderClick("entry_price")} style={{ cursor: "pointer" }}>Entry Price</span></div>,
        enableSorting: false,
        meta: { align: "center" },
        cell: ({ row }) => <div class="flex items-center justify-center"><Text size="xs" ta="center" className="font-mono tabular-nums">₹{(row.original.entry_price ?? 0).toFixed(0)}</Text></div>,
      },
      {
        id: "level_high",
        header: () => <div class="flex items-center justify-center"><span onClick={() => handleHeaderClick("level_high")} style={{ cursor: "pointer" }}>{has52w() ? "52W High" : "Level Hi"}</span></div>,
        enableSorting: false,
        meta: { align: "center" },
        cell: ({ row }) => {
          const val = row.original.or_high ?? row.original.r1 ?? row.original["52w_high"] ?? 0;
          return <div class="flex items-center justify-center"><Text size="xs" ta="center" className="font-mono tabular-nums">₹{val.toFixed(2)}</Text></div>;
        },
      },
    ];

    if (!has52w()) {
      cols.push({
        id: "level_low",
        header: () => <div class="flex items-center justify-center"><span onClick={() => handleHeaderClick("level_low")} style={{ cursor: "pointer" }}>Level Lo</span></div>,
        enableSorting: false,
        meta: { align: "center" },
        cell: ({ row }) => {
          const val = row.original.or_low ?? row.original.s1 ?? 0;
          return <div class="flex items-center justify-center"><Text size="xs" ta="center" className="font-mono tabular-nums">₹{val.toFixed(2)}</Text></div>;
        },
      });
    }

    cols.push(
      {
        id: "exit_price",
        header: () => <div class="flex items-center justify-center"><span onClick={() => handleHeaderClick("exit_price")} style={{ cursor: "pointer" }}>Exit Price</span></div>,
        enableSorting: false,
        meta: { align: "center" },
        cell: ({ row }) => <div class="flex items-center justify-center"><Text size="xs" ta="center" className="font-mono tabular-nums">₹{(row.original.exit_price ?? 0).toFixed(0)}</Text></div>,
      },
      {
        id: "net_pnl",
        header: () => <div class="flex items-center justify-center"><span onClick={() => handleHeaderClick("net_pnl")} style={{ cursor: "pointer" }}>P&L</span></div>,
        enableSorting: false,
        meta: { align: "center" },
        cell: ({ row }) => {
          const val = row.original.net_pnl ?? 0;
          return <div class="flex items-center justify-center"><Text size="xs" fw={600} c={getPnLTextColor(val)} ta="center" data-pnl-sign={val >= 0 ? "pos" : "neg"} className="font-mono tabular-nums">₹{val.toFixed(0)}</Text></div>;
        },
      },
      {
        id: "net_pnl_pct",
        header: () => <div class="flex items-center justify-center"><span onClick={() => handleHeaderClick("net_pnl_pct")} style={{ cursor: "pointer" }}>%</span></div>,
        enableSorting: false,
        meta: { align: "center" },
        cell: ({ row }) => {
          const pnlPct = tradePnlPct(row.original);
          return <div class="flex items-center justify-center"><Text size="xs" c={getPnLTextColor(pnlPct)} ta="center" className="font-mono tabular-nums">{pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%</Text></div>;
        },
      },
      {
        id: "hold_duration_minutes",
        header: () => <div class="flex items-center justify-center"><span onClick={() => handleHeaderClick("hold_duration_minutes")} style={{ cursor: "pointer" }}>Hold</span></div>,
        enableSorting: false,
        meta: { align: "center" },
        cell: ({ row }) => <div class="flex items-center justify-center"><Text size="xs" ta="center" className="font-mono tabular-nums">{formatDuration(row.original.hold_duration_minutes ?? 0)}</Text></div>,
      },
      {
        id: "exit_reason",
        header: () => <div class="flex items-center justify-center"><span onClick={() => handleHeaderClick("exit_reason")} style={{ cursor: "pointer" }}>Type</span></div>,
        enableSorting: false,
        meta: { align: "center" },
        cell: ({ row }) => {
          const reason = row.original.exit_reason ?? "EOD";
          return (
            <div class="flex items-center justify-center">
              <Badge size="xs" variant="filled" color={reason === "TP" ? "success" : reason === "SL" ? "error" : reason === "TRAILING_STOP" ? "warning" : "secondary"}>
                {reason}
              </Badge>
            </div>
          );
        },
      },
    );
    return cols;
  });

  const totalPnl = () => summary().totalPnl;
  const winRate = () => summary().winRate;
  const wins = () => summary().wins;

  return (
    <Show when={!!props.trades && props.trades.length > 0}>
      <Stack
        id="trade-history-table"
        className="trade-history-panel min-h-0 overflow-hidden p-0"
        data-testid="trade-history-panel"
        h="100%"
        style={{ "min-height": 0, gap: 0 }}
      >
        <Stack
          direction="row"
          align="center"
          spacing={1}
          px={1}
          py="3px"
          data-testid="trade-history-header"
          style={{ flex: "0 0 auto", "border-bottom": `1px solid ${palette.BORDER_COLOR}` }}
        >
          <Text size="xs" c="dimmed" style={{ "white-space": "nowrap", "font-weight": 600 }}>
            {props.symbol} Trades ({props.trades.length})
          </Text>
          <div class="flex-1" />
          <Button size="xs" variant="subtle" color="secondary" onClick={exportCsv} leftSection={<IconDownload size={11} />} data-testid="export-trades-csv">
            CSV
          </Button>
          <ActionIcon variant="subtle" color="secondary" size="xs" onClick={props.onClose} data-testid="close-trade-history-btn" title="Close">
            <IconX size={12} />
          </ActionIcon>
        </Stack>

        <Stack
          direction="row"
          align="center"
          spacing={2}
          px={1}
          py="5px"
          data-testid="trade-history-summary"
          style={{ flex: "0 0 auto", "border-bottom": `1px solid ${palette.BORDER_COLOR}` }}
        >
          <Stack direction="row" spacing={0.5} align="baseline">
            <Text size="xs" c="dimmed">P&L</Text>
            <Text size="sm" fw={700} c={getPnLTextColor(totalPnl())} data-testid="trade-summary-pnl" style={{ "font-variant-numeric": "tabular-nums" }} className="font-mono">
              {`₹${totalPnl().toFixed(0)}`}
            </Text>
          </Stack>
          <Stack direction="row" spacing={0.5} align="baseline">
            <Text size="xs" c="dimmed">WR</Text>
            <Text size="sm" fw={700} data-testid="trade-summary-wr" style={{ "font-variant-numeric": "tabular-nums" }} className="font-mono">{winRate()}%</Text>
          </Stack>
          <Text size="xs" c="dimmed" data-testid="trade-summary-wins" className="font-mono tabular-nums">Wins: {wins()}/{filteredTrades().length}</Text>
        </Stack>

        <Stack
          direction="row"
          align="center"
          spacing={1}
          px={1}
          py="4px"
          data-testid="trade-history-filters"
          className="flex-wrap"
          style={{ flex: "0 0 auto", "border-bottom": `1px solid ${palette.BORDER_COLOR}`, "row-gap": "4px" }}
        >
          <SegmentedControl
            size="xs"
            value={sideFilter()}
            onChange={(v) => setFilters({ ...active(), side: v })}
            data={[
              { value: "ALL", label: "All" },
              { value: "LONG", label: "Long" },
              { value: "SHORT", label: "Short" },
            ]}
            data-testid="filter-side"
          />
          <SegmentedControl
            size="xs"
            value={resultFilter()}
            onChange={(v) => setFilters({ ...active(), result: v })}
            data={[
              { value: "ALL", label: "All" },
              { value: "WIN", label: "Win" },
              { value: "LOSS", label: "Loss" },
            ]}
            data-testid="filter-result"
          />
          <div class="flex items-center gap-[4px]">
            <Select
              size="xs"
              value={reasonFilter()}
              onChange={(value) => setFilters({ ...active(), reason: value as string })}
              data={[{ value: "ALL", label: "All types" }, ...reasons().map((r) => ({ value: r, label: r }))]}
              w={110}
              data-testid="filter-reason"
            />
          </div>
          <Text size="xs" c="dimmed" data-testid="filter-count" style={{ "font-variant-numeric": "tabular-nums" }} className="font-mono">
            {filteredTrades().length}/{props.trades.length}
          </Text>
          <Show when={filtersActive()}>
            <ActionIcon
              variant="subtle"
              color="secondary"
              size="xs"
              onClick={() => setFilters(DEFAULT_TRADE_FILTERS)}
              data-testid="filter-clear"
              title="Clear filters"
            >
              <IconFilterOff size={12} />
            </ActionIcon>
          </Show>
        </Stack>

        <div class="flex-1 min-h-0 min-w-0 overflow-auto flex flex-col trade-history-scroll">
          <Show
            when={sortedTrades().length > 0}
            fallback={
              <div class="flex-1 flex items-center justify-center py-3">
                <Text size="xs" c="dimmed">No trades match the current filters.</Text>
              </div>
            }
          >
            <TanStackTable<Trade>
              data={sortedTrades()}
              columns={columns()}
              dataTestId="trade-history-table"
              enableSorting={false}
              getRowStyle={(row) => ({
                backgroundColor: row.net_pnl >= 0 ? undefined : TINT_LOSS_ROW,
              })}
              getRowTestId={(_row, index) => `trade-history-row-${index}`}
              getRowAttributes={(trade) => ({ "data-trade-number": numberOf(trade) })}
              onRowClick={(row) => props.onRowClick(numberOf(row))}
            />
          </Show>
        </div>
      </Stack>
    </Show>
  );
}
