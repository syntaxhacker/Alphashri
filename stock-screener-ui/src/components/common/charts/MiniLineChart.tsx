import { For, Show, createMemo, createSignal } from "solid-js";
import { Box, Text } from "@/ui";
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
export function MiniLineChart(props: MiniLineChartProps) {
  const height = () => props.height ?? 180;
  const zeroLine = () => props.zeroLine ?? false;
  const markers = () => props.markers ?? [];
  const formatValue = () => props.formatValue ?? ((v: number) => v.toFixed(2));
  const emptyMessage = () => props.emptyMessage ?? "No data";
  const scale = () => props.scale ?? "linear";

  const [hover, setHover] = createSignal<number | null>(null);
  const innerW = () => W - PAD_L - PAD_R;
  const innerH = () => height() - PAD_T - PAD_B;

  const bounds0 = createMemo(() => seriesBounds(props.series, 0, scale()));
  const bounds1 = createMemo(() => seriesBounds(props.series, 1, scale()));
  const paths = createMemo(() =>
    props.series.map((s) => {
      const b = (s.axis ?? 0) === 1 ? bounds1() : bounds0();
      return {
        line: buildLinePath(s.points, b, innerW(), innerH(), scale()),
        area: s.area ? buildAreaPath(s.points, b, innerW(), innerH(), scale()) : "",
        color: s.color,
      };
    }),
  );

  const hasData = createMemo(() =>
    props.series.some((s) => s.points.some((p) => finite(p))),
  );

  const span0 = () => bounds0().max - bounds0().min || 1;
  const zeroY = () => PAD_T + innerH() - ((0 - bounds0().min) / span0()) * innerH();
  const stepX = () => (props.labels.length > 1 ? innerW() / (props.labels.length - 1) : 0);

  const onMove = (e: MouseEvent & { currentTarget: SVGSVGElement }) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round((x - PAD_L) / (stepX() || 1));
    setHover(Math.max(0, Math.min(props.labels.length - 1, idx)));
  };

  const emptyState = (
    <Box
      data-testid={props.testId}
      className="flex items-center justify-center"
      style={{ minHeight: height() }}
    >
      <Text size="xs" c="dimmed" span>
        {emptyMessage()}
      </Text>
    </Box>
  );

  return (
    <Show when={hasData() && props.labels.length > 0} fallback={emptyState}>
      <Box
        className="w-full min-w-0 relative"
        data-testid={props.testId}
      >
        <svg
          viewBox={`0 0 ${W} ${height()}`}
          preserveAspectRatio="none"
          style={{ width: "100%", height: height(), display: "block" }}
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
          role="img"
        >
          <Show when={zeroLine() && Number.isFinite(zeroY())}>
            <line
              x1={PAD_L}
              x2={W - PAD_R}
              y1={zeroY()}
              y2={zeroY()}
              stroke={palette.TEXT_MUTED}
              stroke-dasharray="3 3"
              stroke-width={1}
            />
          </Show>
          <For each={markers()}>{(m) => {
            const mx = PAD_L + m.index * stepX();
            return (
              <line
                x1={mx}
                x2={mx}
                y1={PAD_T}
                y2={PAD_T + innerH()}
                stroke={m.color}
                stroke-dasharray="2 3"
                stroke-width={1}
              />
            );
          }}</For>
          <For each={paths()}>{(p) => (
            <Show when={p.area}>
              <path d={p.area} fill={p.color} opacity={0.15} stroke="none" />
            </Show>
          )}</For>
          <For each={paths()}>{(p) => (
            <path
              d={p.line}
              fill="none"
              stroke={p.color}
              stroke-width={1.6}
              vector-effect="non-scaling-stroke"
            />
          )}</For>
          <Show when={hover() != null}>
            <line
              x1={PAD_L + (hover() ?? 0) * stepX()}
              x2={PAD_L + (hover() ?? 0) * stepX()}
              y1={PAD_T}
              y2={PAD_T + innerH()}
              stroke={palette.TEXT_MUTED}
              stroke-width={1}
            />
          </Show>
        </svg>
        <Box className="flex justify-between px-1">
          <Text size="xs" c="dimmed" span>
            {props.labels[0]}
          </Text>
          <Show when={hover() != null}>
            <Text size="xs" c="dimmed" span data-testid={props.testId ? `${props.testId}-readout` : undefined}>
              {props.labels[hover()!]} ·{" "}
              {props.series
                .map((s) => `${s.name} ${finite(s.points[hover()!]) ? formatValue()(s.points[hover()!] as number) : "—"}`)
                .join(" · ")}
            </Text>
          </Show>
          <Text size="xs" c="dimmed" span>
            {props.labels[props.labels.length - 1]}
          </Text>
        </Box>
      </Box>
    </Show>
  );
}
