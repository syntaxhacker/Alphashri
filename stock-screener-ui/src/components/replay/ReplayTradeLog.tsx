import { createSignal, createMemo, createEffect } from "solid-js";
import { Text, Select, ScrollArea, Badge, Anchor } from "@/ui";
import type { TableColumnDef } from "../paper-trading/TanStackTable";
import {
  getPnLTextColor,
  formatTimeOnly,
  formatDuration,
} from "../../utils/ui-helpers";
import { TanStackTable } from "../paper-trading/TanStackTable";
import { SideBadge } from "../common/BadgeComponents";
import { alpha } from "@/ui/alpha";
import * as palette from "@/ui/palette";
import type { ReplayTrade } from "../../types/replay";
import { Group, Box } from "../paper-trading/primitives";

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

export function ReplayTradeLog(props: ReplayTradeLogProps) {
  let bottomRef: HTMLDivElement | undefined;
  const [symbolFilter, setSymbolFilter] = createSignal("ALL");

  const strategyOptions = createMemo(() => {
    const names = new Set(props.trades.map((t) => t.strategy));
    return [
      { value: "ALL", label: "All Strategies" },
      ...Array.from(names).sort().map((name) => ({ value: name, label: name })),
    ];
  });

  const symbolOptions = createMemo(() => {
    const symbols = new Set(props.trades.map((t) => t.symbol));
    return [
      { value: "ALL", label: "All Symbols" },
      ...Array.from(symbols).sort().map((s) => ({ value: s, label: s })),
    ];
  });

  const filteredTrades = createMemo(() => {
    let result =
      props.strategyFilter === "ALL" ? props.trades : props.trades.filter((t) => t.strategy === props.strategyFilter);
    if (symbolFilter() !== "ALL") {
      result = result.filter((t) => t.symbol === symbolFilter());
    }
    return result;
  });

  createEffect(() => {
    const running = props.isRunning;
    const count = filteredTrades().length;
    void count;
    if (running && bottomRef) {
      bottomRef.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  });

  const handleRowClick = (trade: ReplayTrade) => {
    props.onTradeClick?.(trade);
  };

  const columns = createMemo<TableColumnDef<ReplayTrade>[]>(() => [
    {
      id: "index",
      header: "#",
      meta: { align: "right" },
      enableSorting: false,
      cell: ({ row }) => <Text size="xs" c="dimmed">{row.index + 1}</Text>,
    },
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      meta: { align: "left" },
      cell: ({ row }) => <Text size="xs" fw={500}>{row.original.symbol}</Text>,
    },
    {
      id: "side",
      header: "Side",
      accessorKey: "side",
      meta: { align: "center" },
      cell: ({ row }) => <SideBadge side={row.original.side} size="xs" />,
    },
    {
      id: "quantity",
      header: "Qty",
      accessorKey: "quantity",
      meta: { align: "right" },
      enableSorting: false,
      cell: ({ row }) => <Text size="xs" ta="center" className="font-mono tabular-nums">{row.original.quantity}</Text>,
    },
    {
      id: "entry_time",
      header: "Entry Time",
      accessorKey: "entry_time",
      meta: { align: "left" },
      cell: ({ row }) => <Text size="xs" className="font-mono tabular-nums">{formatTimeOnly(row.original.entry_time)}</Text>,
    },
    {
      id: "exit_time",
      header: "Exit Time",
      accessorKey: "exit_time",
      meta: { align: "left" },
      cell: ({ row }) => <Text size="xs" className="font-mono tabular-nums">{row.original.exit_time ? formatTimeOnly(row.original.exit_time) : "-"}</Text>,
    },
    {
      id: "hold",
      header: "Hold",
      meta: { align: "right" },
      enableSorting: false,
      cell: ({ row }) => (
        <Text size="xs" c="dimmed" className="font-mono tabular-nums">
          {formatHoldDuration(row.original.entry_time, row.original.exit_time)}
        </Text>
      ),
    },
    {
      id: "entry_price",
      header: "Entry Price",
      accessorKey: "entry_price",
      meta: { align: "right" },
      enableSorting: false,
      cell: ({ row }) => <Text size="xs" ta="right" className="font-mono tabular-nums">{row.original.entry_price.toFixed(2)}</Text>,
    },
    {
      id: "exit_price",
      header: "Exit Price",
      accessorKey: "exit_price",
      meta: { align: "right" },
      enableSorting: false,
      cell: ({ row }) => <Text size="xs" ta="right" className="font-mono tabular-nums">{row.original.exit_price.toFixed(2)}</Text>,
    },
    {
      id: "pnl",
      header: "P&L",
      accessorKey: "pnl",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Text size="xs" fw={500} c={getPnLTextColor(row.original.pnl)} ta="right" className="font-mono tabular-nums">
          {row.original.pnl >= 0 ? "+" : ""}
          {row.original.pnl.toFixed(2)}
        </Text>
      ),
    },
    {
      id: "net_pnl",
      header: "Net",
      accessorKey: "net_pnl",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Text size="xs" fw={500} c={getPnLTextColor(row.original.net_pnl)} ta="right" className="font-mono tabular-nums">
          {row.original.net_pnl >= 0 ? "+" : ""}
          {row.original.net_pnl.toFixed(2)}
        </Text>
      ),
    },
    {
      id: "strategy",
      header: "Strategy",
      meta: { align: "left" },
      enableSorting: false,
      cell: ({ row }) => (
        <Anchor
          component="button"
          size="xs"
          onClick={() => props.setStrategyFilter(row.original.strategy)}
          data-testid={`replay-trade-strategy-link-${row.original.id}`}
        >
          {row.original.strategy}
        </Anchor>
      ),
    },
    {
      id: "exit_reason",
      header: "Reason",
      meta: { align: "center" },
      enableSorting: false,
      cell: ({ row }) => (
        <Badge size="xs" color={getExitBadgeColor(row.original.exit_reason)} variant="filled">
          {row.original.exit_reason}
        </Badge>
      ),
    },
  ]);

  return (
    <Box
      data-testid="replay-trade-log"
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      <Group gap="sm" align="center" mb="xs" style={{ flex: "0 0 auto" }}>
        <Text size="xs" fw={500}>Trade Log</Text>
        <Select
          size="xs"
          w={160}
          data={strategyOptions()}
          value={props.strategyFilter}
          onChange={(v) => props.setStrategyFilter(v ?? "ALL")}
          allowDeselect={false}
          data-testid="replay-trade-log-strategy-filter"
        />
        <Select
          size="xs"
          w={130}
          data={symbolOptions()}
          value={symbolFilter()}
          onChange={(v) => setSymbolFilter(v ?? "ALL")}
          allowDeselect={false}
          data-testid="replay-trade-log-symbol-filter"
        />
        <Text size="xs" c="dimmed" className="font-mono tabular-nums">
          {filteredTrades().length} trade{filteredTrades().length !== 1 ? "s" : ""}
        </Text>
      </Group>

      <ScrollArea style={{ flex: 1 }} h="100%">
        <TanStackTable<ReplayTrade>
          data={filteredTrades()}
          columns={columns()}
          dataTestId="replay-trade-log-table"
          emptyMessage="No trades yet"
          getRowStyle={(row) => ({
            cursor: props.onTradeClick ? "pointer" : undefined,
            backgroundColor:
              props.highlightedTradeId === row.id
                ? alpha(palette.PRIMARY, 0.10)
                : undefined,
          })}
          getRowClassName={(row) =>
            props.highlightedTradeId === row.id ? "trade-row-highlighted" : ""
          }
          getRowTestId={(row) => `replay-trade-row-${row.id}`}
          stickyHeader
          dense
          onRowClick={props.onTradeClick ? handleRowClick : undefined}
        />
        <div ref={bottomRef} />
      </ScrollArea>
    </Box>
  );
}
