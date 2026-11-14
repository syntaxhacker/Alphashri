import { splitProps } from "solid-js";
import { DatePicker, type UIDatePickerProps } from "@/ui";
import { isTradingHoliday } from "../../state/holidays";

/** `YYYY-MM-DD` → local midnight `Date` (never UTC, so the day never shifts). */
function parseDay(value: string | null | undefined): Date | null {
  if (!value) return null;
  const [y, m, d] = value.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDay(date: Date | null): string {
  if (!date) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isNonTradingDay(date: Date): boolean {
  return isTradingHoliday(formatDay(date));
}

/**
 * String-in/string-out date picker. The trading filters and config forms hold
 * `YYYY-MM-DD` strings, so the conversion to `Date` lives here rather than at
 * every call site (and `maxDate` arrives as a string, which `DatePicker` would
 * otherwise receive typed as a `Date`).
 */
export interface TradingDatePickerProps extends Omit<UIDatePickerProps, "onChange" | "value" | "defaultValue" | "minDate" | "maxDate" | "excludeDate" | "getDayProps"> {
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  minDate?: string;
  maxDate?: string;
  /** Extra non-trading days for this picker, in addition to exchange holidays. */
  excludeDate?: (value: string) => boolean;
  /** Explicit control width (number → px). `DatePicker` has no width prop, so it is applied here. */
  w?: number | string;
}

export function TradingDatePicker(props: TradingDatePickerProps) {
  const [local, rest] = splitProps(props, [
    "value",
    "defaultValue",
    "onChange",
    "minDate",
    "maxDate",
    "excludeDate",
    "w",
    "style",
  ]);

  const exclude = (date: Date) => isNonTradingDay(date) || (local.excludeDate?.(formatDay(date)) ?? false);

  return (
    <DatePicker
      size="sm"
      value={parseDay(local.value)}
      defaultValue={parseDay(local.defaultValue)}
      onChange={(date) => local.onChange?.(formatDay(date))}
      minDate={parseDay(local.minDate) ?? undefined}
      maxDate={parseDay(local.maxDate) ?? undefined}
      excludeDate={exclude}
      valueFormat="DD MMM YYYY"
      clearable
      style={{
        ...(local.w != null ? { width: typeof local.w === "number" ? `${local.w}px` : local.w } : {}),
        ...(local.style as Record<string, string | undefined>),
      }}
      {...rest}
    />
  );
}
