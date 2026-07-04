import { TextInput as MantineTextInput } from "@mantine/core";
import type { UITextInputProps } from "../types";

export function TextInput({ value, defaultValue, onChange, onKeyDown, leftSection, rightSection, className, style, "data-testid": testId, label, description, error, required, disabled, readOnly, size, placeholder, type: inputType }: UITextInputProps) {
  return <MantineTextInput
    value={value}
    defaultValue={defaultValue}
    onChange={onChange ? (e) => onChange(e.currentTarget.value) : undefined}
    onKeyDown={onKeyDown}
    leftSection={leftSection}
    rightSection={rightSection}
    className={className}
    style={style}
    data-testid={testId}
    label={label}
    description={description}
    error={error}
    required={required}
    disabled={disabled}
    readOnly={readOnly}
    size={size}
    placeholder={placeholder}
    type={inputType}
  />;
}
