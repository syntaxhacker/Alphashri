import { createUniqueId, splitProps } from "solid-js";
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

export function Textarea(props: UITextareaProps) {
  const [known, _rest] = splitProps(props, [
    "value",
    "defaultValue",
    "onChange",
    "autosize",
    "minRows",
    "maxRows",
    "resize",
    "label",
    "description",
    "error",
    "required",
    "disabled",
    "size",
    "placeholder",
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

  const effectiveMinRows = known.minRows ?? (known.autosize ? 2 : 3);
  const effectiveMaxRows = known.maxRows;

  // Legacy Mantine props are accepted for backward compatibility but never
  // forwarded to the DOM (native elements reject unknown attributes).
  const forwarded = stripLegacyInputProps(_rest);

  const wrapperStyle = explicitWidth ? { width: explicitWidth, ...known.style } : known.style ?? {};
  const inputStyle = {
    ...(explicitHeight ? { height: explicitHeight } : {}),
    ...(effectiveMaxRows ? { maxHeight: `${effectiveMaxRows * 1.4}rem` } : {}),
  };

  const wrapperTestId = known["data-testid"] ? `${known["data-testid"]}-field` : undefined;
  const inputTestId = known["data-testid"];

  const isControlled = known.value !== undefined || (known.onChange !== undefined && known.defaultValue === undefined);

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
      <textarea
        id={resolvedId}
        {...(isControlled ? { value: known.value } : { defaultValue: known.defaultValue })}
        onInput={(e) => known.onChange?.(e.currentTarget.value)}
        placeholder={known.placeholder}
        required={known.required}
        disabled={known.disabled}
        rows={effectiveMinRows}
        className={cn(
          "flex-1 min-w-0 block",
          sizeClass(known.size),
          resizeClass(known.resize, known.autosize),
          "bg-fin-surface border border-fin-border rounded-fin text-fin-text placeholder:text-fin-text-muted",
          "focus:outline-none focus:border-fin-primary focus:ring-2 focus:ring-fin-primary",
          known.disabled ? "disabled:bg-fin-surface-alt disabled:text-fin-text-muted disabled:border-fin-border disabled:cursor-not-allowed" : undefined,
          isError ? "border-fin-negative focus:border-fin-negative" : undefined,
        )}
        style={inputStyle}
        data-testid={inputTestId}
      />
      {helperText && (
        <span className={cn("text-xs", isError ? "text-fin-negative" : "text-fin-text-muted")}>{helperText}</span>
      )}
    </div>
  );
}
