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
import { TradingViewChart, type TradingViewChartHandle } from "../chart/TradingViewChart";
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

const toSec = (s: string | undefined): number =>
  s ? Math.floor(new Date(s.replace(" ", "T")).getTime() / 1000) : NaN;

/** Strategy reference lines for a single trade (OR/ pivots / 52W) + entry/exit. */
function tradeLevels(entry: ChartTrade | undefined, trade: ReplayTrade): MarkLineData[] {
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
      label: { position: "insideEndTop", formatter: `${label} ${v}` },
    });
  };

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

function TradeChartRow({
  bars,
  barSecs,
  trade,
  levels,
  index,
  timeLabel,
}: {
  bars: { time: string; open: number; high: number; low: number; close: number; volume: number }[];
  barSecs: number[];
  trade: ReplayTrade;
  levels: MarkLineData[];
  index: number;
  timeLabel: (ts: number) => string;
}) {
  const ref = useRef<TradingViewChartHandle | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  // Mount the (heavy) lightweight-charts instance only while the row is near the
  // viewport, so a 100+ trade list never creates all charts at once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => setInView(entries[0]?.isIntersecting ?? false),
      { root: null, rootMargin: "400px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || barSecs.length === 0) return;
    const total = barSecs.length;
    const entryIdx = findIdx(barSecs, toSec(trade.entry_time));
    const exitIdx = findIdx(barSecs, toSec(trade.exit_time));
    const timer = setTimeout(() => {
      ref.current?.zoomToIndexRange(Math.max(0, entryIdx - 4), Math.min(total - 1, exitIdx + 4), total);
    }, 140);
    return () => clearTimeout(timer);
  }, [barSecs, trade, inView]);

  const pnlColor = trade.pnl >= 0 ? palette.POSITIVE : palette.NEGATIVE;

  return (
    <Card elevation={0} sx={{ flex: "0 0 auto", border: `1px solid ${palette.BORDER}`, bgcolor: palette.NT_BG, overflow: "hidden" }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 1, py: "4px", borderBottom: `1px solid ${palette.BORDER}` }}>
        <Chip size="small" label={`#${index + 1}`} sx={{ height: 16, fontSize: 10, bgcolor: palette.SURFACE_ALT, color: palette.TEXT }} />
        <Chip size="small" label={trade.side} color={trade.side === "SHORT" ? "error" : "success"} sx={{ height: 16, fontSize: 10, fontWeight: 700 }} />
        <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, whiteSpace: "nowrap" }}>
          {timeLabel(toSec(trade.entry_time))} → {timeLabel(toSec(trade.exit_time))}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography variant="caption" sx={{ color: palette.TEXT_MUTED }}>{trade.exit_reason}</Typography>
        <Typography variant="caption" sx={{ color: pnlColor, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {trade.pnl >= 0 ? "+" : ""}{trade.pnl.toFixed(0)}
        </Typography>
      </Stack>
      <Box ref={containerRef} sx={{ height: 340, minHeight: 340, flex: "0 0 auto", display: "flex" }}>
        {inView ? (
          <TradingViewChart
            ref={ref}
            theme="nt"
            entryLabels
            candles={bars}
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

export function BacktestTradeCharts({ chartData }: { chartData: SymbolChartData | null | undefined }) {
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
  const trades = useMemo(() => (chartData ? mapTrades(chartData) : []), [chartData]);
  const entryByTrade = useMemo(() => {
    const m = new Map<number, ChartTrade>();
    for (const t of chartData?.trades ?? []) if (t.type === "entry") m.set(t.trade_id, t);
    return m;
  }, [chartData]);

  const timeLabel = (ts: number) =>
    Number.isFinite(ts)
      ? new Date(ts * 1000).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })
      : "—";

  if (!chartData || trades.length === 0) {
    return (
      <Box sx={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <Typography variant="body2" color="text.secondary">No trades to show.</Typography>
      </Box>
    );
  }

  return (
    <Box data-testid="trade-charts" sx={{ height: "100%", overflow: "auto", p: 1, display: "flex", flexDirection: "column", gap: 1, bgcolor: "background.default" }}>
      {trades.map((t, i) => (
        <TradeChartRow key={t.id} index={i} bars={bars} barSecs={barSecs} trade={t} levels={tradeLevels(entryByTrade.get(t.id), t)} timeLabel={timeLabel} />
      ))}
    </Box>
  );
}
