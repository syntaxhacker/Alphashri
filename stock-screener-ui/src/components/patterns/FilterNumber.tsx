import { NumberInput } from "@/ui";

export interface FilterNumberProps {
  value?: number | null;
  onChange: (value: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  testId: string;
  disabled?: boolean;
}

export function FilterNumber(props: FilterNumberProps) {
  return (
    <NumberInput
      value={props.value ?? ""}
      onChange={(next: number | string) => {
        if (next === "" || next == null) {
          props.onChange(null);
          return;
        }
        const numeric = Number(next);
        // Ignore in-progress partials ("-", "1.") — never store NaN.
        if (!Number.isNaN(numeric)) props.onChange(numeric);
      }}
      min={props.min}
      max={props.max}
      step={props.step}
      size="sm"
      placeholder={props.placeholder ?? "Any"}
      data-testid={props.testId}
      disabled={props.disabled}
    />
  );
}
