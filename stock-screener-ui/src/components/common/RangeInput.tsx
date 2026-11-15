import { Show } from "solid-js";
import { Box, NumberInput, RangeSlider } from "@/ui";

export interface RangeInputProps {
  min: number | null;
  max: number | null;
  onMinChange?: (value: number | null) => void;
  onMaxChange?: (value: number | null) => void;
  label?: string;
  /** Slider domain. Required — a range needs an axis to sit on. */
  domain: [number, number];
  step?: number;
  formatValue?: (value: number) => string;
  marks?: { value: number; label: string }[];
  size?: "xs" | "sm";
  testId?: string;
  disabled?: boolean;
  /** Preview during the drag, notify once on release (see RangeSlider). */
  commitOnRelease?: boolean;
}

function toNum(value: number | string | null | undefined): number | null {
  if (value === "" || value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * A range is one control, not two boxes: a dual-thumb slider states the span
 * visually and the paired numeric fields stay for exact entry. The open ends
 * mean "unbounded", so an untouched range leaves both filters null rather than
 * clamping them to the domain.
 */
export function RangeInput(props: RangeInputProps) {
  const lo = () => props.domain[0];
  const hi = () => props.domain[1];
  const clampToDomain = (v: number) => Math.min(Math.max(v, lo()), hi());
  // A floor above the ceiling (or the reverse) is not a range: it matches
  // nothing and it made the slider paint an inverted, ARIA-invalid pair.
  const sliderValue = (): [number, number] => {
    const a = clampToDomain(props.min ?? lo());
    const b = clampToDomain(props.max ?? hi());
    return a <= b ? [a, b] : [b, a];
  };

  const applySlider = (next: [number, number]) => {
    const a = clampToDomain(next[0]);
    const b = clampToDomain(next[1]);
    const nextMin = a <= lo() ? null : a;
    const nextMax = b >= hi() ? null : b;
    // Only notify the side that actually changed: firing both callbacks made one
    // pointer move produce two state writes (and two table/rail updates).
    if (nextMin !== (props.min ?? null)) props.onMinChange?.(nextMin);
    if (nextMax !== (props.max ?? null)) props.onMaxChange?.(nextMax);
  };

  // A typed value is clamped to the domain and kept inside the pair, but it is
  // never mapped to `null`: typing the domain minimum ("0") is a deliberate
  // floor, while blank means "unbounded". Coercing the edited side (rather than
  // pushing the other) keeps it to one callback and never rewrites a field the
  // user did not touch.
  const applyMin = (raw: number | null) => {
    if (raw === null) {
      props.onMinChange?.(null);
      return;
    }
    const value = clampToDomain(raw);
    const ceiling = props.max;
    props.onMinChange?.(ceiling !== null && value > ceiling ? ceiling : value);
  };

  const applyMax = (raw: number | null) => {
    if (raw === null) {
      props.onMaxChange?.(null);
      return;
    }
    const value = clampToDomain(raw);
    const floor = props.min;
    props.onMaxChange?.(floor !== null && value < floor ? floor : value);
  };

  return (
    <Box className="flex flex-col gap-1 min-w-0 w-full" data-testid={props.testId}>
      <Box className="flex items-center gap-1 min-w-0">
        <Show when={props.label}>
          <span className="min-w-0 flex-1 truncate text-[10px] font-semibold uppercase tracking-[0.4px] text-fin-text-muted">
            {props.label}
          </span>
        </Show>
        <Box className="w-[60px] shrink-0">
          <NumberInput
            placeholder="Min"
            aria-label={props.label ? `${props.label} minimum` : "Minimum"}
            value={props.min ?? ""}
            onChange={(v: number | string) => applyMin(toNum(v))}
            size="xs"
            min={lo()}
            max={hi()}
            step={props.step}
            disabled={props.disabled}
            style={{ width: "100%" }}
            data-testid={props.testId ? `${props.testId}-min` : undefined}
          />
        </Box>
        <span className="shrink-0 text-[10px] text-fin-text-muted" aria-hidden="true">–</span>
        <Box className="w-[60px] shrink-0">
          <NumberInput
            placeholder="Max"
            aria-label={props.label ? `${props.label} maximum` : "Maximum"}
            value={props.max ?? ""}
            onChange={(v: number | string) => applyMax(toNum(v))}
            size="xs"
            min={lo()}
            max={hi()}
            step={props.step}
            disabled={props.disabled}
            style={{ width: "100%" }}
            data-testid={props.testId ? `${props.testId}-max` : undefined}
          />
        </Box>
      </Box>
      <RangeSlider
        value={sliderValue()}
        onChange={applySlider}
        min={lo()}
        max={hi()}
        step={props.step}
        label={props.label}
        hideHeader
        formatValue={props.formatValue}
        marks={props.marks}
        size={props.size}
        disabled={props.disabled}
        commitOnRelease={props.commitOnRelease}
        testId={props.testId ? `${props.testId}-slider` : undefined}
      />
    </Box>
  );
}
