import { useState } from "react";
import { cn } from "../cn";
import type { UIDatePickerProps } from "../types";

function toISO(date: Date | null): string | undefined {
  if (!date) return undefined;
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

export function DatePicker({
  value,
  defaultValue,
  onChange,
  placeholder,
  minDate,
  maxDate,
  excludeDate,
  clearable,
  disabled,
  className,
  style,
  "data-testid": testId,
  id
}: UIDatePickerProps) {
  const [internalValue, setInternalValue] = useState<Date | null>(defaultValue ?? null);
  const isControlled = value !== undefined;
  const current: Date | null = isControlled ? (value ?? null) : internalValue;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = e.target.value ? new Date(e.target.value) : null;
    if (parsed && Number.isNaN(parsed.getTime())) return;
    if (excludeDate && parsed && excludeDate(parsed)) return;
    if (!isControlled) setInternalValue(parsed);
    onChange?.(parsed);
  };

  const handleClear = () => {
    if (!isControlled) setInternalValue(null);
    onChange?.(null);
  };

  const inputId = id || testId || undefined;

  return (
    <div className={cn("flex flex-col gap-1", className)} style={style} data-testid={testId}>
      {placeholder && (
        <label htmlFor={inputId} className="text-sm text-fin-text-muted leading-none">
          {placeholder}
        </label>
      )}
      <div className="relative">
        <input
          id={inputId}
          type="date"
          value={toISO(current) ?? ""}
          onChange={handleChange}
          min={minDate ? toISO(minDate) : undefined}
          max={maxDate ? toISO(maxDate) : undefined}
          disabled={disabled}
          className={cn(
            "w-full bg-fin-surface border border-fin-border text-fin-text rounded-fin px-2 py-1.5 text-sm",
            "focus:outline-none focus:ring-1 focus:ring-fin-primary",
            disabled && "opacity-50 cursor-not-allowed",
          )}
        />
        {clearable && current ? (
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
        ) : null}
      </div>
    </div>
  );
}
