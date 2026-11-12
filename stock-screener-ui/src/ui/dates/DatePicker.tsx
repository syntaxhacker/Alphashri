import { createSignal, createMemo, splitProps } from "solid-js";
import { cn } from "../cn";
import type { UIDatePickerProps } from "../types";

function toISO(date: Date | null): string | undefined {
  if (!date) return undefined;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

export function DatePicker(props: UIDatePickerProps) {
  const [known, _rest] = splitProps(props, [
    "value",
    "defaultValue",
    "onChange",
    "placeholder",
    "minDate",
    "maxDate",
    "excludeDate",
    "clearable",
    "disabled",
    "className",
    "style",
    "data-testid",
    "id",
  ]);

  const [internalValue, setInternalValue] = createSignal<Date | null>(known.defaultValue ?? null);
  const isControlled = known.value !== undefined;
  const current = createMemo(() => (isControlled ? (known.value ?? null) : internalValue()));

  const handleChange = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const parsed = input.value ? new Date(input.value) : null;
    if (parsed && Number.isNaN(parsed.getTime())) return;
    if (known.excludeDate && parsed && known.excludeDate(parsed)) return;
    if (!isControlled) setInternalValue(parsed);
    known.onChange?.(parsed);
  };

  const handleClear = () => {
    if (!isControlled) setInternalValue(null);
    known.onChange?.(null);
  };

  const inputId = known.id ?? known["data-testid"];

  return (
    <div className={cn("flex flex-col gap-1", known.className)} style={known.style} data-testid={known["data-testid"]}>
      {known.placeholder && (
        <label htmlFor={inputId} className="text-sm text-fin-text-muted leading-none">
          {known.placeholder}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          type="date"
          value={current() ? toISO(current()) : ""}
          onInput={handleChange}
          min={known.minDate ? toISO(known.minDate) : undefined}
          max={known.maxDate ? toISO(known.maxDate) : undefined}
          disabled={known.disabled}
          className={cn(
            "w-full bg-fin-surface border border-fin-border text-fin-text rounded-fin px-2 py-1.5 text-sm",
            "focus:outline-none focus:ring-1 focus:ring-fin-primary",
            known.disabled && "opacity-50 cursor-not-allowed",
          )}
        />
        <Show when={known.clearable && current()}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleClear();
            }}
            aria-label="Clear date"
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-fin-text-muted hover:text-fin-text rounded"
          >
            <span aria-hidden="true">×</span>
          </button>
        </Show>
      </div>
    </div>
  );
}
