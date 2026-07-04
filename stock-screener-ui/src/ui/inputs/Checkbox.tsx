import { Checkbox as MantineCheckbox } from "@mantine/core";
import type { UICheckboxProps } from "../types";

export function Checkbox({ label, checked, defaultChecked, onChange, disabled, size, color, indeterminate, description, className, style, "data-testid": testId, ...rest }: UICheckboxProps) {
  return <MantineCheckbox
    label={label}
    checked={checked}
    defaultChecked={defaultChecked}
    onChange={onChange}
    disabled={disabled}
    size={size}
    color={color}
    indeterminate={indeterminate}
    description={description}
    className={className}
    style={style}
    data-testid={testId}
    {...rest}
  />;
}
