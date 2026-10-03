import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import type { UINumberInputProps } from "../types";
function mapSize(size?: UINumberInputProps["size"]): "small" | "medium" {
  return size === "xs" || size === "sm" ? "small" : "medium";
}

/**
 * Coerce raw input text to the `onChange` payload. In-progress keystrokes
 * ("-", "1.", "1e-") are not complete numbers: `Number("1.")` truncates to 1
 * and `Number("-")` is NaN — so they pass through as raw text and numeric
 * callers never see a truncated number or NaN.
 */
export function coerceNumberInput(raw: string): number | string {
  if (raw === "") return "";
  if (/[.]$|[eE][+-]?$/.test(raw)) return raw;
  const num = Number(raw);
  return Number.isNaN(num) ? raw : num;
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
  errorProps,
  required,
  disabled,
  size,
  placeholder,
  className,
  style,
  "data-testid": testId,
  w,
  h,
  variant: _variant,
  styles: _styles,
  loading: _loading,
  ...rest
}: any) {
  const muiSize = mapSize(size);
  const explicitWidth = w != null ? (typeof w === "number" ? `${w}px` : w) : undefined;
  const explicitHeight = h != null ? (typeof h === "number" ? `${h}px` : h) : undefined;
  const isError = Boolean(error);
  const helperText = isError
    ? typeof error === "string"
      ? error
      : String(error ?? "")
    : (description as string | undefined);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange?.(coerceNumberInput(e.target.value));
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
      // NOTE: value must stay undefined (uncontrolled) when the caller only
      // passes defaultValue — `?? ""` forces a controlled-empty input that
      // hides defaults, breaks FormData reads, and trips native validation.
      value={value}
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
      fullWidth={explicitWidth == null}
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
        formHelperText: isError && errorProps ? (errorProps as any) : undefined,
      }}
      sx={{ "& .MuiInputBase-root": { bgcolor: "background.paper" }, width: explicitWidth, ...(explicitHeight && { height: explicitHeight }) }}
      {...(rest as object)}
    />
  );
}
