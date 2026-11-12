import { splitProps } from "solid-js";
import { DatePicker, type UIDatePickerProps } from "@/ui";
import { isTradingHoliday } from "../../state/holidays";

function isNonTradingDay(date: string): boolean {
  if (isTradingHoliday(date)) return true;
  const day = new Date(date).getDay();
  return day === 0 || day === 6;
}

export interface TradingDatePickerProps extends Omit<UIDatePickerProps, "onChange"> {
  value: string;
  onChange: (value: string) => void;
}

export function TradingDatePicker(props: TradingDatePickerProps) {
  const [local, rest] = splitProps(props, ["value", "onChange"]);

  const handleChange = (v: string | null) => {
    local.onChange(v || "");
  };

  return (
    <DatePicker
      size="sm"
      value={local.value || null}
      onChange={handleChange}
      excludeDate={isNonTradingDay}
      getDayProps={(date) => (isNonTradingDay(date) ? { disabled: true } : {})}
      valueFormat="DD MMM YYYY"
      clearable
      {...rest}
    />
  );
}
