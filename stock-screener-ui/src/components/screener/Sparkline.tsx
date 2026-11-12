import { Box } from "@/ui";

interface SparklineProps {
  data: number[];
  /** Row's day change % — decides green/red stroke. */
  change?: number;
  width?: number;
  height?: number;
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return Math.min(1, Math.max(0, v));
}

export function Sparkline(props: SparklineProps) {
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
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Box>
  );
}
