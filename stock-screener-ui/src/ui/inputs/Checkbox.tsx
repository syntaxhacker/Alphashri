import { createEffect, createMemo, splitProps } from "solid-js";
import { cn } from "../cn";
import type { UICheckboxProps } from "../types";

function boxSizeClasses(size?: UICheckboxProps["size"]): string {
  return size === "xs" || size === "sm" ? "h-4 w-4" : "h-5 w-5";
}

function toneClass(color?: UICheckboxProps["color"]): string {
  switch (color) {
    case "error":
    case "danger":
      return "border-fin-negative peer-checked:bg-fin-negative";
    case "warning":
      return "border-fin-warning peer-checked:bg-fin-warning";
    case "info":
    case "primary":
      return "border-fin-primary peer-checked:bg-fin-primary";
    case "secondary":
      return "border-fin-text-muted peer-checked:bg-fin-text-muted";
    default:
      return "border-fin-border peer-checked:bg-fin-positive";
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

  // `indeterminate` is a property, not an HTML attribute: sync it imperatively.
  createEffect(() => {
    if (inputEl) inputEl.indeterminate = !!known.indeterminate;
  });

  const rootClass = createMemo(() =>
    cn("inline-flex items-center gap-2 text-sm leading-none", known.disabled && "opacity-50", known.className),
  );
  const boxClass = createMemo(() =>
    cn(
      "flex items-center justify-center shrink-0 rounded-fin border border-fin-border bg-fin-surface text-fin-bg transition-colors",
      boxSizeClasses(known.size),
      toneClass(known.color),
      known.indeterminate && "border-fin-primary",
      known.disabled && "opacity-50 cursor-not-allowed",
    ),
  );

  const control = (
    <span className="relative inline-block shrink-0">
      <input
        ref={(el) => (inputEl = el)}
        type="checkbox"
        role="checkbox"
        checked={known.checked}
        defaultChecked={known.defaultChecked}
        onChange={(e) => known.onChange?.(e)}
        disabled={known.disabled}
        id={known.id}
        data-testid={known["data-testid"]}
        className="peer absolute inset-0 w-full h-full cursor-pointer appearance-none bg-transparent border-none z-10"
      />
      <span className={boxClass()}>
        {known.indeterminate ? "—" : known.checked ? "✔" : ""}
      </span>
    </span>
  );

  if (!known.label && !known.description) {
    return (
      <span className={cn("inline-flex items-center", known.className)} data-testid={known["data-testid"] ? `${known["data-testid"]}-wrapper` : undefined} style={known.style}>
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
