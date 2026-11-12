import { createSignal, createUniqueId, splitProps } from "solid-js";
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
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOff = () => (
  <svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8" />
    <path d="M1 1l22 22" />
  </svg>
);

export function PasswordInput(props: UIPasswordInputProps) {
  const [known, _rest] = splitProps(props, [
    "value",
    "defaultValue",
    "onChange",
    "visibilityToggleButtonLabel",
    "visible",
    "onVisibilityChange",
    "label",
    "description",
    "error",
    "required",
    "disabled",
    "size",
    "placeholder",
    "leftSection",
    "rightSection",
    "className",
    "style",
    "data-testid",
    "id",
    "w",
    "h",
  ]);

  const resolvedId = known.id ?? createUniqueId();
  const explicitWidth = known.w != null ? (typeof known.w === "number" ? `${known.w}px` : known.w) : undefined;
  const explicitHeight = known.h != null ? (typeof known.h === "number" ? `${known.h}px` : known.h) : undefined;
  const isError = Boolean(known.error);
  const helperText = isError
    ? typeof known.error === "string"
      ? known.error
      : String(known.error ?? "")
    : (known.description as string | undefined);

  const [internalVisible, setInternalVisible] = createSignal(false);
  const isControlled = known.visible !== undefined;
  const visible = isControlled ? known.visible : internalVisible();

  const handleToggle = () => {
    const next = !visible;
    if (!isControlled) setInternalVisible(next);
    known.onVisibilityChange?.(next);
  };

  // Legacy Mantine props are accepted for backward compatibility but never
  // forwarded to the DOM (native elements reject unknown attributes).
  const forwarded = stripLegacyInputProps(_rest);

  const wrapperStyle = explicitWidth ? { width: explicitWidth, ...known.style } : known.style ?? {};
  const inputStyle = explicitHeight ? { height: explicitHeight } : {};

  const wrapperTestId = known["data-testid"] ? `${known["data-testid"]}-field` : undefined;
  const inputTestId = known["data-testid"];

  const isControlledInput = known.value !== undefined || (known.onChange !== undefined && known.defaultValue === undefined);

  return (
    <div
      data-testid={wrapperTestId}
      className={cn("flex flex-col min-w-0 gap-1.5", explicitWidth == null ? "w-full" : undefined, known.className)}
      style={wrapperStyle}
    >
      {known.label && (
        <label htmlFor={resolvedId} className={cn("text-xs font-medium", isError ? "text-fin-negative" : "text-fin-text")}>
          {known.label}
          {known.required && <span className="ml-1 text-fin-negative">*</span>}
        </label>
      )}
      <div className="flex items-center gap-2 w-full min-w-0">
        {known.leftSection && <div className="shrink-0">{known.leftSection}</div>}
        <input
          id={resolvedId}
          type={visible ? "text" : "password"}
          value={isControlledInput ? known.value : known.defaultValue}
          onInput={(e) => known.onChange?.(e.currentTarget.value)}
          placeholder={known.placeholder}
          required={known.required}
          disabled={known.disabled}
          className={cn(
            "flex-1 min-w-0 block",
            sizeClass(known.size),
            "bg-fin-surface border border-fin-border rounded-fin text-fin-text placeholder:text-fin-text-muted",
            "focus:outline-none focus:border-fin-primary focus:ring-2 focus:ring-fin-primary",
            known.disabled ? "disabled:bg-fin-surface-alt disabled:text-fin-text-muted disabled:border-fin-border disabled:cursor-not-allowed" : undefined,
            isError ? "border-fin-negative focus:border-fin-negative" : undefined,
          )}
          style={inputStyle}
          data-testid={inputTestId}
          {...(forwarded as Record<string, unknown>)}
        />
        {known.rightSection && <div className="shrink-0">{known.rightSection}</div>}
        <button
          type="button"
          aria-label={known.visibilityToggleButtonLabel ?? "Toggle password visibility"}
          onClick={handleToggle}
          disabled={known.disabled}
          className={cn(
            "flex-shrink-0 flex items-center justify-center",
            buttonSizeClass(known.size),
            "rounded-fin border border-fin-border text-fin-text-muted bg-fin-surface",
            "hover:bg-fin-surface-alt focus:outline-none focus:border-fin-primary focus:ring-1 focus:ring-fin-primary",
            known.disabled ? "opacity-50 cursor-not-allowed" : undefined,
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
