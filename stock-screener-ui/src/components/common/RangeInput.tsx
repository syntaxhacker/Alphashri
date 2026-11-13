import { createMemo } from "solid-js";
import { Box, NumberInput } from "@/ui";

export interface RangeInputProps {
  /** Lower bound; `null` means "no lower bound". */
  min: number | null;
  /** Upper bound; `null` means "no upper bound". */
  max: number | null;
  onMinChange?: (value: number | null) => void;
  onMaxChange?: (value: number | null) => void;
  /** Placeholder for the open ends, e.g. "0" / "any". */
  placeholder?: [string, string];
  step?: number;
  /** Hard limits used to seed the numeric inputs and clamp user entry. */
  bounds?: [number, number];
  size?: "xs" | "sm";
  label?: string;
  description?: string;
  testId?: string;
  disabled?: boolean;
}

function toNum(value: number | string | null | undefined): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * One labelled range instead of two unlabelled Min/Max boxes.
 *
 * Two bare inputs force the user to infer which side is which and read the
 * section title above them; a joined control with a shared track states the
 * range once and shows the active span. Values stay independent so an open
 * end still means "unbounded" rather than 0.
 */
export function RangeInput(props: RangeInputProps) {
  const ph = () => props.placeholder ?? ["Min", "Max"];
  const lo = () => props.bounds?.[0] ?? 0;
  const hi = () => props.bounds?.[1];

  const invalid = createMemo(() => {
    const min = props.min;
    const max = props.max;
    return min != null && max != null && min > max;
  });

  const span = createMemo(() => {
    const min = props.min;
    const max = props.max;
    if (min == null && max == null) return "any";
    if (min != null && max != null) return `${min} – ${max}`;
    return min != null ? `≥ ${min}` : `≤ ${max}`;
  });

  return (
    <Box className="flex flex-col gap-0.5 min-w-0" data-testid={props.testId}>
      <Box className="flex items-center justify-between gap-1 min-w-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.4px] text-fin-text-muted truncate">
          {props.label}
        </span>
        <span
          className="shrink-0 font-mono text-[10px] tabular-nums text-fin-text-muted"
          data-testid={props.testId ? `${props.testId}-span` : undefined}
          classList={{ "text-fin-negative": invalid() }}
        >
          {span()}
        </span>
      </Box>
      <Box
        className="flex items-center gap-0 rounded-fin border border-fin-border overflow-hidden bg-fin-surface"
        classList={{ "border-fin-negative": invalid() }}
        role="group"
        aria-label={props.label ? `${props.label} range` : "Range"}
      >
        <Box className="flex-1 min-w-0">
          <NumberInput
            placeholder={ph()[0]}
            aria-label={props.label ? `${props.label} minimum` : "Minimum"}
            value={props.min ?? ""}
            onChange={(v: number | string) => props.onMinChange?.(toNum(v))}
            size={props.size ?? "xs"}
            min={lo()}
            max={hi()}
            step={props.step}
            disabled={props.disabled}
            style={{ width: "100%", "border": "0", "border-radius": "0" }}
            data-testid={props.testId ? `${props.testId}-min` : undefined}
          />
        </Box>
        <span className="shrink-0 px-1 text-[10px] text-fin-text-muted select-none" aria-hidden="true">
          to
        </span>
        <Box className="flex-1 min-w-0">
          <NumberInput
            placeholder={ph()[1]}
            aria-label={props.label ? `${props.label} maximum` : "Maximum"}
            value={props.max ?? ""}
            onChange={(v: number | string) => props.onMaxChange?.(toNum(v))}
            size={props.size ?? "xs"}
            min={lo()}
            max={hi()}
            step={props.step}
            disabled={props.disabled}
            style={{ width: "100%", "border": "0", "border-radius": "0" }}
            data-testid={props.testId ? `${props.testId}-max` : undefined}
          />
        </Box>
      </Box>
      {props.description && (
        <span className="text-[10px] text-fin-text-muted">{props.description}</span>
      )}
    </Box>
  );
}
