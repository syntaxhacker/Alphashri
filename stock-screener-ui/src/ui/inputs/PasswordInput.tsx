import { useId, useState } from "react";
import { cn } from "../cn";
import { stripLegacyInputProps } from "./legacyProps";
import type { UIPasswordInputProps } from "../types";

function sizeClass(size?: UIPasswordInputProps["size"]): string {
  return size === "xs" || size === "sm" ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm";
}

function buttonSizeClass(size?: UIPasswordInputProps["size"]): string {
  return size === "xs" || size === "sm" ? "w-7 h-7" : "w-8 h-8";
}

const Eye = () => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOff = () => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8" />
    <circle cx="12" cy="12" r="3" />
    <path d="M1 1l22 22" />
  </svg>
);

export function PasswordInput({
  value,
  defaultValue,
  onChange,
  visibilityToggleButtonLabel,
  visible: controlledVisible,
  onVisibilityChange,
  label,
  description,
  error,
  required,
  disabled,
  size,
  placeholder,
  leftSection,
  rightSection,
  className,
  style,
  "data-testid": testId,
  w,
  h,
  id: inputId,
  ...rest
}: UIPasswordInputProps) {
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

  const [internalVisible, setInternalVisible] = useState(false);
  const isControlled = controlledVisible !== undefined;
  const visible = isControlled ? controlledVisible : internalVisible;

  const handleToggle = () => {
    const next = !visible;
    if (!isControlled) setInternalVisible(next);
    onVisibilityChange?.(next);
  };

  // Legacy Mantine props are accepted for backward compatibility but never
  // forwarded to the DOM (native elements reject unknown attributes).
  const forwarded = stripLegacyInputProps(rest);

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
          type={visible ? "text" : "password"}
          value={value}
          defaultValue={defaultValue}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          placeholder={placeholder}
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
          data-testid={inputTestId}
          {...(forwarded as Record<string, unknown>)}
        />
        {rightSection && <div className="shrink-0">{rightSection}</div>}
        <button
          type="button"
          aria-label={visibilityToggleButtonLabel ?? "Toggle password visibility"}
          onClick={handleToggle}
          disabled={disabled}
          className={cn(
            "flex-shrink-0 flex items-center justify-center",
            buttonSizeClass(size),
            "rounded-fin border border-fin-border text-fin-text-muted bg-fin-surface",
            "hover:bg-fin-surface-alt focus:outline-none focus:border-fin-primary focus:ring-1 focus:ring-fin-primary",
            disabled ? "opacity-50 cursor-not-allowed" : undefined,
          )}
        >
          {visible ? <EyeOff /> : <Eye />}
        </button>
      </div>
      {helperText && (
        <span className={cn("text-xs", isError ? "text-fin-negative" : "text-fin-text-muted")}>{helperText}</span>
      )}
    </div>
  );
}
