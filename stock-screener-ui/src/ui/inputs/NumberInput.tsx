import { createMemo, createUniqueId, splitProps } from "solid-js";
import { cn } from "../cn";
import { stripLegacyInputProps } from "./legacyProps";

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

function sizeClass(size?: string | number | undefined): string {
  return size === "xs" || size === "sm" ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm";
}

export function NumberInput(props: any) {
  const [known, _rest] = splitProps(props, [
    "value",
    "defaultValue",
    "onChange",
    "min",
    "max",
    "step",
    "decimalScale",
    "clampBehavior",
    "allowDecimal",
    "allowNegative",
    "hideControls",
    "suffix",
    "prefix",
    "leftSection",
    "rightSection",
    "label",
    "description",
    "error",
    "errorProps",
    "required",
    "disabled",
    "size",
    "placeholder",
    "className",
    "style",
    "data-testid",
    "w",
    "h",
    "variant",
    "styles",
    "loading",
    "id",
    "name",
  ]);

  const resolvedId = known.id ?? createUniqueId();
  const explicitWidth = createMemo(() =>
    known.w != null ? (typeof known.w === "number" ? `${known.w}px` : known.w) : undefined,
  );
  const explicitHeight = createMemo(() =>
    known.h != null ? (typeof known.h === "number" ? `${known.h}px` : known.h) : undefined,
  );
  const isError = createMemo(() => Boolean(known.error));
  const helperText = createMemo(() =>
    isError()
      ? typeof known.error === "string"
        ? known.error
        : String(known.error ?? "")
      : (known.description as string | undefined),
  );

  const isControlledInput = createMemo(
    () => known.value !== undefined || (known.onChange !== undefined && known.defaultValue === undefined),
  );

  // Legacy Mantine props are accepted for backward compatibility but never
  // forwarded to the DOM (native elements reject unknown attributes).
  const forwarded = stripLegacyInputProps(_rest);

  const wrapperStyle = createMemo(() =>
    explicitWidth() ? { width: explicitWidth()!, ...known.style } : (known.style ?? {}),
  );
  const inputStyle = createMemo(() => (explicitHeight() ? { height: explicitHeight()! } : {}));

  const wrapperTestId = known["data-testid"];
  const inputTestId = known["data-testid"] ? `${known["data-testid"]}-input` : undefined;

  return (
    <div
      data-testid={wrapperTestId}
      className={cn("flex flex-col min-w-0 gap-1.5", explicitWidth() == null ? "w-full" : undefined, known.className)}
      style={wrapperStyle()}
    >
      {known.label && (
        <label htmlFor={resolvedId} className={cn("text-xs font-medium", isError() ? "text-fin-negative" : "text-fin-text")}>
          {known.label}
          {known.required && <span className="ml-1 text-fin-negative">*</span>}
        </label>
      )}
      <div className="flex items-center gap-2 w-full min-w-0">
        {known.leftSection && <div className="shrink-0">{known.leftSection}</div>}
        {known.prefix && <span className="shrink-0 text-fin-text-muted">{known.prefix}</span>}
        <input
          id={resolvedId}
          type="number"
          value={(isControlledInput() ? known.value : known.defaultValue) ?? ""}
          onInput={(e) => known.onChange?.(coerceNumberInput(e.currentTarget.value))}
          placeholder={known.placeholder}
          name={known.name}
          min={known.min}
          max={known.max}
          step={known.step}
          required={known.required}
          disabled={known.disabled}
          className={cn(
            "flex-1 min-w-0 block",
            sizeClass(known.size),
            "bg-fin-surface border border-fin-border rounded-fin text-fin-text placeholder:text-fin-text-muted",
            "focus:outline-none focus:border-fin-primary focus:ring-2 focus:ring-fin-primary",
            known.disabled ? "disabled:bg-fin-surface-alt disabled:text-fin-text-muted disabled:border-fin-border disabled:cursor-not-allowed" : undefined,
            isError() ? "border-fin-negative focus:border-fin-negative" : undefined,
          )}
          style={inputStyle()}
          data-testid={inputTestId}
          {...(forwarded as Record<string, unknown>)}
        />
        {known.rightSection && <div className="shrink-0">{known.rightSection}</div>}
        {known.suffix && <span className="shrink-0 text-fin-text-muted">{known.suffix}</span>}
      </div>
      {helperText() && (
        <span
          className={cn("text-xs", isError() ? "text-fin-negative" : "text-fin-text-muted")}
          {...(isError() ? (known.errorProps as Record<string, unknown> | undefined) : undefined)}
        >
          {helperText()}
        </span>
      )}
    </div>
  );
}
