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
  const sliderValue = (): [number, number] => [
    props.min ?? lo(),
    props.max ?? hi(),
  ];

  const applySlider = (next: [number, number]) => {
    props.onMinChange?.(next[0] <= lo() ? null : next[0]);
    props.onMaxChange?.(next[1] >= hi() ? null : next[1]);
  };

  return (
    <Box className="flex flex-col gap-1 min-w-0 w-full" data-testid={props.testId}>
      <RangeSlider
        value={sliderValue()}
        onChange={applySlider}
        min={lo()}
        max={hi()}
        step={props.step}
        label={props.label}
        formatValue={props.formatValue}
        marks={props.marks}
        size={props.size}
        disabled={props.disabled}
        testId={props.testId ? `${props.testId}-slider` : undefined}
      />
      <Box className="flex items-center gap-1 min-w-0">
        <Box className="flex-1 min-w-0">
          <NumberInput
            placeholder="Min"
            aria-label={props.label ? `${props.label} minimum` : "Minimum"}
            value={props.min ?? ""}
            onChange={(v: number | string) => props.onMinChange?.(toNum(v))}
            size="xs"
            min={lo()}
            max={hi()}
            step={props.step}
            disabled={props.disabled}
            style={{ width: "100%" }}
            data-testid={props.testId ? `${props.testId}-min` : undefined}
          />
        </Box>
        <span className="shrink-0 text-[10px] text-fin-text-muted" aria-hidden="true">to</span>
        <Box className="flex-1 min-w-0">
          <NumberInput
            placeholder="Max"
            aria-label={props.label ? `${props.label} maximum` : "Maximum"}
            value={props.max ?? ""}
            onChange={(v: number | string) => props.onMaxChange?.(toNum(v))}
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
    </Box>
  );
}
