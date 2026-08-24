import { useRef, useEffect, useMemo, useCallback, useState } from "react";
import { Text, Select, ScrollArea, Group, Badge, Box, Anchor } from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
import {
  getPnLTextColor,
  formatTimeOnly,
  formatDuration,
} from "../../utils/ui-helpers";
import { TanStackTable } from "../common/TanStackTable";
import { SideBadge } from "../common/BadgeComponents";
import type { ReplayTrade } from "../../types/replay";

const EXIT_REASON_COLORS: Record<string, string> = {
  TP: "success",
  SL: "error",
  EOD: "warning",
  FORCE_CLOSE: "secondary",
};

function getExitBadgeColor(reason: string): string {
  return EXIT_REASON_COLORS[reason] ?? "secondary";
}

interface ReplayTradeLogProps {
  trades: ReplayTrade[];
  strategyFilter: string;
  setStrategyFilter: (filter: string) => void;
  isRunning: boolean;
  highlightedTradeId: number | null;
  onTradeClick?: (trade: ReplayTrade) => void;
}

function formatHoldDuration(entryTime: string, exitTime: string): string {
  if (!entryTime || !exitTime) return "-";
  try {
    const entry = new Date(entryTime);
    const exit = new Date(exitTime);
    const diffMs = exit.getTime() - entry.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins <= 0) return "0m";
    return formatDuration(diffMins);
  } catch {
    return "-";
  }
}

export function ReplayTradeLog({
  trades,
  strategyFilter,
  setStrategyFilter,
  isRunning,
  highlightedTradeId,
  onTradeClick,
}: ReplayTradeLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const [symbolFilter, setSymbolFilter] = useState("ALL");

  const strategyOptions = useMemo(() => {
    const names = new Set(trades.map((t) => t.strategy));
    return [
      { value: "ALL", label: "All Strategies" },
      ...Array.from(names).sort().map((name) => ({ value: name, label: name })),
    ];
  }, [trades]);

  const symbolOptions = useMemo(() => {
    const symbols = new Set(trades.map((t) => t.symbol));
    return [
      { value: "ALL", label: "All Symbols" },
      ...Array.from(symbols).sort().map((s) => ({ value: s, label: s })),
    ];
  }, [trades]);

  const filteredTrades = useMemo(() => {
    let result =
      strategyFilter === "ALL" ? trades : trades.filter((t) => t.strategy === strategyFilter);
    if (symbolFilter !== "ALL") {
      result = result.filter((t) => t.symbol === symbolFilter);
    }
    return result;
  }, [trades, strategyFilter, symbolFilter]);

  useEffect(() => {
    if (isRunning && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [filteredTrades.length, isRunning]);

  const handleRowClick = useCallback(
    (trade: ReplayTrade) => {
      if (onTradeClick) {
        onTradeClick(trade);
      }
    },
    [onTradeClick],
  );

  const columns = useMemo<ColumnDef<ReplayTrade>[]>(
    () => [
      {
        id: "index",
        header: "#",
        enableSorting: false,
        cell: ({ row }) => <Text size="xs" c="dimmed">{row.index + 1}</Text>,
      },
      {
        id: "symbol",
        header: "Symbol",
        accessorKey: "symbol",
        cell: ({ row }) => <Text size="xs" fw={500}>{row.original.symbol}</Text>,
      },
      {
        id: "side",
        header: "Side",
        accessorKey: "side",
        cell: ({ row }) => <SideBadge side={row.original.side} size="xs" />,
      },
      {
        id: "quantity",
        header: "Qty",
        accessorKey: "quantity",
        enableSorting: false,
        cell: ({ row }) => <Text size="xs" ta="center">{row.original.quantity}</Text>,
      },
      {
        id: "entry_time",
        header: "Entry Time",
        accessorKey: "entry_time",
        cell: ({ row }) => <Text size="xs">{formatTimeOnly(row.original.entry_time)}</Text>,
      },
      {
        id: "exit_time",
        header: "Exit Time",
        accessorKey: "exit_time",
        cell: ({ row }) => <Text size="xs">{row.original.exit_time ? formatTimeOnly(row.original.exit_time) : "-"}</Text>,
      },
      {
        id: "hold",
        header: "Hold",
        enableSorting: false,
        cell: ({ row }) => (
          <Text size="xs" c="dimmed">
            {formatHoldDuration(row.original.entry_time, row.original.exit_time)}
          </Text>
        ),
      },
      {
        id: "entry_price",
        header: "Entry Price",
        accessorKey: "entry_price",
        enableSorting: false,
        cell: ({ row }) => <Text size="xs" ta="right">{row.original.entry_price.toFixed(2)}</Text>,
      },
      {
        id: "exit_price",
        header: "Exit Price",
        accessorKey: "exit_price",
        enableSorting: false,
        cell: ({ row }) => <Text size="xs" ta="right">{row.original.exit_price.toFixed(2)}</Text>,
      },
      {
        id: "pnl",
        header: "P&L",
        accessorKey: "pnl",
        cell: ({ row }) => (
          <Text size="xs" fw={500} c={getPnLTextColor(row.original.pnl)} ta="right">
            {row.original.pnl >= 0 ? "+" : ""}
            {row.original.pnl.toFixed(2)}
          </Text>
        ),
      },
      {
        id: "net_pnl",
        header: "Net",
        accessorKey: "net_pnl",
        cell: ({ row }) => (
          <Text size="xs" fw={500} c={getPnLTextColor(row.original.net_pnl)} ta="right">
            {row.original.net_pnl >= 0 ? "+" : ""}
            {row.original.net_pnl.toFixed(2)}
          </Text>
        ),
      },
      {
        id: "strategy",
        header: "Strategy",
        enableSorting: false,
        cell: ({ row }) => (
          <Anchor
            component="button"
            size="xs"
            onClick={() => setStrategyFilter(row.original.strategy)}
            data-testid={`replay-trade-strategy-link-${row.original.id}`}
          >
            {row.original.strategy}
          </Anchor>
        ),
      },
      {
        id: "exit_reason",
        header: "Reason",
        enableSorting: false,
        cell: ({ row }) => (
          <Badge size="xs" color={getExitBadgeColor(row.original.exit_reason)} variant="light">
            {row.original.exit_reason}
          </Badge>
        ),
      },
    ],
    [setStrategyFilter],
  );

  return (
    <Box
      data-testid="replay-trade-log"
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      <Group gap="sm" mb="xs" style={{ flex: "0 0 auto" }}>
        <Text size="xs" fw={500}>Trade Log</Text>
        <Select
          size="xs"
          w={160}
          data={strategyOptions}
          value={strategyFilter}
          onChange={(v) => setStrategyFilter(v ?? "ALL")}
          allowDeselect={false}
          data-testid="replay-trade-log-strategy-filter"
        />
        <Select
          size="xs"
          w={130}
          data={symbolOptions}
          value={symbolFilter}
          onChange={(v) => setSymbolFilter(v ?? "ALL")}
          allowDeselect={false}
          data-testid="replay-trade-log-symbol-filter"
        />
        <Text size="xs" c="dimmed">
          {filteredTrades.length} trade{filteredTrades.length !== 1 ? "s" : ""}
        </Text>
      </Group>

      <ScrollArea style={{ flex: 1 }} h="100%">
        <TanStackTable<ReplayTrade>
          data={filteredTrades}
          columns={columns}
          dataTestId="replay-trade-log-table"
          emptyMessage="No trades yet"
          getRowStyle={(row) => ({
            cursor: onTradeClick ? "pointer" : undefined,
            backgroundColor:
              highlightedTradeId === row.id
                ? "primary.light"
                : undefined,
          })}
          getRowClassName={(row) =>
            highlightedTradeId === row.id ? "trade-row-highlighted" : ""
          }
          getRowTestId={(row) => `replay-trade-row-${row.id}`}
          onRowClick={onTradeClick ? handleRowClick : undefined}
        />
        <div ref={bottomRef} />
      </ScrollArea>
    </Box>
  );
}
