import { useEffect, useMemo, memo } from "react";
import { Text, Badge, Loader, Center, ActionIcon } from "@/ui";
import Box from "@mui/material/Box";
import { IconRefresh } from "@tabler/icons-react";
import { useStoreSubscription } from "../../hooks/useStoreSubscription";
import { getPaperTradingState, subscribe } from "../../state/paperTrading";
import { fetchActivityFeed } from "../../api/paperTrading";
import { formatTimeOnly } from "../../utils/ui-helpers";
import type { ActivityEvent } from "../../types/paperTrading";
import { CompactPanel } from "../common/compact";
import { TanStackTable } from "../common/TanStackTable";
import * as palette from "@/ui/palette";
import type { ColumnDef } from "@tanstack/react-table";

export function ActivityFeed() {
  useStoreSubscription(subscribe);
  const state = getPaperTradingState();

  useEffect(() => {
    fetchActivityFeed();
    const interval = setInterval(() => fetchActivityFeed(), 15000);
    return () => clearInterval(interval);
  }, []);

  const columns = useMemo<ColumnDef<ActivityEvent>[]>(
    () => [
      {
        id: "timestamp",
        header: "Time",
        accessorKey: "timestamp",
        size: 72,
        cell: ({ row }) => (
          <Text className="paper-activity-time" size="xs" c="dimmed" sx={{ fontFamily: "monospace", fontSize: 11 }}>
            {formatTimeOnly(row.original.timestamp)}
          </Text>
        ),
      },
      {
        id: "type",
        header: "Type",
        size: 72,
        accessorFn: (row: ActivityEvent) => row.type,
        cell: ({ row }) => {
          const ev = row.original;
          const isEntry = ev.type === "entry" || (!ev.exit_price && ev.entry_price);
          const isExit = ev.type === "trade_exit" || !!ev.exit_price;
          const pnl = ev.net_pnl ?? ev.pnl ?? 0;
          const isProfit = pnl >= 0;
          const badgeColor = isEntry ? "primary" : isExit ? (isProfit ? "success" : "error") : "secondary";
          const label = isEntry ? "ENTRY" : isExit ? "EXIT" : ev.type.toUpperCase();
          return (
            <Badge className="paper-activity-type" size="xs" color={badgeColor as any} variant="light" style={{ textTransform: "none" }}>
              {label}
            </Badge>
          );
        },
      },
      {
        id: "symbol",
        header: "Symbol",
        accessorKey: "symbol",
        size: 88,
        cell: ({ row }) => (
          <Text className="paper-activity-symbol" fw={600} size="xs" c={palette.PRIMARY} sx={{ fontSize: 11 }}>
            {row.original.symbol}
          </Text>
        ),
      },
      {
        id: "side",
        header: "Side",
        size: 64,
        accessorFn: (row: ActivityEvent) => row.direction || row.side,
        cell: ({ row }) => (
          <Text className="paper-activity-side" size="xs" c="dimmed" sx={{ fontSize: 11 }}>
            {row.original.direction || row.original.side}
          </Text>
        ),
      },
      {
        id: "entry",
        header: "Entry",
        size: 110,
        cell: ({ row }) => {
          const ev = row.original;
          return (
            <Text className="paper-activity-entry" size="xs" c={palette.TEXT} fw={500} sx={{ fontSize: 11, fontFamily: "monospace" }}>
              {ev.quantity} @ ₹{ev.entry_price?.toFixed(1) ?? "-"}
            </Text>
          );
        },
      },
      {
        id: "exit",
        header: "Exit",
        size: 96,
        cell: ({ row }) => {
          const ev = row.original;
          const isExit = ev.type === "trade_exit" || !!ev.exit_price;
          return isExit ? (
            <Text className="paper-activity-exit" size="xs" c={palette.TEXT} fw={600} sx={{ fontSize: 11, fontFamily: "monospace" }}>
              → ₹{ev.exit_price?.toFixed(1)}
            </Text>
          ) : (
            <Text size="xs" c="dimmed" sx={{ fontSize: 11 }}>
              —
            </Text>
          );
        },
      },
      {
        id: "pnl",
        header: "P&L",
        size: 120,
        accessorFn: (row: ActivityEvent) => row.net_pnl ?? row.pnl ?? 0,
        cell: ({ row }) => {
          const ev = row.original;
          const isExit = ev.type === "trade_exit" || !!ev.exit_price;
          if (!isExit) return <Text size="xs" c="dimmed" sx={{ fontSize: 11 }}>—</Text>;
          const pnl = ev.net_pnl ?? ev.pnl ?? 0;
          const isProfit = pnl >= 0;
          return (
            <Text className="paper-activity-pnl" size="xs" c={isProfit ? palette.POSITIVE : palette.NEGATIVE} fw={700} sx={{ fontSize: 11 }}>
              {isProfit ? "+" : ""}₹{pnl.toFixed(0)} {ev.pnl_pct != null ? `(${ev.pnl_pct.toFixed(2)}%)` : ""}
            </Text>
          );
        },
      },
      {
        id: "strategy",
        header: "Strategy",
        size: 140,
        accessorKey: "strategy_name",
        cell: ({ row }) =>
          row.original.strategy_name ? (
            <Badge className="paper-activity-strategy" size="xs" variant="outline" color="secondary" style={{ textTransform: "none" }}>
              {row.original.strategy_name}
            </Badge>
          ) : (
            <Text size="xs" c="dimmed" sx={{ fontSize: 11 }}>
              —
            </Text>
          ),
      },
      {
        id: "reason",
        header: "Reason",
        accessorKey: "exit_reason",
        enableSorting: false,
        cell: ({ row }) => (
          <Text className="paper-activity-reason" size="xs" c="dimmed" sx={{ fontSize: 11 }} truncate>
            {row.original.exit_reason || "—"}
          </Text>
        ),
      },
    ],
    [],
  );

  if (state.activityLoading && !state.activityEvents.length) {
    return (
      <Center className="paper-activity-loading" id="paper-activity-loading" h={200}>
        <Loader size="sm" />
      </Center>
    );
  }

  return (
    <Box className="paper-activity-feed" id="paper-activity-feed" sx={{ display: "flex", flexDirection: "column", gap: 1, p: 1, width: "100%" }}>
      <CompactPanel
        title="Activity Feed"
        action={
          <ActionIcon className="paper-activity-refresh" id="paper-activity-refresh" size="sm" variant="subtle" onClick={() => fetchActivityFeed()} aria-label="Refresh activity feed">
            <IconRefresh size={14} />
          </ActionIcon>
        }
      >
        <Box className="paper-activity-table-wrap" id="paper-activity-table-wrap" sx={{ display: "flex", flexDirection: "column", minHeight: 0, border: `1px solid ${palette.BORDER}`, borderRadius: 1, overflow: "hidden", bgcolor: palette.SURFACE }}>
          <TanStackTable<ActivityEvent>
            className="paper-activity-table"
            data={state.activityEvents}
            columns={columns}
            dataTestId="activity-feed-table"
            loading={state.activityLoading}
            emptyMessage="No recent activity. Trades will appear here as they happen."
            stickyHeader
          />
        </Box>
      </CompactPanel>
    </Box>
  );
}
