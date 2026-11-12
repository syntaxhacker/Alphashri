// ReplayShell — strategy-agnostic replay host. Owns date/param state, fetch + abort,
// playback clock, and delegates rendering to the existing core/tick components. All
// strategy vocabulary (labels, endpoints, envelopes, captions) lives in the plugin.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Button, Text, Select, TextInput, Checkbox } from "@/ui";
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
import SymbolAutocomplete from "./SymbolAutocomplete";
import { Box, Card, Stack } from "../../paper-trading/primitives";
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
      <Select size="sm" w={140} label={spec.label} value={current} onChange={(v) => onChange(coerceParam(spec, v ?? ""))}>
        {spec.options.map((o) => (
          <option key={o} value={numeric ? String(Number.parseFloat(o)) : o}>
            {o}
          </option>
        ))}
      </Select>
    );
  }
  if (spec.type === "bool") {
    return (
      <Box style={{ display: "flex", alignItems: "center", gap: "4px", color: palette.TEXT_MUTED, fontSize: "12px" }}>
        <Checkbox
          size="sm"
          label={spec.label}
          checked={Boolean(value)}
          onChange={(e) => onChange((e.target as HTMLInputElement).checked)}
        />
      </Box>
    );
  }
  if (spec.type === "symbol") {
    return (
      <SymbolAutocomplete
        value={String(value ?? "")}
        label={spec.label}
        onChange={onChange}
        testid={`replay-symbol-${spec.name}`}
      />
    );
  }
  if (spec.type === "int" || spec.type === "float") {
    return (
      <TextInput size="sm" type="number" label={spec.label} value={value == null ? "" : String(value)} w={140}
        onChange={(v) => onChange(coerceParam(spec, v))} />
    );
  }
  return (
    <TextInput size="sm" label={spec.label} value={String(value ?? "")} w={140}
      onChange={(v) => onChange(coerceParam(spec, v))} />
  );
}

const fmtReviewTime = (ts: number) => {
  const d = new Date(ts * 1000);
  const t = d.toLocaleString("en-IN", { timeZone: TZ_IST, hour: "2-digit", minute: "2-digit", hour12: false });
  const day = d.toLocaleString("en-IN", { timeZone: TZ_IST, day: "2-digit", month: "short" });
  return `${t} ${day} ${TZ_IST_LABEL}`;
};

export default function ReplayShell({ plugin, headerExtra }: { plugin: ReplayStrategyPlugin; headerExtra?: ReactNode }) {
  const [date, setDate] = useState(plugin.dates[0]);
  const [params, setParams] = useState<ReplayParamValues>(() => initialParams(plugin));
  const [raw, setRaw] = useState<any>(null);
  const [bundle, setBundle] = useState<ReplayBundle | null>(null);
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [loading, setLoading] = useState(plugin.runMode !== "manual");
  const [runNonce, setRunNonce] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const hostRef = useRef<ReplayChartHandle>(null);

  const manual = plugin.runMode === "manual";

  const setParam = useCallback((name: string, value: unknown) => {
    setParams(prev => ({ ...prev, [name]: value }));
  }, []);

  const candles = timeline?.candles ?? EMPTY_BARS;
  const barSeconds = timeline?.barSeconds ?? 60;
  const t0 = candles.length ? candles[0].time : 0;
  const tEnd = candles.length ? candles[candles.length - 1].time + barSeconds : 0;

  const onTick = useCallback((now: number) => { hostRef.current?.paint(now); }, []);
  const onEnd = useCallback(() => setPlaying(false), []);

  const { clock, clockRef, jump } = useReplayClock({ t0, tEnd, playing, speed, onTick, onEnd });

  // Manual plugins only fetch on an explicit Run (runNonce); auto plugins refetch on
  // date/param change. Stringifying params keeps the key value-stable across renders.
  const fetchKey = manual
    ? `manual:${runNonce}`
    : `auto:${plugin.id}:${date}:${JSON.stringify(params)}`;

  useEffect(() => {
    if (manual && runNonce === 0) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

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

  // Initialize at the END of the session so the chart opens with the full day visible
  // (previously it seeded the first bar and showed a near-empty chart). Pressing Play
  // rewinds to the first bar via onPlayToggle and replays progressively.
  useEffect(() => {
    if (timeline && timeline.candles.length && clockRef.current <= 0) {
      jump(tEnd);
      hostRef.current?.fitContent();
    }
  }, [timeline, tEnd, clockRef, jump]);

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

  const runButton = manual ? (
    <Button size="sm" variant="filled" onClick={() => setRunNonce(n => n + 1)} disabled={loading}>
      Run
    </Button>
  ) : null;
  const showRunHint = manual && runNonce === 0;

  return (
    <Box p="sm" w="100%" data-testid={plugin.mode === "timeline" ? "tick-replay" : "replay-strategy"}>
      <Stack direction="row" gap="sm" mb="xs" align="center" wrap>
        <Text fw={600} style={{ fontSize: "1.125rem", color: "#E5E7EB" }}>{plugin.label}</Text>
        {headerExtra}
      </Stack>
      {(plugin.subtitle || plugin.summary) && (
        <Text size="xs" style={{ color: "#9CA3AF", display: "block", marginBottom: "8px" }}>
          {plugin.subtitle}{plugin.summary?.(bundle ?? EMPTY_BUNDLE, raw)}
        </Text>
      )}
      <Stack direction="row" gap="sm" mb="sm" align="center" wrap>
        {plugin.dates.map(d => (
          <Button key={d} size="xs" variant="subtle" onClick={() => setDate(d)}
            style={{ backgroundColor: d === date ? "#2563EB" : "#1F2937", color: "#E5E7EB", cursor: "pointer", fontWeight: d === date ? 700 : 400, borderRadius: "4px" }}
          >
            {d}
          </Button>
        ))}
      </Stack>
      {showRunHint && (
        <Text size="xs" style={{ color: palette.TEXT_MUTED, display: "block", marginBottom: "8px" }}>
          Choose a symbol / date, then press Run
        </Text>
      )}

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
            {runButton}
            {paramControls}
          </ReplayControls>
          <Card bg={palette.NT_BG} style={{ border: `1px solid ${palette.NT_GRID}`, overflow: "hidden", marginBottom: "16px" }}>
            <ReplayChartHost
              ref={hostRef}
              bars={candles}
              subs={timeline?.subs ?? EMPTY_BARS}
              vwap={timeline?.vwap ?? EMPTY_VWAP}
              levels={levels}
              trades={trades}
              height={420}
              barSeconds={barSeconds}
              clock={clock}
              playing={playing}
            />
          </Card>
          <Card bg={palette.NT_BG} style={{ border: `1px solid ${palette.NT_GRID}`, overflow: "hidden" }}>
            <Box p="sm" style={{ backgroundColor: "#111", borderBottom: `1px solid ${palette.NT_GRID}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Text size="xs" fw={700} style={{ color: palette.PRIMARY }}>
                Trades — {closed.length} closed · net {net > 0 ? "+" : ""}{net.toFixed(1)} pts
              </Text>
              <Button size="xs" variant="subtle" disabled style={{ backgroundColor: "#1F2937", color: "#9CA3AF", borderRadius: "4px" }}>
                {revealed.length - closed.length} open
              </Button>
            </Box>
            <ReplayTradeTable trades={revealed} clock={clock} onSelectTime={(t) => jump(t)} />
          </Card>
        </>
      ) : (
        <>
          {manual && (
            <Stack direction="row" gap="sm" mb="sm" align="center">
              {runButton}
            </Stack>
          )}
          <Stack direction="row" gap="sm" mb="sm" align="center" wrap>
            {paramControls}
            {!plugin.panel && <Button size="xs" variant="subtle" disabled style={{ backgroundColor: "#1F2937", color: palette.POSITIVE, borderRadius: "4px" }}>{trades.length} trades</Button>}
            {loading && <Button size="xs" variant="subtle" disabled style={{ backgroundColor: "#1F2937", color: palette.PRIMARY, borderRadius: "4px" }}>loading ticks…</Button>}
            {bundle?.error && <Button size="xs" variant="subtle" disabled style={{ backgroundColor: "#3B1D1D", color: "#F87171", borderRadius: "4px" }}>{bundle.error}</Button>}
          </Stack>
          {plugin.panel?.(bundle ?? EMPTY_BUNDLE, raw)}
          {!loading && trades.length === 0 && (
            <Box p="sm" style={{ color: palette.TEXT_MUTED, fontSize: "12px" }}>No trades in this view.</Box>
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
              fitPaddingBeforeMin={plugin.card?.fitPaddingBeforeMin}
              fitPaddingAfterMin={plugin.card?.fitPaddingAfterMin}
            />
          ))}
        </>
      )}
    </Box>
  );
}
