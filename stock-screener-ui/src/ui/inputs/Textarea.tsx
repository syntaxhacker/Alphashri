import { createMemo, createSignal, createUniqueId, splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
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

  const resolvedId = known.id ?? createUniqueId();
  const [focused, setFocused] = createSignal(false);
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
    const border = isError() ? palette.NEGATIVE : focused() ? palette.PRIMARY : palette.BORDER;
    const rows = effectiveMinRows();
    const natural = `${rows * lineHeight + 18}px`;
    const height = explicitHeight() ?? natural;
    return {
      height,
      "min-height": height,
      "border-radius": "6px",
      border: `1px solid ${border}`,
      "box-shadow": focused() ? `0 0 0 1px ${border}` : "none",
      "background-color": known.disabled ? palette.SURFACE_ALT : palette.SURFACE,
      color: palette.TEXT,
      "font-size": fontOf(known.size),
      "line-height": `${lineHeight}px`,
      padding: "8px 10px",
      "outline": "none",
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
        {...(isControlled() ? { value: known.value } : { defaultValue: known.defaultValue })}
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
      />
      {helperText() && (
        <span className={cn("text-xs", isError() ? "text-fin-negative" : "text-fin-text-muted")}>{helperText()}</span>
      )}
    </div>
  );
}
