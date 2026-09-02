import { useEffect, useRef, useState } from "react";
import { createChart, ColorType, CandlestickSeries, createSeriesMarkers, type IChartApi, type Time } from "lightweight-charts";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import * as palette from "@/ui/palette";
import { TZ_IST, TZ_IST_LABEL } from "@/config/constants";
import type { Bar } from "@/utils/smc";

// Real trades from /api/poc/smc-trades — runs the actual SMCSignalGenerator (trading/smc_signals.py)
// bar-by-bar over real 1m data, outcomes evaluated against real subsequent bars (SL-first).
type SmcTrade = {
  time: number;
  exit_time: number;
  side: "LONG" | "SHORT";
  entry: number;
  sl: number;
  tp: number;
  result: "TP" | "SL" | "EOD";
  pnl: number;
  held_bars: number;
  note: string;
};

const formatTradeTime = (timestamp: number) =>
  new Date(timestamp * 1000).toLocaleString("en-IN", {
    timeZone: TZ_IST,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

const resultColor = (result: string) => (result === "TP" ? "success" : result === "EOD" ? "warning" : "error");

export default function SmcTrades() {
  const [sessions, setSessions] = useState<{ sess: string; bars: Bar[]; trades: SmcTrade[] }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const sessList = ["2026-09-01", "2026-08-27", "2026-08-31", "2026-08-28", "2026-08-26"];
    Promise.all(sessList.map(async (sess) => {
      try {
        const r = await fetch(`/api/poc/smc-trades?date=${sess}`);
        const j = await r.json();
        if (Array.isArray(j.bars) && j.bars.length > 20) return { sess, bars: j.bars as Bar[], trades: (j.trades || []) as SmcTrade[] };
      } catch {}
      return { sess, bars: [] as Bar[], trades: [] as SmcTrade[] };
    })).then(results => {
      setSessions(results);
      setLoading(false);
    });
  }, []);

  const totalTrades = sessions.reduce((a, s) => a + s.trades.length, 0);
  const totalPnl = sessions.reduce((a, s) => a + s.trades.reduce((x, t) => x + t.pnl, 0), 0);

  return (
    <Box sx={{ p: 2, maxWidth: 1400, mx: "auto" }} data-testid="smc-trades">
      <Typography variant="h6" sx={{ color: "#E5E7EB", mb: 0.5 }}>SMC Trades — SMCSignalGenerator on real 1m NQ data</Typography>
      <Typography variant="caption" sx={{ color: "#9CA3AF", display: "block", mb: 1 }}>
        trading/smc_signals.py run bar-by-bar (history-only, no lookahead) · outcomes from real bars · SL-first on ambiguous candles · Globex session 09:39→09:28 IST
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap" }}>
        <Chip size="small" label={`${totalTrades} trades / 5 sessions`} sx={{ bgcolor: "#1F2937", color: "#00FF00" }} />
        <Chip size="small" label={`net ${totalPnl > 0 ? "+" : ""}${totalPnl.toFixed(1)} pts`} color={totalPnl > 0 ? "success" : "error"} />
        {loading && <Chip size="small" label="loading…" sx={{ bgcolor: "#1F2937", color: "#58A6FF" }} />}
      </Stack>
      {sessions.map(({ sess, bars, trades }) => {
        const net = trades.reduce((a, t) => a + t.pnl, 0);
        return (
          <Card key={sess} elevation={0} sx={{ bgcolor: palette.NT_BG, border: `1px solid ${palette.NT_GRID}`, mb: 2, overflow: "hidden" }}>
            <Box sx={{ p: 1.5, bgcolor: "#111", borderBottom: `1px solid ${palette.NT_GRID}`, display: "flex", justifyContent: "space-between" }}>
              <Typography variant="subtitle2" sx={{ color: palette.PRIMARY }}>{sess} — {bars.length} candles — {trades.length} trades</Typography>
              <Chip size="small" label={`net ${net > 0 ? "+" : ""}${net.toFixed(1)} pts`} color={net > 0 ? "success" : "error"} />
            </Box>
            {trades.length === 0 ? (
              <Box sx={{ p: 2, color: "#9CA3AF", fontSize: 12 }}>No signals — filters not met (range, support, HTF, session bias)</Box>
            ) : (
              trades.map((tr, i) => (
                <Box key={i} sx={{ borderTop: i ? `1px solid ${palette.NT_GRID}` : 0, display: "flex", flexDirection: { xs: "column", md: "row" }, alignItems: "stretch" }}>
                  <Stack sx={{ flex: "0 0 300px", p: 1.5, bgcolor: palette.SURFACE, borderRight: { md: `1px solid ${palette.BORDER}` }, borderBottom: { xs: `1px solid ${palette.BORDER}`, md: 0 }, gap: 1 }}>
                    <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="space-between">
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <Chip size="small" label={tr.side} color={tr.side === "LONG" ? "success" : "error"} sx={{ height: 18, fontSize: 10, fontWeight: 700 }} />
                        <Typography variant="caption" sx={{ color: palette.TEXT, fontWeight: 600, fontSize: 10 }}>#{i + 1}</Typography>
                      </Stack>
                      <Chip size="small" label={tr.result} color={resultColor(tr.result)} sx={{ height: 18, fontSize: 9 }} />
                    </Stack>
                    <Stack spacing={0.25}>
                      <Typography variant="caption" sx={{ color: palette.TEXT, fontSize: 10, fontWeight: 600 }}>
                        {formatTradeTime(tr.time)} → {formatTradeTime(tr.exit_time)} {TZ_IST_LABEL}
                      </Typography>
                      <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, fontSize: 9 }}>
                        Entry {tr.entry.toFixed(2)} · SL {tr.sl.toFixed(2)} · TP {tr.tp.toFixed(2)}
                      </Typography>
                      <Typography variant="caption" sx={{ color: tr.pnl > 0 ? palette.POSITIVE : palette.NEGATIVE, fontSize: 9, fontWeight: 600 }}>
                        RR {(Math.abs(tr.tp - tr.entry) / Math.abs(tr.entry - tr.sl)).toFixed(1)} · {tr.pnl > 0 ? "+" : ""}{tr.pnl.toFixed(2)} pts ({tr.held_bars}m)
                      </Typography>
                    </Stack>
                    <Box sx={{ p: 1, bgcolor: palette.SURFACE_ALT, borderRadius: 1, border: `1px solid ${palette.BORDER}` }}>
                      <Typography variant="caption" sx={{ color: palette.TEXT, fontWeight: 600, display: "block", fontSize: 9, mb: 0.5 }}>Signal (SMCSignalGenerator)</Typography>
                      <Typography variant="caption" sx={{ color: palette.TEXT_MUTED, display: "block", fontSize: 9, lineHeight: 1.6 }}>
                        {tr.note}
                      </Typography>
                    </Box>
                  </Stack>
                  <Box sx={{ flex: 1, minHeight: 260, display: "flex", alignItems: "stretch" }}>
                    <SingleChart bars={bars} trade={tr} />
                  </Box>
                </Box>
              ))
            )}
          </Card>
        );
      })}
    </Box>
  );
}

function SingleChart({ bars, trade }: { bars: Bar[]; trade: SmcTrade }) {
  const ref = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  useEffect(() => {
    if (!ref.current || !bars.length) return;
    const chart = createChart(ref.current, {
      layout: { background: { type: ColorType.Solid, color: palette.NT_BG }, textColor: "#E5E7EB" },
      grid: { vertLines: { color: palette.NT_GRID }, horzLines: { color: palette.NT_GRID } },
      width: ref.current.clientWidth,
      height: 300,
      timeScale: { borderColor: palette.NT_GRID, timeVisible: true, secondsVisible: false, rightOffset: 4, barSpacing: 4, tickMarkFormatter: (time: Time) => typeof time === "number" ? formatTradeTime(time) : "" },
      rightPriceScale: { borderColor: palette.NT_GRID },
      localization: { timeFormatter: (time: Time) => typeof time === "number" ? formatTradeTime(time) : "" },
    });
    chartRef.current = chart;
    const cs = chart.addSeries(CandlestickSeries, {
      upColor: palette.NT_CANDLE_BULL, downColor: palette.NT_CANDLE_BEAR, borderVisible: false, wickVisible: true,
    });
    cs.setData(bars.map(b => ({ time: b.time as Time, open: b.open, high: b.high, low: b.low, close: b.close })));
    const isLong = trade.side === "LONG";
    createSeriesMarkers(cs as any, [
      { time: trade.time as Time, position: isLong ? "belowBar" : "aboveBar" as any, color: isLong ? palette.MARKER_ENTRY : palette.MARKER_SL, shape: isLong ? "arrowUp" as any : "arrowDown" as any, text: isLong ? "▲ BUY" : "▼ SELL" },
      { time: trade.exit_time as Time, position: isLong ? "aboveBar" : "belowBar" as any, color: trade.result === "TP" ? palette.MARKER_TP : palette.MARKER_SL, shape: "circle" as any, text: trade.result },
    ]);
    cs.createPriceLine({ price: trade.entry, color: palette.MARKER_ENTRY, lineWidth: 2, lineStyle: 2, axisLabelVisible: true, title: "ENTRY" });
    cs.createPriceLine({ price: trade.sl, color: palette.MARKER_SL, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "SL" });
    cs.createPriceLine({ price: trade.tp, color: palette.MARKER_TP, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: "TP" });
    chart.timeScale().fitContent();
    const ro = new ResizeObserver(() => chart.applyOptions({ width: ref.current!.clientWidth }));
    ro.observe(ref.current);
    return () => { ro.disconnect(); chart.remove(); };
  }, [bars, trade]);
  return <Box ref={ref} sx={{ width: "100%", height: 260 }} />;
}
