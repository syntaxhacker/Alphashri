import { useId } from "react";
import { cn } from "../cn";
import { stripLegacyInputProps } from "./legacyProps";
import type { UINumberInputProps } from "../types";

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

function sizeClass(size?: UINumberInputProps["size"]): string {
  return size === "xs" || size === "sm" ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm";
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
  errorProps: _errorProps,
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
  id: inputId,
  name,
  ...rest
}: any) {
  const autoId = useId();
  const resolvedId = inputId ?? autoId;
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

  // Legacy Mantine props are accepted for backward compatibility but never
  // forwarded to the DOM (native elements reject unknown attributes).
  const forwarded = stripLegacyInputProps(rest);

  const wrapperStyle: React.CSSProperties = explicitWidth
    ? { width: explicitWidth, ...style }
    : style ?? {};
  const inputStyle: React.CSSProperties = explicitHeight ? { height: explicitHeight } : {};

  return (
    <div
      data-testid={testId}
      className={cn("flex flex-col min-w-0 gap-1.5", explicitWidth == null ? "w-full" : undefined, className)}
      style={wrapperStyle}
    >
      {label && (
        <label htmlFor={resolvedId} className={cn("text-xs font-medium", isError ? "text-fin-negative" : "text-fin-text")}>
          {label}
          {required && <span className="ml-1 text-fin-negative">*</span>}
        </label>
      )}
      <div className="flex items-center gap-2 w-full min-w-0">
        {leftSection && <div className="shrink-0">{leftSection}</div>}
        {prefix && <span className="shrink-0 text-fin-text-muted">{prefix}</span>}
        <input
          id={resolvedId}
          type="number"
          value={value}
          defaultValue={defaultValue}
          onChange={handleChange}
          placeholder={placeholder}
          name={name}
          min={min}
          max={max}
          step={step}
          required={required}
          disabled={disabled}
          className={cn(
            "flex-1 min-w-0 block",
            sizeClass(size),
            "bg-fin-surface border border-fin-border rounded-fin text-fin-text placeholder:text-fin-text-muted",
            "focus:outline-none focus:border-fin-primary focus:ring-2 focus:ring-fin-primary",
            disabled ? "disabled:bg-fin-surface-alt disabled:text-fin-text-muted disabled:border-fin-border disabled:cursor-not-allowed" : undefined,
            isError ? "border-fin-negative focus:border-fin-negative" : undefined,
          )}
          style={inputStyle}
          {...(forwarded as Record<string, unknown>)}
        />
        {rightSection && <div className="shrink-0">{rightSection}</div>}
        {suffix && <span className="shrink-0 text-fin-text-muted">{suffix}</span>}
      </div>
      {helperText && (
        <span
          className={cn("text-xs", isError ? "text-fin-negative" : "text-fin-text-muted")}
          {...(isError ? (_errorProps as Record<string, unknown> | undefined) : undefined)}
        >
          {helperText}
        </span>
      )}
    </div>
  );
}
