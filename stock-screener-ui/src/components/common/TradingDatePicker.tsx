import { useCallback } from "react";
import { DatePickerInput, type DatePickerInputProps } from "@mantine/dates";
import { isTradingHoliday } from "../../state/holidays";

function isNonTradingDay(date: string): boolean {
  if (isTradingHoliday(date)) return true;
  const day = new Date(date).getDay();
  return day === 0 || day === 6;
}

export interface TradingDatePickerProps extends Omit<DatePickerInputProps, "onChange"> {
  value: string;
  onChange: (value: string) => void;
}

export function TradingDatePicker({ value, onChange, ...rest }: TradingDatePickerProps) {
  const handleChange = useCallback(
    (v: string | null) => {
      onChange(v || "");
    },
    [onChange],
  );

  return (
    <DatePickerInput
      size="sm"
      value={value || null}
      onChange={handleChange}
      excludeDate={isNonTradingDay}
      getDayProps={(date) => (isNonTradingDay(date) ? { disabled: true } : {})}
      valueFormat="DD MMM YYYY"
      clearable
      {...rest}
    />
  );
}
