import { createSignal, createMemo, Show } from "solid-js";
import { alpha } from "@/ui/alpha";
import { ActionIcon, Badge, Checkbox, MultiSelect, ScrollArea, SegmentedControl, Text, TextInput, ToolbarRow, Tooltip } from "@/ui";
import type { TableColumnDef } from "./TanStackTable";
import { IconRefresh, IconSparkles } from "@/components/common/Icons";
import { TanStackTable } from "./TanStackTable";
import { SideBadge } from "../common";
import { ClickableSymbolSolid } from "./ClickableSymbolSolid";
import { getPaperTradingState, setSelectedSymbol, setSelectedTradeId } from "../../state/paperTrading";
import { fetchPaperChart } from "../../api/paperTrading";
import { formatTimeAgo } from "../../utils/ui-helpers";
import type { PaperScanItem, PaperBotSnapshot } from "../../types/paperTrading";
import { nearBreakoutPct } from "./PositionsHelpers";
import * as palette from "@/ui/palette";
import { Group, Stack } from "./primitives";

interface WatchlistScan2Props {
  snapshot: PaperBotSnapshot | null;
  selectedSymbol: string | null;
  onRefresh?: () => void;
  refreshing?: boolean;
}

const STATUS_ORDER: Record<string, number> = {
  signal: 0,
  watching: 1,
  rejected: 2,
  skipped: 3,
};

const STATUS_BORDER_COLOR: Record<string, string> = {
  signal: palette.POSITIVE,
  watching: palette.WARNING,
  rejected: palette.NEGATIVE,
  skipped: palette.BORDER,
};

function isNewSignal(item: PaperScanItem, snapshotTs: string | null) {
  const ts = item.timestamp || snapshotTs;
  if (!ts) return false;
  const diffMs = Date.now() - new Date(ts).getTime();
  return diffMs >= 0 && diffMs < 60_000;
}

interface ScanRow extends PaperScanItem {
  statusRank: number;
  age: number;
}

export function WatchlistScan2(props: WatchlistScan2Props) {
  const [statusFilter, setStatusFilter] = createSignal<"all" | "signal" | "watching" | "rejected">("all");
  const [strategyFilter, setStrategyFilter] = createSignal<string[]>([]);
  const [symbolQuery, setSymbolQuery] = createSignal("");
  const [showSkipped, setShowSkipped] = createSignal(false);

  const handleSelectSymbol = async (item: PaperScanItem) => {
    setSelectedSymbol(item.symbol);
    const strategyId = item.strategy_id ?? null;
    setSelectedTradeId(null, undefined, strategyId);
    const currentState = getPaperTradingState();
    await fetchPaperChart(
      item.symbol,
      undefined,
      currentState.chartTimeframe,
      strategyId,
    );
  };

  const allItems = createMemo(() => props.snapshot?.scan_items || []);

  const strategyOptions = createMemo(() => {
    const names = new Set<string>();
    for (const i of allItems()) {
      if (i.strategy_name) names.add(i.strategy_name);
    }
    return Array.from(names)
      .sort()
      .map((n) => ({ value: n, label: n }));
  });

  const scanTime = () => props.snapshot?.timestamp ? formatTimeAgo(props.snapshot.timestamp) : "-";

  const visibleItems = createMemo<ScanRow[]>(() => {
    let rows: ScanRow[] = allItems().map((item) => ({
      ...item,
      statusRank: STATUS_ORDER[item.status] ?? 99,
      age: item.timestamp ? new Date(item.timestamp).getTime() : 0,
    }));

    rows = rows.filter((r) => {
      if (r.status === "skipped") return showSkipped();
      return statusFilter() === "all" || statusFilter() === r.status;
    });

    if (strategyFilter().length > 0) {
      rows = rows.filter((r) => strategyFilter().includes(r.strategy_name || ""));
    }

    const q = symbolQuery().trim().toUpperCase();
    if (q) {
      rows = rows.filter((r) => r.symbol.toUpperCase().includes(q));
    }

    return rows.sort((a, b) => {
      if (a.statusRank !== b.statusRank) return a.statusRank - b.statusRank;
      return b.age - a.age;
    });
  });

  const counts = createMemo(() => ({
    signal: allItems().filter((i) => i.status === "signal").length,
    watching: allItems().filter((i) => i.status === "watching").length,
    rejected: allItems().filter((i) => i.status === "rejected").length,
    skipped: allItems().filter((i) => i.status === "skipped").length,
  }));

  const statusControlData = createMemo(() => [
    { value: "signal", label: `Signals (${counts().signal})` },
    { value: "watching", label: `Watching (${counts().watching})` },
    { value: "rejected", label: `Rejected (${counts().rejected})` },
  ]);

  const emptyMessage = createMemo(() => {
    if (counts().skipped > 0 && !showSkipped()) {
      return `${counts().skipped} skipped`;
    }
    return "No items";
  });

  const columns = createMemo<TableColumnDef<ScanRow>[]>(() => [
    {
      id: "symbol",
      header: "Symbol",
      accessorKey: "symbol",
      meta: { align: "left" } as any,
      cell: (info) => {
        const row = info.row.original;
        return (
          <Group gap="xs" wrap="nowrap" className="gap-1">
            <ClickableSymbolSolid symbol={row.symbol} />
            <Show when={row.source === "custom"}>
              <Badge size="xs" variant="light" color="secondary">Custom</Badge>
            </Show>
            <Show when={isNewSignal(row, props.snapshot?.timestamp ?? null)}>
              <Tooltip label="New (< 1 min)">
                <IconSparkles size={12} color={palette.POSITIVE} />
              </Tooltip>
            </Show>
          </Group>
        );
      },
    },
    {
      id: "side",
      header: "Side",
      accessorKey: "side",
      meta: { align: "center" } as any,
      cell: (info) => {
        const side = info.row.original.side;
        return side ? <SideBadge side={side} /> : <Text size="xs">-</Text>;
      },
    },
    {
      id: "price",
      header: "Price",
      accessorKey: "price",
      meta: { align: "right" } as any,
      cell: (info) => {
        const val = info.row.original.price;
        return <Text size="xs" className="font-mono tabular-nums">{val ? `₹${val.toFixed(2)}` : "-"}</Text>;
      },
    },
    {
      id: "near",
      header: "Near",
      accessorKey: "symbol",
      meta: { align: "right" } as any,
      cell: (info) => {
        const row = info.row.original;
        const near = nearBreakoutPct(row);
        const nearText = Number.isFinite(near) && near < 9999 ? `${near.toFixed(2)}%` : "-";
        return (
          <Text size="xs" c={row.status === "watching" ? "warning" : "dimmed"} className="font-mono tabular-nums">
            {nearText}
          </Text>
        );
      },
    },
    {
      id: "strategy",
      header: "Strategy",
      accessorKey: "strategy_name",
      meta: { align: "left" } as any,
      cell: (info) => {
        const val = info.row.original.strategy_name;
        return (
          <Badge variant="outline" color="primary" size="xs">
            {val || "-"}
          </Badge>
        );
      },
    },
    {
      id: "age",
      header: "Age",
      accessorKey: "timestamp",
      meta: { align: "right" } as any,
      cell: (info) => {
        const val = info.row.original.timestamp;
        return <Text size="xs" c="dimmed" className="font-mono tabular-nums">{val ? formatTimeAgo(val) : "-"}</Text>;
      },
    },
    {
      id: "notes",
      header: "Notes",
      accessorKey: "reason",
      meta: { align: "left" } as any,
      cell: (info) => {
        const val = info.row.original.reason;
        return (
          <Tooltip label={val || "-"} multiline>
            <Text size="xs" c="dimmed" truncate>
              {val || "-"}
            </Text>
          </Tooltip>
        );
      },
    },
  ]);

  const emptyHeader = () => (
    <>
      <Group justify="space-between" className="px-2 py-1">
        <Group gap="xs" className="gap-1">
          <Text fw={600} size="xs" c="dimmed" className="uppercase">
            Watchlist Scan
          </Text>
          <Badge size="xs" variant="outline" color="warning">
            No data
          </Badge>
        </Group>
        <Group gap="xs" className="gap-1">
          <Show when={props.onRefresh}>
            <ActionIcon size="sm" variant="subtle" onClick={props.onRefresh} loading={props.refreshing} data-testid="watchlist-refresh">
              <IconRefresh size={12} />
            </ActionIcon>
          </Show>
          <Text size="xs" c="dimmed">
            updated {scanTime()}
          </Text>
        </Group>
      </Group>
      <Text size="xs" c="warning" className="italic text-center">
        No recent scan results — bot may be idle, stopped, or rate-limited
      </Text>
    </>
  );

  return (
    <Show
      when={props.snapshot && allItems().length > 0}
      fallback={
        <Stack className="gap-1" data-testid="watchlist-scan-card" id="watchlist-scan">
          {emptyHeader()}
        </Stack>
      }
    >
      <Stack className="gap-1" data-testid="watchlist-scan-card" id="watchlist-scan">
        <Group justify="space-between" className="px-2 py-1" wrap="nowrap">
          <Group gap="xs" className="gap-1">
            <Text fw={600} size="xs" c="dimmed" className="uppercase">
              Watchlist Scan
            </Text>
            <Badge size="xs" variant="filled" color="info" data-testid="watchlist-count">
              {allItems().length}
            </Badge>
          </Group>
          <Group gap="xs" className="gap-1">
            <Show when={props.onRefresh}>
              <ActionIcon size="sm" variant="subtle" onClick={props.onRefresh} loading={props.refreshing} data-testid="watchlist-refresh">
                <IconRefresh size={12} />
              </ActionIcon>
            </Show>
            <Text size="xs" c="dimmed">
              updated {scanTime()}
            </Text>
          </Group>
        </Group>

        <ToolbarRow gap={32} style={{ paddingLeft: "4px", paddingRight: "4px" }}>
          <SegmentedControl
            size="xs"
            value={statusFilter()}
            onChange={(val) => setStatusFilter(val as "all" | "signal" | "watching" | "rejected")}
            data={[
              { value: "all", label: `All (${counts().signal + counts().watching + counts().rejected})` },
              ...statusControlData(),
            ]}
          />
          <Checkbox
            size="xs"
            label={`Skipped (${counts().skipped})`}
            checked={showSkipped()}
            onChange={(e) => setShowSkipped(e.currentTarget.checked)}
          />
          <Show when={strategyOptions().length > 0}>
            <MultiSelect
              size="xs"
              placeholder="Filter strategy"
              data={strategyOptions()}
              value={strategyFilter()}
              onChange={setStrategyFilter}
              clearable
              w={160}
            />
          </Show>
          <TextInput
            size="xs"
            placeholder="Search symbol"
            value={symbolQuery()}
            onChange={(val) => setSymbolQuery(val)}
            w={120}
          />
        </ToolbarRow>

        <ScrollArea className="flex-1" style={{ flex: 1 }}>
          <TanStackTable<ScanRow>
            data={visibleItems()}
            columns={columns()}
            dataTestId="watchlist-scan-table"
            enableSorting={false}
            emptyMessage={emptyMessage()}
            onRowClick={(row) => handleSelectSymbol(row)}
            getRowStyle={(row) => {
              const isSelected = row.symbol === props.selectedSymbol;
              const isNew = isNewSignal(row, props.snapshot?.timestamp ?? null);
              return {
                cursor: "pointer",
                backgroundColor: isSelected
                  ? alpha(palette.PRIMARY, 0.08)
                  : isNew
                    ? alpha(palette.POSITIVE, 0.08)
                    : undefined,
                borderLeftWidth: "3px",
                borderLeftStyle: "solid",
                borderLeftColor: STATUS_BORDER_COLOR[row.status] ?? STATUS_BORDER_COLOR.skipped,
              };
            }}
            getRowTestId={(row) => `scan-row-${row.symbol}`}
            dense
          />
        </ScrollArea>

        <Group justify="space-between" className="px-2 py-1">
          <Group gap="xs" className="gap-1">
            <Text size="xs" c="dimmed" className="font-mono tabular-nums">
              Showing {visibleItems().length} of {allItems().length}
            </Text>
            <Show when={counts().skipped > 0 && !showSkipped()}>
              <Text size="xs" c="secondary">
                +{counts().skipped} skipped
              </Text>
            </Show>
          </Group>
        </Group>
      </Stack>
    </Show>
  );
}
