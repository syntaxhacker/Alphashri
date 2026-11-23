import { createMemo, createSignal, splitProps } from "solid-js";
import { cn } from "../cn";
import { stripLegacyInputProps } from "./legacyProps";
import { createFieldA11y } from "./fieldError";
import type { UINumberInputProps } from "../types";

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

type FieldBox = { h: number; fs: number; padY: number; padX: number };

/**
 * Shared with TextInput/PasswordInput: one look for the whole text family.
 * `md` is the default step so a number field matches a Select in the same row.
 */
const FIELD_BOX: Record<string, FieldBox> = {
  xs: { h: 24, fs: 11, padY: 4, padX: 8 },
  sm: { h: 30, fs: 13, padY: 7, padX: 10 },
  md: { h: 34, fs: 13, padY: 9, padX: 10 },
  lg: { h: 38, fs: 14, padY: 11, padX: 12 },
  xl: { h: 42, fs: 15, padY: 13, padX: 12 },
};

function boxOf(size?: string | number | undefined): FieldBox {
  return FIELD_BOX[String(size)] ?? FIELD_BOX.md;
}

/** Repeating decimals (0.1 + 0.2) must not reach a money field as 0.30000000000000004. */
function roundTo(value: number, scale?: number): number {
  if (typeof scale !== "number" || !Number.isFinite(scale) || scale < 0) return value;
  const factor = 10 ** Math.floor(scale);
  return Math.round(value * factor) / factor;
}

function clampToRange(value: number, min?: number, max?: number): number {
  let next = value;
  if (typeof min === "number" && next < min) next = min;
  if (typeof max === "number" && next > max) next = max;
  return next;
}

/**
 * `allowNegative`/`allowDecimal` are promises about what the field accepts, so
 * a keystroke has to lose the characters they forbid before it is emitted.
 * Dropping the dot instead of truncating at it is what ignoring the "." key
 * would have produced anyway.
 */
function normalizeNumberText(raw: string, allowDecimal: boolean, allowNegative: boolean): string {
  let text = allowNegative ? raw : raw.replace(/^-/, "");
  if (!allowDecimal) text = text.replace(/\./g, "");
  return text;
}

export function NumberInput(props: UINumberInputProps) {
  const [known, _rest] = splitProps(props as UINumberInputProps & Record<string, unknown>, [
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
    "onBlur",
    "onFocus",
    "onKeyDown",
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

  const isControlledInput = createMemo(
    () => known.value !== undefined || (known.onChange !== undefined && known.defaultValue === undefined),
  );

  // Legacy Mantine props are accepted for backward compatibility but never
  // forwarded to the DOM (native elements reject unknown attributes).
  const forwarded = stripLegacyInputProps(_rest);

  const wrapperStyle = createMemo(() =>
    explicitWidth() ? { width: explicitWidth()!, ...known.style } : (known.style ?? {}),
  );

  /** A number field with no numeric cue is a text field. The steppers are it. */
  const showSteppers = createMemo(() => !known.hideControls);

  const allowDecimal = () => known.allowDecimal !== false;
  const allowNegative = () => known.allowNegative !== false;

  /**
   * Commit-time normalisation for blur: strip the forbidden characters, round
   * to `decimalScale`, then clamp unless `clampBehavior` is "none". The cleaned
   * value is written back to the element so an uncontrolled field never shows a
   * number the state did not receive. Returns undefined when nothing moved.
   */
  const commitField = (el: HTMLInputElement): number | string | undefined => {
    const raw = el.value;
    const text = normalizeNumberText(raw, allowDecimal(), allowNegative());
    let value: number | string = coerceNumberInput(text);
    if (typeof value === "number") {
      value = roundTo(value, known.decimalScale);
      if (known.clampBehavior !== "none") value = clampToRange(value, known.min, known.max);
    }
    const shown = typeof value === "number" ? String(value) : text;
    if (shown !== raw) el.value = shown;
    return shown === raw ? undefined : value;
  };

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
      "font-size": `${box.fs}px`,
      "line-height": "1",
      padding: `${box.padY}px ${box.padX}px`,
      "padding-right": showSteppers() ? `${box.padX + 16}px` : `${box.padX}px`,
      ...(known.disabled ? { opacity: "0.45", cursor: "not-allowed" } : {}),
    };
  });

  const stepBy = (direction: 1 | -1) => {
    if (known.disabled) return;
    const raw = Number(known.value ?? known.defaultValue ?? 0);
    const base = Number.isFinite(raw) ? raw : 0;
    const increment = typeof known.step === "number" && known.step !== 0 ? known.step : 1;
    // Steppers obey min/max even when typing does not: a click is a deliberate
    // single step, not an in-progress keystroke.
    const next = clampToRange(
      roundTo(base + increment * direction, known.decimalScale),
      known.min,
      known.max,
    );
    known.onChange?.(next);
  };

  const stepperStyle = createMemo<Record<string, string>>(() => {
    const box = boxOf(known.size);
    return {
      width: "16px",
      height: `${Math.max(9, (box.h - 6) / 2 - 1)}px`,
      "border-radius": "3px",
      "border-width": "1px",
      "border-style": "solid",
      "border-color": known.disabled ? "var(--color-fin-surface-alt)" : "var(--color-fin-border)",
      "background-color": known.disabled ? "var(--color-fin-surface-alt)" : "var(--color-fin-bg)",
      color: "var(--color-fin-text-muted)",
      "font-size": "11px",
      "line-height": "1",
      padding: "0px",
      ...(known.disabled ? { opacity: "0.45", cursor: "not-allowed" } : { cursor: "pointer" }),
    };
  });

  const wrapperTestId = known["data-testid"];
  const inputTestId = known["data-testid"] ? `${known["data-testid"]}-input` : undefined;
  const stepperTestId = known["data-testid"] ? `${known["data-testid"]}-steppers` : undefined;

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
        <div className="relative flex-1 min-w-0">
          <input
            id={resolvedId}
            type="number"
            value={(isControlledInput() ? known.value : known.defaultValue) ?? ""}
            onInput={(e) => {
              const el = e.currentTarget;
              const text = normalizeNumberText(el.value, allowDecimal(), allowNegative());
              if (text !== el.value) el.value = text;
              const coerced = coerceNumberInput(text);
              // "strict" clamps mid-keystroke; "blur" waits for the commit, so
              // typing "5" on the way to "50" is not yanked up to a 10 floor.
              known.onChange?.(
                typeof coerced === "number" && known.clampBehavior === "strict"
                  ? clampToRange(coerced, known.min, known.max)
                  : coerced,
              );
            }}
            onFocus={(e) => {
              setFocused(true);
              known.onFocus?.(e);
            }}
            onBlur={(e) => {
              const el = e.currentTarget;
              setFocused(false);
              const committed = commitField(el);
              if (committed !== undefined) known.onChange?.(committed);
              known.onBlur?.(e);
            }}
            onKeyDown={(e) => known.onKeyDown?.(e)}
            placeholder={known.placeholder}
            name={known.name}
            min={known.min}
            max={known.max}
            step={known.step}
            required={known.required}
            disabled={known.disabled}
            className={cn(
              // The custom steppers are the affordance; Chrome's native spin
              // buttons would be a second, differently-shaped one.
              "block w-full min-w-0 bg-transparent placeholder:text-fin-text-muted",
              "[-moz-appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
              known.disabled ? "cursor-not-allowed" : undefined,
            )}
            style={inputStyle()}
            data-testid={inputTestId}
            {...(forwarded as Record<string, unknown>)}
            aria-invalid={isError()}
            aria-describedby={field.describedBy()}
          />
          {showSteppers() && (
            <div
              className="absolute flex flex-col gap-[2px]"
              data-testid={stepperTestId}
              data-part="number-steppers"
              style={{ "right": "2px", "top": "50%", "transform": "translateY(-50%)" }}
            >
              <button
                type="button"
                tabindex={-1}
                aria-label="Increment value"
                data-part="number-stepper-up"
                disabled={known.disabled}
                onClick={() => stepBy(1)}
                className="flex items-center justify-center"
                style={stepperStyle()}
              >
                +
              </button>
              <button
                type="button"
                tabindex={-1}
                aria-label="Decrement value"
                data-part="number-stepper-down"
                disabled={known.disabled}
                onClick={() => stepBy(-1)}
                className="flex items-center justify-center"
                style={stepperStyle()}
              >
                −
              </button>
            </div>
          )}
        </div>
        {known.rightSection && <div className="shrink-0">{known.rightSection}</div>}
        {known.suffix && <span className="shrink-0 text-fin-text-muted">{known.suffix}</span>}
      </div>
      {helperText() && (
        <span
          className={cn("text-xs", isError() ? "text-fin-negative" : "text-fin-text-muted")}
          {...(isError() ? (known.errorProps as Record<string, unknown> | undefined) : undefined)}
          id={field.messageId}
        >
          {helperText()}
        </span>
      )}
    </div>
  );
}
