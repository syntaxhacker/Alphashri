import { memo } from "react";

/**
 * Tiny inline sparkline for a per-minute series (max pain drift, PCR drift).
 * Pure SVG, no chart lib — it lives inside a 12px-tall stat cell.
 *
 * Memoised: hovering a sibling chart re-renders its parent, and this polyline
 * depends only on its own props.
 */
export const Sparkline = memo(function Sparkline({
  values,
  width = 44,
  height = 12,
  color = "currentColor",
  testId,
  animate = false,
  responsive = false,
}: {
  values: Array<number | null | undefined>;
  width?: number;
  height?: number;
  color?: string;
  testId?: string;
  /** Draw-in once on mount; replay updates still jump (the caller decides). */
  animate?: boolean;
  /** When true, omit width/height attributes so parent CSS controls size via viewBox. */
  responsive?: boolean;
}) {
  const clean = (values ?? []).map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (clean.length < 2) return null;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const span = max - min || 1;
  const step = width / (clean.length - 1);
  const points = clean
    .map((v, i) => `${(i * step).toFixed(1)},${(height - 1 - ((v - min) / span) * (height - 2)).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      data-testid={testId}
      {...(!responsive && { width, height })}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      style={{ display: "block", overflow: "visible", ...(responsive ? { width: "100%", height: "auto" } : {}) }}
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.9}
        pathLength={animate ? 1 : undefined}
        strokeDasharray={animate ? 1 : undefined}
        strokeDashoffset={animate ? 1 : undefined}
        style={animate ? { animation: "wall-spark-draw 420ms cubic-bezier(.22,1,.36,1) forwards" } : undefined}
      />
    </svg>
  );
});
Sparkline.displayName = "Sparkline";
