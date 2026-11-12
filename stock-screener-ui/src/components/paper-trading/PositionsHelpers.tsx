import { createMemo, createSignal, onCleanup, onMount } from "solid-js";
import { Text, Tooltip, ActionIcon, SimpleGrid, Textarea, Button, Loader, Flex, Box, Stack } from "@/ui";
import { IconChevronRight, IconChevronDown } from "@/components/common/Icons";
import dayjs from "dayjs";
import { ClickableSymbolSolid } from "./ClickableSymbolSolid";
import { fetchPaperChart, closePaperPosition, refreshLiveData, fetch52WLevels } from "../../api/paperTrading";
import {
  getPaperTradingState,
  setSelectedSymbol,
  setSelectedTradeId,
  updatePositionNotesAction,
} from "../../state/paperTrading";
import type { PaperPosition, PaperScanItem } from "../../types/paperTrading";
import { TanStackTable, type TableColumnDef } from "./TanStackTable";
import {
  formatSignedPnl,
  formatPercentage,
  formatElapsed,
  formatCurrencyIN,
  getPnLTextColor,
} from "../../utils/ui-helpers";
import { POSITIVE, NEGATIVE, WARNING, BG, BORDER } from "@/ui/palette";
import { withAlpha } from "../../utils/color";
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

// Rows are destroyed and re-created on every store tick (TanStackTable keys
// `<For>` items by identity and every tick produces fresh position objects),
// so previous *values* live at module scope to keep tick flashes working
// across remounts.
const _prevPrice = new Map<string, number>();
const _prevPnl = new Map<string, number>();

const FLASH_MS = 600;

function PriceCell(props: { price: number; quantity: number; entry: number; flashKey: string }) {
  const safePrice = Number.isFinite(props.price) ? props.price : 0;
  const safeEntry = Number.isFinite(props.entry) ? props.entry : 0;
  const safeQty = Number.isFinite(props.quantity) ? props.quantity : 0;
  const prev = _prevPrice.get(props.flashKey);
  onMount(() => {
    _prevPrice.set(props.flashKey, safePrice);
  });
  return (
    <Text className="paper-price-cell whitespace-nowrap font-mono tabular-nums" size="sm">
      {safeQty}×₹{safeEntry.toFixed(2)}
      <Text className="paper-price-arrow" span c="dimmed" size="xs" mx={0.5}>→</Text>
      <PriceDisplay price={safePrice} prevPrice={prev !== undefined && Number.isFinite(prev) ? prev : 0} />
    </Text>
  );
}

function PriceDisplay(props: { price: number; prevPrice: number }) {
  const safePrice = Number.isFinite(props.price) ? props.price : 0;
  const safePrev = Number.isFinite(props.prevPrice) ? props.prevPrice : 0;
  const [flash, setFlash] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  onMount(() => {
    if (safePrice !== safePrev && safePrev > 0) {
      setFlash(safePrice > safePrev ? "up" : "down");
      timer = setTimeout(() => setFlash(null), FLASH_MS);
    }
  });

  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  return (
    <span
      classList={{
        priceFlashUp: flash() === "up",
        priceFlashDown: flash() === "down",
      }}
      style={{ display: "inline-block", padding: "0 2px" }}
      onAnimationEnd={() => setFlash(null)}
    >
      ₹{safePrice.toFixed(2)}
    </span>
  );
}

function PnLDisplay(props: { pnl: number; pnlPct: number; flashKey: string }) {
  const [flash, setFlash] = createSignal<string | null>(null);
  let timer: ReturnType<typeof setTimeout> | null = null;

  const pnl = props.pnl;
  const prev = _prevPnl.get(props.flashKey);
  onMount(() => {
    if (prev !== undefined && pnl !== prev) {
      setFlash(pnl > prev ? "up" : "down");
      timer = setTimeout(() => setFlash(null), FLASH_MS);
    }
    _prevPnl.set(props.flashKey, pnl);
  });

  onCleanup(() => {
    if (timer) clearTimeout(timer);
  });

  const pnlClass = getPnLTextColor(pnl);

  return (
    <Text
      c={pnlClass}
      fw={600}
      className={`paper-pnl-display font-mono tabular-nums${flash() === "up" ? " price-flash-up" : flash() === "down" ? " price-flash-down" : ""}`}
      onAnimationEnd={() => setFlash(null)}
      style={{ display: "inline" }}
    >
      {formatSignedPnl(pnl)}
      <Text className="paper-pnl-pct font-mono tabular-nums" span c={pnlClass} size="sm">
        {" "}
        ({formatPercentage(props.pnlPct)})
      </Text>
    </Text>
  );
}

function sanitizeTestIdValue(value: string | number): string {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "-");
}

function getCompositeRowId(pos: PaperPosition): string {
  const strat = pos.strategy_id ?? (pos as unknown as { id?: string | number }).id ?? 0;
  return `${sanitizeTestIdValue(strat)}-${sanitizeTestIdValue(pos.symbol)}`;
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
// Expanded rows are re-created on every tick, so in-progress notes drafts live
// at module scope to survive the remount.
const _notesDrafts = new Map<string, string>();

function PositionDetail(props: { pos: PaperPosition }) {
  const draftKey = String(props.pos.order_id || props.pos.symbol);
  const [notes, setNotes] = createSignal(_notesDrafts.get(draftKey) ?? props.pos.notes ?? "");
  const [saving, setSaving] = createSignal(false);
  const [week52, setWeek52] = createSignal<{ high_52w: number; low_52w: number } | null>(null);
  const [loading52, setLoading52] = createSignal(true);
  let cancelled = false;

  onMount(() => {
    if (_52wCache[props.pos.symbol]) {
      setWeek52(_52wCache[props.pos.symbol]);
      setLoading52(false);
      return;
    }
    setLoading52(true);
    fetch52WLevels(props.pos.symbol)
      .then((data) => {
        if (cancelled) return;
        if (data) _52wCache[props.pos.symbol] = data;
        setWeek52(data ?? null);
      })
      .catch(() => {
        if (!cancelled) setWeek52(null);
      })
      .finally(() => {
        if (!cancelled) setLoading52(false);
      });
  });

  onCleanup(() => {
    cancelled = true;
    _notesDrafts.set(draftKey, notes());
  });

  const handleSaveNotes = async () => {
    setSaving(true);
    await updatePositionNotesAction(props.pos.order_id, notes(), null);
    setSaving(false);
  };

  const updateNotes = (v: string) => {
    _notesDrafts.set(draftKey, v);
    setNotes(v);
  };

  return (
    <Stack className="paper-position-detail" id={`paper-position-detail-${props.pos.order_id || props.pos.symbol}`} gap={1}>
      <SimpleGrid className="paper-position-detail-reasons" id={`paper-position-reasons-${props.pos.symbol}`} cols={2} spacing="xs">
        <Box className="paper-position-entry-reason overflow-hidden" id={`paper-position-entry-reason-${props.pos.symbol}`}>
          <Text className="paper-position-label" size="xs" c="dimmed" className="uppercase" fw={600}>Entry Reason</Text>
          <Text className="paper-position-value break-words" size="sm">{props.pos.entry_reason || "—"}</Text>
        </Box>
        <Box className="paper-position-exit-reason overflow-hidden" id={`paper-position-exit-reason-${props.pos.symbol}`}>
          <Text className="paper-position-label" size="xs" c="dimmed" className="uppercase" fw={600}>Exit Reason</Text>
          <Text className="paper-position-value break-words" size="sm">Open (no exit yet)</Text>
        </Box>
      </SimpleGrid>
      <SimpleGrid className="paper-position-detail-stats" id={`paper-position-stats-${props.pos.symbol}`} cols={4} spacing="sm">
        <Box className="paper-position-stat p-1" id={`paper-position-sl-${props.pos.symbol}`}>
          <Text className="paper-position-label" size="xs" c="dimmed" className="uppercase" fw={600}>Stop Loss</Text>
          <Text className="paper-position-value font-mono tabular-nums" size="sm" c="error">{props.pos.stop_loss ? `₹${props.pos.stop_loss.toFixed(2)}` : "—"}</Text>
        </Box>
        <Box className="paper-position-stat p-1" id={`paper-position-tp-${props.pos.symbol}`}>
          <Text className="paper-position-label" size="xs" c="dimmed" className="uppercase" fw={600}>Take Profit</Text>
          <Text className="paper-position-value font-mono tabular-nums" size="sm" c="success">{props.pos.take_profit ? `₹${props.pos.take_profit.toFixed(2)}` : "—"}</Text>
        </Box>
        <Box className="paper-position-stat p-1" id={`paper-position-peak-${props.pos.symbol}`}>
          <Text className="paper-position-label" size="xs" c="dimmed" className="uppercase" fw={600}>Peak</Text>
          <Text className="paper-position-value font-mono tabular-nums" size="sm">{props.pos.peak_price ? `₹${props.pos.peak_price.toFixed(2)}` : "—"}</Text>
        </Box>
        <Box className="paper-position-stat p-1" id={`paper-position-low-${props.pos.symbol}`}>
          <Text className="paper-position-label" size="xs" c="dimmed" className="uppercase" fw={600}>Low</Text>
          <Text className="paper-position-value font-mono tabular-nums" size="sm">{props.pos.low_price ? `₹${props.pos.low_price.toFixed(2)}` : "—"}</Text>
        </Box>
        <Box className="paper-position-stat p-1" id={`paper-position-52high-${props.pos.symbol}`}>
          <Text className="paper-position-label" size="xs" c="dimmed" className="uppercase" fw={600}>52W High</Text>
          <Text className="paper-position-value font-mono tabular-nums" size="sm" c="warning">
            {loading52() ? <Loader size="xs" /> : week52()?.high_52w ? `₹${week52()!.high_52w.toFixed(2)}` : "—"}
          </Text>
        </Box>
        <Box className="paper-position-stat p-1" id={`paper-position-52low-${props.pos.symbol}`}>
          <Text className="paper-position-label" size="xs" c="dimmed" className="uppercase" fw={600}>52W Low</Text>
          <Text className="paper-position-value font-mono tabular-nums" size="sm" c="primary">
            {loading52() ? <Loader size="xs" /> : week52()?.low_52w ? `₹${week52()!.low_52w.toFixed(2)}` : "—"}
          </Text>
        </Box>
        <Box className="paper-position-stat p-1" id={`paper-position-id-${props.pos.symbol}`}>
          <Text className="paper-position-label" size="xs" c="dimmed" className="uppercase" fw={600}>Position ID</Text>
          <Text className="paper-position-value font-mono tabular-nums" size="xs break-all">{props.pos.order_id || props.pos.id || "—"}</Text>
        </Box>
      </SimpleGrid>
      <Box className="paper-position-notes" id={`paper-position-notes-${props.pos.symbol}`}>
        <Text className="paper-position-label" size="xs" c="dimmed" className="uppercase" fw={600} mb="xs">Notes</Text>
        <Box className="paper-position-notes-row flex items-center gap-2">
          <Box className="paper-position-notes-input-wrap flex-1 flex items-center">
            <Textarea
              className="paper-position-notes-textarea"
              size="xs"
              value={notes()}
              onInput={(e) => updateNotes(e.currentTarget.value)}
              placeholder="Add notes..."
              maxLength={500}
              autosize
              minRows={1}
              maxRows={3}
            />
          </Box>
          <Button className="paper-position-notes-save self-center" id={`paper-position-notes-save-${props.pos.symbol}`} size="compact-xs" variant="light" onClick={handleSaveNotes} loading={saving()}>Save</Button>
        </Box>
      </Box>
    </Stack>
  );
}

export function getPositionAgeColor(entryTime: string): string {
  const elapsed = Date.now() - new Date(entryTime).getTime();
  const hours = elapsed / (1000 * 60 * 60);
  if (hours > 4) return withAlpha(WARNING, 0.15);
  if (hours > 2) return withAlpha(WARNING, 0.08);
  return "transparent";
}

export function PositionsTableBody(props: {
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
    if (props.onClose) {
      props.onClose(symbol, currentPrice);
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
      if (props.onSelect) {
        props.onSelect(symbol, _tradeId, _strategyName, _strategyType, strategyId, entryTime);
        return;
      }
      setSelectedSymbol(symbol);
      setSelectedTradeId("-1", _strategyType, strategyId);
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

  const columns = createMemo<TableColumnDef<PaperPosition>[]>(() => [
    {
      id: "toggle",
      header: "",
      size: 32,
      meta: { align: "center" },
      enableSorting: false,
      cell: ({ row }) => (
        <ActionIcon
          variant="subtle"
          color="secondary"
          size="sm"
          aria-label={row.isExpanded() ? "Collapse" : "Expand"}
          onClick={(e: MouseEvent) => { e.stopPropagation(); row.toggle(); }}
          data-testid={`position-expand-${getCompositeRowId(row.original)}`}
        >
          {row.isExpanded() ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />}
        </ActionIcon>
      ),
    },
    {
      id: "symbol",
      header: "Symbol",
      size: 100,
      meta: { align: "left" },
      accessorKey: "symbol",
      cell: ({ row }) => {
        const pos = row.original;
        const tpLabel = pos.take_profit > 0 ? `₹${pos.take_profit.toFixed(2)}` : "trail";
        return (
          <Tooltip label={`SL: ₹${pos.stop_loss.toFixed(2)} | TP: ${tpLabel}`}>
            <ClickableSymbolSolid
              symbol={pos.symbol}
              onClick={() => {
                handleSelect(pos.symbol, pos.order_id, pos.strategy_name, pos.strategy_type, pos.strategy_id, pos.entry_time)
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
      meta: { align: "right" },
      accessorFn: (row) => row.current_price - row.entry_price,
      cell: ({ row }) => {
        const pos = row.original;
        return <PriceCell flashKey={`price-${getCompositeRowId(pos)}`} price={pos.current_price} quantity={pos.quantity} entry={pos.entry_price} />;
      },
    },
    {
      id: "pnl",
      header: "P&L",
      size: 100,
      meta: { align: "right" },
      accessorFn: (row) => row.pnl,
      cell: ({ row }) => <PnLDisplay flashKey={`pnl-${getCompositeRowId(row.original)}`} pnl={row.original.pnl} pnlPct={row.original.pnl_pct} />,
    },
    {
      id: "age",
      header: "Age",
      size: 80,
      meta: { align: "right" },
      accessorFn: (row) => row.entry_time,
      cell: ({ row }) => <Text size="xs" c="dimmed" className="whitespace-nowrap font-mono tabular-nums">{formatElapsed(row.original.entry_time)}</Text>,
    },
    {
      id: "close",
      header: "",
      size: 40,
      meta: { align: "center" },
      enableSorting: false,
      cell: ({ row }) => {
        const pos = row.original;
        return (
          <Tooltip label="Close position">
            <ActionIcon
              variant="subtle"
              color="secondary"
              size="sm"
              onClick={(e: MouseEvent) => { e.stopPropagation(); handleClosePosition(pos.symbol, pos.current_price); }}
              data-testid={`close-position-${getCompositeRowId(pos)}`}
            >
              ✕
            </ActionIcon>
          </Tooltip>
        );
      },
    },
  ]);

  return (
    <TanStackTable<PaperPosition>
      className="paper-positions-table"
      data={props.positions}
      columns={columns()}
      getRowCanExpand={() => true}
      renderSubComponent={(pos) => (
        <Box className="paper-position-expanded p-1" id={`paper-position-expanded-${pos.order_id || pos.symbol}`} style={{ "background-color": BG, "border-top": `1px solid ${BORDER}`, "border-bottom": `1px solid ${BORDER}` }}>
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
      stickyHeader
      dense
    />
  );
}

interface StrategySummaryRow {
  id: number;
  name: string;
  totalPnl: number;
  marginUsed: number;
  count: number;
}

export function StrategySummaryFooter(props: {
  strategyGroups: Map<number, PaperPosition[]>;
}) {
  const summaries = (): StrategySummaryRow[] =>
    Array.from(props.strategyGroups.entries()).map(([id, positions]) => ({
      id,
      name: positions[0]?.strategy_name || `Strategy ${id}`,
      ...calcStrategySummary(positions),
    }));

  const columns: TableColumnDef<StrategySummaryRow>[] = [
    { id: "name", header: "Strategy", accessorKey: "name", meta: { align: "left" }, cell: ({ row }) => <Text fw={600} size="sm">{row.original.name}</Text> },
    { id: "count", header: "Pos", accessorKey: "count", meta: { align: "right" }, cell: ({ row }) => <>{row.original.count}</> },
    { id: "marginUsed", header: "Margin", accessorKey: "marginUsed", meta: { align: "right" }, cell: ({ row }) => <>₹{formatCurrencyIN(row.original.marginUsed)}</> },
    {
      id: "totalPnl",
      header: "P&L",
      accessorKey: "totalPnl",
      meta: { align: "right" },
      cell: ({ row }) => (
        <Text c={getPnLTextColor(row.original.totalPnl)} fw={600} size="sm" className="font-mono tabular-nums">
          {formatSignedPnl(row.original.totalPnl)}
        </Text>
      ),
    },
  ];

  return (
    <Flex
      direction="column"
      mt={1}
      pt={1}
      data-testid="strategy-summary-footer"
      className="paper-strategy-summary"
      id="strategy-summary"
    >
      <Text fw={600} size="xs" c="dimmed" className="uppercase" mb={0.5}>
        Strategy Summary
      </Text>
      <TanStackTable
        data={summaries()}
        columns={columns}
        enableSorting={false}
        dataTestId="strategy-summary-table"
        dense
      />
    </Flex>
  );
}
