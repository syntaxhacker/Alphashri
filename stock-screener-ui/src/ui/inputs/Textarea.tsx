import TextField from "@mui/material/TextField";
import type { UITextareaProps } from "../types";

function mapSize(size?: UITextareaProps["size"]): "small" | "medium" {
  return size === "xs" || size === "sm" ? "small" : "medium";
}

export function Textarea({
  value,
  defaultValue,
  onChange,
  autosize,
  minRows,
  maxRows,
  resize,
  label,
  description,
  error,
  required,
  disabled,
  size,
  placeholder,
  className,
  style,
  "data-testid": testId,
  w,
  h,
  ...rest
}: UITextareaProps) {
  const muiSize = mapSize(size);
  const explicitWidth = w != null ? (typeof w === "number" ? `${w}px` : w) : undefined;
  const explicitHeight = h != null ? (typeof h === "number" ? `${h}px` : h) : undefined;
  const isError = Boolean(error);
  const helperText = isError
    ? typeof error === "string"
      ? error
      : String(error ?? "")
    : (description as string | undefined);

  const effectiveMinRows = minRows ?? (autosize ? 2 : 3);
  const effectiveMaxRows = maxRows;

  return (
    <TextField
      value={value}
      defaultValue={defaultValue}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      label={label as string | undefined}
      placeholder={placeholder}
      helperText={helperText}
      error={isError}
      required={required}
      disabled={disabled}
      size={muiSize}
      fullWidth={explicitWidth == null}
      multiline
      minRows={effectiveMinRows}
      maxRows={effectiveMaxRows}
      className={className}
      style={style as React.CSSProperties}
      data-testid={testId ? `${testId}-field` : undefined}
      slotProps={{
        // testid belongs on the native textarea so getByTestId returns an
        // editable element (typing, fill, clear all work on it)
        htmlInput: testId ? ({ "data-testid": testId } as any) : undefined,
      }}
      sx={{
        "& .MuiInputBase-inputMultiline": {
          resize: resize ?? (autosize ? "none" : undefined),
        },
        "& .MuiInputBase-root": { bgcolor: "background.paper" },
        width: explicitWidth,
        ...(explicitHeight && { height: explicitHeight }),
      }}
      {...(rest as object)}
    />
  );
}
