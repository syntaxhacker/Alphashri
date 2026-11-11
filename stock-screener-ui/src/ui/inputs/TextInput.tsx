import { useId } from "react";
import { cn } from "../cn";
import type { UITextInputProps } from "../types";

function sizeClass(size?: UITextInputProps["size"]): string {
  return size === "xs" || size === "sm" ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm";
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
  w,
  h,
  onFocus,
  onBlur,
}: UITextInputProps) {
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

  const wrapperStyle: React.CSSProperties = explicitWidth
    ? { width: explicitWidth, ...style }
    : style ?? {};
  const inputStyle: React.CSSProperties = explicitHeight ? { height: explicitHeight } : {};

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
      <div className="flex items-center gap-2 w-full min-w-0">
        {leftSection && <div className="shrink-0">{leftSection}</div>}
        <input
          id={resolvedId}
          type={inputType ?? "text"}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onBlur={onBlur}
          placeholder={placeholder}
          name={name}
          required={required}
          disabled={disabled}
          readOnly={readOnly}
          className={cn(
            "flex-1 min-w-0 block",
            sizeClass(size),
            "bg-fin-surface border border-fin-border rounded-fin text-fin-text placeholder:text-fin-text-muted",
            "focus:outline-none focus:border-fin-primary focus:ring-2 focus:ring-fin-primary",
            disabled ? "disabled:bg-fin-surface-alt disabled:text-fin-text-muted disabled:border-fin-border disabled:cursor-not-allowed" : undefined,
            isError ? "border-fin-negative focus:border-fin-negative" : undefined,
          )}
          style={inputStyle}
          data-testid={inputTestId}
        />
        {rightSection && <div className="shrink-0">{rightSection}</div>}
      </div>
      {helperText && (
        <span className={cn("text-xs", isError ? "text-fin-negative" : "text-fin-text-muted")}>{helperText}</span>
      )}
    </div>
  );
}
