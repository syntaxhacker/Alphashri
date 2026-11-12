import { useMemo, useState } from "react";

import { Box, Button, Select, Text, ToolbarRow } from "@/ui";
import { INFO, NEGATIVE, POSITIVE, SCALE_DARK, WARNING } from "@/ui/palette";
import type { CSSProperties } from "react";
import type { UsMode, UsRoot } from "../../../types/usReport";
import { UsChart } from "./UsChart";
import { UsLadder } from "./UsLadder";
import { fmtCompact, fmtInt, fmtNum, fmtPct, fmtTime } from "./usReportMath";
import { useUsReport } from "./useUsReport";

const ROOTS: { id: UsRoot; enabled: boolean }[] = [
  { id: "NQ", enabled: true },
  { id: "ES", enabled: false },
  { id: "GC", enabled: false },
];

const SPEEDS = [
  { value: "1", label: "1x" },
  { value: "4", label: "4x" },
  { value: "12", label: "12x" },
  { value: "30", label: "30x" },
];

function Stat({ label, value, color, testId }: { label: string; value: string; color?: string; testId?: string }) {
  return (
    <Box className="flex items-baseline gap-1 min-w-0" data-testid={testId}>
      <Text size="xs" c="dimmed" span className="text-[9px] tracking-[0.3px] whitespace-nowrap">
        {label}
      </Text>
      <Text size="xs" span className="font-mono font-bold text-[11px] whitespace-nowrap" style={{ color }}>
        {value}
      </Text>
    </Box>
  );
}

export function UsReportPage() {
  const [root, setRoot] = useState<UsRoot>("NQ");
  const [mode, setMode] = useState<UsMode>("live");
  const [tf, setTf] = useState(1);
  const us = useUsReport(root, mode);
  const row = us.row;

  const topStrikes = useMemo(() => {
    if (!row) return [];
    const lo = row.spot * 0.96;
    const hi = row.spot * 1.04;
    return [...row.strikes]
      .filter((s) => s.k >= lo && s.k <= hi)
      .sort((a, b) => b.c_oi + b.p_oi - (a.c_oi + a.p_oi))
      .slice(0, 9);
  }, [row]);

  const chgColor = row?.change_pct == null ? undefined : row.change_pct >= 0 ? POSITIVE : NEGATIVE;

  return (
    <Box
      data-testid="us-report"
      className="flex flex-col h-full min-h-0 gap-1 p-[6px] overflow-hidden tabular-nums"
    >
      {/* ---- controls ---- */}
      <ToolbarRow gap={6} data-testid="us-toolbar" style={{ "min-height": 26 }}>
        <Text size="xs" fw={800} span className="tracking-[0.8px] text-[11px]">
          US FUTURES
        </Text>
        <Box className="flex gap-0.5">
          {ROOTS.map((r) => (
            <Button
              key={r.id}
              size="xs"
              variant={root === r.id ? "filled" : "subtle"}
              disabled={!r.enabled}
              title={r.enabled ? r.id : "coming later"}
              onClick={() => r.enabled && setRoot(r.id)}
              data-testid={`us-root-${r.id}`}
              style={{ "min-width": 34, height: 22, "padding-left": 6, "padding-right": 6, "font-size": 10 }}
            >
              {r.id}
            </Button>
          ))}
        </Box>
        <Box className="flex gap-0.5">
          {(["live", "eod"] as UsMode[]).map((m) => (
            <Button
              key={m}
              size="xs"
              variant={mode === m ? "filled" : "subtle"}
              onClick={() => setMode(m)}
              data-testid={`us-mode-${m}`}
              style={{ "min-width": 42, height: 22, "padding-left": 6, "padding-right": 6, "font-size": 10, "text-transform": "uppercase" }}
            >
              {m}
            </Button>
          ))}
        </Box>
        <Box className="flex gap-0.5">
          {[1, 5, 15].map((v) => (
            <Button
              key={v}
              size="xs"
              variant={tf === v ? "filled" : "subtle"}
              onClick={() => setTf(v)}
              data-testid={`us-tf-${v}`}
              style={{ "min-width": 26, height: 22, "padding-left": 4, "padding-right": 4, "font-size": 10 }}
            >
              {v}m
            </Button>
          ))}
        </Box>
        {mode === "eod" && (
          <Select
            size="xs"
            w={118}
            value={us.date || null}
            onChange={(v) => v && us.setDate(v)}
            data={us.dates.map((d) => ({ value: d, label: d }))}
            placeholder="date"
            data-testid="us-date"
          />
        )}
        <Box className="flex-1" />
        <Text size="xs" span className="font-mono text-[10px]">
          {row ? `${row.contract} · ${row.series} · exp ${row.expiry}` : "—"}
        </Text>
        <Box
          className="w-1.5 h-1.5 rounded-full"
          style={{
            "background-color": us.status?.market_open ? POSITIVE : SCALE_DARK[3],
            "box-shadow": us.status?.market_open ? `0 0 6px ${POSITIVE}` : "none",
          }}
          data-testid="us-session-dot"
        />
        <Text size="xs" c="dimmed" span className="text-[9px]">
          {us.status?.market_open ? "RTH" : "CLOSED"} {fmtTime(us.status?.now_et)} ET
        </Text>
        <Button size="xs" variant="subtle" onClick={us.refresh} data-testid="us-refresh" style={{ height: 22, "font-size": 10 }}>
          REFRESH
        </Button>
      </ToolbarRow>

      {/* ---- stats strip ---- */}
      <Box
        data-testid="us-stats"
        className="flex items-center gap-[10px] flex-wrap px-1 py-[2px] border-t border-b border-fin-border"
      >
        <Stat label="SPOT" value={row ? fmtNum(row.spot) : "—"} color={INFO} testId="us-spot" />
        <Stat label="CHG" value={row ? fmtPct(row.change_pct) : "—"} color={chgColor} testId="us-change" />
        <Stat label="PCR" value={row ? fmtNum(row.pcr_oi) : "—"} testId="us-pcr" />
        <Stat label="MAX PAIN" value={row ? fmtInt(row.max_pain) : "—"} color={WARNING} testId="us-max-pain" />
        <Stat label="PUT WALL" value={row ? fmtInt(row.put_wall) : "—"} color={NEGATIVE} testId="us-put-wall" />
        <Stat label="CALL WALL" value={row ? fmtInt(row.call_wall) : "—"} color={POSITIVE} testId="us-call-wall" />
        <Stat label="EXP MOVE" value={row?.exp_move_pct != null ? `±${fmtNum(row.exp_move_pct)}%` : "—"} testId="us-exp-move" />
        <Stat label="GEX" value={row?.net_gex ? `${row.net_gex >= 0 ? "+" : ""}${fmtNum(row.net_gex, 0)}m` : "–"} />
        <Stat label="VOL" value={fmtCompact(row?.volume)} testId="us-vol" />
        <Stat label="MIN" value={mode === "eod" ? `${us.cursor + 1}/${us.frames.length}` : String(us.status?.iterations ?? "—")} />
        {us.error && (
          <Text size="xs" span className="text-[9px]" style={{ color: NEGATIVE }}>
            {us.error}
          </Text>
        )}
      </Box>

      {/* ---- EOD settled strip ---- */}
      {mode === "eod" && us.eod && (
        <Box
          data-testid="us-eod"
          className="flex items-center gap-[10px] flex-wrap px-1 py-[1px] border-b border-fin-border"
          style={{ "background-color": "rgba(88,166,255,0.04)" }}
        >
          <Stat label="OPEN" value={fmtInt(us.eod.open)} />
          <Stat label="HIGH" value={fmtInt(us.eod.high)} color={POSITIVE} />
          <Stat label="LOW" value={fmtInt(us.eod.low)} color={NEGATIVE} />
          <Stat label="CLOSE" value={fmtInt(us.eod.close)} />
          <Stat label="WALL MIGR" value={String(us.eod.wall_migrations)} />
          <Stat label="PAIN HITS" value={String(us.eod.max_pain_touches)} color={WARNING} />
          <Stat label="MIN" value={`${us.eod.minutes}`} />
          <Stat label="LAST TAPE" value={fmtTime(us.eod.last_t)} />
        </Box>
      )}

      {/* ---- ladder + chart ---- */}
      <Box className="flex gap-1 flex-1 min-h-0">
        <Box className="w-[400px] min-w-[340px] flex flex-col">
          {row ? <UsLadder row={row} /> : null}
        </Box>
        <Box className="flex-1 min-w-0 flex flex-col gap-1">
          <UsChart frames={us.frames} cursor={us.cursor} bucket={tf} />
          {mode === "eod" && (
            <Box
              data-testid="us-playback"
              className="flex items-center gap-1 h-[26px] px-1 border border-fin-border"
            >
              <Button
                size="xs"
                variant="subtle"
                onClick={() => us.setCursor(0)}
                disabled={!us.frames.length}
                style={{ "min-width": 24, height: 20, "padding-left": 4, "padding-right": 4, "font-size": 10 }}
                aria-label="Jump to first frame"
              >
                |&lt;
              </Button>
              <Button
                size="xs"
                variant={us.playing ? "filled" : "subtle"}
                onClick={us.togglePlay}
                disabled={us.frames.length < 2}
                data-testid="us-play"
                style={{ "min-width": 28, height: 20, "padding-left": 4, "padding-right": 4, "font-size": 10 }}
              >
                {us.playing ? "||" : ">"}
              </Button>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => us.setCursor(us.frames.length - 1)}
                disabled={!us.frames.length}
                style={{ "min-width": 24, height: 20, "padding-left": 4, "padding-right": 4, "font-size": 10 }}
                aria-label="Jump to last frame"
              >
                &gt;|
              </Button>
              <Box
                component="input"
                type="range"
                min={0}
                max={Math.max(0, us.frames.length - 1)}
                value={Math.min(us.cursor, Math.max(0, us.frames.length - 1))}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => us.setCursor(Number(e.target.value))}
                data-testid="us-seek"
                className="flex-1 h-3 cursor-pointer appearance-none bg-transparent [&::-webkit-slider-runnable-track]:h-[2px] [&::-webkit-slider-runnable-track]:bg-[var(--color-fin-border)] [&::-webkit-slider-runnable-track]:rounded-[1px] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-2 [&::-webkit-slider-thumb]:h-2 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:-mt-[3px] [&::-webkit-slider-thumb]:bg-[var(--us-thumb)]"
                style={{ "accent-color": INFO, "--us-thumb": INFO } as CSSProperties}
              />
              <Box className="w-16">
                <Select
                  size="xs"
                  value={String(us.speed)}
                  onChange={(v) => v && us.setSpeed(Number(v))}
                  data={SPEEDS}
                  data-testid="us-speed"
                />
              </Box>
              <Text size="xs" span className="font-mono text-[10px] min-w-[92px] text-right">
                {row ? `${fmtTime(row.t)} · ${fmtInt(row.spot)}` : "—"}
              </Text>
            </Box>
          )}
        </Box>
      </Box>

      {/* ---- strikes strip ---- */}
      <Box
        data-testid="us-strikes"
        className="h-[118px] border border-fin-border flex flex-col font-mono text-[10px] leading-[14px] overflow-hidden"
      >
        <Box
          className="grid grid-cols-[70px_70px_70px_70px_70px_70px_1fr] px-1 text-fin-text-muted border-b border-fin-border text-[9px] tracking-[0.4px]"
        >
          <span>STRIKE</span>
          <span style={{ "text-align": "right" }}>CALL OI</span>
          <span style={{ "text-align": "right" }}>CALL VOL</span>
          <span style={{ "text-align": "right" }}>PUT OI</span>
          <span style={{ "text-align": "right" }}>PUT VOL</span>
          <span style={{ "text-align": "right" }}>NET OI</span>
          <span style={{ "text-align": "right" }}>GEX $m</span>
        </Box>
        <Box className="flex-1 overflow-auto">
          {topStrikes.map((s) => {
            const net = s.c_oi - s.p_oi;
            return (
              <Box
                key={s.k}
                data-testid={`us-strike-${s.k}`}
                className="grid grid-cols-[70px_70px_70px_70px_70px_70px_1fr] px-1"
                style={{ "background-color": s.k === row?.put_wall || s.k === row?.call_wall ? "rgba(255,255,255,0.04)" : "transparent" }}
              >
                <span style={{ "font-weight": s.k === row?.max_pain ? 800 : 500, color: s.k === row?.max_pain ? WARNING : undefined }}>
                  {fmtInt(s.k)}
                </span>
                <span style={{ "text-align": "right", color: POSITIVE }}>{fmtInt(s.c_oi)}</span>
                <span style={{ "text-align": "right", color: "var(--color-fin-text-muted)" }}>{fmtInt(s.c_vol)}</span>
                <span style={{ "text-align": "right", color: NEGATIVE }}>{fmtInt(s.p_oi)}</span>
                <span style={{ "text-align": "right", color: "var(--color-fin-text-muted)" }}>{fmtInt(s.p_vol)}</span>
                <span style={{ "text-align": "right", color: net >= 0 ? POSITIVE : NEGATIVE }}>{net > 0 ? "+" : ""}{fmtInt(net)}</span>
                <span style={{ "text-align": "right", color: s.g ? (s.g >= 0 ? POSITIVE : NEGATIVE) : undefined }}>{s.g ? fmtNum(s.g, 1) : "–"}</span>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
