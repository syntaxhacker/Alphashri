import { PasswordInput as MantinePasswordInput } from "@mantine/core";
import type { UIPasswordInputProps } from "../types";

export function PasswordInput({ value, defaultValue, onChange, visibilityToggleButtonLabel, visible, onVisibilityChange, label, description, error, required, disabled, size, placeholder, leftSection, rightSection, className, style, "data-testid": testId, ...rest }: UIPasswordInputProps) {
  return <MantinePasswordInput
    value={value}
    defaultValue={defaultValue}
    onChange={onChange ? (e) => onChange(e.currentTarget.value) : undefined}
    visibilityToggleButtonLabel={visibilityToggleButtonLabel}
    visible={visible}
    onVisibilityChange={onVisibilityChange}
    label={label}
    description={description}
    error={error}
    required={required}
    disabled={disabled}
    size={size}
    placeholder={placeholder}
    leftSection={leftSection}
    rightSection={rightSection}
    className={className}
    style={style}
    data-testid={testId}
    {...rest}
  />;
}
