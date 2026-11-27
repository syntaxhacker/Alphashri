import { createMemo, createSignal, splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import { typeSize, type TypeRole } from "../typography";
import { stripLegacyInputProps } from "./legacyProps";
import { createFieldA11y } from "./fieldError";
import type { UIPasswordInputProps } from "../types";

type FieldBox = { h: number; fontRole: TypeRole; padY: number; padX: number };

/**
 * Shared with TextInput/NumberInput: one look for the whole text family.
 * `md` is the default step so a password field matches a Select in the same row.
 */
const FIELD_BOX: Record<string, FieldBox> = {
  xs: { h: 24, fontRole: "micro", padY: 4, padX: 8 },
  sm: { h: 30, fontRole: "body", padY: 7, padX: 10 },
  md: { h: 34, fontRole: "body", padY: 9, padX: 10 },
  lg: { h: 38, fontRole: "label", padY: 11, padX: 12 },
  xl: { h: 42, fontRole: "title", padY: 13, padX: 12 },
};

function boxOf(size?: UIPasswordInputProps["size"]): FieldBox {
  return FIELD_BOX[String(size)] ?? FIELD_BOX.md;
}

const Eye = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={2} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOff = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={2} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
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

  const [internalVisible, setInternalVisible] = createSignal(false);
  const isControlled = createMemo(() => known.visible !== undefined);
  const visible = createMemo(() => (isControlled() ? known.visible === true : internalVisible()));

  const handleToggle = () => {
    const next = !visible();
    if (!isControlled()) setInternalVisible(next);
    known.onVisibilityChange?.(next);
  };

  // Legacy Mantine props are accepted for backward compatibility but never
  // forwarded to the DOM (native elements reject unknown attributes).
  const forwarded = stripLegacyInputProps(_rest);

  const wrapperStyle = createMemo(() =>
    explicitWidth() ? { width: explicitWidth()!, ...known.style } : (known.style ?? {}),
  );

  /**
   * The value is monospace so a masked field never reads as prose. Without that
   * and the reveal eye, a password box is indistinguishable from a search box —
   * the user cannot tell whether their keystrokes are hidden.
   */
  const inputStyle = createMemo<Record<string, string>>(() => {
    const box = boxOf(known.size);
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
      "background-color": known.disabled ? "var(--color-fin-surface-alt)" : "var(--color-fin-surface)",
      color: "var(--color-fin-text)",
      "font-size": `${typeSize(box.fontRole)}px`,
      "font-family": palette.MONO,
      "letter-spacing": visible() ? "normal" : "0.12em",
      "line-height": "1",
      padding: `${box.padY}px ${box.padX + 20}px ${box.padY}px ${box.padX}px`,
      ...(known.disabled ? { opacity: "0.45", cursor: "not-allowed" } : {}),
    };
  });

  const toggleStyle = createMemo<Record<string, string>>(() => {
    const box = boxOf(known.size);
    return {
      width: `${box.h - 8}px`,
      height: `${box.h - 8}px`,
      "border-radius": "4px",
      border: "none",
      "background-color": "transparent",
      color: visible() ? "var(--color-fin-primary)" : "var(--color-fin-text-muted)",
      right: "4px",
      top: "50%",
      transform: "translateY(-50%)",
      ...(known.disabled ? { opacity: "0.45", cursor: "not-allowed" } : {}),
    };
  });

  const wrapperTestId = known["data-testid"] ? `${known["data-testid"]}-field` : undefined;
  const inputTestId = known["data-testid"];

  const isControlledInput = createMemo(
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
      <div className="flex items-center gap-2 w-full min-w-0">
        {known.leftSection && <div className="shrink-0">{known.leftSection}</div>}
        <div className="relative flex-1 min-w-0">
          <input
            id={resolvedId}
            aria-invalid={isError()}
            aria-describedby={field.describedBy()}
            type={visible() ? "text" : "password"}
            value={(isControlledInput() ? known.value : known.defaultValue) ?? ""}
            onInput={(e) => known.onChange?.(e.currentTarget.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={known.placeholder}
            required={known.required}
            disabled={known.disabled}
            className={cn(
              "block w-full min-w-0 bg-transparent placeholder:text-fin-text-muted",
              known.disabled ? "cursor-not-allowed" : undefined,
            )}
            style={inputStyle()}
            data-testid={inputTestId}
            {...(forwarded as Record<string, unknown>)}
          />
          <button
            type="button"
            aria-label={known.visibilityToggleButtonLabel ?? "Toggle password visibility"}
            data-part="password-toggle"
            onClick={handleToggle}
            disabled={known.disabled}
            className={cn(
              "absolute flex items-center justify-center p-0",
              known.disabled ? "cursor-not-allowed" : "cursor-pointer",
            )}
            style={toggleStyle()}
          >
            {visible() ? <EyeOff /> : <Eye />}
          </button>
        </div>
        {known.rightSection && <div className="shrink-0">{known.rightSection}</div>}
      </div>
      {helperText() && (
        <span id={field.messageId} className={cn("text-xs", isError() ? "text-fin-negative" : "text-fin-text-muted")}>
          {helperText()}
        </span>
      )}
    </div>
  );
}
