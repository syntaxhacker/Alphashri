import { Show, createEffect, createMemo, createSignal, on, splitProps } from "solid-js";
import { cn } from "../cn";
import type { UIDatePickerProps } from "../types";

/**
 * `YYYY-MM-DD` from the *local* calendar fields. `toISOString()` would shift the
 * day for any zone offset from UTC (IST rendered 2026-04-20 as 2026-04-19).
 */
function toISO(date: Date | null): string | undefined {
  if (!date) return undefined;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return undefined;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local midnight for a `YYYY-MM-DD` string; `new Date(str)` parses as UTC and shifts the day. */
function fromISO(value: string): Date | null {
  if (!value) return null;
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
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
  const [rejected, setRejected] = createSignal(false);
  const isControlled = known.value !== undefined;
  const current = createMemo(() => (isControlled ? (known.value ?? null) : internalValue()));

  const handleChange = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const parsed = fromISO(input.value);
    if (input.value && !parsed) {
      input.value = toISO(current()) ?? "";
      return;
    }
    if (parsed && known.excludeDate?.(parsed)) {
      setRejected(true);
      input.value = toISO(current()) ?? "";
      return;
    }
    setRejected(false);
    if (!isControlled) setInternalValue(parsed);
    known.onChange?.(parsed);
  };

  const handleClear = () => {
    setRejected(false);
    if (!isControlled) setInternalValue(null);
    known.onChange?.(null);
  };

  const inputId = known.id ?? known["data-testid"];

  // A rejected pick leaves the message up; a new value from the parent supersedes it.
  createEffect(
    on(
      () => toISO(current()),
      () => setRejected(false),
      { defer: true },
    ),
  );

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
          aria-invalid={rejected() || undefined}
          disabled={known.disabled}
          className={cn(
            "w-full bg-fin-surface border border-fin-border text-fin-text rounded-fin px-2 py-1.5 text-sm",
            "focus:outline-none focus:ring-1 focus:ring-fin-primary",
            rejected() && "border-fin-negative",
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
      <Show when={rejected()}>
        <span role="alert" className="text-[10px] leading-none text-fin-negative">
          Selected date is not available
        </span>
      </Show>
    </div>
  );
}
