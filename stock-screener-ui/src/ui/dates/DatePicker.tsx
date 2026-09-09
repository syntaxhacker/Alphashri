import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { DatePicker as MuiDatePicker } from "@mui/x-date-pickers/DatePicker";
import { AdapterDayjs } from "@mui/x-date-pickers/AdapterDayjs";
import dayjs from "dayjs";
import type { UIDatePickerProps } from "../types";

export function DatePicker({
  value,
  defaultValue,
  onChange,
  placeholder,
  minDate,
  maxDate,
  excludeDate,
  disabled,
  className,
  style,
  "data-testid": testId,
  ...rest
}: UIDatePickerProps) {
  const toDayjs = (d: Date | null | undefined) => (d ? dayjs(d) : null);
  const fromDayjs = (d: dayjs.Dayjs | null) => (d ? d.toDate() : null);

  // Use controlled if value is defined, otherwise defaultValue
  const isControlled = value !== undefined;
  const dayjsValue = isControlled ? toDayjs(value ?? null) : undefined;
  const dayjsDefaultValue = !isControlled && defaultValue !== undefined ? toDayjs(defaultValue ?? null) : undefined;

  const shouldDisableDate = excludeDate
    ? (d: dayjs.Dayjs) => {
        try {
          return excludeDate(d.toDate());
        } catch {
          return false;
        }
      }
    : undefined;

  return (
    <LocalizationProvider dateAdapter={AdapterDayjs}>
      <MuiDatePicker
        value={dayjsValue as any}
        defaultValue={dayjsDefaultValue as any}
        onChange={(v: any) => onChange?.(fromDayjs(v))}
        slotProps={{
          textField: {
            placeholder: placeholder as any,
            disabled: disabled as any,
            className,
            style,
            inputProps: { "data-testid": testId } as any,
            size: "small",
          } as any,
        }}
        minDate={minDate ? dayjs(minDate) as any : undefined}
        maxDate={maxDate ? dayjs(maxDate) as any : undefined}
        shouldDisableDate={shouldDisableDate as any}
        disabled={disabled as any}
        {...(rest as any)}
      />
    </LocalizationProvider>
  );
}
