import { createMemo } from "solid-js";
import { Select } from "@/ui";
import type { TFSpec } from "@/types/chartPatterns";
import { FALLBACK_TIMEFRAMES } from "./TimeframeSelect";

export interface ChartTimeframeSelectProps {
  timeframes: TFSpec[];
  /** Active timeframe id (single-select — a chart shows one frame at a time). */
  value: string;
  onChange: (timeframe: string) => void;
}

/**
 * Single-select timeframe control for the chart surfaces (fullscreen modal and
 * `/chart/:symbol`).
 *
 * `TimeframeSelect` is the multi-select used by the Patterns scan workspace (a
 * scan can cover several frames). A chart can only render one frame, so this is
 * a plain @/ui `Select` over the same server-provided ladder and keeps the
 * contract test ids (`patterns-timeframe-select`).
 */
export function ChartTimeframeSelect(props: ChartTimeframeSelectProps) {
  const source = () => (props.timeframes.length > 0 ? props.timeframes : FALLBACK_TIMEFRAMES);
  const data = createMemo(() =>
    source().map((tf) => ({ value: tf.id, label: tf.label || tf.id })),
  );

  // Keep the active id selectable even if the ladder has not caught up yet.
  const dataWithValue = createMemo(() =>
    data().some((item) => item.value === props.value)
      ? data()
      : [{ value: props.value, label: props.value }, ...data()],
  );

  return (
    <Select
      data-testid="patterns-timeframe-select"
      aria-label="Timeframe"
      size="xs"
      w={104}
      value={props.value}
      onChange={(next) => {
        if (next != null && next !== props.value) props.onChange(String(next));
      }}
      data={dataWithValue()}
    />
  );
}
