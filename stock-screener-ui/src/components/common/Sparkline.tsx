import { Show, createMemo } from "solid-js";

/**
 * Tiny inline sparkline for a per-minute series (max pain drift, PCR drift).
 * Pure SVG, no chart lib — it lives inside a 12px-tall stat cell.
 */
export function Sparkline(props: {
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
          stroke-dasharray={props.animate ? 1 : undefined}
          stroke-dashoffset={props.animate ? 1 : undefined}
          style={props.animate ? { animation: "wall-spark-draw 420ms cubic-bezier(.22,1,.36,1) forwards" } : undefined}
        />
      </svg>
    </Show>
  );
}
