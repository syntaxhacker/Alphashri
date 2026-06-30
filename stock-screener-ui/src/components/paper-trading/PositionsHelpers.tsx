import { memo, useRef, useState, useEffect, Fragment } from "react";
import { Table, Text, Group, Flex, Tooltip, ActionIcon, ScrollArea, Badge, Collapse, Box, Stack, SimpleGrid, Textarea, Button, Loader } from "@mantine/core";
import dayjs from "dayjs";
import { DataTable, ClickableSymbol } from "../common";
import { fetchPaperChart, closePaperPosition, refreshLiveData, fetch52WLevels } from "../../api/paperTrading";
import {
  getPaperTradingState,
  setSelectedSymbol,
  setSelectedTradeId,
  updatePositionNotesAction,
} from "../../state/paperTrading";
import type { PaperPosition, PaperScanItem, PaperBotSnapshot } from "../../types/paperTrading";
import { COMMON_TABLE_STYLES as TABLE_STYLES } from "../common/tableStyles";
import {
  formatSignedPnl,
  formatPercentage,
  formatElapsed,
  formatCurrencyIN,
  getPnLTextColor,
} from "../../utils/ui-helpers";

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

export { TABLE_STYLES as tableStyles };

const PriceDisplay = memo(function PriceDisplay({ price, prevPrice }: { price: number; prevPrice: number }) {
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
});

const PnLDisplay = memo(function PnLDisplay({ pnl, pnlPct }: { pnl: number; pnlPct: number }) {
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
      {formatSignedPnl(pnl)}
      <Text span c="dimmed" fs="italic" size="sm">
        {" "}
        ({formatPercentage(pnlPct)})
      </Text>
    </Text>
  );
});

function usePrevPrice(price: number) {
  const ref = useRef(price);
  const prev = ref.current;
  useEffect(() => {
    ref.current = price;
  }, [price]);
  return prev;
}

function getSideColor(side: string): string {
  return side === "BUY" ? "#22c55e" : "#ef4444";
}

function calcRowBg(current: number, entry: number, sl: number, tp: number): string {
  const slDist = entry - sl;
  const tpDist = tp > 0 ? tp - entry : null;
  if (slDist <= 0 && (tpDist == null || tpDist <= 0)) return "transparent";
  let redPct = 0;
  let greenPct = 0;
  if (slDist > 0) {
    redPct = Math.max(0, Math.min(1, (entry - current) / slDist));
  }
  if (tpDist != null && tpDist > 0) {
    greenPct = Math.max(0, Math.min(1, (current - entry) / tpDist));
  } else if (current > entry) {
    greenPct = 0.3;
  }
  const redStop = redPct * 50;
  const greenStart = 100 - greenPct * 50;
  return `linear-gradient(90deg, rgba(239,68,68,0.08) 0%, rgba(239,68,68,0.12) ${redStop}%, transparent ${redStop}%, transparent ${greenStart}%, rgba(34,197,94,0.12) ${greenStart}%, rgba(34,197,94,0.08) 100%)`;
}

const PositionRow = memo(function PositionRow({
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
  const [expanded, setExpanded] = useState(false);
  const prevPrice = usePrevPrice(pos.current_price);
  const sideColor = getSideColor(pos.side);
  const rowBg = calcRowBg(pos.current_price, pos.entry_price, pos.stop_loss, pos.take_profit);
  const ageColor = "transparent";
  const tpLabel = pos.take_profit > 0 ? `₹${pos.take_profit.toFixed(2)}` : "trail";

  return (
    <Fragment key={pos.order_id || `${pos.strategy_id}-${pos.symbol}`}>
      <Table.Tr
        onClick={() => setExpanded((e) => !e)}
        style={{
          cursor: "pointer",
          background: rowBg,
          borderLeft: `3px solid ${sideColor}`,
          transition: "background 0.5s ease",
        }}
        data-testid={`position-row-${pos.symbol}`}
      >
        <Table.Td>
          <Text span size="xs" c="dimmed" mr={4}>{expanded ? "▼" : "▶"}</Text>
          <Tooltip label={`SL: ₹${pos.stop_loss.toFixed(2)} | TP: ${tpLabel}`}>
            <ClickableSymbol
              symbol={pos.symbol}
              showPreview
              onClick={() => onSelect(pos.symbol, pos.order_id, pos.strategy_name, undefined, pos.strategy_id, pos.entry_time)}
            />
          </Tooltip>
        </Table.Td>
        <Table.Td>
          <Text size="sm">
            {pos.quantity}×₹{pos.entry_price.toFixed(0)}
            <Text span c="dimmed" size="xs">→</Text>
            <PriceDisplay price={pos.current_price} prevPrice={prevPrice} />
          </Text>
        </Table.Td>
        <Table.Td>
          <PnLDisplay pnl={pos.pnl} pnlPct={pos.pnl_pct} />
        </Table.Td>
        <Table.Td>
          <Text size="xs" c="dimmed">{formatElapsed(pos.entry_time)}</Text>
        </Table.Td>
        <Table.Td>
          <Tooltip label="Close position">
            <ActionIcon variant="subtle" color="gray" size="sm" onClick={(e) => { e.stopPropagation(); onClose(pos.symbol, pos.current_price); }} data-testid={`close-position-${pos.symbol}`}>
              ✕
            </ActionIcon>
          </Tooltip>
        </Table.Td>
      </Table.Tr>
      <Table.Tr key={`${pos.order_id || `${pos.strategy_id}-${pos.symbol}`}-detail`}>
        <Table.Td colSpan={5} style={{ padding: 0, border: "none" }}>
          <Collapse in={expanded}>
            <Box p="xs" bg="dark.7" style={{ borderBottom: "1px solid var(--mantine-color-dark-4)" }}>
              <PositionDetail pos={pos} />
            </Box>
          </Collapse>
        </Table.Td>
      </Table.Tr>
    </Fragment>
  );
});

const _52wCache: Record<string, { high_52w: number; low_52w: number }> = {};

const PositionDetail = memo(function PositionDetail({ pos }: { pos: PaperPosition }) {
  console.log("[PositionDetail] pos:", pos.symbol, "order_id:", pos.order_id, "id:", pos.id);
  const [notes, setNotes] = useState(pos.notes || "");
  const [saving, setSaving] = useState(false);
  const [week52, setWeek52] = useState<{ high_52w: number; low_52w: number } | null>(null);
  const [loading52, setLoading52] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (_52wCache[pos.symbol]) {
      setWeek52(_52wCache[pos.symbol]);
      setLoading52(false);
      return;
    }
    setLoading52(true);
    fetch52WLevels(pos.symbol).then((data) => {
      if (!cancelled) {
        _52wCache[pos.symbol] = data;
        setWeek52(data);
        setLoading52(false);
      }
    });
    return () => { cancelled = true; };
  }, [pos.symbol]);

  const handleSaveNotes = async () => {
    setSaving(true);
    await updatePositionNotesAction(pos.order_id, notes, null);
    setSaving(false);
  };

  return (
    <Stack gap={2}>
      <SimpleGrid cols={2} spacing="xs">
        <Box style={{ overflow: "hidden" }}>
          <Text size="xs" c="dimmed">Entry Reason</Text>
          <Text size="sm" style={{ wordBreak: "break-word" }}>{pos.entry_reason || "—"}</Text>
        </Box>
        <Box style={{ overflow: "hidden" }}>
          <Text size="xs" c="dimmed">Exit Reason</Text>
          <Text size="sm" style={{ wordBreak: "break-word" }}>Open (no exit yet)</Text>
        </Box>
      </SimpleGrid>
      <SimpleGrid cols={4} spacing={2}>
        <Box>
          <Text size="xs" c="dimmed">Stop Loss</Text>
          <Text size="sm" c="red">{pos.stop_loss ? `₹${pos.stop_loss.toFixed(2)}` : "—"}</Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">Take Profit</Text>
          <Text size="sm" c="teal">{pos.take_profit ? `₹${pos.take_profit.toFixed(2)}` : "—"}</Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">Peak</Text>
          <Text size="sm">{pos.peak_price ? `₹${pos.peak_price.toFixed(2)}` : "—"}</Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">Low</Text>
          <Text size="sm">{pos.low_price ? `₹${pos.low_price.toFixed(2)}` : "—"}</Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">52W High</Text>
          <Text size="sm" c="orange">
            {loading52 ? <Loader size="xs" /> : week52?.high_52w ? `₹${week52.high_52w.toFixed(2)}` : "—"}
          </Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">52W Low</Text>
          <Text size="sm" c="blue">
            {loading52 ? <Loader size="xs" /> : week52?.low_52w ? `₹${week52.low_52w.toFixed(2)}` : "—"}
          </Text>
        </Box>
        <Box>
          <Text size="xs" c="dimmed">Position ID</Text>
          <Text size="xs" style={{ wordBreak: "break-all" }}>{pos.order_id || pos.id || "—"}</Text>
        </Box>
      </SimpleGrid>
      <Box>
        <Text size="xs" c="dimmed" mb={2}>Notes</Text>
        <Group gap="xs">
          <Textarea
            size="xs"
            value={notes}
            onChange={(e) => setNotes(e.currentTarget.value)}
            placeholder="Add notes..."
            style={{ flex: 1 }}
            maxLength={500}
            autosize
            minRows={1}
            maxRows={3}
          />
          <Button size="compact-xs" variant="light" onClick={handleSaveNotes} loading={saving}>Save</Button>
        </Group>
      </Box>
    </Stack>
  );
});

export function getPositionAgeColor(entryTime: string): string {
  const elapsed = Date.now() - new Date(entryTime).getTime();
  const hours = elapsed / (1000 * 60 * 60);
  if (hours > 4) return "var(--mantine-color-orange-1)";
  if (hours > 2) return "var(--mantine-color-orange-0)";
  return "transparent";
}

export function PositionsTableBody({
  positions,
  selectedSymbol: _selectedSymbol,
  onSelect: externalOnSelect,
  onClose: externalOnClose,
}: {
  positions: PaperPosition[];
  selectedSymbol?: string | null;
  onSelect?: (
    symbol: string,
    tradeId?: string,
    strategyName?: string,
    strategyType?: string,
    strategyId?: number,
    entryTime?: string,
  ) => void;
  onClose?: (symbol: string, price: number) => void;
}) {
  const handleClosePosition = async (symbol: string, currentPrice: number) => {
    if (externalOnClose) {
      externalOnClose(symbol, currentPrice);
      return;
    }
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
    if (externalOnSelect) {
      externalOnSelect(symbol, _tradeId, _strategyName, _strategyType, strategyId, entryTime);
      return;
    }
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
      fromDate,
    );
  };

  return (
    <DataTable styles={TABLE_STYLES} dataTestId="positions-table">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>Symbol</Table.Th>
          <Table.Th>Entry→Curr</Table.Th>
          <Table.Th>P&L</Table.Th>
          <Table.Th>Age</Table.Th>
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
      <Group justify="space-between" px={4} py={2}>
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
      mt={2}
      pt={2}
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
                  {formatSignedPnl(s.totalPnl)}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </DataTable>
    </Flex>
  );
}
