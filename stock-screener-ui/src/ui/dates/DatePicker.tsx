import { DatePickerInput } from "@mantine/dates";
import type { UIDatePickerProps } from "../types";

export function DatePicker({ value, defaultValue, onChange, excludeDate, className, style, "data-testid": testId, ...rest }: UIDatePickerProps) {
  return <DatePickerInput value={value} defaultValue={defaultValue} onChange={onChange} excludeDate={excludeDate} className={className} style={style} data-testid={testId} {...rest} />;
}
