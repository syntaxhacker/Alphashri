import { For, createMemo, createUniqueId } from "solid-js";
import { NEGATIVE, POSITIVE, TEXT_MUTED } from "@/ui/palette";
import { finite, signedPct } from "./shared";

const PAD = 2;

export interface MiniSparklineProps {
  values: (number | null)[];
  width?: number;
  height?: number;
}

type SparkSign = "positive" | "negative" | "flat";

interface SparkSegment {
  key: string;
  d: string;
  sign: SparkSign;
}

export function MiniSparkline(props: MiniSparklineProps) {
  const titleId = `history-sparkline-title-${createUniqueId()}`;
  const descId = `history-sparkline-desc-${createUniqueId()}`;

  const model = createMemo(() => {
    const values = props.values;
    const width = props.width ?? 96;
    const height = props.height ?? 24;

    let factor = 1;
    const cumulative: (number | null)[] = values.map((value) => {
      if (!finite(value)) return null;
      factor *= 1 + Math.max(-100, value) / 100;
      return (factor - 1) * 100;
    });

    const valid = cumulative.filter(finite);
    const final = valid.length > 0 ? valid[valid.length - 1] : null;
    const hasPath = valid.length >= 2;

    let min = 0;
    let max = 0;
    for (const value of valid) {
      if (value < min) min = value;
      if (value > max) max = value;
    }
    if (hasPath && min === max) {
      min = -1;
      max = 1;
    }
    if (!hasPath) {
      min = -1;
      max = 1;
    }
    const span = max - min || 1;
    const innerW = Math.max(1, width - PAD * 2);
    const innerH = Math.max(1, height - PAD * 2);

    const x = (index: number) =>
      values.length > 1 ? PAD + (index / (values.length - 1)) * innerW : PAD + innerW / 2;
    const y = (value: number) => PAD + ((max - value) / span) * innerH;
    const zeroY = y(0);

    const segments: SparkSegment[] = [];
    if (hasPath) {
      for (let index = 0; index < cumulative.length - 1; index++) {
        const from = cumulative[index];
        const to = cumulative[index + 1];
        if (!finite(from) || !finite(to)) continue;
        const x0 = x(index);
        const x1 = x(index + 1);
        const y0 = y(from);
        const y1 = y(to);

        if ((from < 0 && to > 0) || (from > 0 && to < 0)) {
          const ratio = from / (from - to);
          const crossX = x0 + (x1 - x0) * ratio;
          segments.push({
            key: `segment-${segments.length}`,
            d: `M${x0.toFixed(1)} ${y0.toFixed(1)} L${crossX.toFixed(1)} ${zeroY.toFixed(1)}`,
            sign: from > 0 ? "positive" : "negative",
          });
          segments.push({
            key: `segment-${segments.length}`,
            d: `M${crossX.toFixed(1)} ${zeroY.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)}`,
            sign: to > 0 ? "positive" : "negative",
          });
        } else {
          segments.push({
            key: `segment-${segments.length}`,
            d: `M${x0.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y1.toFixed(1)}`,
            sign: from === 0 && to === 0 ? "flat" : from >= 0 && to >= 0 ? "positive" : "negative",
          });
        }
      }
    }

    return { width, height, zeroY, segments, final };
  });

  const signColor = (sign: SparkSign) =>
    sign === "positive" ? POSITIVE : sign === "negative" ? NEGATIVE : TEXT_MUTED;

  return (
    <svg
      data-testid="history-sparkline"
      width="100%"
      viewBox={`0 0 ${model().width} ${model().height}`}
      preserveAspectRatio="xMinYMin meet"
      role="img"
      aria-labelledby={`${titleId} ${descId}`}
      style={{ display: "block", "max-width": `${model().width}px`, height: "auto" }}
    >
      <title id={titleId}>
        {model().final === null
          ? "Cumulative monthly return sparkline"
          : `Cumulative monthly return ${signedPct(model().final ?? 0)}`}
      </title>
      <desc id={descId}>
        Compounded monthly returns with a zero baseline. Green segments sit above zero, red segments
        below. Missing months break the line.
      </desc>

      <line
        data-baseline="true"
        x1={PAD}
        x2={model().width - PAD}
        y1={model().zeroY}
        y2={model().zeroY}
        stroke={TEXT_MUTED}
        stroke-opacity={0.55}
        stroke-width={0.75}
        stroke-dasharray="2 2"
        vector-effect="non-scaling-stroke"
      />

      <For each={model().segments}>
        {(segment, index) => (
          <path
            data-segment={index()}
            data-sign={segment.sign}
            d={segment.d}
            fill="none"
            stroke={signColor(segment.sign)}
            stroke-width={1.3}
            stroke-linecap="round"
            vector-effect="non-scaling-stroke"
          />
        )}
      </For>
    </svg>
  );
}
