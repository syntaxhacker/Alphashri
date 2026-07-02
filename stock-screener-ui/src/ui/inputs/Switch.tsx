import { Switch as MantineSwitch } from "@mantine/core";
import type { UISwitchProps } from "../types";

export function Switch({ label, checked, defaultChecked, onChange, disabled, size, color, onLabel, offLabel, description, className, style, "data-testid": testId, ...rest }: UISwitchProps) {
  return <MantineSwitch
    label={label}
    checked={checked}
    defaultChecked={defaultChecked}
    onChange={onChange ? (e) => onChange(e.currentTarget.checked) : undefined}
    disabled={disabled}
    size={size}
    color={color}
    onLabel={onLabel}
    offLabel={offLabel}
    description={description}
    className={className}
    style={style}
    data-testid={testId}
    {...rest}
  />;
}
