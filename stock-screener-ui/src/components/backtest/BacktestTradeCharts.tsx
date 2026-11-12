// BacktestTradeCharts — "per trade" view: each trade gets its own row/chart with
// only that trade's markers + its strategy reference lines, auto-zoomed to the
// trade window. Reuses the NT TradingViewChart (lightweight-charts).
import { createEffect, createMemo, createSignal, For, Show, onCleanup } from "solid-js";
import * as palette from "@/ui/palette";
import { Badge, Text, Card, Stack } from "@/ui";
import { TradingViewChart } from "../chart/TradingViewChart";
import type { MarkLineData } from "../../utils/chart/types";
import type { SymbolChartData, ChartTrade } from "../../types/backtest";
import type { ReplayTrade } from "../../types/replay";
import {
  PIVOT_OR_HIGH,
  PIVOT_OR_LOW,
  PIVOT_PP,
  PIVOT_R1,
  PIVOT_S1,
  PIVOT_52W_HIGH,
} from "../../config/colors";
import { mapTrades } from "./BacktestChart";
import { DEFAULT_TRADE_FILTERS, canonicalSide, filterTrades, type TradeFilters } from "./tradeFilters";
// Times are naive IST strings; parse them explicitly as +05:30 so the browser's
// local timezone never shifts them.
const toSec = (s: string | undefined): number => {
  if (!s) return NaN;
  const iso = s.includes("T") ? s : s.replace(" ", "T");
  const hasTz = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(iso);
  return Math.floor(new Date(hasTz ? iso : `${iso}+05:30`).getTime() / 1000);
};

const pctOf = (v: unknown, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Stop-loss / take-profit prices from the trade + strategy params. */
function deriveSLTP(
  trade: ReplayTrade,
  entry: ChartTrade | undefined,
  params: Record<string, unknown> | undefined,
  strategyType: string | undefined,
): { sl: number | null; tp: number | null } {
  const isLong = (trade.side || "BUY").toUpperCase() !== "SELL";
  const slPct = pctOf(params?.sl_pct ?? params?.stop_loss_pct, 1.0);
  const tpPct = pctOf(params?.take_profit_pct ?? params?.tp_pct, 0);
  const entryPrice = trade.entry_price;

  let sl: number | null = isLong ? entryPrice * (1 - slPct / 100) : entryPrice * (1 + slPct / 100);
  const tp: number | null = tpPct > 0
    ? (isLong ? entryPrice * (1 + tpPct / 100) : entryPrice * (1 - tpPct / 100))
    : null;

  const st = (strategyType || "").toUpperCase();
  const h52 = (entry?.trade as unknown as Record<string, number> | undefined)?.["52w_high"];
  if (st.includes("52W_CHASER") && h52) sl = h52;

  return { sl, tp };
}

/** Strategy reference lines for a single trade (SL/TP + OR/pivots/52W + entry/exit). */
function tradeLevels(
  entry: ChartTrade | undefined,
  trade: ReplayTrade,
  params: Record<string, unknown> | undefined,
  strategyType: string | undefined,
): MarkLineData[] {
  const out: MarkLineData[] = [];
  const seen = new Set<string>();
  const push = (v: number | null | undefined, color: string, label: string) => {
    if (v == null || !Number.isFinite(v) || v <= 0) return;
    const key = `${label}:${v}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      yAxis: v,
      lineStyle: { color, type: "solid", width: 1 },
      label: { position: "insideEndTop", formatter: `${label} ${v.toFixed(1)}` },
    });
  };

  const { sl, tp } = deriveSLTP(trade, entry, params, strategyType);
  push(sl, palette.NEGATIVE, "SL");
  push(tp, palette.POSITIVE, "TP");

  const t = entry?.trade;
  if (t) {
    push(t.or_high, PIVOT_OR_HIGH, "OR-H");
    push(t.or_low, PIVOT_OR_LOW, "OR-L");
    push(t.pp, PIVOT_PP, "PP");
    push(t.r1, PIVOT_R1, "R1");
    push(t.s1, PIVOT_S1, "S1");
    push(t.r2, PIVOT_R1, "R2");
    push(t.s2, PIVOT_S1, "S2");
    push((t as unknown as Record<string, number>)["52w_high"], PIVOT_52W_HIGH, "52W");
  }
  push(trade.entry_price, palette.PRIMARY, "Entry");
  push(trade.exit_price, trade.pnl >= 0 ? palette.POSITIVE : palette.NEGATIVE, "Exit");
  return out;
}

function findIdx(secs: number[], sec: number): number {
  if (!Number.isFinite(sec) || secs.length === 0) return 0;
  let lo = 0, hi = secs.length - 1, ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (secs[mid] <= sec) { ans = mid; lo = mid + 1; } else { hi = mid - 1; }
  }
  return ans;
}

const TRADE_WINDOW_PAD = 90;

// One shared IntersectionObserver for the whole per-trade list (instead of one
// per row) — keeps observer count at 1 even for very large trade counts.
const rowVisibility = new WeakMap<Element, (visible: boolean) => void>();
let sharedObserver: IntersectionObserver | null = null;
function observeRow(el: Element, cb: (visible: boolean) => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    cb(true);
    return () => {};
  }
  if (!sharedObserver) {
    sharedObserver = new IntersectionObserver(
      (entries) => {
        for (const e of entries) rowVisibility.get(e.target)?.(e.isIntersecting);
      },
      { root: null, rootMargin: "400px 0px", threshold: 0 },
    );
  }
  rowVisibility.set(el, cb);
  sharedObserver.observe(el);
  return () => {
    rowVisibility.delete(el);
    sharedObserver?.unobserve(el);
  };
}

const EMPTY_LEVELS: MarkLineData[] = [];

function TradeChartRow(props: {
  bars: { time: string; open: number; high: number; low: number; close: number; volume: number }[];
  barSecs: number[];
  trade: ReplayTrade;
  entry: ChartTrade | undefined;
  params?: Record<string, unknown>;
  strategyType?: string;
  index: number;
  number: number;
  daily: boolean;
  symbol: string;
  rsi?: { period: number; data: (number | null)[] };
}) {
  let containerRef: HTMLDivElement | undefined;
  const [inView, setInView] = createSignal(false);

  const fmt = (s: string | undefined) => {
    const ts = toSec(s);
    if (!Number.isFinite(ts)) return "—";
    return new Date(ts * 1000).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      ...(props.daily
        ? { day: "2-digit", month: "short" }
        : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }),
    });
  };

  // Mount the (heavy) lightweight-charts instance only while the row is near the
  // viewport, so a 100+ trade list never creates all charts at once.
  createEffect(() => {
    if (!containerRef) return;
    const el = containerRef;
    const unobserve = observeRow(el, setInView);
    onCleanup(unobserve);
  });

  // Only feed the chart the trade's own window (± padding). Rendering ~200 bars
  // instead of the full multi-thousand-bar series keeps render + symbol switch fast.
  const tradeWindow = createMemo(() => {
    const bars = props.bars;
    const barSecs = props.barSecs;
    const rsi = props.rsi;
    if (barSecs.length === 0) return { bars, rsiData: rsi };
    const total = barSecs.length;
    const entryIdx = findIdx(barSecs, toSec(props.trade.entry_time));
    const exitIdx = findIdx(barSecs, toSec(props.trade.exit_time));
    const start = Math.max(0, entryIdx - TRADE_WINDOW_PAD);
    const end = Math.min(total - 1, exitIdx + TRADE_WINDOW_PAD);
    return {
      bars: bars.slice(start, end + 1),
      rsiData: rsi ? { period: rsi.period, data: rsi.data.slice(start, end + 1) } : undefined,
    };
  });

  // Level lines are only needed for rows that are actually on screen.
  const levels = createMemo(() =>
    inView() ? tradeLevels(props.entry, props.trade, props.params, props.strategyType) : EMPTY_LEVELS,
  );

  const pnlColor = () => props.trade.pnl >= 0 ? palette.POSITIVE : palette.NEGATIVE;

  return (
    <Card
      data-trade-number={props.number}
      className="flex-shrink-0 rounded-fin overflow-hidden"
      style={{
        border: `1px solid ${palette.BORDER}`,
        "background-color": palette.NT_BG,
        contentVisibility: "auto",
        containIntrinsicSize: "auto 371px",
      }}
    >
      <Stack
        direction="row"
        align="center"
        spacing={1}
        px={1}
        py="4px"
        style={{ borderBottom: `1px solid ${palette.BORDER}` }}
      >
        <Badge size="xs" style={{ height: "16px", fontSize: "10px", "background-color": palette.SURFACE_ALT, color: palette.TEXT }}>
          {`#${props.number}`}
        </Badge>
        <Badge
          size="xs"
          data-testid={`trade-symbol-${props.index}`}
          style={{ height: "16px", fontSize: "10px", fontWeight: 700, "background-color": palette.PRIMARY, color: palette.NT_BG }}
        >
          {props.symbol}
        </Badge>
        <Badge
          size="xs"
          style={{ height: "16px", fontSize: "10px", fontWeight: 700 }}
          color={canonicalSide(props.trade.side) === "SHORT" ? "negative" : "positive"}
          variant="filled"
        >
          {canonicalSide(props.trade.side)}
        </Badge>
        <Text size="xs" c="muted" style={{ whiteSpace: "nowrap" }}>
          {fmt(props.trade.entry_time)} → {fmt(props.trade.exit_time)}
        </Text>
        <div class="flex-1" />
        <Text size="xs" c="muted">{props.trade.exit_reason}</Text>
        <Text size="xs" fw={700} c={pnlColor()} style={{ fontVariantNumeric: "tabular-nums" }} className="font-mono">
          {(props.trade.pnl ?? 0) >= 0 ? "+" : ""}{(props.trade.pnl ?? 0).toFixed(0)}
        </Text>
      </Stack>
      <div ref={containerRef} class="h-[340px] min-h-[340px] flex-shrink-0 flex" style={{ height: "340px", minHeight: "340px" }}>
        <Show
          when={inView()}
          fallback={<div class="flex-1" style={{ "background-color": palette.NT_BG }} />}
        >
          <TradingViewChart
            theme="nt"
            entryLabels
            candles={tradeWindow().bars}
            rsiData={tradeWindow().rsiData}
            trades={[props.trade]}
            showAllTrades
            markLines={levels()}
          />
        </Show>
      </div>
    </Card>
  );
}

export function BacktestTradeCharts(props: {
  chartData: SymbolChartData | null | undefined;
  params?: Record<string, unknown>;
  strategyType?: string;
  filters?: TradeFilters;
  symbols?: string[];
  selectedSymbol?: string;
  onSymbolSelect?: (symbol: string) => void;
}) {
  const bars = createMemo(() =>
    (props.chartData?.candles ?? []).map((c) => ({
      time: c.time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume ?? 0,
    })),
  );
  const barSecs = createMemo(() => bars().map((b) => toSec(b.time)));
  const barSeconds = () => (barSecs().length > 1 ? Math.round((barSecs()[barSecs().length - 1] - barSecs()[0]) / (barSecs().length - 1)) : 60);
  const daily = () => barSeconds() >= 86400;
  const allTrades = createMemo(() => (props.chartData ? mapTrades(props.chartData) : []));
  const active = () => props.filters ?? DEFAULT_TRADE_FILTERS;
  const trades = createMemo(() => filterTrades(allTrades(), active()));
  const entryByTrade = createMemo(() => {
    const m = new Map<number, ChartTrade>();
    for (const t of props.chartData?.trades ?? []) if (t.type === "entry") m.set(t.trade_id, t);
    return m;
  });

  const symbol = () => props.chartData?.symbol ?? props.selectedSymbol ?? "";
  const rsi = () => props.chartData?.rsi;
  const symbolList = () => (props.symbols && props.symbols.length > 0 ? props.symbols : symbol() ? [symbol()] : []);
  const netPnl = () => trades().reduce((s, t) => s + (t.pnl ?? 0), 0);

  return (
    <div class="h-full overflow-auto flex flex-col" style={{ "background-color": palette.BG }}>
      <Stack
        direction="row"
        align="center"
        spacing={0.5}
        px={1}
        py="4px"
        data-testid="trade-charts-header"
        style={{
          position: "sticky",
          top: 0,
          "z-index": 2,
          flex: "0 0 auto",
          borderBottom: `1px solid ${palette.BORDER}`,
          "background-color": palette.SURFACE,
        }}
      >
        <For each={symbolList()}>{(s) => (
          <Badge
            size="xs"
            onClick={() => props.onSymbolSelect?.(s)}
            data-testid={`trade-symbol-tab-${s}`}
            variant={s === (props.selectedSymbol ?? symbol()) ? "filled" : "light"}
            color={s === (props.selectedSymbol ?? symbol()) ? "primary" : "secondary"}
            style={{
              height: "18px",
              fontSize: "10px",
              fontWeight: 700,
              cursor: props.onSymbolSelect ? "pointer" : "default",
            }}
          >
            {s}
          </Badge>
        )}</For>
        <div class="flex-1" />
        <Text size="xs" c="muted" style={{ whiteSpace: "nowrap" }}>
          {trades().length}/{allTrades().length} trades · net{" "}
          <span style={{ color: netPnl() >= 0 ? palette.POSITIVE : palette.NEGATIVE, fontWeight: 700 }} className="font-mono tabular-nums">
            {netPnl() >= 0 ? "+" : ""}₹{netPnl().toFixed(0)}
          </span>
        </Text>
      </Stack>

      <Show
        when={props.chartData && allTrades().length > 0}
        fallback={
          <div class="flex-1 flex items-center justify-center">
            <Text size="xs" c="muted">No trades to show.</Text>
          </div>
        }
      >
        <Show
          when={trades().length > 0}
          fallback={
            <div class="flex-1 flex items-center justify-center">
              <Text size="xs" c="muted">No trades match the current filters.</Text>
            </div>
          }
        >
          <div data-testid="trade-charts" class="flex-1 min-h-0 overflow-auto p-2 flex flex-col gap-2">
            <For each={trades()}>{(t, i) => (
              <TradeChartRow
                index={i()}
                number={t.id}
                bars={bars()}
                barSecs={barSecs()}
                trade={t}
                symbol={symbol()}
                entry={entryByTrade().get(t.id)}
                params={props.params}
                strategyType={props.strategyType}
                daily={daily()}
                rsi={rsi()}
              />
            )}</For>
          </div>
        </Show>
      </Show>
    </div>
  );
}
