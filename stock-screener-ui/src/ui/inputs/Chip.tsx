import { Chip as MantineChip } from "@mantine/core";
import type { UIChipProps } from "../types";

export function Chip({ checked, defaultChecked, onChange, disabled, size, color, variant, value, children, className, style, "data-testid": testId, ...rest }: UIChipProps) {
  return <MantineChip
    checked={checked}
    defaultChecked={defaultChecked}
    onChange={onChange ? (checked) => onChange(checked) : undefined}
    disabled={disabled}
    size={size}
    color={color}
    variant={variant}
    value={value}
    className={className}
    style={style}
    data-testid={testId}
    {...rest}
  >{children}</MantineChip>;
}
