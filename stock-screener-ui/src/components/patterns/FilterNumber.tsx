import { NumberInput } from "@/ui";

export interface FilterNumberProps {
  value: number | null | undefined;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  testId: string;
  disabled?: boolean;
}

/**
 * Numeric filter input with the shared "empty clears the filter / partials
 * never become NaN" semantics used by every numeric control in the rail.
 */
export function FilterNumber({
  value,
  onChange,
  min,
  max,
  step,
  placeholder = "Any",
  testId,
  disabled,
}: FilterNumberProps) {
  return (
    <NumberInput
      value={value ?? ""}
      onChange={(next: number | string) => {
        if (next === "" || next == null) {
          onChange(null);
          return;
        }
        const numeric = Number(next);
        // Ignore in-progress partials ("-", "1.") — never store NaN.
        if (!Number.isNaN(numeric)) onChange(numeric);
      }}
      min={min}
      max={max}
      step={step}
      size="sm"
      placeholder={placeholder}
      data-testid={testId}
      disabled={disabled}
    />
  );
}
