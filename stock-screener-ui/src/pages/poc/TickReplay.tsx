import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import * as palette from "@/ui/palette";
import { orRangeLabel } from "@/utils/replayTime";
import { TZ_IST_LABEL } from "@/config/constants";
import { ReplayTradeTable, type ReplayTrade } from "@/components/replay/tick";
import { ReplayChartHost, ReplayControls, useReplayClock, type ReplayChartHandle } from "@/components/replay/core";

type Candle = { time: number; open: number; high: number; low: number; close: number };
type VwapPt = { time: number; value: number };
type Bundle = {
  candles: Candle[]; subs: Candle[]; vwap: VwapPt[];
  or_high: number; or_low: number; or_minutes: number; or_end: number;
  trades: ReplayTrade[]; basis?: number; sub_secs?: number; hist_bars?: number; error?: string;
};

const DATES = ["2026-09-02", "2026-08-26", "2026-07-24", "2026-08-27", "2026-07-22", "2026-07-02"];

const EMPTY_CANDLES: Candle[] = [];
const EMPTY_VWAP: VwapPt[] = [];
const EMPTY_TRADES: ReplayTrade[] = [];

export default function TickReplay() {
  const [date, setDate] = useState(DATES[0]);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [orTf, setOrTf] = useState(15);
  const hostRef = useRef<ReplayChartHandle>(null);

  const t0 = bundle && bundle.candles.length ? bundle.candles[0].time : 0;
  const tEnd = bundle && bundle.candles.length ? bundle.candles[bundle.candles.length - 1].time + 60 : 0;

  const onTick = useCallback((now: number) => { hostRef.current?.paint(now); }, []);
  const onEnd = useCallback(() => setPlaying(false), []);

  const { clock, clockRef, jump } = useReplayClock({ t0, tEnd, playing, speed, onTick, onEnd });

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setPlaying(false);
    jump(0);
    fetch(`/api/poc/tick-replay?date=${date}&secs=2&orb=${orTf}&hist=8`, { signal: ac.signal })
      .then(r => {
        if (r.ok === false) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(j => {
        if (ac.signal.aborted) return;
        setBundle({
          candles: j.candles || [], subs: j.subs || [], vwap: j.vwap || [],
          or_high: j.or_high, or_low: j.or_low, or_minutes: j.or_minutes || orTf, or_end: j.or_end || 0,
          trades: j.trades || [], basis: j.basis, sub_secs: j.sub_secs, hist_bars: j.hist_bars,
          ...(j.error ? { error: j.error } : {}),
        });
      })
      .catch((e) => {
        if (ac.signal.aborted || (e && e.name === "AbortError")) return;
        setBundle({
          candles: [], subs: [], vwap: [], or_high: 0, or_low: 0,
          or_minutes: orTf, or_end: 0, trades: [],
          error: `load failed: ${e && e.message ? e.message : e}`,
        });
      })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [date, orTf, jump]);

  const revealed = useMemo(
    () => (bundle ? bundle.trades.filter(t => t.time <= clock) : []),
    [bundle, clock],
  );
  const closed = useMemo(
    () => revealed.filter(t => t.exit_time <= clock),
    [revealed, clock],
  );
  const net = closed.reduce((a, t) => a + t.pnl, 0);

  // initialize clock at first candle so the chart/time/slider are correct before play
  useEffect(() => {
    if (bundle && bundle.candles.length && clockRef.current <= 0) {
      jump(bundle.candles[0].time);
    }
  }, [bundle, clockRef, jump]);

  const onPlayToggle = useCallback(() => {
    if (clockRef.current >= tEnd) jump(t0);
    setPlaying(p => !p);
  }, [clockRef, tEnd, t0, jump]);

  const levels = useMemo(
    () => ({ or_high: bundle?.or_high ?? 0, or_low: bundle?.or_low ?? 0, or_end: bundle?.or_end ?? 0 }),
    [bundle?.or_high, bundle?.or_low, bundle?.or_end],
  );

  return (
    <Box sx={{ p: 2, width: "100%" }} data-testid="tick-replay">
      <Typography variant="h6" sx={{ color: "#E5E7EB", mb: 0.5 }}>Tick Replay — VWAP + ORB on real NQ ticks</Typography>
      <Typography variant="caption" sx={{ color: "#9CA3AF", display: "block", mb: 1 }}>
        1m NQ=F candles, forming bar ticks live from {bundle?.sub_secs ?? 2}s subs{bundle?.basis != null ? ` · basis +${bundle.basis.toFixed(1)}` : ""}{bundle?.hist_bars ? ` · +${bundle.hist_bars} overnight bars` : ""} · OR {bundle?.or_minutes ?? orTf}m{bundle && bundle.candles.length ? ` (${orRangeLabel(bundle.candles[0].time, bundle.or_minutes)})` : ""} · LONG above OR-H + VWAP / SHORT below OR-L + VWAP · SL opposite edge, TP nearest structure · {TZ_IST_LABEL}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", alignItems: "center" }}>
        {DATES.map(d => (
          <Chip key={d} size="small" label={d} onClick={() => setDate(d)}
            sx={{ bgcolor: d === date ? "#2563EB" : "#1F2937", color: "#E5E7EB", cursor: "pointer", fontWeight: d === date ? 700 : 400 }} />
        ))}
      </Stack>
      <ReplayControls
        playing={playing}
        loading={loading}
        disabled={loading || !bundle?.candles.length}
        speed={speed}
        orTf={orTf}
        t0={t0}
        tEnd={tEnd}
        clock={clock}
        closedCount={closed.length}
        revealedCount={revealed.length}
        net={net}
        error={bundle?.error}
        onPlayToggle={onPlayToggle}
        onSpeedChange={setSpeed}
        onOrTfChange={setOrTf}
        onJump={jump}
      />
      <Card elevation={0} sx={{ bgcolor: palette.NT_BG, border: `1px solid ${palette.NT_GRID}`, overflow: "hidden", mb: 2 }}>
        <ReplayChartHost
          ref={hostRef}
          bars={bundle?.candles ?? EMPTY_CANDLES}
          subs={bundle?.subs ?? EMPTY_CANDLES}
          vwap={bundle?.vwap ?? EMPTY_VWAP}
          levels={levels}
          trades={bundle?.trades ?? EMPTY_TRADES}
          height={420}
          clock={clock}
          playing={playing}
        />
      </Card>
      <Card elevation={0} sx={{ bgcolor: palette.NT_BG, border: `1px solid ${palette.NT_GRID}`, overflow: "hidden" }}>
        <Box sx={{ p: 1.5, bgcolor: "#111", borderBottom: `1px solid ${palette.NT_GRID}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Typography variant="subtitle2" sx={{ color: palette.PRIMARY }}>
            Trades — {closed.length} closed · net {net > 0 ? "+" : ""}{net.toFixed(1)} pts
          </Typography>
          <Chip size="small" label={`${revealed.length - closed.length} open`} sx={{ bgcolor: "#1F2937", color: "#9CA3AF" }} />
        </Box>
        <ReplayTradeTable trades={revealed} clock={clock} onSelectTime={(t) => jump(t)} />
      </Card>
    </Box>
  );
}
