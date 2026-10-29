import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import { Text } from "@/ui";
import * as palette from "@/ui/palette";

/** One plotted series. `points` are y-values aligned to `labels`. */
export interface MiniSeries {
  name: string;
  points: (number | null)[];
  color: string;
  /** Fill under the line. */
  area?: boolean;
  /** Which y-axis the series is normalised against (0 = left, 1 = right). */
  axis?: 0 | 1;
}

export interface MiniMarker {
  /** Label index the marker sits on. */
  index: number;
  label: string;
  color: string;
}

export interface MiniLineChartProps {
  series: MiniSeries[];
  /** x labels (already formatted); markers/points index into this. */
  labels: string[];
  height?: number;
  /** Draw a horizontal zero reference (uses axis 0's scale). */
  zeroLine?: boolean;
  markers?: MiniMarker[];
  /** Value formatter for the hover readout. */
  formatValue?: (v: number) => string;
  testId?: string;
  emptyMessage?: string;
  /** Optional y-axis compression (see `MiniScale`). Defaults to `linear`. */
  scale?: MiniScale;
}

const PAD_L = 4;
const PAD_R = 4;
const PAD_T = 8;
const PAD_B = 14;
const W = 600;

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Optional y-axis compression. GEX-style profiles have a long tail (a few
 * walls thousands of Cr tall next to dozens of strikes under a hundred), so a
 * linear axis flattens everything but the tallest spike against the baseline.
 * `sqrt` keeps zero at zero, preserves sign, and stays monotonic — a gentler,
 * more familiar compression than log for a signed quantity. Points are
 * transformed for plotting only; hover readouts keep the raw value.
 */
export type MiniScale = "linear" | "sqrt";

export function scaleValue(v: number, scale: MiniScale): number {
  if (scale !== "sqrt") return v;
  return Math.sign(v) * Math.sqrt(Math.abs(v));
}

/** Min/max across the finite points of a set of series. */
export function seriesBounds(
  series: MiniSeries[],
  axis: 0 | 1,
  scale: MiniScale = "linear",
): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    if ((s.axis ?? 0) !== axis) continue;
    for (const raw of s.points) {
      if (!finite(raw)) continue;
      const p = scaleValue(raw, scale);
      if (p < min) min = p;
      if (p > max) max = p;
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1 };
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    return { min: min - pad, max: max + pad };
  }
  return { min, max };
}

/** SVG path `d` for one series (null points break the line). */
export function buildLinePath(
  points: (number | null)[],
  bounds: { min: number; max: number },
  innerW: number,
  innerH: number,
  scale: MiniScale = "linear",
): string {
  const n = points.length;
  if (n === 0) return "";
  const span = bounds.max - bounds.min || 1;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const yOf = (v: number) => innerH - ((scaleValue(v, scale) - bounds.min) / span) * innerH;
  let d = "";
  let pen = false;
  for (let i = 0; i < n; i++) {
    const v = points[i];
    if (!finite(v)) {
      pen = false;
      continue;
    }
    const x = PAD_L + i * stepX;
    const y = PAD_T + yOf(v);
    d += `${pen ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)} `;
    pen = true;
  }
  return d.trim();
}

/** Closed area path under one series (for `area` fills). */
export function buildAreaPath(
  points: (number | null)[],
  bounds: { min: number; max: number },
  innerW: number,
  innerH: number,
  scale: MiniScale = "linear",
): string {
  const line = buildLinePath(points, bounds, innerW, innerH, scale);
  if (!line) return "";
  const n = points.length;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const baseline = (PAD_T + innerH).toFixed(1);
  // Close from the last finite point back to the first finite point.
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (finite(points[i])) {
      if (first === -1) first = i;
      last = i;
    }
  }
  if (first === -1) return "";
  const x0 = (PAD_L + first * stepX).toFixed(1);
  const x1 = (PAD_L + last * stepX).toFixed(1);
  return `${line} L${x1} ${baseline} L${x0} ${baseline} Z`;
}

/**
 * Dependency-free inline-SVG line/area chart for the Nifty analytics panels.
 *
 * Chosen over ECharts on purpose: these are static monitoring visuals, so a
 * full canvas charting instance (≈1 MB + a canvas context each) is not worth
 * the bundle/heap cost. SVG renders in the DOM, styles from palette tokens, and
 * a plain mouse-move drives the hover readout.
 */
export function MiniLineChart({
  series,
  labels,
  height = 180,
  zeroLine = false,
  markers = [],
  formatValue = (v) => v.toFixed(2),
  testId,
  emptyMessage = "No data",
  scale = "linear",
}: MiniLineChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const innerW = W - PAD_L - PAD_R;
  const innerH = height - PAD_T - PAD_B;

  const bounds0 = useMemo(() => seriesBounds(series, 0, scale), [series, scale]);
  const bounds1 = useMemo(() => seriesBounds(series, 1, scale), [series, scale]);
  const paths = useMemo(
    () =>
      series.map((s) => {
        const b = (s.axis ?? 0) === 1 ? bounds1 : bounds0;
        return {
          line: buildLinePath(s.points, b, innerW, innerH, scale),
          area: s.area ? buildAreaPath(s.points, b, innerW, innerH, scale) : "",
          color: s.color,
        };
      }),
    [series, bounds0, bounds1, innerW, innerH, scale],
  );

  const hasData = series.some((s) => s.points.some((p) => finite(p)));
  if (!hasData || labels.length === 0) {
    return (
      <Box
        data-testid={testId}
        sx={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: height }}
      >
        <Text size="xs" c="dimmed" span>
          {emptyMessage}
        </Text>
      </Box>
    );
  }

  const span0 = bounds0.max - bounds0.min || 1;
  const zeroY = PAD_T + innerH - ((0 - bounds0.min) / span0) * innerH;
  const stepX = labels.length > 1 ? innerW / (labels.length - 1) : 0;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round((x - PAD_L) / (stepX || 1));
    setHover(Math.max(0, Math.min(labels.length - 1, idx)));
  };

  const hoverX = hover != null ? PAD_L + hover * stepX : 0;

  return (
    <Box sx={{ width: "100%", minWidth: 0, position: "relative" }} data-testid={testId}>
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        style={{ width: "100%", height, display: "block" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
      >
        {zeroLine && Number.isFinite(zeroY) && (
          <line
            x1={PAD_L}
            x2={W - PAD_R}
            y1={zeroY}
            y2={zeroY}
            stroke={palette.TEXT_MUTED}
            strokeDasharray="3 3"
            strokeWidth={1}
          />
        )}
        {markers.map((m) => {
          const mx = PAD_L + m.index * stepX;
          return (
            <line
              key={m.label}
              x1={mx}
              x2={mx}
              y1={PAD_T}
              y2={PAD_T + innerH}
              stroke={m.color}
              strokeDasharray="2 3"
              strokeWidth={1}
            />
          );
        })}
        {paths.map((p, i) =>
          p.area ? (
            <path key={`a${i}`} d={p.area} fill={p.color} opacity={0.15} stroke="none" />
          ) : null,
        )}
        {paths.map((p, i) => (
          <path
            key={`l${i}`}
            d={p.line}
            fill="none"
            stroke={p.color}
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {hover != null && (
          <line
            x1={hoverX}
            x2={hoverX}
            y1={PAD_T}
            y2={PAD_T + innerH}
            stroke={palette.TEXT_MUTED}
            strokeWidth={1}
          />
        )}
      </svg>
      <Box sx={{ display: "flex", justifyContent: "space-between", px: 0.5 }}>
        <Text size="xs" c="dimmed" span>
          {labels[0]}
        </Text>
        {hover != null && (
          <Text size="xs" c="dimmed" span data-testid={testId ? `${testId}-readout` : undefined}>
            {labels[hover]} ·{" "}
            {series
              .map((s) => `${s.name} ${finite(s.points[hover]) ? formatValue(s.points[hover] as number) : "—"}`)
              .join(" · ")}
          </Text>
        )}
        <Text size="xs" c="dimmed" span>
          {labels[labels.length - 1]}
        </Text>
      </Box>
    </Box>
  );
}
