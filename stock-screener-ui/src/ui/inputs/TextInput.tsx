import { createUniqueId } from "solid-js";
import { cn } from "../cn";
import type { UITextInputProps } from "../types";

function sizeClass(size?: UITextInputProps["size"]): string {
  return size === "xs" || size === "sm" ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm";
}

export function TextInput(props: UITextInputProps) {
  const resolvedId = props.id ?? createUniqueId();
  const explicitWidth = props.w != null ? (typeof props.w === "number" ? `${props.w}px` : props.w) : undefined;
  const explicitHeight = props.h != null ? (typeof props.h === "number" ? `${props.h}px` : props.h) : undefined;
  const isError = Boolean(props.error);
  const helperText = isError
    ? typeof props.error === "string"
      ? props.error
      : String(props.error ?? "")
    : (props.description as string | undefined);

  const wrapperStyle = explicitWidth ? { width: explicitWidth, ...props.style } : props.style ?? {};
  const inputStyle = explicitHeight ? { height: explicitHeight } : {};

  const wrapperTestId = props["data-testid"] ? `${props["data-testid"]}-field` : undefined;
  const inputTestId = props["data-testid"];

  const isControlled = props.value !== undefined || (props.onChange !== undefined && props.defaultValue === undefined);

  return (
    <div
      data-testid={wrapperTestId}
      className={cn("flex flex-col min-w-0 gap-1.5", explicitWidth == null ? "w-full" : undefined, props.className)}
      style={wrapperStyle}
    >
      {props.label && (
        <label htmlFor={resolvedId} className={cn("text-xs font-medium", isError ? "text-fin-negative" : "text-fin-text")}>
          {props.label}
          {props.required && <span className="ml-1 text-fin-negative">*</span>}
        </label>
      )}
      <div className="flex items-center gap-2 w-full min-w-0">
        {props.leftSection && <div className="shrink-0">{props.leftSection}</div>}
        <input
          id={resolvedId}
          type={props.type ?? "text"}
          value={isControlled ? props.value : props.defaultValue}
          onInput={(e) => props.onChange?.(e.currentTarget.value)}
          onKeyDown={(e) => props.onKeyDown?.(e)}
          onFocus={(e) => props.onFocus?.(e)}
          onBlur={(e) => props.onBlur?.(e)}
          placeholder={props.placeholder}
          name={props.name}
          required={props.required}
          disabled={props.disabled}
          readOnly={props.readOnly}
          className={cn(
            "flex-1 min-w-0 block",
            sizeClass(props.size),
            "bg-fin-surface border border-fin-border rounded-fin text-fin-text placeholder:text-fin-text-muted",
            "focus:outline-none focus:border-fin-primary focus:ring-2 focus:ring-fin-primary",
            props.disabled ? "disabled:bg-fin-surface-alt disabled:text-fin-text-muted disabled:border-fin-border disabled:cursor-not-allowed" : undefined,
            isError ? "border-fin-negative focus:border-fin-negative" : undefined,
          )}
          style={inputStyle}
          data-testid={inputTestId}
        />
        {props.rightSection && <div className="shrink-0">{props.rightSection}</div>}
      </div>
      {helperText && (
        <span className={cn("text-xs", isError ? "text-fin-negative" : "text-fin-text-muted")}>{helperText}</span>
      )}
    </div>
  );
}
