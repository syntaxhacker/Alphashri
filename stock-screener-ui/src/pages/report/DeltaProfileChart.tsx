import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";
import type { NiftyPositioningStrike } from "@/types/niftyReport";
import { sortByField } from "@/utils/ui-helpers";

/** Strike half-width kept around spot — same band as the option-chain OI. */
const DELTA_PROFILE_WINDOW_PTS = 750;

/** One plotted strike: its OI delta exposure, today's initiated flow, and the
 * running exposure total used to locate the Δ pivot. */
interface DeltaProfilePoint {
  strike: number;
  /** OI × |delta| (Cr), calls + / puts −. */
  netState: number;
  /** ΔOI × |delta| signed by class (Cr); + = bullish initiation. */
  netInitiated: number;
  /** Running Σ netState over the **whole** chain, so the zero crossing still
   * matches the backend's Δ pivot after windowing. */
  cumulative: number;
}

/**
 * Build the per-strike delta profile.
 *
 * `netState` (OI delta exposure) is what defines the Δ pivot, so it must be
 * accumulated **before** the ±window filter — resetting the sum at the first
 * visible strike would move the zero crossing and contradict the pivot chip.
 * Payloads recorded before `net_state` existed return `[]` (the panel then
 * shows its empty state instead of a fake flat line).
 */
export function buildDeltaProfile(
  strikes: NiftyPositioningStrike[] | null | undefined,
  spot?: number | null,
  width: number = DELTA_PROFILE_WINDOW_PTS,
): DeltaProfilePoint[] {
  const rows = sortByField(
    (Array.isArray(strikes) ? strikes : []).filter((s) => s && Number.isFinite(s.strike)),
    "strike",
    "asc",
  );
  if (rows.length === 0) return [];
  if (!rows.some((s) => Number.isFinite(s.netState as number))) return [];

  let cumulative = 0;
  const all = rows.map((s): DeltaProfilePoint => {
    const netState = Number.isFinite(s.netState as number)
      ? (s.netState as number)
      : 0;
    cumulative += netState;
    return {
      strike: s.strike,
      netState,
      netInitiated: Number.isFinite(s.netInitiated) ? s.netInitiated : 0,
      cumulative,
    };
  });

  if (!Number.isFinite(spot as number) || (spot as number) <= 0) return all;
  const near = all.filter(
    (p) => Math.abs(p.strike - (spot as number)) <= width,
  );
  return near.length > 0 ? near : all;
}

/** Nearest point index to a strike, or -1 when the level is missing or sits
 * outside the plotted band (a marker pinned to the edge would misstate it). */
function nearestIndex(
  points: DeltaProfilePoint[],
  level: number | null | undefined,
): number {
  if (!Number.isFinite(level as number) || points.length === 0) return -1;
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < points.length; i++) {
    const d = Math.abs(points[i].strike - (level as number));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  const step =
    points.length > 1
      ? Math.abs(points[1].strike - points[0].strike)
      : 0;
  return bestDist <= Math.max(step, 1) ? best : -1;
}

const W = 600;
const PAD_X = 2;
const LINE_TOP = 8;
const LINE_H = 96;
const BAR_TOP = 116;
const BAR_H = 52;
const BAR_BASE = BAR_TOP + BAR_H / 2;
const H = BAR_TOP + BAR_H + 2;

/** Compress bar lengths: |v|^0.5 keeps a single wall from flattening the rest. */
function barHeight(value: number, maxAbs: number): number {
  if (!Number.isFinite(value) || maxAbs <= 0) return 0;
  const v = Math.abs(value);
  if (v === 0) return 0;
  return Math.max(0.6, Math.sqrt(v / maxAbs) * (BAR_H / 2));
}

interface DeltaProfileChartProps {
  points: DeltaProfilePoint[];
  spot?: number | null;
  flip?: number | null;
  /** Value formatter for the hover readout (e.g. signed crore). */
  formatValue?: (v: number) => string;
  testId?: string;
  emptyMessage?: string;
}

/**
 * Live delta-positioning visual: a cumulative exposure curve over today's
 * per-strike initiated flow.
 *
 * Reading it:
 *   - white curve = running Σ OI×delta (above 0 = long-delta book)
 *   - dotted grey line = zero; where the curve climbs through it is the pivot
 *   - green/red columns = today's initiated delta per strike
 *   - blue dashed = spot, gold dashed = Δ pivot
 *
 * Deliberately SVG (like the GEX panel): a 600px-wide chart over ~30 strikes
 * does not justify a canvas instance, and HTML remains readable by tests.
 */
export function DeltaProfileChart({
  points,
  spot = null,
  flip = null,
  formatValue = (v) => Math.round(v).toLocaleString("en-IN"),
  testId = "nifty-positioning-profile",
  emptyMessage = "No strike breakdown",
}: DeltaProfileChartProps) {
  const [hover, setHover] = useState<number | null>(null);

  const bounds = useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const p of points) {
      if (p.cumulative < min) min = p.cumulative;
      if (p.cumulative > max) max = p.cumulative;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
    if (min === max) {
      const pad = Math.abs(min) * 0.05 || 1;
      return { min: min - pad, max: max + pad };
    }
    return { min, max };
  }, [points]);

  const maxAbsFlow = useMemo(
    () => points.reduce((m, p) => Math.max(m, Math.abs(p.netInitiated)), 0),
    [points],
  );

  const spotIdx = useMemo(() => nearestIndex(points, spot), [points, spot]);
  const flipIdx = useMemo(() => nearestIndex(points, flip), [points, flip]);

  if (points.length === 0) {
    return (
      <Box
        data-testid={testId}
        sx={{ display: "flex", alignItems: "center", justifyContent: "center", flex: 1, minHeight: 120 }}
      >
        <Text size="xs" c="dimmed" span>
          {emptyMessage}
        </Text>
      </Box>
    );
  }

  const innerW = W - PAD_X * 2;
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const xOf = (i: number) => PAD_X + i * stepX;
  const span = bounds.max - bounds.min || 1;
  const yOf = (v: number) =>
    LINE_TOP + LINE_H - ((v - bounds.min) / span) * LINE_H;
  const zeroY = yOf(0);
  const zeroInBand = zeroY >= LINE_TOP - 0.5 && zeroY <= LINE_TOP + LINE_H + 0.5;

  const line = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xOf(i).toFixed(1)} ${yOf(p.cumulative).toFixed(1)}`)
    .join(" ");
  const area = `${line} L${xOf(points.length - 1).toFixed(1)} ${(LINE_TOP + LINE_H).toFixed(1)} L${PAD_X} ${(LINE_TOP + LINE_H).toFixed(1)} Z`;

  const barW = Math.max(1.5, stepX * 0.62);
  const hoverPoint = hover != null ? points[hover] : null;
  const hoverX = hover != null ? xOf(hover) : 0;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round((x - PAD_X) / (stepX || 1));
    setHover(Math.max(0, Math.min(points.length - 1, idx)));
  };

  const marker = (idx: number, color: string, key: string, dashed = true) =>
    idx >= 0 ? (
      <line
        key={key}
        data-testid={`${testId}-marker-${key}`}
        x1={xOf(idx)}
        x2={xOf(idx)}
        y1={LINE_TOP}
        y2={BAR_TOP + BAR_H}
        stroke={color}
        strokeDasharray={dashed ? "2 3" : undefined}
        strokeWidth={dashed ? 1 : 1.25}
        vectorEffect="non-scaling-stroke"
      />
    ) : null;

  return (
    <Box
      data-testid={testId}
      sx={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0, gap: 0.25 }}
    >
      <Box sx={{ flex: 1, minHeight: 120, minWidth: 0 }}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height: "100%", display: "block" }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
          aria-label="Cumulative delta exposure and today's initiated delta by strike"
        >
          {/* zero reference for the cumulative curve */}
          {zeroInBand && (
            <line
              x1={PAD_X}
              x2={W - PAD_X}
              y1={zeroY}
              y2={zeroY}
              stroke={palette.TEXT_MUTED}
              strokeDasharray="3 3"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {marker(spotIdx, palette.TERM_SPOT, "spot", false)}
          {marker(flipIdx, palette.TERM_FLIP, "flip")}
          <path d={area} fill={palette.TEXT} opacity={0.06} stroke="none" />
          <path
            d={line}
            fill="none"
            stroke={palette.TEXT}
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
          />
          {points.map((p, i) => {
            const h = barHeight(p.netInitiated, maxAbsFlow);
            if (h <= 0) return null;
            const up = p.netInitiated >= 0;
            return (
              <rect
                key={`b${p.strike}`}
                x={xOf(i) - barW / 2}
                y={up ? BAR_BASE - h : BAR_BASE}
                width={barW}
                height={h}
                fill={up ? palette.POSITIVE : palette.NEGATIVE}
                opacity={0.72}
              />
            );
          })}
          {/* baseline for the flow columns */}
          <line
            x1={PAD_X}
            x2={W - PAD_X}
            y1={BAR_BASE}
            y2={BAR_BASE}
            stroke={palette.CHART_BORDER}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          {hover != null && (
            <line
              x1={hoverX}
              x2={hoverX}
              y1={LINE_TOP}
              y2={BAR_TOP + BAR_H}
              stroke={palette.TEXT_MUTED}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
      </Box>

      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, minWidth: 0, px: 0.25 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25, minWidth: 0, overflow: "hidden" }}>
          <Legend color={palette.TEXT} label="Cumulative δ" line />
          <Legend color={palette.POSITIVE} label="Flow +" block />
          <Legend color={palette.NEGATIVE} label="Flow −" block />
          <Legend color={palette.TERM_SPOT} label="Spot" line />
          <Legend color={palette.TERM_FLIP} label="Δ pivot" dashed />
        </Box>
        <Text
          size="xs"
          c="dimmed"
          span
          data-testid={`${testId}-readout`}
          sx={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 }}
        >
          {hoverPoint
            ? `${hoverPoint.strike.toLocaleString("en-IN")} · cum ${formatValue(hoverPoint.cumulative)} · flow ${formatValue(hoverPoint.netInitiated)}`
            : `${points[0].strike.toLocaleString("en-IN")}–${points[points.length - 1].strike.toLocaleString("en-IN")}`}
        </Text>
      </Box>
    </Box>
  );
}

function Legend({
  color,
  label,
  line = false,
  dashed = false,
  block = false,
}: {
  color: string;
  label: string;
  line?: boolean;
  dashed?: boolean;
  block?: boolean;
}) {
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
      <Box
        aria-hidden
        sx={{
          width: block ? 6 : 12,
          height: block ? 6 : 0,
          borderRadius: block ? 1 : 0,
          bgcolor: block ? color : "transparent",
          borderTop: line || dashed ? `1px ${dashed ? "dashed" : "solid"} ${color}` : undefined,
          opacity: 0.9,
        }}
      />
      <Text size="xs" c="dimmed" span>
        {label}
      </Text>
    </Box>
  );
}
