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

export function Sparkline({ data, change = 0, width = 64, height = 20 }: SparklineProps) {
  const positive = change >= 0;
  const values = (Array.isArray(data) ? data : []).map(clamp01);
  const pad = 1.5;
  const innerW = Math.max(1, width - pad * 2);
  const innerH = Math.max(1, height - pad * 2);

  let points: string;
  if (values.length === 0) {
    const y = (height / 2).toFixed(1);
    points = `${pad},${y} ${(width - pad).toFixed(1)},${y}`;
  } else if (values.length === 1) {
    const y = (height - pad - values[0] * innerH).toFixed(1);
    points = `${pad},${y} ${(width - pad).toFixed(1)},${y}`;
  } else {
    points = values
      .map((v, i) => {
        const x = pad + (i / (values.length - 1)) * innerW;
        const y = height - pad - v * innerH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }

  return (
    <Box
      data-testid="sparkline"
      data-positive={positive ? "true" : "false"}
      data-points={values.length}
      sx={{ width, height, flexShrink: 0, display: "inline-flex", alignItems: "center" }}
    >
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polyline
          points={points}
          fill="none"
          stroke={positive ? "var(--mui-palette-success-main)" : "var(--mui-palette-error-main)"}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </Box>
  );
}
