import { Textarea as MantineTextarea } from "@mantine/core";
import type { UITextareaProps } from "../types";

export function Textarea({ value, defaultValue, onChange, autosize, minRows, maxRows, resize, label, description, error, required, disabled, size, placeholder, className, style, "data-testid": testId, ...rest }: UITextareaProps) {
  return <MantineTextarea
    value={value}
    defaultValue={defaultValue}
    onChange={onChange ? (e) => onChange(e.currentTarget.value) : undefined}
    autosize={autosize}
    minRows={minRows}
    maxRows={maxRows}
    resize={resize}
    label={label}
    description={description}
    error={error}
    required={required}
    disabled={disabled}
    size={size}
    placeholder={placeholder}
    className={className}
    style={style}
    data-testid={testId}
    {...rest}
  />;
}
