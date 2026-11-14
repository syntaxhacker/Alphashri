import { createMemo, Show } from "solid-js";
import { usePolling } from "@/hooks/usePolling";
import { Text, Badge, Loader, ActionIcon } from "@/ui";
import { IconRefresh } from "@/components/common/Icons";
import { useStoreSnapshot } from "./storeSnapshot";
import { getPaperTradingState, subscribe } from "../../state/paperTrading";
import { fetchActivityFeed } from "../../api/paperTrading";
import { formatTimeOnly } from "../../utils/ui-helpers";
import type { ActivityEvent } from "../../types/paperTrading";
import { CompactPanel } from "../common/compact";
import { TanStackTable, type TableColumnDef } from "./TanStackTable";
import * as palette from "@/ui/palette";

export function ActivityFeed() {
  const state = useStoreSnapshot(subscribe, getPaperTradingState);

  usePolling(() => {
    void fetchActivityFeed();
  }, 15000, { immediate: true, skipIfRunning: false });

  const columns = createMemo<TableColumnDef<ActivityEvent>[]>(() => [
    {
      id: "timestamp",
      header: "Time",
      accessorKey: "timestamp",
      size: 72,
      meta: { align: "left" },
      cell: ({ row }) => (
        <Text className="paper-activity-time font-mono tabular-nums" size="xs" c="dimmed" style={{ "font-size": "11px" }}>
          {formatTimeOnly(row.original.timestamp)}
        </Text>
      ),
    },
    {
      id: "type",
      header: "Type",
      size: 72,
      meta: { align: "center" },
      accessorFn: (row: ActivityEvent) => row.type,
      cell: ({ row }) => {
        const ev = row.original;
        const isEntry = ev.type === "entry" || (!ev.exit_price && !!ev.entry_price);
        const isExit = ev.type === "trade_exit" || !!ev.exit_price;
        const pnl = ev.net_pnl ?? ev.pnl ?? 0;
        const isProfit = pnl >= 0;
        const badgeColor = isEntry ? "primary" : isExit ? (isProfit ? "success" : "error") : "secondary";
        const label = isEntry ? "ENTRY" : isExit ? "EXIT" : ev.type.toUpperCase();
        return (
          <Badge className="paper-activity-type" size="xs" color={badgeColor as "primary" | "success" | "error" | "secondary"} variant="light" style={{ "text-transform": "none" }}>
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
      meta: { align: "left" },
      cell: ({ row }) => (
        <Text className="paper-activity-symbol font-mono tabular-nums" fw={600} size="xs" c={palette.PRIMARY} style={{ "font-size": "11px" }}>
          {row.original.symbol}
        </Text>
      ),
    },
    {
      id: "side",
      header: "Side",
      size: 64,
      meta: { align: "center" },
      accessorFn: (row: ActivityEvent) => row.direction || row.side,
      cell: ({ row }) => (
        <Text className="paper-activity-side" size="xs" c="dimmed" style={{ "font-size": "11px" }}>
          {row.original.direction || row.original.side}
        </Text>
      ),
    },
    {
      id: "entry",
      header: "Entry",
      size: 110,
      meta: { align: "right" },
      cell: ({ row }) => {
        const ev = row.original;
        return (
          <Text className="paper-activity-entry font-mono tabular-nums" size="xs" c={palette.TEXT} fw={500} style={{ "font-size": "11px" }}>
            {ev.quantity} @ ₹{ev.entry_price?.toFixed(1) ?? "-"}
          </Text>
        );
      },
    },
    {
      id: "exit",
      header: "Exit",
      size: 96,
      meta: { align: "right" },
      cell: ({ row }) => {
        const ev = row.original;
        const isExit = ev.type === "trade_exit" || !!ev.exit_price;
        return isExit ? (
          <Text className="paper-activity-exit font-mono tabular-nums" size="xs" c={palette.TEXT} fw={600} style={{ "font-size": "11px" }}>
            → ₹{ev.exit_price?.toFixed(1)}
          </Text>
        ) : (
          <Text size="xs" c="dimmed" style={{ "font-size": "11px" }}>
            —
          </Text>
        );
      },
    },
    {
      id: "pnl",
      header: "P&L",
      size: 120,
      meta: { align: "right" },
      accessorFn: (row: ActivityEvent) => row.net_pnl ?? row.pnl ?? 0,
      cell: ({ row }) => {
        const ev = row.original;
        const isExit = ev.type === "trade_exit" || !!ev.exit_price;
        if (!isExit) return <Text size="xs" c="dimmed" style={{ "font-size": "11px" }}>—</Text>;
        const pnl = ev.net_pnl ?? ev.pnl ?? 0;
        const isProfit = pnl >= 0;
        return (
          <Text className="paper-activity-pnl font-mono tabular-nums" size="xs" c={isProfit ? palette.POSITIVE : palette.NEGATIVE} fw={700} style={{ "font-size": "11px" }}>
            {isProfit ? "+" : ""}₹{pnl.toFixed(0)} {ev.pnl_pct != null ? `(${ev.pnl_pct.toFixed(2)}%)` : ""}
          </Text>
        );
      },
    },
    {
      id: "strategy",
      header: "Strategy",
      size: 140,
      meta: { align: "left" },
      accessorKey: "strategy_name",
      cell: ({ row }) =>
        row.original.strategy_name ? (
          <Badge className="paper-activity-strategy" size="xs" variant="outline" color="secondary" style={{ "text-transform": "none" }}>
            {row.original.strategy_name}
          </Badge>
        ) : (
          <Text size="xs" c="dimmed" style={{ "font-size": "11px" }}>
            —
          </Text>
        ),
    },
    {
      id: "reason",
      header: "Reason",
      accessorKey: "exit_reason",
      meta: { align: "left" },
      enableSorting: false,
      cell: ({ row }) => (
        <Text className="paper-activity-reason" size="xs" c="dimmed" style={{ "font-size": "11px" }} truncate>
          {row.original.exit_reason || "—"}
        </Text>
      ),
    },
  ]);

  return (
    <Show
      when={!(state().activityLoading && state().activityEvents.length === 0)}
      fallback={
        <div class="paper-activity-loading flex items-center justify-center" id="paper-activity-loading" style={{ height: "200px" }}>
          <Loader size="sm" />
        </div>
      }
    >
      <div class="paper-activity-feed flex flex-col gap-1 p-1 w-full" id="paper-activity-feed">
        <CompactPanel title="Activity Feed" action={
          <ActionIcon className="paper-activity-refresh" id="paper-activity-refresh" size="sm" variant="subtle" onClick={() => fetchActivityFeed()} aria-label="Refresh activity feed">
            <IconRefresh size={14} />
          </ActionIcon>
        }>
          <div class="paper-activity-table-wrap flex flex-col min-h-0 overflow-hidden bg-fin-surface" id="paper-activity-table-wrap">
            <TanStackTable<ActivityEvent>
              className="paper-activity-table"
              data={state().activityEvents}
              columns={columns()}
              dataTestId="activity-feed-table"
              loading={state().activityLoading}
              emptyMessage="No recent activity. Trades will appear here as they happen."
              stickyHeader
              dense
            />
          </div>
        </CompactPanel>
      </div>
    </Show>
  );
}
