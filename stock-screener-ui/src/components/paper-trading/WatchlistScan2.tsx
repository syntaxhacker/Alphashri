import { useMemo, useState } from "react";
import {
  Badge,
  Checkbox,
  Group,
  MultiSelect,
  ScrollArea,
  SegmentedControl,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import { IconRefresh, IconSparkles } from "@tabler/icons-react";
import { DataTable, SideBadge } from "../common";
import { ClickableSymbol } from "../common";
import { getPaperTradingState, setSelectedSymbol } from "../../state/paperTrading";
import { fetchPaperChart } from "../../api/paperTrading";
import { formatTimeAgo } from "../../utils/ui-helpers";
import type { PaperScanItem, PaperBotSnapshot } from "../../types/paperTrading";
import { nearBreakoutPct, tableStyles as TABLE_STYLES } from "./PositionsHelpers";

interface WatchlistScan2Props {
  snapshot: PaperBotSnapshot | null;
  selectedSymbol: string | null;
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

export function WatchlistScan2({ snapshot, selectedSymbol }: WatchlistScan2Props) {
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
    let rows = allItems.map((item) => ({
      ...item,
      statusRank: STATUS_ORDER[item.status] ?? 99,
      age: item.timestamp ? new Date(item.timestamp).getTime() : 0,
    }));

    // Status filter: skipped is controlled independently by showSkipped
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
            <IconRefresh size={12} />
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
      {/* Header */}
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
          <IconRefresh size={12} />
          <Text size="xs" c="dimmed">
            updated {scanTime}
          </Text>
        </Group>
      </Group>

      {/* Filters */}
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
          onChange={(e) => setSymbolQuery(e.currentTarget.value)}
          style={{ width: 120 }}
        />
      </Group>

      {/* Table */}
      <ScrollArea style={{ flex: 1 }}>
        <DataTable styles={TABLE_STYLES} dataTestId="watchlist-scan-table">
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 110 }}>
                <Text size="xs" fw={600}>
                  Symbol
                </Text>
              </Table.Th>
              <Table.Th style={{ width: 60 }}>
                <Text size="xs" fw={600}>
                  Side
                </Text>
              </Table.Th>
              <Table.Th style={{ width: 70 }}>
                <Text size="xs" fw={600}>
                  Price
                </Text>
              </Table.Th>
              <Table.Th style={{ width: 70 }}>
                <Text size="xs" fw={600}>
                  Near
                </Text>
              </Table.Th>
              <Table.Th>
                <Text size="xs" fw={600}>
                  Strategy
                </Text>
              </Table.Th>
              <Table.Th style={{ width: 70 }}>
                <Text size="xs" fw={600}>
                  Age
                </Text>
              </Table.Th>
              <Table.Th style={{ flex: 1 }}>
                <Text size="xs" fw={600}>
                  Notes
                </Text>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {visibleItems.length === 0 ? (
              <Table.Tr>
                <Table.Td colSpan={7}>
                  <Text size="xs" c="dimmed" ta="center" py="sm">
                    {counts.skipped > 0 ? `${counts.skipped} skipped` : "No items"}
                  </Text>
                </Table.Td>
              </Table.Tr>
            ) : (
              visibleItems.map((item) => {
                const isSelected = item.symbol === selectedSymbol;
                const isNew = isNewSignal(item, snapshot?.timestamp ?? null);
                const near = nearBreakoutPct(item);
                const nearText = Number.isFinite(near) && near < 9999 ? `${near.toFixed(2)}%` : "-";
                const ageText = item.timestamp ? formatTimeAgo(item.timestamp) : "-";
                const borderColor = STATUS_BORDER_COLOR[item.status] || STATUS_BORDER_COLOR.skipped;

                return (
                  <Table.Tr
                    key={`${item.strategy_id ?? item.strategy_name}-${item.symbol}-${item.status}`}
                    onClick={() => handleSelectSymbol(item.symbol)}
                    style={{
                      cursor: "pointer",
                      borderLeft: `3px solid ${borderColor}`,
                      backgroundColor: isSelected
                        ? "var(--mantine-color-teal-light)"
                        : isNew
                          ? "var(--mantine-color-green-light)"
                          : undefined,
                    }}
                    data-testid={`scan-row-${item.symbol}`}
                  >
                    <Table.Td>
                      <Group gap={6} wrap="nowrap">
                        <ClickableSymbol symbol={item.symbol} showPreview />
                        {item.source === "custom" && (
                          <Badge size="xs" variant="light" color="violet">Custom</Badge>
                        )}
                        {isNew && (
                          <Tooltip label="New (< 1 min)">
                            <IconSparkles size={12} color="var(--mantine-color-green-6)" />
                          </Tooltip>
                        )}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      {item.side ? <SideBadge side={item.side} /> : <Text size="xs">-</Text>}
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs">{item.price ? `₹${item.price.toFixed(2)}` : "-"}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c={item.status === "watching" ? "yellow" : "dimmed"}>
                        {nearText}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge variant="outline" color="blue" size="xs">
                        {item.strategy_name || "-"}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {ageText}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label={item.reason || "-"} multiline withinPortal>
                        <Text size="xs" c="dimmed" truncate>
                          {item.reason || "-"}
                        </Text>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                );
              })
            )}
          </Table.Tbody>
        </DataTable>
      </ScrollArea>

      {/* Footer summary */}
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
