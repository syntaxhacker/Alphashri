import { useId } from "react";
import { cn } from "../cn";
import { stripLegacyInputProps } from "./legacyProps";
import type { UITextareaProps } from "../types";

function sizeClass(size?: UITextareaProps["size"]): string {
  return size === "xs" || size === "sm" ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm";
}

function resizeClass(resize?: UITextareaProps["resize"], autosize?: boolean): string | undefined {
  const effective = resize ?? (autosize ? "none" : undefined);
  if (effective === "none") return "resize-none";
  if (effective === "both") return "resize";
  if (effective === "horizontal") return "resize-x";
  if (effective === "vertical") return "resize-y";
  return undefined;
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
  id: inputId,
  ...rest
}: UITextareaProps) {
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

  const effectiveMinRows = minRows ?? (autosize ? 2 : 3);
  const effectiveMaxRows = maxRows;

  // Legacy Mantine props are accepted for backward compatibility but never
  // forwarded to the DOM (native elements reject unknown attributes).
  const forwarded = stripLegacyInputProps(rest);

  const wrapperStyle: React.CSSProperties = explicitWidth
    ? { width: explicitWidth, ...style }
    : style ?? {};
  const inputStyle: React.CSSProperties = {
    ...(explicitHeight ? { height: explicitHeight } : {}),
    ...(effectiveMaxRows ? { maxHeight: `${effectiveMaxRows * 1.4}rem` } : {}),
  };

  const wrapperTestId = testId ? `${testId}-field` : undefined;
  const inputTestId = testId;

  return (
    <div
      data-testid={wrapperTestId}
      className={cn("flex flex-col min-w-0 gap-1.5", explicitWidth == null ? "w-full" : undefined, className)}
      style={wrapperStyle}
    >
      {label && (
        <label htmlFor={resolvedId} className={cn("text-xs font-medium", isError ? "text-fin-negative" : "text-fin-text")}>
          {label}
          {required && <span className="ml-1 text-fin-negative">*</span>}
        </label>
      )}
      <textarea
        id={resolvedId}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        rows={effectiveMinRows}
        className={cn(
          "flex-1 min-w-0 block",
          sizeClass(size),
          resizeClass(resize, autosize),
          "bg-fin-surface border border-fin-border rounded-fin text-fin-text placeholder:text-fin-text-muted",
          "focus:outline-none focus:border-fin-primary focus:ring-2 focus:ring-fin-primary",
          disabled ? "disabled:bg-fin-surface-alt disabled:text-fin-text-muted disabled:border-fin-border disabled:cursor-not-allowed" : undefined,
          isError ? "border-fin-negative focus:border-fin-negative" : undefined,
        )}
        style={inputStyle}
        data-testid={inputTestId}
        {...(forwarded as Record<string, unknown>)}
      />
      {helperText && (
        <span className={cn("text-xs", isError ? "text-fin-negative" : "text-fin-text-muted")}>{helperText}</span>
      )}
    </div>
  );
}
