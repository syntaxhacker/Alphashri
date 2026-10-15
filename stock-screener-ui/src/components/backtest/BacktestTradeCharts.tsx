// BacktestTradeCharts — "per trade" view: each trade gets its own row/chart with
// only that trade's markers + its strategy reference lines, auto-zoomed to the
// trade window. Reuses the NT TradingViewChart (lightweight-charts).
import { useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import * as palette from "@/ui/palette";
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

// React Compiler (vite reactCompiler:true) auto-memoizes this component, so no
// manual React.memo is needed — only avoid doing work that isn't required.
function TradeChartRow({
  bars,
  barSecs,
  trade,
  entry,
  params,
  strategyType,
  index,
  number,
  daily,
  symbol,
  rsi,
}: {
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
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  const fmt = (s: string | undefined) => {
    const ts = toSec(s);
    if (!Number.isFinite(ts)) return "—";
    return new Date(ts * 1000).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      ...(daily
        ? { day: "2-digit", month: "short" }
        : { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }),
    });
  };

  // Mount the (heavy) lightweight-charts instance only while the row is near the
  // viewport, so a 100+ trade list never creates all charts at once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    return observeRow(el, setInView);
  }, []);

  // Only feed the chart the trade's own window (± padding). Rendering ~200 bars
  // instead of the full multi-thousand-bar series keeps render + symbol switch fast.
  const tradeWindow = useMemo(() => {
    if (barSecs.length === 0) return { bars, rsiData: rsi };
    const total = barSecs.length;
    const entryIdx = findIdx(barSecs, toSec(trade.entry_time));
    const exitIdx = findIdx(barSecs, toSec(trade.exit_time));
    const start = Math.max(0, entryIdx - TRADE_WINDOW_PAD);
    const end = Math.min(total - 1, exitIdx + TRADE_WINDOW_PAD);
    return {
      bars: bars.slice(start, end + 1),
      rsiData: rsi ? { period: rsi.period, data: rsi.data.slice(start, end + 1) } : undefined,
    };
  }, [bars, barSecs, trade, rsi]);

  // Level lines are only needed for rows that are actually on screen.
  const levels = useMemo(
    () => (inView ? tradeLevels(entry, trade, params, strategyType) : EMPTY_LEVELS),
    [inView, entry, trade, params, strategyType],
  );

  const pnlColor = trade.pnl >= 0 ? palette.POSITIVE : palette.NEGATIVE;

  return (
    <Card
      elevation={0}
      data-trade-number={number}
      sx={{
        flex: "0 0 auto",
        border: `1px solid ${palette.BORDER}`,
        bgcolor: palette.NT_BG,
        overflow: "hidden",
        // Let the browser skip layout/paint for off-screen rows (big lists).
        contentVisibility: "auto",
        containIntrinsicSize: "auto 371px",
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: "4px", borderBottom: `1px solid ${palette.BORDER}` }}>
        <Chip size="small" label={`#${number}`} sx={{ height: 16, fontSize: 10, bgcolor: palette.SURFACE_ALT, color: palette.TEXT }} />
        <Chip
          size="small"
          label={symbol}
          data-testid={`trade-symbol-${index}`}
          sx={{ height: 16, fontSize: 10, fontWeight: 700, bgcolor: palette.PRIMARY, color: palette.NT_BG }}
        />
        <Chip size="small" label={canonicalSide(trade.side)} color={canonicalSide(trade.side) === "SHORT" ? "error" : "success"} sx={{ height: 16, fontSize: 10, fontWeight: 700 }} />
        <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, whiteSpace: "nowrap" }}>
          {fmt(trade.entry_time)} → {fmt(trade.exit_time)}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: palette.TEXT_MUTED }}>{trade.exit_reason}</Typography>
        <Typography variant="caption" sx={{ color: pnlColor, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {(trade.pnl ?? 0) >= 0 ? "+" : ""}{(trade.pnl ?? 0).toFixed(0)}
        </Typography>
      </Stack>
      <Box ref={containerRef} sx={{ height: 340, minHeight: 340, flex: "0 0 auto", display: "flex" }}>
        {inView ? (
          <TradingViewChart
            theme="nt"
            entryLabels
            candles={tradeWindow.bars}
            rsiData={tradeWindow.rsiData}
            trades={[trade]}
            showAllTrades
            markLines={levels}
          />
        ) : (
          <Box sx={{ flex: 1, bgcolor: palette.NT_BG }} />
        )}
      </Box>
    </Card>
  );
}

export function BacktestTradeCharts({
  chartData,
  params,
  strategyType,
  filters,
  symbols,
  selectedSymbol,
  onSymbolSelect,
}: {
  chartData: SymbolChartData | null | undefined;
  params?: Record<string, unknown>;
  strategyType?: string;
  filters?: TradeFilters;
  symbols?: string[];
  selectedSymbol?: string;
  onSymbolSelect?: (symbol: string) => void;
}) {
  const bars = useMemo(
    () =>
      (chartData?.candles ?? []).map((c) => ({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume ?? 0,
      })),
    [chartData],
  );
  const barSecs = useMemo(() => bars.map((b) => toSec(b.time)), [bars]);
  const barSeconds = barSecs.length > 1 ? Math.round((barSecs[barSecs.length - 1] - barSecs[0]) / (barSecs.length - 1)) : 60;
  const daily = barSeconds >= 86400;
  const allTrades = useMemo(() => (chartData ? mapTrades(chartData) : []), [chartData]);
  const active = filters ?? DEFAULT_TRADE_FILTERS;
  const trades = useMemo(
    () => filterTrades(allTrades, active),
    [allTrades, active.side, active.result, active.reason],
  );
  const entryByTrade = useMemo(() => {
    const m = new Map<number, ChartTrade>();
    for (const t of chartData?.trades ?? []) if (t.type === "entry") m.set(t.trade_id, t);
    return m;
  }, [chartData]);

  const symbol = chartData?.symbol ?? selectedSymbol ?? "";
  const rsi = chartData?.rsi;
  const symbolList = symbols && symbols.length > 0 ? symbols : symbol ? [symbol] : [];
  const netPnl = useMemo(() => trades.reduce((s, t) => s + (t.pnl ?? 0), 0), [trades]);

  return (
    <Box sx={{ height: "100%", overflow: "auto", display: "flex", flexDirection: "column", bgcolor: "background.default" }}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={0.5}
        data-testid="trade-charts-header"
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          flex: "0 0 auto",
          px: 1,
          py: "4px",
          borderBottom: `1px solid ${palette.BORDER}`,
          bgcolor: "background.paper",
        }}
      >
        {symbolList.map((s) => (
          <Chip
            key={s}
            size="small"
            label={s}
            onClick={() => onSymbolSelect?.(s)}
            variant={s === (selectedSymbol ?? symbol) ? "filled" : "outlined"}
            color={s === (selectedSymbol ?? symbol) ? "primary" : "default"}
            data-testid={`trade-symbol-tab-${s}`}
            sx={{ height: 18, fontSize: 10, fontWeight: 700, cursor: onSymbolSelect ? "pointer" : "default" }}
          />
        ))}
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, whiteSpace: "nowrap" }}>
          {trades.length}/{allTrades.length} trades · net{" "}
          <Box component="span" sx={{ color: netPnl >= 0 ? palette.POSITIVE : palette.NEGATIVE, fontWeight: 700 }}>
            {netPnl >= 0 ? "+" : ""}₹{netPnl.toFixed(0)}
          </Box>
        </Typography>
      </Stack>

      {!chartData || allTrades.length === 0 ? (
        <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Typography variant="body2" color="text.secondary">No trades to show.</Typography>
        </Box>
      ) : trades.length === 0 ? (
        <Box sx={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Typography variant="body2" color="text.secondary">No trades match the current filters.</Typography>
        </Box>
      ) : (
        <Box data-testid="trade-charts" sx={{ flex: 1, minHeight: 0, overflow: "auto", p: 1, display: "flex", flexDirection: "column", gap: 1 }}>
          {trades.map((t, i) => (
            <TradeChartRow
              key={t.id}
              index={i}
              number={t.id}
              bars={bars}
              barSecs={barSecs}
              trade={t}
              symbol={symbol}
              entry={entryByTrade.get(t.id)}
              params={params}
              strategyType={strategyType}
              daily={daily}
              rsi={rsi}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
