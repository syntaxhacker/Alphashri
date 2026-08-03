import { useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Checkbox,
  Group,
  MultiSelect,
  ScrollArea,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { IconRefresh, IconSparkles } from "@tabler/icons-react";
import { TanStackTable, SideBadge } from "../common";
import { ClickableSymbol } from "../common";
import { getPaperTradingState, setSelectedSymbol } from "../../state/paperTrading";
import { fetchPaperChart } from "../../api/paperTrading";
import { formatTimeAgo } from "../../utils/ui-helpers";
import type { PaperScanItem, PaperBotSnapshot } from "../../types/paperTrading";
import { nearBreakoutPct } from "./PositionsHelpers";

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
  signal: "var(--mantine-color-green-6)",
  watching: "var(--mantine-color-yellow-6)",
  rejected: "var(--mantine-color-red-6)",
  skipped: "var(--mantine-color-gray-5)",
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

export function WatchlistScan2({ snapshot, selectedSymbol, onRefresh, refreshing }: WatchlistScan2Props) {
  const [statusFilter, setStatusFilter] = useState<"all" | "signal" | "watching" | "rejected">("all");
  const [strategyFilter, setStrategyFilter] = useState<string[]>([]);
  const [symbolQuery, setSymbolQuery] = useState("");
  const [showSkipped, setShowSkipped] = useState(false);

  const handleSelectSymbol = async (symbol: string) => {
    setSelectedSymbol(symbol);
    const currentState = getPaperTradingState();
    await fetchPaperChart(
      symbol,
      undefined,
      currentState.chartTimeframe,
      currentState.selectedStrategyId,
    );
  };

  const allItems = useMemo(() => snapshot?.scan_items || [], [snapshot?.scan_items]);

  const strategyOptions = useMemo(() => {
    const names = new Set<string>();
    allItems.forEach((i) => {
      if (i.strategy_name) names.add(i.strategy_name);
    });
    return Array.from(names)
      .sort()
      .map((n) => ({ value: n, label: n }));
  }, [allItems]);

  const scanTime = snapshot?.timestamp ? formatTimeAgo(snapshot.timestamp) : "-";

  const visibleItems = useMemo(() => {
    let rows: ScanRow[] = allItems.map((item) => ({
      ...item,
      statusRank: STATUS_ORDER[item.status] ?? 99,
      age: item.timestamp ? new Date(item.timestamp).getTime() : 0,
    }));

    rows = rows.filter((r) => {
      if (r.status === "skipped") return showSkipped;
      return statusFilter === "all" || statusFilter === r.status;
    });

    if (strategyFilter.length > 0) {
      rows = rows.filter((r) => strategyFilter.includes(r.strategy_name || ""));
    }

    if (symbolQuery.trim()) {
      const q = symbolQuery.toUpperCase();
      rows = rows.filter((r) => r.symbol.toUpperCase().includes(q));
    }

    return rows.sort((a, b) => {
      if (a.statusRank !== b.statusRank) return a.statusRank - b.statusRank;
      return b.age - a.age;
    });
  }, [allItems, statusFilter, strategyFilter, symbolQuery, showSkipped]);

  const counts = useMemo(() => {
    return {
      signal: allItems.filter((i) => i.status === "signal").length,
      watching: allItems.filter((i) => i.status === "watching").length,
      rejected: allItems.filter((i) => i.status === "rejected").length,
      skipped: allItems.filter((i) => i.status === "skipped").length,
    };
  }, [allItems]);

  const statusControlData = useMemo(
    () => [
      { value: "signal", label: `Signals (${counts.signal})` },
      { value: "watching", label: `Watching (${counts.watching})` },
      { value: "rejected", label: `Rejected (${counts.rejected})` },
    ],
    [counts],
  );

  const emptyMessage = useMemo(() => {
    if (counts.skipped > 0 && !showSkipped) {
      return `${counts.skipped} skipped`;
    }
    return "No items";
  }, [counts.skipped, showSkipped]);

  const columns = useMemo<ColumnDef<ScanRow>[]>(
    () => [
      {
        id: "symbol",
        header: "Symbol",
        accessorKey: "symbol",
        cell: (info) => {
          const row = info.row.original;
          return (
            <Group gap={6} wrap="nowrap">
              <ClickableSymbol symbol={row.symbol} showPreview />
              {row.source === "custom" && (
                <Badge size="xs" variant="light" color="violet">Custom</Badge>
              )}
              {isNewSignal(row, snapshot?.timestamp ?? null) && (
                <Tooltip label="New (< 1 min)">
                  <IconSparkles size={12} color="var(--mantine-color-green-6)" />
                </Tooltip>
              )}
            </Group>
          );
        },
      },
      {
        id: "side",
        header: "Side",
        accessorKey: "side",
        cell: (info) => {
          const side = info.getValue<string | null>();
          return side ? <SideBadge side={side} /> : <Text size="xs">-</Text>;
        },
      },
      {
        id: "price",
        header: "Price",
        accessorKey: "price",
        cell: (info) => {
          const val = info.getValue<number | null>();
          return <Text size="xs">{val ? `₹${val.toFixed(2)}` : "-"}</Text>;
        },
      },
      {
        id: "near",
        header: "Near",
        accessorKey: "symbol",
        cell: (info) => {
          const row = info.row.original;
          const near = nearBreakoutPct(row);
          const nearText = Number.isFinite(near) && near < 9999 ? `${near.toFixed(2)}%` : "-";
          return (
            <Text size="xs" c={row.status === "watching" ? "yellow" : "dimmed"}>
              {nearText}
            </Text>
          );
        },
      },
      {
        id: "strategy",
        header: "Strategy",
        accessorKey: "strategy_name",
        cell: (info) => {
          const val = info.getValue<string | null>();
          return (
            <Badge variant="outline" color="blue" size="xs">
              {val || "-"}
            </Badge>
          );
        },
      },
      {
        id: "age",
        header: "Age",
        accessorKey: "timestamp",
        cell: (info) => {
          const val = info.getValue<string | null>();
          return <Text size="xs" c="dimmed">{val ? formatTimeAgo(val) : "-"}</Text>;
        },
      },
      {
        id: "notes",
        header: "Notes",
        accessorKey: "reason",
        cell: (info) => {
          const val = info.getValue<string | null>();
          return (
            <Tooltip label={val || "-"} multiline withinPortal>
              <Text size="xs" c="dimmed" truncate>
                {val || "-"}
              </Text>
            </Tooltip>
          );
        },
      },
    ],
    [snapshot?.timestamp],
  );

  if (!snapshot || allItems.length === 0) {
    return (
      <Stack gap={2} data-testid="watchlist-scan-card" className="paper-watchlist-scan" id="watchlist-scan">
        <Group justify="space-between" px={4} py={1}>
          <Group gap="xs">
            <Text fw={600} size="xs" c="dimmed" tt="uppercase">
              Watchlist Scan
            </Text>
            <Badge size="xs" variant="outline" color="orange">
              No data
            </Badge>
          </Group>
          <Group gap={2}>
            {onRefresh && (
              <ActionIcon size="sm" variant="subtle" onClick={onRefresh} loading={refreshing}>
                <IconRefresh size={12} />
              </ActionIcon>
            )}
            <Text size="xs" c="dimmed">
              updated {scanTime}
            </Text>
          </Group>
        </Group>
        <Text size="xs" c="orange" fs="italic" ta="center" py="xs">
          No scan data — API rate limit or connection issue
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap={2} data-testid="watchlist-scan-card" className="paper-watchlist-scan" id="watchlist-scan">
      <Group justify="space-between" px={4} py={1} wrap="nowrap">
        <Group gap="xs">
          <Text fw={600} size="xs" c="dimmed" tt="uppercase">
            Watchlist Scan
          </Text>
          <Badge size="xs" variant="filled" color="teal">
            {allItems.length}
          </Badge>
        </Group>
        <Group gap={2}>
          {onRefresh && (
            <ActionIcon size="sm" variant="subtle" onClick={onRefresh} loading={refreshing}>
              <IconRefresh size={12} />
            </ActionIcon>
          )}
          <Text size="xs" c="dimmed">
            updated {scanTime}
          </Text>
        </Group>
      </Group>

      <Group gap="xs" px={4} wrap="wrap">
        <SegmentedControl
          size="xs"
          value={statusFilter}
          onChange={(val) => setStatusFilter(val as "all" | "signal" | "watching" | "rejected")}
          data={[
            { value: "all", label: `All (${counts.signal + counts.watching + counts.rejected})` },
            ...statusControlData,
          ]}
        />
        <Checkbox
          size="xs"
          label={`Skipped (${counts.skipped})`}
          checked={showSkipped}
          onChange={(e) => setShowSkipped(e.currentTarget.checked)}
        />
        {strategyOptions.length > 0 && (
          <MultiSelect
            size="xs"
            placeholder="Filter strategy"
            data={strategyOptions}
            value={strategyFilter}
            onChange={setStrategyFilter}
            clearable
            style={{ minWidth: 160 }}
          />
        )}
        <TextInput
          size="xs"
          placeholder="Search symbol"
          value={symbolQuery}
          onChange={(val) => setSymbolQuery(val)}
          style={{ width: 120 }}
        />
      </Group>

      <ScrollArea style={{ flex: 1 }}>
        <TanStackTable<ScanRow>
          data={visibleItems}
          columns={columns}
          dataTestId="watchlist-scan-table"
          enableSorting={false}
          emptyMessage={emptyMessage}
          onRowClick={(row) => handleSelectSymbol(row.symbol)}
          getRowStyle={(row) => {
            const isSelected = row.symbol === selectedSymbol;
            const isNew = isNewSignal(row, snapshot?.timestamp ?? null);
            const borderColor = STATUS_BORDER_COLOR[row.status] || STATUS_BORDER_COLOR.skipped;
            return {
              cursor: "pointer",
              borderLeft: `3px solid ${borderColor}`,
              backgroundColor: isSelected
                ? "var(--mantine-color-teal-light)"
                : isNew
                  ? "var(--mantine-color-green-light)"
                  : undefined,
            };
          }}
          getRowTestId={(row) => `scan-row-${row.symbol}`}
        />
      </ScrollArea>

      <Group justify="space-between" px={4} py={1}>
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            Showing {visibleItems.length} of {allItems.length}
          </Text>
          {counts.skipped > 0 && !showSkipped && (
            <Text size="xs" c="gray">
              +{counts.skipped} skipped
            </Text>
          )}
        </Group>
      </Group>
    </Stack>
  );
}
