import { useMemo } from "react";
import { Accordion, Badge, Flex, Group, Table, Text } from "@mantine/core";
import { getPaperTradingState, setSelectedSymbol } from "../../state/paperTrading";
import { fetchPaperChart } from "../../api/paperTrading";
import type { PaperScanItem, PaperBotSnapshot } from "../../types/paperTrading";
import { nearBreakoutPct } from "./PositionsHelpers";
import { DataTable, SideBadge } from "../common";
import { ClickableSymbol } from "../common";
import { COMMON_TABLE_STYLES } from "../common/tableStyles";

interface WatchlistScanProps {
  snapshot: PaperBotSnapshot | null;
  selectedSymbol: string | null;
}

function SignalRow({ item, onSelect }: { item: PaperScanItem; onSelect: (s: string) => void }) {
  const near = nearBreakoutPct(item);
  const nearText = Number.isFinite(near) && near < 9999 ? `${near.toFixed(2)}%` : "-";
  return (
    <Table.Tr
      onClick={() => onSelect(item.symbol)}
      style={{ cursor: "pointer" }}
      data-testid={`scan-signal-${item.symbol}`}
    >
      <Table.Td>
        <ClickableSymbol symbol={item.symbol} showPreview />
      </Table.Td>
      <Table.Td>
        <SideBadge side={item.side || "LONG"} />
      </Table.Td>
      <Table.Td>{item.price ? `₹${item.price.toFixed(2)}` : "-"}</Table.Td>
      <Table.Td>{item.high_52w ? `₹${item.high_52w.toFixed(0)}` : "-"}</Table.Td>
      <Table.Td>{nearText}</Table.Td>
      <Table.Td>
        <Badge variant="outline" color="blue" size="xs">
          {item.strategy_name || "-"}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed">
          {item.reason || "-"}
        </Text>
      </Table.Td>
    </Table.Tr>
  );
}

function WatchingRow({ item, onSelect }: { item: PaperScanItem; onSelect: (s: string) => void }) {
  const near = nearBreakoutPct(item);
  const nearText = Number.isFinite(near) && near < 9999 ? `${near.toFixed(2)}%` : "-";
  return (
    <Table.Tr
      onClick={() => onSelect(item.symbol)}
      style={{ cursor: "pointer" }}
      data-testid={`scan-watching-${item.symbol}`}
    >
      <Table.Td>
        <ClickableSymbol symbol={item.symbol} showPreview />
      </Table.Td>
      <Table.Td>
        <Badge variant="light" color="yellow" size="xs">
          Watch
        </Badge>
      </Table.Td>
      <Table.Td>{item.price ? `₹${item.price.toFixed(2)}` : "-"}</Table.Td>
      <Table.Td>{item.high_52w ? `₹${item.high_52w.toFixed(0)}` : "-"}</Table.Td>
      <Table.Td>
        <Text size="xs" c="yellow" fw={500}>
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
          {item.reason || "-"}
        </Text>
      </Table.Td>
    </Table.Tr>
  );
}

function SkippedRow({
  item,
  onSelect,
}: {
  item: { symbol: string; strategies: string[]; reasons: string[] };
  onSelect: (s: string) => void;
}) {
  return (
    <Table.Tr
      onClick={() => onSelect(item.symbol)}
      style={{ cursor: "pointer" }}
      data-testid={`scan-skipped-${item.symbol}`}
    >
      <Table.Td>
        <Text fw={500} c="dimmed">
          <ClickableSymbol symbol={item.symbol} showPreview />
        </Text>
      </Table.Td>
      <Table.Td>
        <Badge variant="light" color="gray" size="xs">
          Skip
        </Badge>
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed">
          {item.strategies.join(", ")}
        </Text>
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="dimmed">
          {item.reasons[0] || "-"}
        </Text>
      </Table.Td>
    </Table.Tr>
  );
}

function RejectedRow({ item, onSelect }: { item: PaperScanItem; onSelect: (s: string) => void }) {
  return (
    <Table.Tr
      onClick={() => onSelect(item.symbol)}
      style={{ cursor: "pointer" }}
      data-testid={`scan-rejected-${item.symbol}`}
    >
      <Table.Td>
        <ClickableSymbol symbol={item.symbol} showPreview />
      </Table.Td>
      <Table.Td>
        <Badge variant="light" color="red" size="xs">
          Rejected
        </Badge>
      </Table.Td>
      <Table.Td>
        <Badge variant="outline" color="blue" size="xs">
          {item.strategy_name || "-"}
        </Badge>
      </Table.Td>
      <Table.Td>
        <Text size="xs" c="red" fw={500}>
          {item.reason || "Risk check failed"}
        </Text>
      </Table.Td>
    </Table.Tr>
  );
}

const SECTION_HEADER = { padding: "2px 6px", fontSize: "11px", fontWeight: 600 as const };
const SECTION_PANEL = { padding: 0 };

export function WatchlistScan({ snapshot, selectedSymbol: _selectedSymbol }: WatchlistScanProps) {
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
        defaultValue={["signals", "watching"]}
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
              <Text size="xs" fw={600}>
                Signals
              </Text>
              <Badge size="xs" variant="filled" color="green">
                {signals.length}
              </Badge>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {signals.length === 0 ? (
              <Text size="xs" c="dimmed" px="xs" py={4}>
                No signals
              </Text>
            ) : (
              <DataTable styles={COMMON_TABLE_STYLES} dataTestId="signals-table">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Sym</Table.Th>
                    <Table.Th>Side</Table.Th>
                    <Table.Th>Price</Table.Th>
                    <Table.Th>52W High</Table.Th>
                    <Table.Th>Near</Table.Th>
                    <Table.Th>Strategy</Table.Th>
                    <Table.Th>Reason</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {signals.map((item) => (
                    <SignalRow
                      key={`${item.strategy_id ?? item.strategy_name}-${item.symbol}`}
                      item={item}
                      onSelect={handleSelectSymbol}
                    />
                  ))}
                </Table.Tbody>
              </DataTable>
            )}
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="watching" data-testid="watchlist-scan-watching">
          <Accordion.Control>
            <Group gap="xs">
              <Badge size="xs" variant="filled" color="yellow" circle />
              <Text size="xs" fw={600}>
                Watching
              </Text>
              <Badge size="xs" variant="filled" color="yellow">
                {watching.length}
              </Badge>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {watching.length === 0 ? (
              <Text size="xs" c="dimmed" px="xs" py={4}>
                None watching
              </Text>
            ) : (
              <DataTable styles={COMMON_TABLE_STYLES} dataTestId="watching-table">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Sym</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Price</Table.Th>
                    <Table.Th>52W High</Table.Th>
                    <Table.Th>Near</Table.Th>
                    <Table.Th>Strategy</Table.Th>
                    <Table.Th>Reason</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {watching.map((item) => (
                    <WatchingRow
                      key={`${item.strategy_id ?? item.strategy_name}-${item.symbol}`}
                      item={item}
                      onSelect={handleSelectSymbol}
                    />
                  ))}
                </Table.Tbody>
              </DataTable>
            )}
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="rejected" data-testid="watchlist-scan-rejected">
          <Accordion.Control>
            <Group gap="xs">
              <Badge size="xs" variant="filled" color="red" circle />
              <Text size="xs" fw={600}>
                Rejected
              </Text>
              <Badge size="xs" variant="filled" color="red">
                {rejected.length}
              </Badge>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {rejected.length === 0 ? (
              <Text size="xs" c="dimmed" px="xs" py={4}>
                None rejected
              </Text>
            ) : (
              <DataTable styles={COMMON_TABLE_STYLES} dataTestId="rejected-table">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Sym</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Strategy</Table.Th>
                    <Table.Th>Reason</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {rejected.map((item) => (
                    <RejectedRow
                      key={`${item.strategy_id ?? item.strategy_name}-${item.symbol}`}
                      item={item}
                      onSelect={handleSelectSymbol}
                    />
                  ))}
                </Table.Tbody>
              </DataTable>
            )}
          </Accordion.Panel>
        </Accordion.Item>

        <Accordion.Item value="skipped" data-testid="watchlist-scan-skipped">
          <Accordion.Control>
            <Group gap="xs">
              <Badge size="xs" variant="filled" color="gray" circle />
              <Text size="xs" fw={600}>
                Skipped
              </Text>
              <Badge size="xs" variant="filled" color="gray">
                {skipped.length}
              </Badge>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            {skipped.length === 0 ? (
              <Text size="xs" c="dimmed" px="xs" py={4}>
                None skipped
              </Text>
            ) : (
              <DataTable styles={COMMON_TABLE_STYLES} dataTestId="skipped-table">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Sym</Table.Th>
                    <Table.Th>Status</Table.Th>
                    <Table.Th>Strategy</Table.Th>
                    <Table.Th>Reason</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {skipped.map((item) => (
                    <SkippedRow key={item.symbol} item={item} onSelect={handleSelectSymbol} />
                  ))}
                </Table.Tbody>
              </DataTable>
            )}
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Flex>
  );
}
