import { createMemo, createSignal, createUniqueId, splitProps } from "solid-js";
import { cn } from "../cn";
import { stripLegacyInputProps } from "./legacyProps";
import type { UITextInputProps } from "../types";

type FieldBox = { h: number; fs: number; padY: number; padX: number };

/**
 * Text-family geometry. Text/password/number deliberately share one look — they
 * are the same control; the distinguishing affordances live inside the field
 * (reveal eye, steppers) or in the element itself (textarea height/resize).
 * `md` is the default step: a text field and a Select have to be the same
 * height when they sit in one row.
 */
const FIELD_BOX: Record<string, FieldBox> = {
  xs: { h: 24, fs: 11, padY: 4, padX: 8 },
  sm: { h: 30, fs: 13, padY: 7, padX: 10 },
  md: { h: 34, fs: 13, padY: 9, padX: 10 },
  lg: { h: 38, fs: 14, padY: 11, padX: 12 },
  xl: { h: 42, fs: 15, padY: 13, padX: 12 },
};

function boxOf(size?: UITextInputProps["size"]): FieldBox {
  return FIELD_BOX[String(size)] ?? FIELD_BOX.md;
}

export function TextInput(props: UITextInputProps) {
  // Every prop the component renders itself is claimed here; whatever is left
  // (`aria-label`, `aria-describedby`, `role`, `autocomplete`, …) is a native
  // input attribute the caller meant for the field, so it must reach the DOM.
  const [, _rest] = splitProps(props, [
    "value",
    "defaultValue",
    "onChange",
    "onKeyDown",
    "onFocus",
    "onBlur",
    "leftSection",
    "rightSection",
    "type",
    "label",
    "description",
    "error",
    "required",
    "disabled",
    "readOnly",
    "size",
    "placeholder",
    "name",
    "w",
    "h",
    "className",
    "style",
    "id",
    "data-testid",
  ] as Array<keyof UITextInputProps>);
  const forwarded = stripLegacyInputProps(_rest);
  const resolvedId = props.id ?? createUniqueId();
  const [focused, setFocused] = createSignal(false);
  const explicitWidth = createMemo(() =>
    props.w != null ? (typeof props.w === "number" ? `${props.w}px` : props.w) : undefined,
  );
  const explicitHeight = createMemo(() =>
    props.h != null ? (typeof props.h === "number" ? `${props.h}px` : props.h) : undefined,
  );
  const isError = createMemo(() => Boolean(props.error));
  const helperText = createMemo(() =>
    isError()
      ? typeof props.error === "string"
        ? props.error
        : String(props.error ?? "")
      : (props.description as string | undefined),
  );

  const wrapperStyle = createMemo(() =>
    explicitWidth() ? { width: explicitWidth()!, ...props.style } : (props.style ?? {}),
  );

  const inputStyle = createMemo<Record<string, string>>(() => {
    const box = boxOf(props.size);
    const border = isError()
      ? "var(--color-fin-negative)"
      : focused()
        ? "var(--color-fin-primary)"
        : "var(--color-fin-border)";
    return {
      height: explicitHeight() ?? `${box.h}px`,
      "border-radius": "6px",
      // Longhands, not the `border` shorthand: a `var()` inside the shorthand is
      // not parsed by every DOM implementation, which silently drops the width.
      "border-width": "1px",
      "border-style": "solid",
      "border-color": border,
      "box-shadow": focused() ? `0 0 0 1px ${border}` : "none",
      "background-color": props.disabled ? "var(--color-fin-surface-alt)" : "var(--color-fin-surface)",
      color: "var(--color-fin-text)",
      "font-size": `${box.fs}px`,
      "line-height": "1",
      padding: `${box.padY}px ${box.padX}px`,
      "outline": "none",
      ...(props.disabled ? { opacity: "0.45", cursor: "not-allowed" } : {}),
    };
  });

  const wrapperTestId = props["data-testid"] ? `${props["data-testid"]}-field` : undefined;
  const inputTestId = props["data-testid"];

  const isControlled = createMemo(
    () => props.value !== undefined || (props.onChange !== undefined && props.defaultValue === undefined),
  );

  return (
    <div
      data-testid={wrapperTestId}
      className={cn("flex flex-col min-w-0 gap-1.5", explicitWidth() == null ? "w-full" : undefined, props.className)}
      style={wrapperStyle()}
    >
      {props.label && (
        <label htmlFor={resolvedId} className={cn("text-xs font-medium", isError() ? "text-fin-negative" : "text-fin-text")}>
          {props.label}
          {props.required && <span className="ml-1 text-fin-negative">*</span>}
        </label>
      )}
      <div className="flex items-center gap-2 w-full min-w-0">
        {props.leftSection && <div className="shrink-0">{props.leftSection}</div>}
        <input
          {...(forwarded as Record<string, unknown>)}
          id={resolvedId}
          type={props.type ?? "text"}
          value={(isControlled() ? props.value : props.defaultValue) ?? ""}
          onInput={(e) => props.onChange?.(e.currentTarget.value)}
          onKeyDown={(e) => props.onKeyDown?.(e)}
          onFocus={(e) => {
            setFocused(true);
            props.onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            props.onBlur?.(e);
          }}
          placeholder={props.placeholder}
          name={props.name}
          required={props.required}
          disabled={props.disabled}
          readOnly={props.readOnly}
          className={cn(
            "flex-1 min-w-0 block bg-transparent placeholder:text-fin-text-muted",
            props.disabled ? "cursor-not-allowed" : undefined,
          )}
          style={inputStyle()}
          data-testid={inputTestId}
        />
        {props.rightSection && <div className="shrink-0">{props.rightSection}</div>}
      </div>
      {helperText() && (
        <span className={cn("text-xs", isError() ? "text-fin-negative" : "text-fin-text-muted")}>{helperText()}</span>
      )}
    </div>
  );
}
