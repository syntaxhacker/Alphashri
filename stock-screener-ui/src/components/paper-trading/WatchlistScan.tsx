import { memo, useMemo, useState } from "react";
import { Accordion, Badge, Flex, Group, Table, Text } from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
import { getPaperTradingState, setSelectedSymbol } from "../../state/paperTrading";
import { fetchPaperChart } from "../../api/paperTrading";
import type { PaperScanItem, PaperBotSnapshot } from "../../types/paperTrading";
import { nearBreakoutPct } from "./PositionsHelpers";
import { TanStackTable, ClickableSymbol, SideBadge } from "../common";

interface WatchlistScanProps {
  snapshot: PaperBotSnapshot | null;
  selectedSymbol: string | null;
}

const signalColumns: ColumnDef<PaperScanItem>[] = [
  {
    id: "symbol",
    header: "Sym",
    cell: ({ row }) => <ClickableSymbol symbol={row.original.symbol} showPreview />,
    enableSorting: false,
  },
  {
    id: "side",
    header: "Side",
    cell: ({ row }) => <SideBadge side={row.original.side || "LONG"} />,
    enableSorting: false,
  },
  {
    id: "price",
    header: "Price",
    cell: ({ row }) => <>{row.original.price ? `₹${row.original.price.toFixed(2)}` : "-"}</>,
    enableSorting: false,
  },
  {
    id: "high_52w",
    header: "52W High",
    cell: ({ row }) => <>{row.original.high_52w ? `₹${row.original.high_52w.toFixed(0)}` : "-"}</>,
    enableSorting: false,
  },
  {
    id: "near",
    header: "Near",
    cell: ({ row }) => {
      const near = nearBreakoutPct(row.original);
      const nearText = Number.isFinite(near) && near < 9999 ? `${near.toFixed(2)}%` : "-";
      return <>{nearText}</>;
    },
    enableSorting: false,
  },
  {
    id: "strategy_name",
    header: "Strategy",
    cell: ({ row }) => (
      <Badge variant="outline" color="blue" size="xs">
        {row.original.strategy_name || "-"}
      </Badge>
    ),
    enableSorting: false,
  },
  {
    id: "reason",
    header: "Reason",
    cell: ({ row }) => (
      <Text size="xs" c="dimmed">
        {row.original.reason || "-"}
      </Text>
    ),
    enableSorting: false,
  },
];

const watchingColumns: ColumnDef<PaperScanItem>[] = [
  {
    id: "symbol",
    header: "Sym",
    cell: ({ row }) => <ClickableSymbol symbol={row.original.symbol} showPreview />,
    enableSorting: false,
  },
  {
    id: "status",
    header: "Status",
    cell: () => (
      <Badge variant="light" color="yellow" size="xs">
        Watch
      </Badge>
    ),
    enableSorting: false,
  },
  {
    id: "price",
    header: "Price",
    cell: ({ row }) => <>{row.original.price ? `₹${row.original.price.toFixed(2)}` : "-"}</>,
    enableSorting: false,
  },
  {
    id: "high_52w",
    header: "52W High",
    cell: ({ row }) => <>{row.original.high_52w ? `₹${row.original.high_52w.toFixed(0)}` : "-"}</>,
    enableSorting: false,
  },
  {
    id: "near",
    header: "Near",
    cell: ({ row }) => {
      const near = nearBreakoutPct(row.original);
      const nearText = Number.isFinite(near) && near < 9999 ? `${near.toFixed(2)}%` : "-";
      return <Text size="xs" c="yellow" fw={500}>{nearText}</Text>;
    },
    enableSorting: false,
  },
  {
    id: "strategy_name",
    header: "Strategy",
    cell: ({ row }) => (
      <Badge variant="outline" color="blue" size="xs">
        {row.original.strategy_name || "-"}
      </Badge>
    ),
    enableSorting: false,
  },
  {
    id: "reason",
    header: "Reason",
    cell: ({ row }) => (
      <Text size="xs" c="dimmed">
        {row.original.reason || "-"}
      </Text>
    ),
    enableSorting: false,
  },
];

const rejectedColumns: ColumnDef<PaperScanItem>[] = [
  {
    id: "symbol",
    header: "Sym",
    cell: ({ row }) => <ClickableSymbol symbol={row.original.symbol} showPreview />,
    enableSorting: false,
  },
  {
    id: "status",
    header: "Status",
    cell: () => (
      <Badge variant="light" color="red" size="xs">
        Rejected
      </Badge>
    ),
    enableSorting: false,
  },
  {
    id: "strategy_name",
    header: "Strategy",
    cell: ({ row }) => (
      <Badge variant="outline" color="blue" size="xs">
        {row.original.strategy_name || "-"}
      </Badge>
    ),
    enableSorting: false,
  },
  {
    id: "reason",
    header: "Reason",
    cell: ({ row }) => (
      <Text size="xs" c="red" fw={500}>
        {row.original.reason || "Risk check failed"}
      </Text>
    ),
    enableSorting: false,
  },
];

interface SkippedItem {
  symbol: string;
  strategies: string[];
  reasons: string[];
}

const skippedColumns: ColumnDef<SkippedItem>[] = [
  {
    id: "symbol",
    header: "Sym",
    cell: ({ row }) => (
      <Text fw={500} c="dimmed">
        <ClickableSymbol symbol={row.original.symbol} showPreview />
      </Text>
    ),
    enableSorting: false,
  },
  {
    id: "status",
    header: "Status",
    cell: () => (
      <Badge variant="light" color="gray" size="xs">
        Skip
      </Badge>
    ),
    enableSorting: false,
  },
  {
    id: "strategies",
    header: "Strategy",
    cell: ({ row }) => (
      <Text size="xs" c="dimmed">
        {row.original.strategies.join(", ")}
      </Text>
    ),
    enableSorting: false,
  },
  {
    id: "reasons",
    header: "Reason",
    cell: ({ row }) => (
      <Text size="xs" c="dimmed">
        {row.original.reasons[0] || "-"}
      </Text>
    ),
    enableSorting: false,
  },
];

const SECTION_HEADER = { padding: "2px 6px", fontSize: "11px", fontWeight: 600 as const };
const SECTION_PANEL = { padding: 0 };

export function WatchlistScan({ snapshot, selectedSymbol: _selectedSymbol }: WatchlistScanProps) {
  const [accordionValue, setAccordionValue] = useState<string[]>(["signals", "watching", "rejected", "skipped"]);
  const handleSelectSymbol = async (symbol: string) => {
    setAccordionValue([]);
    setSelectedSymbol(symbol);
    const currentState = getPaperTradingState();
    await fetchPaperChart(
      symbol,
      undefined,
      currentState.chartTimeframe,
      currentState.selectedStrategyId,
    );
  };

  const { signals, watching, rejected, skipped } = useMemo(() => {
    if (!snapshot?.scan_items) return { signals: [], watching: [], rejected: [], skipped: [] };

    const sig: PaperScanItem[] = [];
    const wat: PaperScanItem[] = [];
    const rej: PaperScanItem[] = [];
    const skipMap = new Map<string, { strategies: Set<string>; reasons: Set<string> }>();

    for (const item of snapshot.scan_items) {
      if (item.status === "signal") {
        sig.push(item);
      } else if (item.status === "watching") {
        wat.push(item);
      } else if (item.status === "rejected") {
        rej.push(item);
      } else {
        const existing = skipMap.get(item.symbol);
        const strat = item.strategy_name || "?";
        const reason = item.reason || "";
        if (existing) {
          existing.strategies.add(strat);
          if (reason) existing.reasons.add(reason);
        } else {
          skipMap.set(item.symbol, {
            strategies: new Set([strat]),
            reasons: new Set(reason ? [reason] : []),
          });
        }
      }
    }

    const sk = Array.from(skipMap.entries()).map(([symbol, data]) => ({
      symbol,
      strategies: Array.from(data.strategies),
      reasons: Array.from(data.reasons),
    }));

    return { signals: sig, watching: wat, rejected: rej, skipped: sk };
  }, [snapshot?.scan_items]);

  const scanTime = snapshot?.timestamp ? new Date(snapshot.timestamp).toLocaleTimeString() : "-";

  if (!snapshot || !snapshot.scan_items || snapshot.scan_items.length === 0) {
    return (
      <Flex
        direction="column"
        data-testid="watchlist-scan-card"
        className="paper-watchlist-scan"
        id="watchlist-scan"
      >
        <Group justify="space-between" px="xs" py={2}>
          <Text fw={600} size="xs" c="dimmed" tt="uppercase">
            Watchlist Scan
          </Text>
          <Text size="xs" c="dimmed">
            {scanTime}
          </Text>
        </Group>
        <Flex justify="center" py="sm">
          <Text size="xs" c="orange" fs="italic" style={{ textAlign: "center" }}>
            No scan data — API rate limit or connection issue
          </Text>
        </Flex>
      </Flex>
    );
  }

  const totalCount = snapshot.scan_items.length;

  return (
    <Flex
      direction="column"
      data-testid="watchlist-scan-card"
      className="paper-watchlist-scan"
      id="watchlist-scan"
    >
      <Group justify="space-between" px="xs" py={2}>
        <Text fw={600} size="xs" c="dimmed" tt="uppercase">
          Watchlist Scan
        </Text>
        <Group gap="xs">
          <Text size="xs" c="dimmed">
            {totalCount}
          </Text>
          <Text size="xs" c="dimmed">
            {scanTime}
          </Text>
        </Group>
      </Group>

      <Accordion
        variant="contained"
        multiple
        value={accordionValue}
        onChange={setAccordionValue}
        data-testid="watchlist-scan-accordion"
        styles={{
          item: { border: "none", backgroundColor: "transparent" },
          control: { ...SECTION_HEADER },
          content: { ...SECTION_PANEL },
          chevron: { fontSize: 10 },
        }}
      >
        <Accordion.Item value="signals" data-testid="watchlist-scan-signals">
          <Accordion.Control>
            <Group gap="xs">
              <Badge size="xs" variant="filled" color="green" circle />
              <Text size="xs" fw={600}>Signals</Text>
              <Badge size="xs" variant="filled" color="green">{signals.length}</Badge>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {signals.length === 0 ? (
              <Text size="xs" c="dimmed" px="xs" py={4}>No signals</Text>
            ) : (
              <TanStackTable<PaperScanItem>
                data={signals}
                columns={signalColumns}
                enableSorting={false}
                onRowClick={(item) => handleSelectSymbol(item.symbol)}
                dataTestId="signals-table"
                getRowTestId={(item) => `scan-signal-${item.symbol}`}
              />
            )}
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="watching" data-testid="watchlist-scan-watching">
          <Accordion.Control>
            <Group gap="xs">
              <Badge size="xs" variant="filled" color="yellow" circle />
              <Text size="xs" fw={600}>Watching</Text>
              <Badge size="xs" variant="filled" color="yellow">{watching.length}</Badge>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {watching.length === 0 ? (
              <Text size="xs" c="dimmed" px="xs" py={4}>None watching</Text>
            ) : (
              <TanStackTable<PaperScanItem>
                data={watching}
                columns={watchingColumns}
                enableSorting={false}
                onRowClick={(item) => handleSelectSymbol(item.symbol)}
                dataTestId="watching-table"
                getRowTestId={(item) => `scan-watching-${item.symbol}`}
              />
            )}
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="rejected" data-testid="watchlist-scan-rejected">
          <Accordion.Control>
            <Group gap="xs">
              <Badge size="xs" variant="filled" color="red" circle />
              <Text size="xs" fw={600}>Rejected</Text>
              <Badge size="xs" variant="filled" color="red">{rejected.length}</Badge>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {rejected.length === 0 ? (
              <Text size="xs" c="dimmed" px="xs" py={4}>None rejected</Text>
            ) : (
              <TanStackTable<PaperScanItem>
                data={rejected}
                columns={rejectedColumns}
                enableSorting={false}
                onRowClick={(item) => handleSelectSymbol(item.symbol)}
                dataTestId="rejected-table"
                getRowTestId={(item) => `scan-rejected-${item.symbol}`}
              />
            )}
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="skipped" data-testid="watchlist-scan-skipped">
          <Accordion.Control>
            <Group gap="xs">
              <Badge size="xs" variant="filled" color="gray" circle />
              <Text size="xs" fw={600}>Skipped</Text>
              <Badge size="xs" variant="filled" color="gray">{skipped.length}</Badge>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {skipped.length === 0 ? (
              <Text size="xs" c="dimmed" px="xs" py={4}>None skipped</Text>
            ) : (
              <TanStackTable<SkippedItem>
                data={skipped}
                columns={skippedColumns}
                enableSorting={false}
                onRowClick={(item) => handleSelectSymbol(item.symbol)}
                dataTestId="skipped-table"
                getRowTestId={(item) => `scan-skipped-${item.symbol}`}
              />
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Flex>
  );
}
