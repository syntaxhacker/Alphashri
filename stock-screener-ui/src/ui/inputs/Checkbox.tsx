import { createEffect, createMemo, createSignal, splitProps } from "solid-js";
import { cn } from "../cn";
import type { UICheckboxProps } from "../types";

const BOX_SIDE: Record<string, number> = { xs: 14, sm: 16, md: 16, lg: 18, xl: 18 };

function boxSide(size?: UICheckboxProps["size"]): number {
  return BOX_SIDE[String(size)] ?? 16;
}

/**
 * Theme tokens, not palette hexes: inline styles beat the light-theme override
 * in tailwind.css, so a hex here keeps the control dark in the light scheme.
 */
function toneColor(color?: UICheckboxProps["color"]): string {
  switch (color) {
    case "success":
      return "var(--color-fin-positive)";
    case "error":
    case "danger":
      return "var(--color-fin-negative)";
    case "warning":
      return "var(--color-fin-warning)";
    case "info":
      return "var(--color-fin-info)";
    case "secondary":
      return "var(--color-fin-text-muted)";
    default:
      return "var(--color-fin-primary)";
  }
}

export function Checkbox(props: UICheckboxProps) {
  const [known, _rest] = splitProps(props, [
    "label",
    "checked",
    "defaultChecked",
    "onChange",
    "disabled",
    "size",
    "color",
    "indeterminate",
    "error",
    "description",
    "className",
    "style",
    "id",
    "data-testid",
    "children",
    "onClick",
    "onMouseEnter",
    "onMouseLeave",
  ]);

  let inputEl: HTMLInputElement | undefined;
  const [uncontrolled, setUncontrolled] = createSignal(known.defaultChecked ?? false);
  const isControlled = createMemo(() => known.checked !== undefined);
  const isChecked = createMemo(() => (isControlled() ? known.checked === true : uncontrolled()));

  // `indeterminate` is a property, not an HTML attribute: sync it imperatively.
  createEffect(() => {
    if (inputEl) inputEl.indeterminate = !!known.indeterminate;
  });

  const [focused, setFocused] = createSignal(false);

  const handleChange = (e: Event & { currentTarget: HTMLInputElement }) => {
    const next = e.currentTarget.checked;
    if (!isControlled()) setUncontrolled(next);
    known.onChange?.(e as Event & { currentTarget: HTMLInputElement; target: Element });
  };

  const rootClass = createMemo(() =>
    cn("inline-flex items-center gap-2 text-sm leading-none", known.className),
  );

  /** The selected fill is the tone; unchecked stays a hairline square. */
  const boxStyle = createMemo<Record<string, string>>(() => {
    const side = boxSide(known.size);
    const tone = toneColor(known.color);
    const marked = isChecked() || !!known.indeterminate;
    const fill = marked
      ? tone
      : known.disabled
        ? "var(--color-fin-surface-alt)"
        : "var(--color-fin-surface)";
    return {
      width: `${side}px`,
      height: `${side}px`,
      "border-radius": "4px",
      // The frame follows the tone too: a green fill inside an amber frame read
      // as two different controls sharing a box. Longhands, not `border`: a
      // `var()` inside the shorthand is not parsed by every DOM implementation.
      "border-width": "1px",
      "border-style": "solid",
      "border-color": known.error
        ? "var(--color-fin-negative)"
        : focused() || marked
          ? tone
          : "var(--color-fin-border)",
      "box-shadow": focused() ? `0 0 0 1px ${tone}` : "none",
      "background-color": fill,
      color: "var(--color-fin-bg)",
      "font-size": `${side - 4}px`,
      "line-height": `${side - 2}px`,
      ...(known.disabled ? { opacity: "0.45", cursor: "not-allowed" } : {}),
    };
  });

  const boxClass = createMemo(() =>
    cn(
      "flex items-center justify-center shrink-0 select-none transition-colors",
      known.indeterminate && "border-fin-primary",
      known.disabled ? "cursor-not-allowed" : undefined,
    ),
  );

  const control = (
    <span className="relative inline-block shrink-0">
      <input
        ref={(el) => {
          inputEl = el;
        }}
        type="checkbox"
        role="checkbox"
        checked={isControlled() ? isChecked() : undefined}
        defaultChecked={isControlled() ? undefined : known.defaultChecked}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        disabled={known.disabled}
        id={known.id}
        data-testid={known["data-testid"]}
        // The global `:is(input, …):focus` rule paints an amber outline on every
        // mouse click; the box below is this control's own indicator, so the
        // native one must stay off in both focus modes.
        className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer appearance-none bg-transparent border-none outline-none focus-visible:outline-none disabled:cursor-not-allowed"
      />
      <span className={boxClass()} style={boxStyle()} data-part="checkbox-box">
        {known.indeterminate ? "—" : isChecked() ? "✔" : ""}
      </span>
    </span>
  );

  if (!known.label && !known.description) {
    return (
      <span
        className={cn("inline-flex items-center", known.className)}
        data-testid={known["data-testid"] ? `${known["data-testid"]}-wrapper` : undefined}
        style={known.style}
      >
        {control}
      </span>
    );
  }

  return (
    <label className={rootClass()} style={known.style} data-testid={known["data-testid"] ? `${known["data-testid"]}-group` : undefined}>
      {control}
      <span className="leading-none">
        {known.label ? <span className="text-fin-text">{known.label}</span> : null}
        {known.description ? <span className="text-xs text-fin-text-muted">{known.description}</span> : null}
      </span>
    </label>
  );
}
