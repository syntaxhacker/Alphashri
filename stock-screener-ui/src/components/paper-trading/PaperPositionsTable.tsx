import { useState, useEffect, useMemo } from "react";
import { Table, Tabs, Badge, ActionIcon, Text, Group, Card, Tooltip } from "@mantine/core";
import {
  getPaperTradingState,
  setSelectedSymbol,
  setSelectedStrategyTab,
  subscribe,
} from "../../state/paperTrading";
import { fetchPaperChart, closePaperPosition, refreshLiveData } from "../../api/paperTrading";
import type { PaperPosition, PaperScanItem, PaperBotSnapshot } from "../../types/paperTrading";

function formatCurrency(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) return "0";
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function formatNum(value: number | undefined | null): string {
  if (value === undefined || value === null || isNaN(value)) return "0";
  if (Math.abs(value) >= 100000) {
    return (value / 100000).toFixed(1) + "L";
  }
  if (Math.abs(value) >= 1000) {
    return (value / 1000).toFixed(1) + "K";
  }
  return value.toFixed(0);
}

function formatDuration(entryTime: string | null | undefined): string {
  if (!entryTime) return "-";
  try {
    const entry = new Date(entryTime);
    const now = new Date();
    const diffMs = now.getTime() - entry.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 60) {
      return `${diffMins}m`;
    }
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    return `${hours}h ${mins}m`;
  } catch {
    return "-";
  }
}

function nearBreakoutPct(item: PaperScanItem): number {
  const price = item.price;
  const orHigh = item.or_high;
  const orLow = item.or_low;
  if (price == null || orHigh == null || orLow == null || orHigh <= 0 || orLow <= 0) return 9999;

  if (price <= orHigh && price >= orLow) {
    const toHigh = ((orHigh - price) / orHigh) * 100;
    const toLow = ((price - orLow) / orLow) * 100;
    return Math.max(0, Math.min(toHigh, toLow));
  }

  if (price > orHigh) return ((price - orHigh) / orHigh) * 100;
  return ((orLow - price) / orLow) * 100;
}

function formatNear(item: PaperScanItem): string {
  const v = nearBreakoutPct(item);
  if (!Number.isFinite(v) || v >= 9999) return "-";
  return `${v.toFixed(2)}%`;
}

function groupPositionsByStrategy(positions: PaperPosition[]): Map<string, PaperPosition[]> {
  const groups = new Map<string, PaperPosition[]>();

  for (const pos of positions) {
    const key = pos.strategy_name || `Strategy ${pos.strategy_id || 0}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(pos);
  }

  return groups;
}

interface StrategySummary {
  totalPnl: number;
  marginUsed: number;
  count: number;
}

function calcStrategySummary(positions: PaperPosition[]): StrategySummary {
  let totalPnl = 0;
  let marginUsed = 0;

  for (const pos of positions) {
    totalPnl += pos.pnl || 0;
    marginUsed += pos.margin_used || 0;
  }

  return { totalPnl, marginUsed, count: positions.length };
}

interface PositionsTableProps {
  positions: PaperPosition[];
  selectedSymbol: string | null;
}

function PositionsTableBody({ positions, selectedSymbol }: PositionsTableProps) {
  const handleClosePosition = async (symbol: string, currentPrice: number) => {
    if (confirm(`Close position for ${symbol} at ₹${currentPrice.toFixed(2)}?`)) {
      try {
        await closePaperPosition(symbol, currentPrice, "MANUAL");
        await refreshLiveData();
      } catch (error) {
        console.error("Failed to close position:", error);
        alert("Failed to close position. Check console for details.");
      }
    }
  };

  const handleSelectPosition = async (symbol: string) => {
    setSelectedSymbol(symbol);
    const state = getPaperTradingState();
    await fetchPaperChart(symbol, undefined, state.chartTimeframe);
  };

  return (
    <Table striped highlightOnHover withTableBorder>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Symbol</Table.Th>
          <Table.Th>Side</Table.Th>
          <Table.Th>Qty</Table.Th>
          <Table.Th>Entry</Table.Th>
          <Table.Th>Current</Table.Th>
          <Table.Th>P&L</Table.Th>
          <Table.Th>SL</Table.Th>
          <Table.Th>TP</Table.Th>
          <Table.Th>Strategy</Table.Th>
          <Table.Th>Time</Table.Th>
          <Table.Th></Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {positions.map((pos) => {
          const isSelected = pos.symbol === selectedSymbol;
          const pnlClass = (pos.pnl ?? 0) >= 0 ? "green" : "red";
          const pnlSign = (pos.pnl ?? 0) >= 0 ? "+" : "";

          return (
            <Table.Tr
              key={pos.symbol}
              onClick={() => handleSelectPosition(pos.symbol)}
              style={{ cursor: "pointer" }}
              data-testid={`position-row-${pos.symbol}`}
            >
              <Table.Td>
                <Text fw={600}>{pos.symbol}</Text>
              </Table.Td>
              <Table.Td>
                <Badge
                  color={pos.side === "BUY" ? "green" : "red"}
                  variant="light"
                  data-testid={`side-badge-${pos.symbol}`}
                >
                  {pos.side === "BUY" ? "▲ BUY" : "▼ SELL"}
                </Badge>
              </Table.Td>
              <Table.Td>{pos.quantity}</Table.Td>
              <Table.Td>₹{(pos.entry_price ?? 0).toFixed(2)}</Table.Td>
              <Table.Td>₹{(pos.current_price ?? 1).toFixed(2)}</Table.Td>
              <Table.Td>
                <Text c={pnlClass} fw={600}>
                  {pnlSign}₹{formatNum(pos.pnl)}
                  <Text span c="dimmed" fs="italic" size="sm">
                    {" "}
                    ({pnlSign}
                    {(pos.pnl_pct ?? 0).toFixed(2)}%)
                  </Text>
                </Text>
              </Table.Td>
              <Table.Td>₹{(pos.stop_loss ?? 0).toFixed(2)}</Table.Td>
              <Table.Td>₹{(pos.take_profit ?? 0).toFixed(2)}</Table.Td>
              <Table.Td>
                <Badge variant="outline" color="blue">
                  {pos.strategy_name || "Default"}
                </Badge>
              </Table.Td>
              <Table.Td>{formatDuration(pos.entry_time)}</Table.Td>
              <Table.Td>
                <Tooltip label="Close Position">
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleClosePosition(pos.symbol, pos.current_price);
                    }}
                    data-testid={`close-position-${pos.symbol}`}
                  >
                    ✕
                  </ActionIcon>
                </Tooltip>
              </Table.Td>
            </Table.Tr>
          );
        })}
      </Table.Tbody>
    </Table>
  );
}

function EmptyPositions() {
  return (
    <Card shadow="sm" padding="xl" radius="md" withBorder data-testid="positions-empty" className="paper-positions-empty" id="positions-empty">
      <Text size="lg" fw={500} ta="center">
        No open positions
      </Text>
      <Text c="dimmed" ta="center" mt="sm">
        Positions will appear here when trades are placed
      </Text>
    </Card>
  );
}

interface WatchlistScanProps {
  snapshot: PaperBotSnapshot | null;
  selectedSymbol: string | null;
}

function WatchlistScan({ snapshot, selectedSymbol }: WatchlistScanProps) {
  const state = getPaperTradingState();

  const handleSelectSymbol = async (symbol: string) => {
    setSelectedSymbol(symbol);
    const currentState = getPaperTradingState();
    await fetchPaperChart(symbol, undefined, currentState.chartTimeframe);
  };

  if (!snapshot || !snapshot.scan_items || snapshot.scan_items.length === 0) {
    return (
      <Card shadow="sm" padding="md" radius="md" withBorder data-testid="watchlist-scan-card" className="paper-watchlist-scan" id="watchlist-scan">
        <Group justify="space-between" mb="md">
          <Text fw={600} size="md">
            Watchlist Scan
          </Text>
          <Text size="sm" c="dimmed">
            No scan data yet
          </Text>
        </Group>
      </Card>
    );
  }

  const scanTime = snapshot.timestamp ? new Date(snapshot.timestamp).toLocaleTimeString() : "-";

  let scanItems = snapshot.scan_items;
  if (state.selectedStrategyTab && state.selectedStrategyTab !== "all") {
    scanItems = scanItems.filter((item) => item.status === state.selectedStrategyTab);
  }

  const rows = [...scanItems].sort((a, b) => nearBreakoutPct(a) - nearBreakoutPct(b)).slice(0, 12);

  return (
    <Card shadow="sm" padding="md" radius="md" withBorder data-testid="watchlist-scan-card" className="paper-watchlist-scan" id="watchlist-scan">
      <Group justify="space-between" mb="md">
        <Text fw={600} size="md">
          Watchlist Scan
        </Text>
        <Text size="sm" c="dimmed">
          {scanTime}
        </Text>
      </Group>

      <Table striped highlightOnHover withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Symbol</Table.Th>
            <Table.Th>Strategy</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Price</Table.Th>
            <Table.Th>OR H/L</Table.Th>
            <Table.Th>Near</Table.Th>
            <Table.Th>Reason</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((item) => (
            <Table.Tr
              key={item.symbol}
              onClick={() => handleSelectSymbol(item.symbol)}
              style={{ cursor: "pointer" }}
              data-testid={`scan-row-${item.symbol}`}
            >
              <Table.Td>
                <Text fw={600}>{item.symbol}</Text>
              </Table.Td>
              <Table.Td>
                <Badge variant="outline" color="blue">
                  {item.status || "-"}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Badge
                  color={item.side === "LONG" ? "green" : item.side === "SHORT" ? "red" : "gray"}
                  variant="light"
                >
                  {item.status}
                  {item.side ? ` ${item.side}` : ""}
                </Badge>
              </Table.Td>
              <Table.Td>{item.price ? `₹${item.price.toFixed(2)}` : "-"}</Table.Td>
              <Table.Td>
                {item.or_high && item.or_low
                  ? `₹${item.or_high.toFixed(2)} / ₹${item.or_low.toFixed(2)}`
                  : "-"}
              </Table.Td>
              <Table.Td>{formatNear(item)}</Table.Td>
              <Table.Td>{item.reason || "-"}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

function StrategySummaryFooter({
  strategyGroups,
}: {
  strategyGroups: Map<string, PaperPosition[]>;
}) {
  const summaries = Array.from(strategyGroups.entries()).map(([name, positions]) => ({
    name,
    ...calcStrategySummary(positions),
  }));

  return (
    <Card
      shadow="sm"
      padding="sm"
      radius="md"
      withBorder
      mt="md"
      data-testid="strategy-summary-footer"
      className="paper-strategy-summary"
      id="strategy-summary"
    >
      <Text fw={600} size="sm" mb="sm">
        Strategy Summary
      </Text>
      <Table striped withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Strategy</Table.Th>
            <Table.Th>Positions</Table.Th>
            <Table.Th>Margin</Table.Th>
            <Table.Th>Unrealized P&L</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {summaries.map((s) => (
            <Table.Tr key={s.name}>
              <Table.Td>
                <Text fw={600}>{s.name}</Text>
              </Table.Td>
              <Table.Td>{s.count}</Table.Td>
              <Table.Td>₹{formatCurrency(s.marginUsed)}</Table.Td>
              <Table.Td>
                <Text c={s.totalPnl >= 0 ? "green" : "red"} fw={600}>
                  {s.totalPnl >= 0 ? "+" : ""}₹{formatNum(s.totalPnl)}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Card>
  );
}

export function PaperPositionsTable() {
  const [, setTick] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribe(() => {
      setTick((t) => t + 1);
    });
    return () => {
      unsubscribe();
    };
  }, []);

  const state = getPaperTradingState();
  const { positions, selectedSymbol, selectedStrategyTab, botSnapshot, isLoading } = state;

  const strategyGroups = useMemo(() => groupPositionsByStrategy(positions), [positions]);
  const strategies = Array.from(strategyGroups.keys());
  const isMultiStrategy = strategies.length > 1;

  const activeTab = selectedStrategyTab || "all";

  const handleStrategyTabChange = (value: string | null) => {
    if (value) {
      setSelectedStrategyTab(value);
    }
  };

  if (isLoading && positions.length === 0) {
    return (
      <Card shadow="sm" padding="md" radius="md" withBorder data-testid="positions-panel" className="paper-positions-panel" id="positions-panel">
        <Text c="dimmed" ta="center">
          Loading positions...
        </Text>
      </Card>
    );
  }

  if (positions.length === 0) {
    return (
      <Card shadow="sm" padding="md" radius="md" withBorder data-testid="positions-panel" className="paper-positions-panel" id="positions-panel">
        <WatchlistScan snapshot={botSnapshot} selectedSymbol={selectedSymbol} />
        <EmptyPositions />
      </Card>
    );
  }

  const allSummary = calcStrategySummary(positions);
  const filteredPositions = activeTab === "all" ? positions : strategyGroups.get(activeTab) || [];

  return (
    <Card shadow="sm" padding="md" radius="md" withBorder data-testid="positions-panel" className="paper-positions-panel" id="positions-panel">
      <WatchlistScan snapshot={botSnapshot} selectedSymbol={selectedSymbol} />

      <Card
        shadow="xs"
        padding="md"
        radius="md"
        withBorder
        mt="md"
        data-testid="positions-table-container"
        className="paper-positions-table-container"
        id="positions-table-container"
      >
        <Group justify="space-between" mb="md" className="paper-positions-header" id="positions-header">
          <Text fw={600} size="md">
            Open Positions
          </Text>
          <Badge color="red" variant="light">
            <Group gap={4}>
              <span>●</span> LIVE
            </Group>
          </Badge>
        </Group>

        {isMultiStrategy && (
          <Tabs value={activeTab} onChange={handleStrategyTabChange} data-testid="strategy-tabs" className="paper-strategy-tabs" id="strategy-tabs">
            <Tabs.List>
              <Tabs.Tab value="all" data-testid="strategy-tab-all">
                <Group gap="xs">
                  <span>All</span>
                  <Badge size="sm" variant="filled" color="blue">
                    {positions.length}
                  </Badge>
                  <Text size="sm" c={allSummary.totalPnl >= 0 ? "green" : "red"}>
                    {allSummary.totalPnl >= 0 ? "+" : ""}₹{formatNum(allSummary.totalPnl)}
                  </Text>
                </Group>
              </Tabs.Tab>
              {strategies.map((strategy) => {
                const strategyPositions = strategyGroups.get(strategy) || [];
                const summary = calcStrategySummary(strategyPositions);
                return (
                  <Tabs.Tab
                    key={strategy}
                    value={strategy}
                    data-testid={`strategy-tab-${strategy.replace(/\s+/g, "-").toLowerCase()}`}
                  >
                    <Group gap="xs">
                      <span>{strategy}</span>
                      <Badge size="sm" variant="filled" color="blue">
                        {summary.count}
                      </Badge>
                      <Text size="sm" c={summary.totalPnl >= 0 ? "green" : "red"}>
                        {summary.totalPnl >= 0 ? "+" : ""}₹{formatNum(summary.totalPnl)}
                      </Text>
                    </Group>
                  </Tabs.Tab>
                );
              })}
            </Tabs.List>
          </Tabs>
        )}

        <div style={{ marginTop: "1rem" }}>
          <PositionsTableBody positions={filteredPositions} selectedSymbol={selectedSymbol} />
        </div>

        {isMultiStrategy && activeTab === "all" && (
          <StrategySummaryFooter strategyGroups={strategyGroups} />
        )}
      </Card>
    </Card>
  );
}
