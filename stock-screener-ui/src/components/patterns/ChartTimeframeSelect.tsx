import { useMemo } from "react";
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
export function ChartTimeframeSelect({ timeframes, value, onChange }: ChartTimeframeSelectProps) {
  const source = timeframes.length > 0 ? timeframes : FALLBACK_TIMEFRAMES;
  const data = useMemo(
    () => source.map((tf) => ({ value: tf.id, label: tf.label || tf.id })),
    [source],
  );

  // Keep the active id selectable even if the ladder has not caught up yet.
  const dataWithValue = useMemo(
    () =>
      data.some((item) => item.value === value)
        ? data
        : [{ value, label: value }, ...data],
    [data, value],
  );

  return (
    <Select
      data-testid="patterns-timeframe-select"
      aria-label="Timeframe"
      size="xs"
      w={104}
      value={value}
      onChange={(next) => {
        if (next != null && next !== value) onChange(String(next));
      }}
      data={dataWithValue}
    />
  );
}
