import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import type { UITextInputProps } from "../types";

function mapSize(size?: UITextInputProps["size"]): "small" | "medium" {
  return size === "xs" || size === "sm" ? "small" : "medium";
}

export function TextInput({
  value,
  defaultValue,
  onChange,
  onKeyDown,
  leftSection,
  rightSection,
  className,
  style,
  "data-testid": testId,
  label,
  description,
  error,
  required,
  disabled,
  readOnly,
  size,
  placeholder,
  type: inputType,
  name,
  id: inputId,
}: UITextInputProps) {
  const muiSize = mapSize(size);
  const isError = Boolean(error);
  const helperText = isError
    ? typeof error === "string"
      ? error
      : String(error ?? "")
    : (description as string | undefined);

  return (
    <TextField
      value={value}
      defaultValue={defaultValue}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      onKeyDown={onKeyDown as React.KeyboardEventHandler<HTMLDivElement> | undefined}
      label={label as string | undefined}
      placeholder={placeholder}
      helperText={helperText}
      error={isError}
      required={required}
      disabled={disabled}
      size={muiSize}
      type={inputType}
      name={name as string | undefined}
      id={inputId as string | undefined}
      fullWidth
      className={className}
      style={style as React.CSSProperties}
      data-testid={testId ? `${testId}-field` : undefined}
      slotProps={{
        input: {
          readOnly: readOnly,
          startAdornment: leftSection ? (
            <InputAdornment position="start">{leftSection}</InputAdornment>
          ) : undefined,
          endAdornment: rightSection ? (
            <InputAdornment position="end">{rightSection}</InputAdornment>
          ) : undefined,
        },
        // testid belongs on the native input so getByTestId returns an
        // editable element (typing, fill, clear all work on it)
        htmlInput: testId ? ({ "data-testid": testId } as any) : undefined,
      }}
      sx={{ "& .MuiInputBase-root": { bgcolor: "background.paper" } }}
    />
  );
}
