import { createSignal, createMemo, splitProps } from "solid-js";
import { cn } from "../cn";
import type { UIChipProps, UIColor } from "../types";

function chipSizeClasses(size?: UIChipProps["size"]): string {
  return size === "xs" || size === "sm" ? "text-xs px-2 py-1" : "text-sm px-3 py-1.5";
}

function toneClasses(color?: UIColor): { checked: string; border: string } {
  switch (color) {
    case "success":
      return { checked: "bg-fin-positive text-fin-bg", border: "border-fin-positive text-fin-positive" };
    case "error":
    case "danger":
      return { checked: "bg-fin-negative text-fin-bg", border: "border-fin-negative text-fin-negative" };
    case "warning":
      return { checked: "bg-fin-warning text-fin-bg", border: "border-fin-warning text-fin-warning" };
    case "info":
    case "primary":
      return { checked: "bg-fin-primary text-fin-bg", border: "border-fin-primary text-fin-primary" };
    case "secondary":
      return { checked: "bg-fin-text-muted text-fin-bg", border: "border-fin-text-muted text-fin-text-muted" };
    default:
      return { checked: "bg-fin-surface-alt text-fin-text", border: "border-fin-border text-fin-text-muted" };
  }
}

export function Chip(props: UIChipProps) {
  const [known, _rest] = splitProps(props, [
    "checked",
    "defaultChecked",
    "onChange",
    "disabled",
    "size",
    "color",
    "variant",
    "label",
    "value",
    "children",
    "className",
    "style",
    "id",
    "data-testid",
    "onClick",
  ]);

  const isControlled = createMemo(() => known.checked !== undefined);
  const [internalChecked, setInternalChecked] = createSignal<boolean>(known.defaultChecked ?? false);
  const isChecked = createMemo(() => (isControlled() ? known.checked === true : internalChecked()));
  const tone = createMemo(() => toneClasses(known.color));
  const isOutline = createMemo(() => known.variant === "outline");

  const handleClick = (e: MouseEvent) => {
    if (known.disabled) return;
    known.onClick?.(e);
    const next = !isChecked();
    if (!isControlled()) setInternalChecked(next);
    known.onChange?.(next);
  };

  const base = createMemo(() =>
    cn(
      "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-fin border border-transparent transition-colors",
      chipSizeClasses(known.size),
      known.disabled ? "opacity-50 cursor-default" : "cursor-pointer",
      known.className,
    ),
  );

  const variantClass = createMemo(() => {
    if (isOutline()) return isChecked() ? tone().border : cn("border-fin-border bg-transparent text-fin-text-muted hover:bg-fin-surface-alt");
    return isChecked() ? tone().checked : cn("border-fin-border bg-transparent text-fin-text-muted hover:bg-fin-surface-alt");
  });

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isChecked()}
      disabled={known.disabled}
      id={known.id}
      data-testid={known["data-testid"]}
      className={cn(base(), variantClass())}
      style={known.style}
      onClick={handleClick}
    >
      {known.children ?? known.label}
    </button>
  );
}
