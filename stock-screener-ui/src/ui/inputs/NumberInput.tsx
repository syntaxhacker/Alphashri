import { createMemo, createSignal, createUniqueId, splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
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

type FieldBox = { h: number; fs: number; padY: number; padX: number };

/** Shared with TextInput/PasswordInput: one look for the whole text family. */
const FIELD_BOX: Record<string, FieldBox> = {
  xs: { h: 26, fs: 11, padY: 4, padX: 8 },
  sm: { h: 32, fs: 13, padY: 8, padX: 10 },
};

function boxOf(size?: string | number | undefined): FieldBox {
  return FIELD_BOX[String(size)] ?? { h: 32, fs: 13, padY: 8, padX: 10 };
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

  const inputStyle = createMemo<Record<string, string>>(() => {
    const box = boxOf(known.size);
    const border = isError() ? palette.NEGATIVE : focused() ? palette.PRIMARY : palette.BORDER;
    return {
      height: explicitHeight() ?? `${box.h}px`,
      "border-radius": "6px",
      border: `1px solid ${border}`,
      "box-shadow": focused() ? `0 0 0 1px ${border}` : "none",
      "background-color": known.disabled ? palette.SURFACE_ALT : palette.SURFACE,
      color: palette.TEXT,
      "font-size": `${box.fs}px`,
      "line-height": "1",
      padding: `${box.padY}px ${box.padX}px`,
      "padding-right": showSteppers() ? `${box.padX + 16}px` : `${box.padX}px`,
      "outline": "none",
      ...(known.disabled ? { opacity: "0.45", cursor: "not-allowed" } : {}),
    };
  });

  const stepBy = (direction: 1 | -1) => {
    if (known.disabled) return;
    const raw = Number(known.value ?? known.defaultValue ?? 0);
    const base = Number.isFinite(raw) ? raw : 0;
    const increment = typeof known.step === "number" && known.step !== 0 ? known.step : 1;
    let next = base + increment * direction;
    if (typeof known.min === "number" && next < known.min) next = known.min;
    if (typeof known.max === "number" && next > known.max) next = known.max;
    known.onChange?.(next);
  };

  const stepperStyle = createMemo<Record<string, string>>(() => {
    const box = boxOf(known.size);
    return {
      width: "16px",
      height: `${Math.max(9, (box.h - 6) / 2 - 1)}px`,
      "border-radius": "3px",
      border: `1px solid ${known.disabled ? palette.SURFACE_ALT : palette.BORDER}`,
      "background-color": known.disabled ? palette.SURFACE_ALT : palette.BG,
      color: palette.TEXT_MUTED,
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
            onInput={(e) => known.onChange?.(coerceNumberInput(e.currentTarget.value))}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
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
        >
          {helperText()}
        </span>
      )}
    </div>
  );
}
