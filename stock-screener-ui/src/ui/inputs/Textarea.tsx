import { createMemo, createSignal, splitProps } from "solid-js";
import { cn } from "../cn";
import { createFieldA11y } from "./fieldError";
import type { UITextareaProps } from "../types";

/**
 * Row height for 13px text. Two rows plus 8px block padding and the 1px borders
 * land on 56px — comfortably taller than the 32px single-line field.
 */
const ROW_H = 19;

function lineHeightOf(size?: UITextareaProps["size"]): number {
  return size === "xs" ? 15 : ROW_H;
}

function fontOf(size?: UITextareaProps["size"]): string {
  return size === "xs" ? "11px" : "13px";
}

function resizeStyle(resize?: UITextareaProps["resize"], autosize?: boolean): string {
  // Only an explicit autosize field hides the handle — the default keeps it so
  // a textarea is always recognisable as a resizable multi-line control.
  if (resize) return resize;
  return autosize ? "none" : "vertical";
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

  const field = createFieldA11y({
    id: known.id,
    error: () => known.error,
    description: () => known.description,
    externalDescribedBy: () => (_rest as Record<string, unknown>)["aria-describedby"] as string | undefined,
  });
  const resolvedId = field.controlId;
  const [focused, setFocused] = createSignal(false);
  const explicitWidth = createMemo(() =>
    known.w != null ? (typeof known.w === "number" ? `${known.w}px` : known.w) : undefined,
  );
  const explicitHeight = createMemo(() =>
    known.h != null ? (typeof known.h === "number" ? `${known.h}px` : known.h) : undefined,
  );
  const isError = field.isError;
  const helperText = field.message;

  const effectiveMinRows = createMemo(() => known.minRows ?? 2);
  const effectiveMaxRows = createMemo(() => known.maxRows);

  const wrapperStyle = createMemo(() =>
    explicitWidth() ? { width: explicitWidth()!, ...known.style } : (known.style ?? {}),
  );

  /**
   * A textarea must read as a multi-line field at a glance: it is taller than a
   * one-line input by default (≈56px at two rows) and keeps a visible resize
   * handle, which single-line inputs never have.
   */
  const inputStyle = createMemo<Record<string, string>>(() => {
    const lineHeight = lineHeightOf(known.size);
    const border = isError() ? "var(--color-fin-negative)" : focused() ? "var(--color-fin-primary)" : "var(--color-fin-border)";
    const rows = effectiveMinRows();
    const natural = `${rows * lineHeight + 18}px`;
    const height = explicitHeight() ?? natural;
    return {
      height,
      "min-height": height,
      "border-radius": "6px",
      // Longhands, not the `border` shorthand: a `var()` inside the shorthand is
      // not parsed by every DOM implementation, which silently drops the width.
      "border-width": "1px",
      "border-style": "solid",
      "border-color": border,
      "box-shadow": focused() ? `0 0 0 1px ${border}` : "none",
      "background-color": known.disabled ? "var(--color-fin-surface-alt)" : "var(--color-fin-surface)",
      color: "var(--color-fin-text)",
      "font-size": fontOf(known.size),
      "line-height": `${lineHeight}px`,
      padding: "8px 10px",
      resize: resizeStyle(known.resize, known.autosize),
      "text-align": "left",
      "vertical-align": "top",
      ...(effectiveMaxRows() ? { "max-height": `${effectiveMaxRows()! * lineHeight + 18}px` } : {}),
      ...(known.disabled ? { opacity: "0.45", cursor: "not-allowed" } : {}),
    };
  });
  const wrapperTestId = known["data-testid"] ? `${known["data-testid"]}-field` : undefined;
  const inputTestId = known["data-testid"];

  const isControlled = createMemo(
    () => known.value !== undefined || (known.onChange !== undefined && known.defaultValue === undefined),
  );

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
      <textarea
        id={resolvedId}
        aria-invalid={isError()}
        aria-describedby={field.describedBy()}
        {...(isControlled() ? { value: String(known.value ?? "") } : {})}
        onInput={(e) => known.onChange?.(e.currentTarget.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={known.placeholder}
        required={known.required}
        disabled={known.disabled}
        rows={effectiveMinRows()}
        className={cn(
          "block w-full min-w-0 bg-transparent placeholder:text-fin-text-muted",
          known.disabled ? "cursor-not-allowed" : undefined,
        )}
        style={inputStyle()}
        data-testid={inputTestId}
      >
        {/* A <textarea> has no value/defaultValue attribute: its initial text is
            its own content, so the uncontrolled default has to be a child. */}
        {isControlled() ? undefined : known.defaultValue}
      </textarea>
      {helperText() && (
        <span id={field.messageId} className={cn("text-xs", isError() ? "text-fin-negative" : "text-fin-text-muted")}>
          {helperText()}
        </span>
      )}
    </div>
  );
}
