import { Show, createMemo } from "solid-js";
import { Box } from "@/ui";

/**
 * Two call shapes still reach this primitive. The screener sends closes that
 * the API has already normalised to 0..1; report/agri/story callers send raw
 * values that need min/max normalisation. Each branch keeps its own geometry
 * so the rendered SVG is unchanged from the two former modules.
 */
export interface ScreenerSparklineProps {
  data: number[];
  /** Row's day change % — decides green/red stroke. */
  change?: number;
  width?: number;
  height?: number;
}

export interface ChartSparklineProps {
  values: Array<number | null | undefined>;
  width?: number;
  height?: number;
  color?: string;
  testId?: string;
  /** Draw-in once on mount; replay updates still jump (the caller decides). */
  animate?: boolean;
  /** When true, omit width/height attributes so parent CSS controls size via viewBox. */
  responsive?: boolean;
}

export type SparklineProps = ScreenerSparklineProps | ChartSparklineProps;

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

function ScreenerSparkline(props: ScreenerSparklineProps) {
  const change = () => props.change ?? 0;
  const width = () => props.width ?? 64;
  const height = () => props.height ?? 20;
  const positive = () => change() >= 0;
  const values = () => (Array.isArray(props.data) ? props.data : []).map(clamp01);

  const geometry = () => {
    const w = width();
    const h = height();
    const pad = 1.5;
    const vals = values();
    const innerW = Math.max(1, w - pad * 2);
    const innerH = Math.max(1, h - pad * 2);

    if (vals.length === 0) {
      const y = (h / 2).toFixed(1);
      return `${pad},${y} ${(w - pad).toFixed(1)},${y}`;
    }
    if (vals.length === 1) {
      const y = (h - pad - vals[0] * innerH).toFixed(1);
      return `${pad},${y} ${(w - pad).toFixed(1)},${y}`;
    }
    return vals
      .map((v, i) => {
        const x = pad + (i / (vals.length - 1)) * innerW;
        const y = h - pad - v * innerH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  };

  return (
    <Box
      data-testid="sparkline"
      data-positive={positive() ? "true" : "false"}
      data-points={values().length}
      className="inline-flex flex-shrink-0 items-center"
      style={{ width: `${width()}px`, height: `${height()}px` }}
    >
      <svg
        width={width()}
        height={height()}
        viewBox={`0 0 ${width()} ${height()}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polyline
          points={geometry()}
          fill="none"
          stroke={positive() ? "var(--color-fin-positive)" : "var(--color-fin-negative)"}
          stroke-width={1.5}
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </Box>
  );
}

function ChartSparkline(props: ChartSparklineProps) {
  const width = () => props.width ?? 44;
  const height = () => props.height ?? 12;
  const clean = createMemo(() =>
    (props.values ?? []).map((v) => Number(v)).filter((v) => Number.isFinite(v)),
  );
  const points = createMemo(() => {
    const c = clean();
    if (c.length < 2) return "";
    const min = Math.min(...c);
    const max = Math.max(...c);
    const span = max - min || 1;
    const step = width() / (c.length - 1);
    return c
      .map((v, i) => `${(i * step).toFixed(1)},${(height() - 1 - ((v - min) / span) * (height() - 2)).toFixed(1)}`)
      .join(" ");
  });
  return (
    <Show when={clean().length >= 2}>
      <svg
        data-testid={props.testId}
        {...(!(props.responsive ?? false) ? { width: width(), height: height() } : {})}
        viewBox={`0 0 ${width()} ${height()}`}
        aria-hidden
        style={{ display: "block", overflow: "visible", ...(props.responsive ? { width: "100%", height: "auto" } : {}) }}
      >
        <polyline
          points={points()}
          fill="none"
          stroke={props.color ?? "currentColor"}
          stroke-width={1}
          stroke-linejoin="round"
          stroke-linecap="round"
          opacity={0.9}
          pathLength={props.animate ? 1 : undefined}
          stroke-dasharray={props.animate ? "1" : undefined}
          stroke-dashoffset={props.animate ? "1" : undefined}
          style={props.animate ? { animation: "wall-spark-draw 420ms cubic-bezier(.22,1,.36,1) forwards" } : undefined}
        />
      </svg>
    </Show>
  );
}

export function Sparkline(props: SparklineProps) {
  return "data" in props ? ScreenerSparkline(props) : ChartSparkline(props);
}
