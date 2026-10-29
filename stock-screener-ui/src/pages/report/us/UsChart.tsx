import { useMemo } from "react";

import { Box, Text } from "@/ui";
import { INFO, MONO, NEGATIVE, POSITIVE, WARNING } from "@/ui/palette";
import type { UsRow } from "../../../types/usReport";
import { buildChart, fmtInt, fmtNum, fmtTime, niceTicks, toBars } from "./usReportMath";

const H = 260;

interface Props {
  frames: UsRow[];
  cursor: number;
  /** Candle aggregation in minutes: 1, 5 or 15. */
  bucket?: number;
}

interface Wall {
  v: number;
  color: string;
  label: string;
}

/** Candles + only the walls that fit the traded range; far walls get edge tags. */
export function UsChart({ frames, cursor, bucket = 1 }: Props) {
  const bars = useMemo(() => toBars(frames, bucket), [frames, bucket]);
  const frame = frames[Math.max(0, Math.min(cursor, frames.length - 1))] ?? null;

  const barIdx = useMemo(() => {
    if (!bars.length || !frame) return 0;
    const i = bars.findIndex((b) => b.t >= frame.t);
    return i < 0 ? bars.length - 1 : i;
  }, [bars, frame]);

  const nearWalls = frame
    ? [frame.put_wall, frame.call_wall, frame.max_pain].filter(
        (v) => Number.isFinite(v) && Math.abs(v / frame.spot - 1) <= 0.015,
      )
    : [];
  const g = buildChart(bars, barIdx, nearWalls);

  if (!g || !frame) {
    return (
      <Box sx={{ flex: 1, display: "grid", placeItems: "center", border: "1px solid var(--mui-palette-divider)" }}>
        <Text size="xs" c="dimmed">
          no tape yet
        </Text>
      </Box>
    );
  }

  const walls: Wall[] = [
    { v: frame.put_wall, color: NEGATIVE, label: "PUT" },
    { v: frame.call_wall, color: POSITIVE, label: "CALL" },
    { v: frame.max_pain, color: WARNING, label: "PAIN" },
  ];
  const inRange = walls.filter((w) => w.v >= g.min && w.v <= g.max);
  const above = walls.filter((w) => w.v > g.max);
  const below = walls.filter((w) => w.v < g.min);

  const yFor = (v: number) => H - ((v - g.min) / (g.max - g.min)) * H;
  const pctFor = (v: number) => 100 - ((v - g.min) / (g.max - g.min)) * 100;
  const step = g.width / Math.max(1, bars.length);
  const bodyW = Math.max(1.2, Math.min(16, step * 0.66));
  const last = bars[bars.length - 1];
  const first = bars[0];
  const ticks = niceTicks(g.min, g.max, 4);

  return (
    <Box
      data-testid="us-chart"
      sx={{
        flex: 1,
        minHeight: 0,
        position: "relative",
        border: "1px solid var(--mui-palette-divider)",
        overflow: "hidden",
      }}
    >
      <svg
        viewBox={`0 0 ${g.width} ${H}`}
        preserveAspectRatio="none"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        shapeRendering="crispEdges"
        role="img"
        aria-label="NQ candles against put wall, call wall and max pain"
      >
        {ticks.map((t, i) => (
          <line key={i} x1={0} x2={g.width} y1={yFor(t)} y2={yFor(t)} stroke="rgba(255,255,255,0.05)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        ))}

        {inRange.map((w) => (
          <line
            key={w.label}
            x1={0}
            x2={g.width}
            y1={yFor(w.v)}
            y2={yFor(w.v)}
            stroke={w.color}
            strokeWidth={1}
            strokeDasharray={w.label === "PAIN" ? "2 5" : "6 4"}
            vectorEffect="non-scaling-stroke"
            opacity={0.75}
          />
        ))}

        {bars.map((b, i) => {
          const x = step * i + step / 2;
          const up = b.c >= b.o;
          const color = up ? POSITIVE : NEGATIVE;
          const top = yFor(Math.max(b.o, b.c));
          const bottom = yFor(Math.min(b.o, b.c));
          return (
            <g key={b.t}>
              <line x1={x} x2={x} y1={yFor(b.h)} y2={yFor(b.l)} stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.95} />
              <rect
                x={x - bodyW / 2}
                y={top}
                width={bodyW}
                height={Math.max(1.2, bottom - top)}
                fill={color}
                opacity={up ? 0.9 : 0.95}
              />
            </g>
          );
        })}

        <line x1={g.cursorX} x2={g.cursorX} y1={0} y2={H} stroke="rgba(240,246,252,0.4)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={g.width} y1={yFor(frame.spot)} y2={yFor(frame.spot)} stroke={INFO} strokeWidth={1} strokeDasharray="1 3" vectorEffect="non-scaling-stroke" opacity={0.6} />
      </svg>

      {/* y-axis ticks */}
      {ticks.map((t, i) => (
        <Box
          key={i}
          sx={{
            position: "absolute",
            left: 3,
            top: pctFor(t) > 94 ? "calc(100% - 12px)" : pctFor(t) < 6 ? 2 : `calc(${pctFor(t)}% - 5px)`,
            fontFamily: MONO,
            fontSize: 9,
            color: "var(--mui-palette-text-secondary)",
            bgcolor: "rgba(0,0,0,0.55)",
            px: 0.25,
            pointerEvents: "none",
          }}
        >
          {fmtInt(t)}
        </Box>
      ))}

      {/* in-range wall labels, pinned to the right edge */}
      {inRange.map((w, i) => (
        <Box
          key={w.label}
          sx={{
            position: "absolute",
            right: 4,
            top: `calc(${pctFor(w.v)}% - 6px)`,
            fontFamily: MONO,
            fontSize: 9,
            color: w.color,
            bgcolor: "rgba(0,0,0,0.65)",
            px: 0.5,
            borderLeft: `2px solid ${w.color}`,
            lineHeight: "11px",
            pointerEvents: "none",
            zIndex: 2 + i,
          }}
        >
          {w.label} {fmtInt(w.v)}
        </Box>
      ))}

      {/* far walls: edge tags instead of stretching the scale */}
      {above.length > 0 && (
        <Box sx={{ position: "absolute", top: 2, right: 4, display: "flex", gap: 1, fontFamily: MONO, fontSize: 9, pointerEvents: "none" }}>
          {above.map((w) => (
            <Text key={w.label} size="xs" span sx={{ color: w.color }}>
              ↑ {w.label} {fmtInt(w.v)} ({fmtNum(((w.v - frame.spot) / frame.spot) * 100, 1)}%)
            </Text>
          ))}
        </Box>
      )}
      {below.length > 0 && (
        <Box sx={{ position: "absolute", bottom: 14, right: 4, display: "flex", gap: 1, fontFamily: MONO, fontSize: 9, pointerEvents: "none" }}>
          {below.map((w) => (
            <Text key={w.label} size="xs" span sx={{ color: w.color }}>
              ↓ {w.label} {fmtInt(w.v)} ({fmtNum(((w.v - frame.spot) / frame.spot) * 100, 1)}%)
            </Text>
          ))}
        </Box>
      )}

      {/* last price chip */}
      <Box
        sx={{
          position: "absolute",
          right: 4,
          top: `calc(${pctFor(last.c)}% - 7px)`,
          fontFamily: MONO,
          fontSize: 9.5,
          fontWeight: 700,
          color: INFO,
          bgcolor: "rgba(0,0,0,0.75)",
          px: 0.5,
          borderLeft: `2px solid ${INFO}`,
          lineHeight: "12px",
          pointerEvents: "none",
        }}
      >
        {fmtInt(last.c)}
      </Box>

      {/* x-axis */}
      <Box
        sx={{
          position: "absolute",
          left: 46,
          right: 60,
          bottom: 1,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: MONO,
          fontSize: 9,
          color: "var(--mui-palette-text-secondary)",
          pointerEvents: "none",
        }}
      >
        <span>{fmtTime(first.t)}</span>
        <span>{fmtTime(frame.t)} ET</span>
        <span>{fmtTime(last.t)}</span>
      </Box>
    </Box>
  );
}
