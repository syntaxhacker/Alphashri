import { useMemo } from "react";
import { Group, Text, Badge, ActionIcon, Stack } from "@/ui";
import Box from "@mui/material/Box";
import { IconX, IconArrowUp, IconArrowDown } from "@tabler/icons-react";
import type { ColumnDef } from "@tanstack/react-table";
import type { Trade } from "../../types/backtest";
import { formatDateTimeHuman, formatDuration, getPnLTextColor } from "../../utils/ui-helpers";
import { TanStackTable } from "../common/TanStackTable";
import { TINT_LOSS_ROW } from "../../config/colors";

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
        aVal = a.net_pnl_pct || (a.net_pnl / (a.entry_price * a.quantity)) * 100;
        bVal = b.net_pnl_pct || (b.net_pnl / (b.entry_price * b.quantity)) * 100;
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
  onRowClick: (tradeIndex: number) => void;
  onClose: () => void;
}

export function TradeHistoryTable({
  symbol,
  trades,
  sortColumn,
  sortDirection,
  onSort,
  onRowClick,
  onClose,
}: TradeHistoryTableProps) {
  const sortedTrades = useMemo(() => {
    return [...(trades ?? [])].sort((a, b) => {
      let aVal: number | string = 0;
      let bVal: number | string = 0;
      switch (sortColumn) {
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
          aVal = a.net_pnl_pct || (a.net_pnl / (a.entry_price * a.quantity)) * 100;
          bVal = b.net_pnl_pct || (b.net_pnl / (b.entry_price * b.quantity)) * 100;
          break;
        case "hold_duration_minutes": aVal = a.hold_duration_minutes; bVal = b.hold_duration_minutes; break;
        case "exit_reason": aVal = a.exit_reason || ""; bVal = b.exit_reason || ""; break;
        default: return 0;
      }
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDirection === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDirection === "asc"
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  }, [trades, sortColumn, sortDirection]);

  const safeTrades = trades ?? [];
  const { totalPnl, wins, winRate } = useMemo(() => {
    const pnl = safeTrades.reduce((sum, t) => sum + t.net_pnl, 0);
    const w = safeTrades.filter((t) => t.net_pnl > 0).length;
    const wr = safeTrades.length > 0 ? ((w / safeTrades.length) * 100).toFixed(1) : "0";
    return { totalPnl: pnl, wins: w, winRate: wr };
  }, [safeTrades]);
  const has52w =
    (safeTrades[0]?.["52w_high"] !== undefined && safeTrades[0]?.["52w_high"] !== null);

  const getTradeIndex = (trade: Trade) => safeTrades.indexOf(trade);

  const handleHeaderClick = (column: string) => {
    onSort(column);
  };

  const columns = useMemo(() => {
    const cols: ColumnDef<Trade>[] = [
      {
        id: "#",
        header: "#",
        enableSorting: false,
        cell: ({ row }) => <Text size="sm">{getTradeIndex(row.original) + 1}</Text>,
      },
      {
        id: "entry_time",
        header: () => <span onClick={() => handleHeaderClick("entry_time")} style={{ cursor: "pointer" }}>Entry Time</span>,
        accessorKey: "entry_time",
        enableSorting: false,
        cell: ({ row }) => <Text size="sm">{formatDateTimeHuman(row.original.entry_time)}</Text>,
      },
      {
        id: "exit_time",
        header: () => <span onClick={() => handleHeaderClick("exit_time")} style={{ cursor: "pointer" }}>Exit Time</span>,
        accessorKey: "exit_time",
        enableSorting: false,
        cell: ({ row }) => <Text size="sm">{formatDateTimeHuman(row.original.exit_time)}</Text>,
      },
      {
        id: "side",
        header: () => <span onClick={() => handleHeaderClick("side")} style={{ cursor: "pointer" }}>Side</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const side = (row.original as any).side || "LONG";
          return side === "LONG" ? (
            <Text size="sm" c="green"><IconArrowUp size={12} style={{ marginRight: 2 }} />LONG</Text>
          ) : (
            <Text size="sm" c="red"><IconArrowDown size={12} style={{ marginRight: 2 }} />SHORT</Text>
          );
        },
      },
      {
        id: "quantity",
        header: () => <span onClick={() => handleHeaderClick("quantity")} style={{ cursor: "pointer" }}>Qty</span>,
        enableSorting: false,
        cell: ({ row }) => <Text size="sm">{row.original.quantity ?? 0}</Text>,
      },
      {
        id: "entry_price",
        header: () => <span onClick={() => handleHeaderClick("entry_price")} style={{ cursor: "pointer" }}>Entry Price</span>,
        enableSorting: false,
        cell: ({ row }) => <Text size="sm">₹{(row.original.entry_price ?? 0).toFixed(0)}</Text>,
      },
      {
        id: "level_high",
        header: () => <span onClick={() => handleHeaderClick("level_high")} style={{ cursor: "pointer" }}>{has52w ? "52W High" : "Level Hi"}</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const val = row.original.or_high ?? row.original.r1 ?? row.original["52w_high"] ?? 0;
          return <Text size="sm">₹{val.toFixed(2)}</Text>;
        },
      },
    ];

    if (!has52w) {
      cols.push({
        id: "level_low",
        header: () => <span onClick={() => handleHeaderClick("level_low")} style={{ cursor: "pointer" }}>Level Lo</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const val = row.original.or_low ?? row.original.s1 ?? 0;
          return <Text size="sm">₹{val.toFixed(2)}</Text>;
        },
      });
    }

    cols.push(
      {
        id: "exit_price",
        header: () => <span onClick={() => handleHeaderClick("exit_price")} style={{ cursor: "pointer" }}>Exit Price</span>,
        enableSorting: false,
        cell: ({ row }) => <Text size="sm">₹{(row.original.exit_price ?? 0).toFixed(0)}</Text>,
      },
      {
        id: "net_pnl",
        header: () => <span onClick={() => handleHeaderClick("net_pnl")} style={{ cursor: "pointer" }}>P&L</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const val = row.original.net_pnl ?? 0;
          return <Text size="sm" fw={600} c={getPnLTextColor(val)}>₹{val.toFixed(0)}</Text>;
        },
      },
      {
        id: "net_pnl_pct",
        header: () => <span onClick={() => handleHeaderClick("net_pnl_pct")} style={{ cursor: "pointer" }}>%</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const pnlPct = row.original.net_pnl_pct || (row.original.net_pnl / (row.original.entry_price * row.original.quantity)) * 100;
          return <Text size="sm" c={getPnLTextColor(pnlPct)}>{pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%</Text>;
        },
      },
      {
        id: "hold_duration_minutes",
        header: () => <span onClick={() => handleHeaderClick("hold_duration_minutes")} style={{ cursor: "pointer" }}>Hold</span>,
        enableSorting: false,
        cell: ({ row }) => <Text size="sm">{formatDuration(row.original.hold_duration_minutes ?? 0)}</Text>,
      },
      {
        id: "exit_reason",
        header: () => <span onClick={() => handleHeaderClick("exit_reason")} style={{ cursor: "pointer" }}>Type</span>,
        enableSorting: false,
        cell: ({ row }) => {
          const reason = row.original.exit_reason ?? "EOD";
          return (
            <Badge size="sm" color={reason === "TP" ? "green" : reason === "SL" ? "red" : reason === "TRAILING_STOP" ? "orange" : "gray"}>
              {reason}
            </Badge>
          );
        },
      },
    );
    return cols;
  }, [has52w, sortColumn, sortDirection, onSort]);

  if (!trades || trades.length === 0) return null;

  return (
    <Stack
      id="trade-history-table"
      className="trade-history-panel"
      data-testid="trade-history-panel"
      h="100%"
      style={{ minHeight: 0, overflow: "hidden" }}
    >
      <Group justify="space-between" p="sm" flex="0 0 auto" data-testid="trade-history-header">
        <Text fw={600} size="sm">
          📋 {symbol} Trades ({trades.length})
        </Text>
        <ActionIcon variant="subtle" color="gray" size="sm" onClick={onClose} data-testid="close-trade-history-btn" title="Close">
          <IconX size={14} />
        </ActionIcon>
      </Group>

      <Group gap="md" p="xs" data-testid="trade-history-summary">
        <Text size="sm" data-testid="trade-summary-pnl">
          P&L: <Text component="span" fw={600} c={getPnLTextColor(totalPnl)}>₹{totalPnl.toFixed(0)}</Text>
        </Text>
        <Text size="sm" data-testid="trade-summary-wr">WR: {winRate}%</Text>
        <Text size="sm" data-testid="trade-summary-wins">Wins: {wins}/{trades.length}</Text>
      </Group>

      <Box sx={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }} className="trade-history-scroll">
        <TanStackTable<Trade>
          data={sortedTrades}
          columns={columns}
          dataTestId="trade-history-table"
          enableSorting={false}
          getRowStyle={(row) => ({
            backgroundColor: row.net_pnl >= 0 ? undefined : TINT_LOSS_ROW,
          })}
          getRowTestId={(_row, index) => `trade-history-row-${index}`}
          onRowClick={(row) => onRowClick(safeTrades.indexOf(row))}
        />
      </Box>
    </Stack>
  );
}
