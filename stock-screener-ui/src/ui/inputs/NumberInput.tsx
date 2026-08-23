import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import type { UINumberInputProps } from "../types";

function mapSize(size?: UINumberInputProps["size"]): "small" | "medium" {
  return size === "xs" || size === "sm" ? "small" : "medium";
}

export function NumberInput({
  value,
  defaultValue,
  onChange,
  min,
  max,
  step,
  decimalScale: _decimalScale,
  clampBehavior: _clampBehavior,
  allowDecimal: _allowDecimal,
  allowNegative: _allowNegative,
  hideControls: _hideControls,
  suffix,
  prefix,
  leftSection,
  rightSection,
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
}: UINumberInputProps) {
  const muiSize = mapSize(size);
  const isError = Boolean(error);
  const helperText = isError
    ? typeof error === "string"
      ? error
      : String(error ?? "")
    : (description as string | undefined);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === "") {
      onChange?.("");
      return;
    }
    const num = Number(raw);
    onChange?.(Number.isNaN(num) ? raw : num);
  };

  const startAdornment = prefix || leftSection ? (
    <InputAdornment position="start">
      {prefix ? <span>{prefix}</span> : null}
      {leftSection}
    </InputAdornment>
  ) : undefined;

  const endAdornment = suffix || rightSection ? (
    <InputAdornment position="end">
      {rightSection}
      {suffix ? <span>{suffix}</span> : null}
    </InputAdornment>
  ) : undefined;

  return (
    <TextField
      value={value ?? ""}
      defaultValue={defaultValue}
      onChange={handleChange}
      label={label as string | undefined}
      placeholder={placeholder}
      helperText={helperText}
      error={isError}
      required={required}
      disabled={disabled}
      size={muiSize}
      type="number"
      fullWidth
      className={className}
      style={style as React.CSSProperties}
      data-testid={testId}
      slotProps={{
        input: {
          startAdornment,
          endAdornment,
        },
        htmlInput: {
          min,
          max,
          step,
        },
      }}
      sx={{ "& .MuiInputBase-root": { bgcolor: "background.paper" } }}
      {...(rest as object)}
    />
  );
}
