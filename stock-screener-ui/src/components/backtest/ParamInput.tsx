import { memo } from "react";
import { Select, NumberInput, Checkbox } from "@/ui";
import type { StrategyParam } from "../../types/backtest";

export const ParamInput = memo(function ParamInput({
  param,
  value,
  onChange,
}: {
  param: StrategyParam;
  value: any;
  onChange: (value: any) => void;
}) {
  const testId = `param-${param.key}`;

  if (param.type === "select") {
    return (
      <Select
        data-testid={testId}
        value={value ?? param.default}
        onChange={(v) => v && onChange(v)}
        data={(param.options || []).map((opt) => ({ value: opt, label: opt }))}
        size="sm"
        w={80}
      />
    );
  }

  if (param.type === "boolean") {
    return (
      <Checkbox
        data-testid={testId}
        checked={value ?? param.default}
        onChange={(e) => onChange(e.currentTarget.checked)}
        size="sm"
      />
    );
  }

  return (
    <NumberInput
      data-testid={testId}
      value={value ?? param.default}
      onChange={(v) => onChange(Number(v))}
      min={param.min}
      max={param.max}
      step={param.step ?? 1}
      size="sm"
      w={70}
    />
  );
});
