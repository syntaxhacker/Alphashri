import { useState, useRef } from "react";
import { NumberInput } from "@/ui";

interface EditableNumberCellProps {
  value: number;
  field: string;
  strategyId: number;
  step?: number;
  decimalScale?: number;
  min?: number;
  max?: number;
  suffix?: string;
  onUpdate: (strategyId: number, field: string, value: number) => Promise<void>;
}

export function EditableNumberCell({
  value,
  field,
  strategyId,
  step = 0.1,
  decimalScale = 1,
  min,
  max,
  suffix,
  onUpdate,
}: EditableNumberCellProps) {
  const [localValue, setLocalValue] = useState(value);
  const [saving, setSaving] = useState(false);
  const lastCommitted = useRef(value);
  const isDirty = useRef(false);
  const localRef = useRef(value);

  if (!saving && !isDirty.current && localValue !== value) {
    setLocalValue(value);
  }

  const updateRef = (v: number) => {
    localRef.current = v;
    setLocalValue(v);
    if (v !== lastCommitted.current) {
      isDirty.current = true;
    }
  };

  const handleBlur = async () => {
    const numValue =
      typeof localRef.current === "number"
        ? localRef.current
        : parseFloat(String(localRef.current));
    if (isNaN(numValue) || numValue === lastCommitted.current) {
      if (isDirty.current) {
        setLocalValue(lastCommitted.current);
        localRef.current = lastCommitted.current;
        isDirty.current = false;
      }
      return;
    }

    isDirty.current = true;
    setSaving(true);
    try {
      await onUpdate(strategyId, field, numValue);
      lastCommitted.current = numValue;
      isDirty.current = false;
    } catch {
      setLocalValue(lastCommitted.current);
      localRef.current = lastCommitted.current;
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    }
    if (e.key === "Escape") {
      setLocalValue(lastCommitted.current);
      localRef.current = lastCommitted.current;
      isDirty.current = false;
    }
  };

  return (
    <NumberInput
      size="xs"
      value={localValue}
      onChange={updateRef}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      step={step}
      decimalScale={decimalScale}
      min={min}
      max={max}
      suffix={suffix}
      hideControls
      loading={saving}
      w={72}
      variant="default"
      styles={{
        input: {
          textAlign: "right",
          height: 24,
          minHeight: 24,
          fontSize: "var(--mantine-font-size-xs)",
          padding: "0 6px",
        },
      }}
      data-testid={`editable-${field}-${strategyId}`}
    />
  );
}
