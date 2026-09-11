// ReplayShell — strategy-agnostic replay host. Owns date/param state, fetch + abort,
// playback clock, and delegates rendering to the existing core/tick components. All
// strategy vocabulary (labels, endpoints, envelopes, captions) lives in the plugin.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import * as palette from "@/ui/palette";
import { TZ_IST, TZ_IST_LABEL } from "@/config/constants";
import {
  ReplayTradeTable,
  TradeReplayCard,
  type ReplayBundle,
  type ReplayTrade,
} from "@/components/replay/tick";
import { useReplayClock } from "./useReplayClock";
import ReplayChartHost, { type ReplayChartHandle } from "./ReplayChartHost";
import ReplayControls from "./ReplayControls";
import type {
  ReplayParamSpec,
  ReplayParamValues,
  ReplayStrategyPlugin,
  TimelineData,
} from "./plugin";

const EMPTY_BARS: TimelineData["candles"] = [];
const EMPTY_VWAP: TimelineData["vwap"] = [];
const EMPTY_TRADES: ReplayTrade[] = [];
const EMPTY_BUNDLE: ReplayBundle = { bars: [], trades: [] };

function initialParams(plugin: ReplayStrategyPlugin): ReplayParamValues {
  const out: ReplayParamValues = {};
  for (const spec of plugin.params) out[spec.name] = spec.default;
  return out;
}

function coerceParam(spec: ReplayParamSpec, raw: string): unknown {
  if (spec.type === "int") return Number.parseInt(raw, 10);
  if (spec.type === "float") return Number.parseFloat(raw);
  if (spec.type === "bool") return raw === "true";
  return raw;
}

/** Generic param control driven only by its spec — no strategy vocabulary. */
function ParamControl({ spec, value, onChange }: {
  spec: ReplayParamSpec;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (spec.options && spec.options.length > 0) {
    const numeric = spec.type === "int" || spec.type === "float";
    const current = numeric ? String(Number.parseFloat(String(value))) : String(value ?? "");
    return (
      <TextField size="small" select label={spec.label} value={current} sx={{ width: 140 }}
        onChange={e => onChange(coerceParam(spec, e.target.value))}>
        {spec.options.map(o => (
          <MenuItem key={o} value={numeric ? String(Number.parseFloat(o)) : o}>{o}</MenuItem>
        ))}
      </TextField>
    );
  }
  if (spec.type === "bool") {
    return (
      <FormControlLabel
        control={<Checkbox size="small" checked={Boolean(value)} onChange={(_, c) => onChange(c)} />}
        label={spec.label}
        sx={{ color: palette.TEXT_MUTED, "& .MuiFormControlLabel-label": { fontSize: 12 } }}
      />
    );
  }
  if (spec.type === "int" || spec.type === "float") {
    return (
      <TextField size="small" type="number" label={spec.label} value={value == null ? "" : String(value)} sx={{ width: 140 }}
        onChange={e => onChange(coerceParam(spec, e.target.value))} />
    );
  }
  return (
    <TextField size="small" label={spec.label} value={String(value ?? "")} sx={{ width: 140 }}
      onChange={e => onChange(e.target.value)} />
  );
}

const fmtReviewTime = (ts: number) => {
  const d = new Date(ts * 1000);
  const t = d.toLocaleString("en-IN", { timeZone: TZ_IST, hour: "2-digit", minute: "2-digit", hour12: false });
  const day = d.toLocaleString("en-IN", { timeZone: TZ_IST, day: "2-digit", month: "short" });
  return `${t} ${day} ${TZ_IST_LABEL}`;
};

export default function ReplayShell({ plugin }: { plugin: ReplayStrategyPlugin }) {
  const [date, setDate] = useState(plugin.dates[0]);
  const [params, setParams] = useState<ReplayParamValues>(() => initialParams(plugin));
  const [raw, setRaw] = useState<any>(null);
  const [bundle, setBundle] = useState<ReplayBundle | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const hostRef = useRef<ReplayChartHandle>(null);

  const setParam = useCallback((name: string, value: unknown) => {
    setParams(prev => ({ ...prev, [name]: value }));
  }, []);

  const candles = timeline?.candles ?? EMPTY_BARS;
  const t0 = candles.length ? candles[0].time : 0;
  const tEnd = candles.length ? candles[candles.length - 1].time + 60 : 0;

  const onTick = useCallback((now: number) => { hostRef.current?.paint(now); }, []);
  const onEnd = useCallback(() => setPlaying(false), []);

  const { clock, clockRef, jump } = useReplayClock({ t0, tEnd, playing, speed, onTick, onEnd });

  useEffect(() => {
    const ac = new AbortController();
    setLoading(true);
    setPlaying(false);
    jump(0);
    const query = new URLSearchParams({ date });
    for (const spec of plugin.params) query.set(spec.name, String(params[spec.name] ?? spec.default));
    const request: Promise<any> = plugin.load
      ? plugin.load({ date, params, signal: ac.signal })
      : fetch(`${plugin.endpoint}?${query.toString()}`, { signal: ac.signal })
          .then(r => {
            if (r.ok === false) throw new Error(`HTTP ${r.status}`);
            return r.json();
          });
    request
      .then(j => {
        if (ac.signal.aborted) return;
        setRaw(j);
        setBundle(plugin.normalize(j));
        if (plugin.mode === "timeline" && plugin.timeline) setTimeline(plugin.timeline(j));
      })
      .catch((e) => {
        if (ac.signal.aborted || (e && e.name === "AbortError")) return;
        setRaw(null);
        setTimeline(null);
        setBundle({
          bars: [], trades: [],
          error: `load failed: ${e && e.message ? e.message : e}`,
        });
      })
      .finally(() => { if (!ac.signal.aborted) setLoading(false); });
    return () => ac.abort();
  }, [date, params, plugin, jump]);

  const trades = bundle?.trades ?? EMPTY_TRADES;

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
    if (timeline && timeline.candles.length && clockRef.current <= 0) {
      jump(timeline.candles[0].time);
    }
  }, [timeline, clockRef, jump]);

  const onPlayToggle = useCallback(() => {
    if (clockRef.current >= tEnd) jump(t0);
    setPlaying(p => !p);
  }, [clockRef, tEnd, t0, jump]);

  const levels = useMemo(
    () => timeline?.levels ?? { or_high: 0, or_low: 0, or_end: 0 },
    [timeline?.levels],
  );

  const zones = useMemo(
    () => (plugin.card?.zones && raw ? plugin.card.zones(raw) : []),
    [plugin, raw],
  );
  const trends = useMemo(
    () => (plugin.card?.trends && raw ? plugin.card.trends(raw) : []),
    [plugin, raw],
  );

  const paramControls = plugin.params.map(spec => (
    <ParamControl key={spec.name} spec={spec} value={params[spec.name]}
      onChange={v => setParam(spec.name, v)} />
  ));

  return (
    <Box sx={{ p: 2, width: "100%" }} data-testid={plugin.mode === "timeline" ? "tick-replay" : "replay-strategy"}>
      <Typography variant="h6" sx={{ color: "#E5E7EB", mb: 0.5 }}>{plugin.label}</Typography>
      {(plugin.subtitle || plugin.summary) && (
        <Typography variant="caption" sx={{ color: "#9CA3AF", display: "block", mb: 1 }}>
          {plugin.subtitle}{plugin.summary?.(bundle ?? EMPTY_BUNDLE, raw)}
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", alignItems: "center" }}>
        {plugin.dates.map(d => (
          <Chip key={d} size="small" label={d} onClick={() => setDate(d)}
            sx={{ bgcolor: d === date ? "#2563EB" : "#1F2937", color: "#E5E7EB", cursor: "pointer", fontWeight: d === date ? 700 : 400 }} />
        ))}
      </Stack>

      {plugin.mode === "timeline" ? (
        <>
          <ReplayControls
            playing={playing}
            loading={loading}
            disabled={loading || !candles.length}
            speed={speed}
            t0={t0}
            tEnd={tEnd}
            clock={clock}
            closedCount={closed.length}
            revealedCount={revealed.length}
            net={net}
            error={bundle?.error}
            onPlayToggle={onPlayToggle}
            onSpeedChange={setSpeed}
            onJump={jump}
          >
            {paramControls}
          </ReplayControls>
          <Card elevation={0} sx={{ bgcolor: palette.NT_BG, border: `1px solid ${palette.NT_GRID}`, overflow: "hidden", mb: 2 }}>
            <ReplayChartHost
              ref={hostRef}
              bars={candles}
              subs={timeline?.subs ?? EMPTY_BARS}
              vwap={timeline?.vwap ?? EMPTY_VWAP}
              levels={levels}
              trades={trades}
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
        </>
      ) : (
        <>
          <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: "wrap", alignItems: "center" }}>
            {paramControls}
            <Chip size="small" label={`${trades.length} trades`} sx={{ bgcolor: "#1F2937", color: palette.POSITIVE }} />
            {loading && <Chip size="small" label="loading ticks…" sx={{ bgcolor: "#1F2937", color: "#58A6FF" }} />}
            {bundle?.error && <Chip size="small" label={bundle.error} color="error" />}
          </Stack>
          {plugin.panel?.(bundle ?? EMPTY_BUNDLE, raw)}
          {!loading && trades.length === 0 && (
            <Box sx={{ p: 2, color: palette.TEXT_MUTED, fontSize: 12 }}>No trades in this view.</Box>
          )}
          {trades.map((tr, i) => (
            <TradeReplayCard
              key={`${tr.time}-${tr.side}-${i}`}
              bars={bundle?.bars ?? EMPTY_BARS}
              trade={tr}
              index={i}
              zones={zones}
              trends={trends}
              timeLabel={fmtReviewTime}
              explainer={plugin.card?.explainer ? (t) => plugin.card!.explainer!(t, raw) : undefined}
            />
          ))}
        </>
      )}
    </Box>
  );
}
