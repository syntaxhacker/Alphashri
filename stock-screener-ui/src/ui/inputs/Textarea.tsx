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
  ...rest
}: UITextareaProps) {
  const muiSize = mapSize(size);
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
      fullWidth
      multiline
      minRows={effectiveMinRows}
      maxRows={effectiveMaxRows}
      className={className}
      style={style as React.CSSProperties}
      data-testid={testId}
      sx={{
        "& .MuiInputBase-inputMultiline": {
          resize: resize ?? (autosize ? "none" : undefined),
        },
        "& .MuiInputBase-root": { bgcolor: "background.paper" },
      }}
      {...(rest as object)}
    />
  );
}
