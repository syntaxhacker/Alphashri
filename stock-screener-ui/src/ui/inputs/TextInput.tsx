import { createMemo, createSignal, createUniqueId } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import type { UITextInputProps } from "../types";

type FieldBox = { h: number; fs: number; padY: number; padX: number };

/**
 * Text-family geometry. Text/password/number deliberately share one look — they
 * are the same control; the distinguishing affordances live inside the field
 * (reveal eye, steppers) or in the element itself (textarea height/resize).
 */
const FIELD_BOX: Record<string, FieldBox> = {
  xs: { h: 26, fs: 11, padY: 4, padX: 8 },
  sm: { h: 32, fs: 13, padY: 8, padX: 10 },
};

function boxOf(size?: UITextInputProps["size"]): FieldBox {
  return FIELD_BOX[String(size)] ?? { h: 32, fs: 13, padY: 8, padX: 10 };
}

export function TextInput(props: UITextInputProps) {
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
    const border = isError() ? palette.NEGATIVE : focused() ? palette.PRIMARY : palette.BORDER;
    return {
      height: explicitHeight() ?? `${box.h}px`,
      "border-radius": "6px",
      border: `1px solid ${border}`,
      "box-shadow": focused() ? `0 0 0 1px ${border}` : "none",
      "background-color": props.disabled ? palette.SURFACE_ALT : palette.SURFACE,
      color: palette.TEXT,
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
