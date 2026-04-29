import { useRef, useState, useEffect } from "react";
import { Table, Badge, Text, Group, Flex, Tooltip, ActionIcon, ScrollArea } from "@mantine/core";
import dayjs from "dayjs";
import { DataTable } from "../common";
import { fetchPaperChart, closePaperPosition, refreshLiveData } from "../../api/paperTrading";
import {
  getPaperTradingState,
  setSelectedSymbol,
  setSelectedTradeId,
} from "../../state/paperTrading";
import type { PaperPosition, PaperScanItem, PaperBotSnapshot } from "../../types/paperTrading";
import {
  formatCurrencyIN,
  formatNumber,
  formatElapsed,
  getPnLTextColor,
  getStrategyTypeFromName,
} from "../../utils/ui-helpers";
import { SideBadge } from "../common";
import { ClickableSymbol } from "../common";

export function nearBreakoutPct(item: PaperScanItem): number {
  const price = item.price;
  const orHigh = item.or_high;
  const orLow = item.or_low;
  const high52w = item.high_52w;

  // Use 52W high if ORB levels not available
  if (
    (orHigh == null || orLow == null || orHigh <= 0 || orLow <= 0) &&
    high52w != null &&
    high52w > 0
  ) {
    return ((high52w - price) / high52w) * 100;
  }
  if (price == null || orHigh == null || orLow == null || orHigh <= 0 || orLow <= 0) return 9999;
  if (price <= orHigh && price >= orLow) {
    const toHigh = ((orHigh - price) / orHigh) * 100;
    const toLow = ((price - orLow) / orLow) * 100;
    return Math.max(0, Math.min(toHigh, toLow));
  }
  if (price > orHigh) return ((price - orHigh) / orHigh) * 100;
  return ((orLow - price) / orLow) * 100;
}

export function formatNear(item: PaperScanItem): string {
  const v = nearBreakoutPct(item);
  if (!Number.isFinite(v) || v >= 9999) return "-";
  return `${v.toFixed(2)}%`;
}

export function groupPositionsByStrategy(positions: PaperPosition[]): Map<number, PaperPosition[]> {
  const groups = new Map<number, PaperPosition[]>();
  for (const pos of positions) {
    const key = pos.strategy_id || 0;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(pos);
  }
  return groups;
}

interface StrategySummary {
  totalPnl: number;
  marginUsed: number;
  count: number;
}

export function calcStrategySummary(positions: PaperPosition[]): StrategySummary {
  let totalPnl = 0;
  let marginUsed = 0;
  for (const pos of positions) {
    totalPnl += pos.pnl || 0;
    marginUsed += pos.margin_used || 0;
  }
  return { totalPnl, marginUsed, count: positions.length };
}

const TABLE_STYLES = {
  thead: {
    position: "sticky" as const,
    top: 0,
    zIndex: 1,
    background: "var(--mantine-color-body)",
  },
  th: {
    padding: "4px 6px",
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    borderBottom: "1px solid var(--mantine-color-default-border)",
    whiteSpace: "nowrap" as const,
  },
  td: {
    padding: "3px 6px",
    fontSize: "12px",
    borderBottom: "1px solid var(--mantine-color-default-border)",
    whiteSpace: "nowrap" as const,
  },
};

export { TABLE_STYLES as tableStyles };

function PriceDisplay({ price, prevPrice }: { price: number; prevPrice: number }) {
  const [flash, setFlash] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (price !== prevPrice && prevPrice > 0) {
      const direction = price > prevPrice ? "up" : "down";
      setFlash(direction);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setFlash(null), 600);
    }
  }, [price, prevPrice]);

  return (
    <span
      className={
        flash === "up" ? "price-flash-up" : flash === "down" ? "price-flash-down" : undefined
      }
      style={{ display: "inline-block", padding: "0 2px" }}
      onAnimationEnd={() => setFlash(null)}
    >
      ₹{price.toFixed(2)}
    </span>
  );
}

function PnLDisplay({ pnl, pnlPct }: { pnl: number; pnlPct: number }) {
  const [flash, setFlash] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const prevRef = useRef(pnl);
  useEffect(() => {
    if (pnl !== prevRef.current) {
      const direction = pnl > prevRef.current ? "up" : "down";
      setFlash(direction);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setFlash(null), 600);
      prevRef.current = pnl;
    }
  }, [pnl]);

  const pnlClass = getPnLTextColor(pnl);
  const pnlSign = pnl >= 0 ? "+" : "";

  return (
    <Text
      c={pnlClass}
      fw={600}
      className={
        flash === "up" ? "price-flash-up" : flash === "down" ? "price-flash-down" : undefined
      }
      onAnimationEnd={() => setFlash(null)}
      style={{ display: "inline" }}
    >
      {pnlSign}₹{formatNumber(pnl)}
      <Text span c="dimmed" fs="italic" size="sm">
        {" "}
        ({pnlSign}
        {pnlPct.toFixed(2)}%)
      </Text>
    </Text>
  );
}

function usePrevPrice(price: number) {
  const ref = useRef(price);
  const prev = ref.current;
  useEffect(() => {
    ref.current = price;
  }, [price]);
  return prev;
}

function PositionRow({
  pos,
  onSelect,
  onClose,
}: {
  pos: PaperPosition;
  onSelect: (
    symbol: string,
    tradeId?: string,
    strategyName?: string,
    strategyType?: string,
    strategyId?: number,
    entryTime?: string,
  ) => void;
  onClose: (symbol: string, price: number) => void;
}) {
  const prevPrice = usePrevPrice(pos.current_price);

  return (
    <Table.Tr
      key={pos.order_id || `${pos.strategy_id}-${pos.symbol}`}
      onClick={() =>
        onSelect(
          pos.symbol,
          pos.order_id,
          pos.strategy_name,
          pos.strategy_type || (getStrategyTypeFromName(pos.strategy_name) ?? undefined),
          pos.strategy_id,
          pos.entry_time,
        )
      }
      style={{ cursor: "pointer" }}
      data-testid={`position-row-${pos.symbol}`}
    >
      <Table.Td>
        <ClickableSymbol
          symbol={pos.symbol}
          onClick={() =>
            onSelect(
              pos.symbol,
              pos.order_id,
              pos.strategy_name,
              pos.strategy_type || (getStrategyTypeFromName(pos.strategy_name) ?? undefined),
              pos.strategy_id,
              pos.entry_time,
            )
          }
        />
      </Table.Td>
      <Table.Td>
        <SideBadge side={pos.side} data-testid={`side-badge-${pos.symbol}`} />
      </Table.Td>
      <Table.Td>{pos.quantity}</Table.Td>
      <Table.Td>₹{(pos.entry_price ?? 0).toFixed(2)}</Table.Td>
      <Table.Td>
        <PriceDisplay price={pos.current_price ?? 1} prevPrice={prevPrice} />
      </Table.Td>
      <Table.Td>
        <PnLDisplay pnl={pos.pnl ?? 0} pnlPct={pos.pnl_pct ?? 0} />
      </Table.Td>
      <Table.Td>₹{(pos.stop_loss ?? 0).toFixed(2)}</Table.Td>
      <Table.Td>₹{(pos.take_profit ?? 0).toFixed(2)}</Table.Td>
      <Table.Td>
        <Badge variant="outline" color="blue">
          {pos.strategy_name || "Default"}
        </Badge>
      </Table.Td>
      <Table.Td>{formatElapsed(pos.entry_time)}</Table.Td>
      <Table.Td>
        <Tooltip label="Close Position">
          <ActionIcon
            variant="subtle"
            color="red"
            onClick={(e) => {
              e.stopPropagation();
              onClose(pos.symbol, pos.current_price);
            }}
            data-testid={`close-position-${pos.symbol}`}
          >
            ✕
          </ActionIcon>
        </Tooltip>
      </Table.Td>
    </Table.Tr>
  );
}

export function PositionsTableBody({
  positions,
  selectedSymbol: _selectedSymbol,
}: {
  positions: PaperPosition[];
  selectedSymbol: string | null;
}) {
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

  const handleSelect = async (
    symbol: string,
    _tradeId?: string,
    _strategyName?: string,
    _strategyType?: string,
    strategyId?: number,
    entryTime?: string,
  ) => {
    setSelectedSymbol(symbol);
    setSelectedTradeId("-1");
    const entryDate = entryTime ? entryTime.split("T")[0] : undefined;
    const fromDate = entryDate
      ? dayjs(entryDate).subtract(7, "day").format("YYYY-MM-DD")
      : undefined;
    const state = getPaperTradingState();
    await fetchPaperChart(
      symbol,
      entryDate,
      state.chartTimeframe,
      strategyId ?? state.selectedStrategyId,
      state.intradayOnly,
      fromDate,
    );
  };

  return (
    <DataTable styles={TABLE_STYLES} dataTestId="positions-table">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Symbol</Table.Th>
          <Table.Th>Side</Table.Th>
          <Table.Th>Qty</Table.Th>
          <Table.Th>Entry</Table.Th>
          <Table.Th>Curr</Table.Th>
          <Table.Th>P&L</Table.Th>
          <Table.Th>SL</Table.Th>
          <Table.Th>TP</Table.Th>
          <Table.Th>Strategy</Table.Th>
          <Table.Th>Time</Table.Th>
          <Table.Th></Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {positions.map((pos) => (
          <PositionRow
            key={pos.order_id || `${pos.strategy_id}-${pos.symbol}`}
            pos={pos}
            onSelect={handleSelect}
            onClose={handleClosePosition}
          />
        ))}
      </Table.Tbody>
    </DataTable>
  );
}

export function WatchlistScan({ snapshot }: { snapshot: PaperBotSnapshot | null }) {
  const state = getPaperTradingState();

  const handleSelectSymbol = async (symbol: string) => {
    setSelectedSymbol(symbol);
    const currentState = getPaperTradingState();
    await fetchPaperChart(
      symbol,
      undefined,
      currentState.chartTimeframe,
      currentState.selectedStrategyId,
      currentState.intradayOnly,
    );
  };

  if (!snapshot || !snapshot.scan_items || snapshot.scan_items.length === 0) return null;

  const scanTime = snapshot.timestamp ? new Date(snapshot.timestamp).toLocaleTimeString() : "-";

  let scanItems = snapshot.scan_items;
  if (state.selectedStrategyTab && state.selectedStrategyTab !== "all") {
    scanItems = scanItems.filter((item) => item.status === state.selectedStrategyTab);
  }

  const rows = [...scanItems].sort((a, b) => nearBreakoutPct(a) - nearBreakoutPct(b)).slice(0, 12);

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
      <ScrollArea flex={1} style={{ minHeight: 0 }}>
        <div style={{ overflowX: "auto" }}>
          <DataTable styles={TABLE_STYLES} dataTestId="scan-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Sym</Table.Th>
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
                  key={item.strategy_id ? `${item.strategy_id}-${item.symbol}` : item.symbol}
                  onClick={() => handleSelectSymbol(item.symbol)}
                  style={{ cursor: "pointer" }}
                  data-testid={`scan-row-${item.symbol}`}
                >
                  <Table.Td>
                    <Text fw={600} size="sm">
                      {item.symbol}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Badge variant="outline" color="blue" size="xs">
                      {item.status || "-"}
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
          </DataTable>
        </div>
      </ScrollArea>
    </Flex>
  );
}

export function StrategySummaryFooter({
  strategyGroups,
}: {
  strategyGroups: Map<number, PaperPosition[]>;
}) {
  const summaries = Array.from(strategyGroups.entries()).map(([id, positions]) => ({
    id,
    name: positions[0]?.strategy_name || `Strategy ${id}`,
    ...calcStrategySummary(positions),
  }));

  return (
    <Flex
      direction="column"
      mt="xs"
      pt="xs"
      style={{ borderTop: "1px solid var(--mantine-color-default-border)" }}
      data-testid="strategy-summary-footer"
      className="paper-strategy-summary"
      id="strategy-summary"
    >
      <Text fw={600} size="xs" c="dimmed" tt="uppercase" mb={2}>
        Strategy Summary
      </Text>
      <DataTable highlightOnHover={false} styles={TABLE_STYLES} dataTestId="strategy-summary-table">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Strategy</Table.Th>
            <Table.Th>Pos</Table.Th>
            <Table.Th>Margin</Table.Th>
            <Table.Th>P&L</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {summaries.map((s) => (
            <Table.Tr key={s.name}>
              <Table.Td>
                <Text fw={600} size="sm">
                  {s.name}
                </Text>
              </Table.Td>
              <Table.Td>{s.count}</Table.Td>
              <Table.Td>₹{formatCurrencyIN(s.marginUsed)}</Table.Td>
              <Table.Td>
                <Text c={getPnLTextColor(s.totalPnl)} fw={600} size="sm">
                  {s.totalPnl >= 0 ? "+" : ""}₹{formatNumber(s.totalPnl)}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </DataTable>
    </Flex>
  );
}
