import { Box, Text } from "@/ui";
import { INFO, MONO, NEGATIVE, POSITIVE, WARNING } from "@/ui/palette";
import type { UsRow } from "../../../types/usReport";
import { buildChart, fmtInt, fmtTime } from "./usReportMath";

const H = 260;

interface Props {
  frames: UsRow[];
  cursor: number;
  compact?: boolean;
}

/** Spot vs walls vs max pain, one polyline per level; cursor marks the frame. */
export function UsChart({ frames, cursor, compact = false }: Props) {
  const g = buildChart(frames, cursor);
  const frame = frames[Math.max(0, Math.min(cursor, frames.length - 1))] ?? null;

  if (!g || !frame) {
    return (
      <Box sx={{ flex: 1, display: "grid", placeItems: "center", border: "1px solid var(--mui-palette-divider)" }}>
        <Text size="xs" c="dimmed">
          no tape yet
        </Text>
      </Box>
    );
  }

  const yFor = (v: number) => H - ((v - g.min) / (g.max - g.min)) * H;
  const first = frames[0];
  const last = frames[frames.length - 1];

  // Build 1-minute bars. Tape rows carry o/h/l/c once the sampler has run;
  // older rows fall back to close-to-close bodies so playback still works.
  const bars = frames.map((f, i) => {
    const c = f.c ?? f.spot;
    const prev = i > 0 ? (frames[i - 1].c ?? frames[i - 1].spot) : f.o ?? c;
    const o = f.o ?? prev;
    return { t: f.t, o, c, h: f.h ?? Math.max(o, c), l: f.l ?? Math.min(o, c) };
  });
  const step = g.width / Math.max(1, bars.length);
  const bodyW = Math.max(1.5, Math.min(14, step * 0.62));

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
        role="img"
        aria-label="US futures spot against call wall, put wall and max pain"
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={g.width} y1={H * f} y2={H * f} stroke="rgba(255,255,255,0.06)" strokeWidth={1} />
        ))}

        <polyline points={g.callWall} fill="none" stroke={POSITIVE} strokeWidth={1} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" opacity={0.85} />
        <polyline points={g.putWall} fill="none" stroke={NEGATIVE} strokeWidth={1} strokeDasharray="5 4" vectorEffect="non-scaling-stroke" opacity={0.85} />
        <polyline points={g.maxPain} fill="none" stroke={WARNING} strokeWidth={1} strokeDasharray="2 4" vectorEffect="non-scaling-stroke" opacity={0.75} />

        {bars.map((b, i) => {
          const x = step * i + step / 2;
          const up = b.c >= b.o;
          const color = up ? POSITIVE : NEGATIVE;
          const top = yFor(Math.max(b.o, b.c));
          const bottom = yFor(Math.min(b.o, b.c));
          return (
            <g key={b.t}>
              <line x1={x} x2={x} y1={yFor(b.h)} y2={yFor(b.l)} stroke={color} strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.9} />
              <rect
                x={x - bodyW / 2}
                y={top}
                width={bodyW}
                height={Math.max(1, bottom - top)}
                fill={color}
                opacity={0.85}
              />
            </g>
          );
        })}

        <line x1={g.cursorX} x2={g.cursorX} y1={0} y2={H} stroke="rgba(240,246,252,0.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />

        <circle cx={g.cursorX} cy={yFor(frame.spot)} r={3.5} fill={INFO} vectorEffect="non-scaling-stroke" />
      </svg>

      <Box
        sx={{
          position: "absolute",
          left: 4,
          top: 2,
          bottom: 0,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          pointerEvents: "none",
          fontFamily: MONO,
          fontSize: 9,
          color: "var(--mui-palette-text-secondary)",
        }}
      >
        <span>{fmtInt(g.max)}</span>
        {!compact && <span>{fmtInt((g.max + g.min) / 2)}</span>}
        <span>{fmtInt(g.min)}</span>
      </Box>

      <Box
        sx={{
          position: "absolute",
          right: 6,
          top: 4,
          display: "flex",
          gap: 1.25,
          fontFamily: MONO,
          fontSize: 9.5,
          alignItems: "center",
        }}
      >
        <Text size="xs" span sx={{ color: INFO }}>
          ● spot {fmtInt(frame.spot)}
        </Text>
        <Text size="xs" span sx={{ color: POSITIVE }}>
          -- call {fmtInt(frame.call_wall)}
        </Text>
        <Text size="xs" span sx={{ color: NEGATIVE }}>
          -- put {fmtInt(frame.put_wall)}
        </Text>
        <Text size="xs" span sx={{ color: WARNING }}>
          ·· pain {fmtInt(frame.max_pain)}
        </Text>
      </Box>

      <Box
        sx={{
          position: "absolute",
          left: 30,
          right: 6,
          bottom: 12,
          display: "flex",
          justifyContent: "space-between",
          fontFamily: MONO,
          fontSize: 9,
          color: "var(--mui-palette-text-secondary)",
        }}
      >
        <span>{fmtTime(first.t)}</span>
        <span>{fmtTime(frame.t)} ET</span>
        <span>{fmtTime(last.t)}</span>
      </Box>
    </Box>
  );
}
