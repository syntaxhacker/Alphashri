import { memo, useRef, useState, useEffect, useMemo } from "react";
import { Text, Group, Flex, Tooltip, ActionIcon, Badge, Collapse, Box, Stack, SimpleGrid, Textarea, Button, Loader } from "@/ui";
import type { ColumnDef } from "@tanstack/react-table";
import dayjs from "dayjs";
import { ClickableSymbol } from "../common";
import { fetchPaperChart, closePaperPosition, refreshLiveData, fetch52WLevels } from "../../api/paperTrading";
import {
  getPaperTradingState,
  setSelectedSymbol,
  setSelectedTradeId,
  updatePositionNotesAction,
} from "../../state/paperTrading";
import type { PaperPosition, PaperScanItem, PaperBotSnapshot } from "../../types/paperTrading";
import { TanStackTable } from "../common/TanStackTable";
import {
  formatSignedPnl,
  formatPercentage,
  formatElapsed,
  formatCurrencyIN,
  getPnLTextColor,
} from "../../utils/ui-helpers";
import { POSITIVE, NEGATIVE } from "../../config/colors";

function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function nearBreakoutPct(item: PaperScanItem): number {
  const price = item.price;
  const orHigh = item.or_high;
  const orLow = item.or_low;
  const high52w = item.high_52w;

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

const PriceCell = memo(function PriceCell({ price, quantity, entry }: { price: number; quantity: number; entry: number }) {
  const prevPrice = usePrevPrice(price);
  const safePrice = Number.isFinite(price) ? price : 0;
  const safeEntry = Number.isFinite(entry) ? entry : 0;
  const safeQty = Number.isFinite(quantity) ? quantity : 0;
  return (
    <Text size="sm">
      {safeQty}×₹{safeEntry.toFixed(0)}
      <Text span c="dimmed" size="xs">→</Text>
      <PriceDisplay price={safePrice} prevPrice={Number.isFinite(prevPrice) ? prevPrice : 0} />
    </Text>
  );
});

const PriceDisplay = memo(function PriceDisplay({ price, prevPrice }: { price: number; prevPrice: number }) {
  const safePrice = Number.isFinite(price) ? price : 0;
  const safePrev = Number.isFinite(prevPrice) ? prevPrice : 0;
  const [flash, setFlash] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    if (safePrice !== safePrev && safePrev > 0) {
      const direction = safePrice > safePrev ? "up" : "down";
      setFlash(direction);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setFlash(null), 600);
    }
  }, [safePrice, safePrev]);

  return (
    <span
      className={
        flash === "up" ? "price-flash-up" : flash === "down" ? "price-flash-down" : undefined
      }
      style={{ display: "inline-block", padding: "0 2px" }}
      onAnimationEnd={() => setFlash(null)}
    >
      ₹{safePrice.toFixed(2)}
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

function sanitizeTestIdValue(value: string | number): string {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function getCompositeRowId(pos: PaperPosition): string {
  const strat = pos.strategy_id ?? (pos as unknown as { id?: string | number }).id ?? 0;
  return `${sanitizeTestIdValue(strat)}-${sanitizeTestIdValue(pos.symbol)}`;
}

function getSideColor(side: string): string {
  return side === "BUY" ? POSITIVE : NEGATIVE;
}

function calcRowBg(current: number, entry: number, sl: number, tp: number): string {
  if (!Number.isFinite(current) || !Number.isFinite(entry) || !Number.isFinite(sl)) return "transparent";
  const slDist = entry - sl;
  const tpDist = Number.isFinite(tp) && tp > 0 ? tp - entry : null;
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
  return `linear-gradient(90deg, ${withAlpha(NEGATIVE, 0.08)} 0%, ${withAlpha(NEGATIVE, 0.12)} ${redStop}%, transparent ${redStop}%, transparent ${greenStart}%, ${withAlpha(POSITIVE, 0.12)} ${greenStart}%, ${withAlpha(POSITIVE, 0.08)} 100%)`;
}

const _52wCache: Record<string, { high_52w: number; low_52w: number }> = {};

const PositionDetail = memo(function PositionDetail({ pos }: { pos: PaperPosition }) {
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
            onChange={(val) => setNotes(val)}
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
  if (hours > 4) return "rgba(251, 146, 60, 0.15)";
  if (hours > 2) return "rgba(251, 146, 60, 0.08)";
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
    try {
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
    } catch (err) {
      console.error("handleSelect failed:", err);
    }
  };

  const columns = useMemo<ColumnDef<PaperPosition>[]>(() => [
    {
      id: "toggle",
      header: "",
      size: 32,
      enableSorting: false,
       cell: ({ row }) => (
        <ActionIcon
          variant="subtle"
          color="gray"
          size="sm"
          onClick={(e) => { e.stopPropagation(); row.toggleExpanded(); }}
          data-testid={`position-expand-${getCompositeRowId(row.original)}`}
        >
          {row.getIsExpanded() ? "▼" : "▶"}
        </ActionIcon>
      ),
    },
    {
      id: "symbol",
      header: "Symbol",
      size: 100,
      accessorKey: "symbol",
      cell: ({ row }) => {
        const pos = row.original;
        const tpLabel = pos.take_profit > 0 ? `₹${pos.take_profit.toFixed(2)}` : "trail";
        return (
          <Tooltip label={`SL: ₹${pos.stop_loss.toFixed(2)} | TP: ${tpLabel}`}>
            <ClickableSymbol
              symbol={pos.symbol}
              showPreview
              onClick={() => {
                handleSelect(pos.symbol, pos.order_id, pos.strategy_name, undefined, pos.strategy_id, pos.entry_time)
                  .catch((err) => console.error("Position select failed:", err));
              }}
            />
          </Tooltip>
        );
      },
    },
    {
      id: "price",
      header: "Entry→Curr",
      size: 160,
      accessorFn: (row) => row.current_price - row.entry_price,
      cell: ({ row }) => {
        const pos = row.original;
        return <PriceCell price={pos.current_price} quantity={pos.quantity} entry={pos.entry_price} />;
      },
    },
    {
      id: "pnl",
      header: "P&L",
      size: 100,
      accessorFn: (row) => row.pnl,
      cell: ({ row }) => <PnLDisplay pnl={row.original.pnl} pnlPct={row.original.pnl_pct} />,
    },
    {
      id: "age",
      header: "Age",
      size: 80,
      accessorFn: (row) => row.entry_time,
      cell: ({ row }) => <Text size="xs" c="dimmed">{formatElapsed(row.original.entry_time)}</Text>,
    },
    {
      id: "close",
      header: "",
      size: 40,
      enableSorting: false,
      cell: ({ row }) => {
        const pos = row.original;
        return (
          <Tooltip label="Close position">
            <ActionIcon
              variant="subtle"
              color="gray"
              size="sm"
              onClick={(e) => { e.stopPropagation(); handleClosePosition(pos.symbol, pos.current_price); }}
              data-testid={`close-position-${getCompositeRowId(pos)}`}
            >
              ✕
            </ActionIcon>
          </Tooltip>
        );
      },
    },
  ], [externalOnSelect, externalOnClose]);

  return (
    <TanStackTable<PaperPosition>
      data={positions}
      columns={columns}
      getRowCanExpand={() => true}
      renderSubComponent={(pos) => (
        <Box p="xs" sx={(theme) => ({ background: theme.palette.grey[800] })}>
          <PositionDetail pos={pos} />
        </Box>
      )}
      getRowStyle={(pos) => ({
        cursor: "pointer",
        background: calcRowBg(pos.current_price, pos.entry_price, pos.stop_loss, pos.take_profit),
        transition: "background 0.5s ease",
      })}
      getRowTestId={(pos) => `position-row-${getCompositeRowId(pos)}`}
      dataTestId="positions-table"
    />
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

  const columns: ColumnDef<(typeof summaries)[0]>[] = [
    { id: "name", header: "Strategy", accessorKey: "name", cell: ({ row }) => <Text fw={600} size="sm">{row.original.name}</Text> },
    { id: "count", header: "Pos", accessorKey: "count", cell: ({ row }) => <>{row.original.count}</> },
    { id: "marginUsed", header: "Margin", accessorKey: "marginUsed", cell: ({ row }) => <>₹{formatCurrencyIN(row.original.marginUsed)}</> },
    {
      id: "totalPnl",
      header: "P&L",
      accessorKey: "totalPnl",
      cell: ({ row }) => (
        <Text c={getPnLTextColor(row.original.totalPnl)} fw={600} size="sm">
          {formatSignedPnl(row.original.totalPnl)}
        </Text>
      ),
    },
  ];

  return (
    <Flex
      direction="column"
      mt={2}
      pt={2}
      data-testid="strategy-summary-footer"
      className="paper-strategy-summary"
      id="strategy-summary"
    >
      <Text fw={600} size="xs" c="dimmed" tt="uppercase" mb={2}>
        Strategy Summary
      </Text>
      <TanStackTable
        data={summaries}
        columns={columns}
        enableSorting={false}
        dataTestId="strategy-summary-table"
      />
    </Flex>
  );
}
