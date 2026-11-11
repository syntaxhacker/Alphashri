import { useMemo, useState } from "react";

import { Box, Button, Select, Text, ToolbarRow } from "@/ui";
import { INFO, MONO, NEGATIVE, POSITIVE, WARNING } from "@/ui/palette";
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
    <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5, minWidth: 0 }} data-testid={testId}>
      <Text size="xs" c="dimmed" span sx={{ fontSize: 9, letterSpacing: 0.3, whiteSpace: "nowrap" }}>
        {label}
      </Text>
      <Text size="xs" span sx={{ fontFamily: MONO, fontWeight: 700, color, fontSize: 11, whiteSpace: "nowrap" }}>
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
      sx={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
        gap: "4px",
        p: "6px",
        overflow: "hidden",
        fontVariantNumeric: "tabular-nums",
      }}
    >
      {/* ---- controls ---- */}
      <ToolbarRow gap={6} data-testid="us-toolbar" style={{ minHeight: 26 }}>
        <Text size="xs" fw={800} span sx={{ letterSpacing: 0.8, fontSize: 11 }}>
          US FUTURES
        </Text>
        <Box sx={{ display: "flex", gap: "2px" }}>
          {ROOTS.map((r) => (
            <Button
              key={r.id}
              size="xs"
              variant={root === r.id ? "filled" : "subtle"}
              disabled={!r.enabled}
              title={r.enabled ? r.id : "coming later"}
              onClick={() => r.enabled && setRoot(r.id)}
              data-testid={`us-root-${r.id}`}
              sx={{ minWidth: 34, height: 22, px: 0.75, fontSize: 10 }}
            >
              {r.id}
            </Button>
          ))}
        </Box>
        <Box sx={{ display: "flex", gap: "2px" }}>
          {(["live", "eod"] as UsMode[]).map((m) => (
            <Button
              key={m}
              size="xs"
              variant={mode === m ? "filled" : "subtle"}
              onClick={() => setMode(m)}
              data-testid={`us-mode-${m}`}
              sx={{ minWidth: 42, height: 22, px: 0.75, fontSize: 10, textTransform: "uppercase" }}
            >
              {m}
            </Button>
          ))}
        </Box>
        <Box sx={{ display: "flex", gap: "2px" }}>
          {[1, 5, 15].map((v) => (
            <Button
              key={v}
              size="xs"
              variant={tf === v ? "filled" : "subtle"}
              onClick={() => setTf(v)}
              data-testid={`us-tf-${v}`}
              sx={{ minWidth: 26, height: 22, px: 0.5, fontSize: 10 }}
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
        <Box sx={{ flex: 1 }} />
        <Text size="xs" span sx={{ fontFamily: MONO, fontSize: 10 }}>
          {row ? `${row.contract} · ${row.series} · exp ${row.expiry}` : "—"}
        </Text>
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            bgcolor: us.status?.market_open ? POSITIVE : "var(--mui-palette-text-disabled)",
            boxShadow: us.status?.market_open ? `0 0 6px ${POSITIVE}` : "none",
          }}
          data-testid="us-session-dot"
        />
        <Text size="xs" c="dimmed" span sx={{ fontSize: 9 }}>
          {us.status?.market_open ? "RTH" : "CLOSED"} {fmtTime(us.status?.now_et)} ET
        </Text>
        <Button size="xs" variant="subtle" onClick={us.refresh} data-testid="us-refresh" sx={{ height: 22, fontSize: 10 }}>
          REFRESH
        </Button>
      </ToolbarRow>

      {/* ---- stats strip ---- */}
      <Box
        data-testid="us-stats"
        sx={{
          display: "flex",
          alignItems: "center",
          gap: "10px",
          flexWrap: "wrap",
          px: "4px",
          py: "2px",
          borderTop: "1px solid var(--mui-palette-divider)",
          borderBottom: "1px solid var(--mui-palette-divider)",
        }}
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
          <Text size="xs" span sx={{ color: NEGATIVE, fontSize: 9 }}>
            {us.error}
          </Text>
        )}
      </Box>

      {/* ---- EOD settled strip ---- */}
      {mode === "eod" && us.eod && (
        <Box
          data-testid="us-eod"
          sx={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
            px: "4px",
            py: "1px",
            borderBottom: "1px solid var(--mui-palette-divider)",
            bgcolor: "rgba(88,166,255,0.04)",
          }}
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
      <Box sx={{ display: "flex", gap: "4px", flex: 1, minHeight: 0 }}>
        <Box sx={{ width: 400, minWidth: 340, display: "flex", flexDirection: "column" }}>
          {row ? <UsLadder row={row} /> : null}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" }}>
          <UsChart frames={us.frames} cursor={us.cursor} bucket={tf} />
          {mode === "eod" && (
            <Box
              data-testid="us-playback"
              sx={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                height: 26,
                px: "4px",
                border: "1px solid var(--mui-palette-divider)",
              }}
            >
              <Button
                size="xs"
                variant="subtle"
                onClick={() => us.setCursor(0)}
                disabled={!us.frames.length}
                sx={{ minWidth: 24, height: 20, px: 0.5, fontSize: 10 }}
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
                sx={{ minWidth: 28, height: 20, px: 0.5, fontSize: 10 }}
              >
                {us.playing ? "||" : ">"}
              </Button>
              <Button
                size="xs"
                variant="subtle"
                onClick={() => us.setCursor(us.frames.length - 1)}
                disabled={!us.frames.length}
                sx={{ minWidth: 24, height: 20, px: 0.5, fontSize: 10 }}
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
                sx={{
                  flex: 1,
                  accentColor: INFO,
                  height: 12,
                  cursor: "pointer",
                  appearance: "none",
                  bgcolor: "transparent",
                  "&::-webkit-slider-runnable-track": {
                    height: 2,
                    bgcolor: "var(--mui-palette-divider)",
                    borderRadius: 1,
                  },
                  "&::-webkit-slider-thumb": {
                    appearance: "none",
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    bgcolor: INFO,
                    mt: "-3px",
                  },
                }}
              />
              <Box sx={{ width: 64 }}>
                <Select
                  size="xs"
                  value={String(us.speed)}
                  onChange={(v) => v && us.setSpeed(Number(v))}
                  data={SPEEDS}
                  data-testid="us-speed"
                />
              </Box>
              <Text size="xs" span sx={{ fontFamily: MONO, fontSize: 10, minWidth: 92, textAlign: "right" }}>
                {row ? `${fmtTime(row.t)} · ${fmtInt(row.spot)}` : "—"}
              </Text>
            </Box>
          )}
        </Box>
      </Box>

      {/* ---- strikes strip ---- */}
      <Box
        data-testid="us-strikes"
        sx={{
          height: 118,
          border: "1px solid var(--mui-palette-divider)",
          display: "flex",
          flexDirection: "column",
          fontFamily: MONO,
          fontSize: 10,
          lineHeight: "14px",
          overflow: "hidden",
        }}
      >
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: "70px 70px 70px 70px 70px 70px 1fr",
            px: "4px",
            color: "var(--mui-palette-text-secondary)",
            borderBottom: "1px solid var(--mui-palette-divider)",
            fontSize: 9,
            letterSpacing: 0.4,
          }}
        >
          <span>STRIKE</span>
          <span style={{ textAlign: "right" }}>CALL OI</span>
          <span style={{ textAlign: "right" }}>CALL VOL</span>
          <span style={{ textAlign: "right" }}>PUT OI</span>
          <span style={{ textAlign: "right" }}>PUT VOL</span>
          <span style={{ textAlign: "right" }}>NET OI</span>
          <span style={{ textAlign: "right" }}>GEX $m</span>
        </Box>
        <Box sx={{ flex: 1, overflow: "auto" }}>
          {topStrikes.map((s) => {
            const net = s.c_oi - s.p_oi;
            return (
              <Box
                key={s.k}
                data-testid={`us-strike-${s.k}`}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "70px 70px 70px 70px 70px 70px 1fr",
                  px: "4px",
                  bgcolor: s.k === row?.put_wall || s.k === row?.call_wall ? "rgba(255,255,255,0.04)" : "transparent",
                }}
              >
                <span style={{ fontWeight: s.k === row?.max_pain ? 800 : 500, color: s.k === row?.max_pain ? WARNING : undefined }}>
                  {fmtInt(s.k)}
                </span>
                <span style={{ textAlign: "right", color: POSITIVE }}>{fmtInt(s.c_oi)}</span>
                <span style={{ textAlign: "right", color: "var(--mui-palette-text-secondary)" }}>{fmtInt(s.c_vol)}</span>
                <span style={{ textAlign: "right", color: NEGATIVE }}>{fmtInt(s.p_oi)}</span>
                <span style={{ textAlign: "right", color: "var(--mui-palette-text-secondary)" }}>{fmtInt(s.p_vol)}</span>
                <span style={{ textAlign: "right", color: net >= 0 ? POSITIVE : NEGATIVE }}>{net > 0 ? "+" : ""}{fmtInt(net)}</span>
                <span style={{ textAlign: "right", color: s.g ? (s.g >= 0 ? POSITIVE : NEGATIVE) : undefined }}>{s.g ? fmtNum(s.g, 1) : "–"}</span>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
