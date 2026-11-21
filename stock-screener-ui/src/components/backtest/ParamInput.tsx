import { Select, NumberInput, Checkbox } from "@/ui";
import type { StrategyParam } from "../../types/backtest";

export function ParamInput(props: {
  param: StrategyParam;
  value: any;
  onChange: (value: any) => void;
}) {
  const testId = () => `param-${props.param.key}`;

  if (props.param.type === "select") {
    return (
      <Select
        data-testid={testId()}
        value={props.value ?? props.param.default}
        onChange={(v) => v && props.onChange(v)}
        data={(props.param.options || []).map((opt) => ({ value: opt, label: opt }))}
        size="sm"
        w="100%"
      />
    );
  }

  if (props.param.type === "boolean") {
    return (
      <Checkbox
        data-testid={testId()}
        checked={props.value ?? props.param.default}
        onChange={(e) => props.onChange(e.currentTarget.checked)}
        size="sm"
      />
    );
  }

  return (
    <NumberInput
      data-testid={testId()}
      value={props.value ?? props.param.default}
      onChange={(v) => props.onChange(Number(v))}
      min={props.param.min}
      max={props.param.max}
      step={props.param.step ?? 1}
      size="sm"
      w="100%"
    />
  );
}
