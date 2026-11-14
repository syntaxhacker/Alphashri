import { createSignal, createEffect } from "solid-js";
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

export function EditableNumberCell(props: EditableNumberCellProps) {
  const [localValue, setLocalValue] = createSignal<number | string>(props.value);
  const [saving, setSaving] = createSignal(false);
  let lastCommitted = props.value;
  let isDirty = false;
  let localRef: number | string = props.value;

  // Adopt an external value only while the user is not mid-edit: a refetch
  // must not clobber keystrokes.
  createEffect(() => {
    const v = props.value;
    if (!saving() && !isDirty && v !== localValue()) setLocalValue(v);
  });

  const updateRef = (v: number | string) => {
    localRef = v;
    // Mark dirty BEFORE publishing: Solid notifies the sync effect
    // synchronously inside setLocalValue, so setting the flag afterwards
    // lets the effect revert the keystroke it just saw.
    if (v !== lastCommitted) {
      isDirty = true;
    }
    setLocalValue(v);
  };

  const handleBlur = async () => {
    const numValue =
      typeof localRef === "number" ? localRef : parseFloat(String(localRef));
    if (isNaN(numValue) || numValue === lastCommitted) {
      if (isDirty) {
        setLocalValue(lastCommitted);
        localRef = lastCommitted;
        isDirty = false;
      }
      return;
    }

    isDirty = true;
    setSaving(true);
    try {
      await props.onUpdate(props.strategyId, props.field, numValue);
      lastCommitted = numValue;
      isDirty = false;
    } catch {
      setLocalValue(lastCommitted);
      localRef = lastCommitted;
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      (e.currentTarget as HTMLInputElement).blur();
    }
    if (e.key === "Escape") {
      setLocalValue(lastCommitted);
      localRef = lastCommitted;
      isDirty = false;
    }
  };

  return (
    <NumberInput
      size="xs"
      value={localValue()}
      onChange={updateRef}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      step={props.step ?? 0.1}
      decimalScale={props.decimalScale ?? 1}
      min={props.min}
      max={props.max}
      suffix={props.suffix}
      hideControls
      loading={saving()}
      w={72}
      variant="default"
      data-testid={`editable-${props.field}-${props.strategyId}`}
    />
  );
}
