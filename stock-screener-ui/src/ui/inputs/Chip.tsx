import { createMemo, createSignal, Show, splitProps } from "solid-js";
import { cn } from "../cn";
import type { UIChipProps, UIColor } from "../types";

/**
 * Chip = an interactive filter. Shape language: 20px tall, 4px radius (a
 * rounded rectangle, never a capsule), 11px label, 1px hairline that goes
 * PRIMARY + 12% PRIMARY wash when checked. Reserving the capsule for nothing
 * keeps the three "small pill" primitives read apart at a glance: a Chip is
 * taller than a Badge (20 vs 16) and shorter than a SegmentedControl item (24).
 */
type ChipBox = { h: number; font: number; px: number };

// Every size keeps the 20px floor: a filter chip that shrinks below a Badge
// (16px) stops being distinguishable from a status label. Dense tables that
// genuinely need 16px pin it explicitly at the call site via `className`/`style`.
const CHIP_BOX: Record<string, ChipBox> = {
  xs: { h: 20, font: 10, px: 6 },
  sm: { h: 20, font: 10, px: 6 },
  md: { h: 20, font: 11, px: 8 },
  lg: { h: 22, font: 11, px: 8 },
  xl: { h: 24, font: 12, px: 10 },
};

function chipBox(size?: UIChipProps["size"]): ChipBox {
  return CHIP_BOX[String(size)] ?? CHIP_BOX.md;
}

/** Checked tone: hairline tone border + 12% tint. `outline` keeps the body clear. */
function checkedClasses(color?: UIColor): { border: string; tint: string; text: string } {
  switch (color) {
    case "success":
      return { border: "border-fin-positive", tint: "bg-fin-positive/12", text: "text-fin-positive" };
    case "error":
    case "danger":
      return { border: "border-fin-negative", tint: "bg-fin-negative/12", text: "text-fin-negative" };
    case "warning":
      return { border: "border-fin-warning", tint: "bg-fin-warning/12", text: "text-fin-warning" };
    case "info":
      return { border: "border-fin-info", tint: "bg-fin-info/12", text: "text-fin-info" };
    case "secondary":
      return { border: "border-fin-text-muted", tint: "bg-fin-surface-alt", text: "text-fin-text" };
    default:
      return { border: "border-fin-primary", tint: "bg-fin-primary/12", text: "text-fin-primary" };
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
  const isOutline = createMemo(() => known.variant === "outline");

  const handleClick = (e: MouseEvent) => {
    if (known.disabled) return;
    known.onClick?.(e);
    const next = !isChecked();
    if (!isControlled()) setInternalChecked(next);
    known.onChange?.(next);
  };

  const shape = createMemo<Record<string, string>>(() => {
    const box = chipBox(known.size);
    return {
      height: `${box.h}px`,
      "border-radius": "4px",
      "border-width": "1px",
      "border-style": "solid",
      "font-size": `${box.font}px`,
      "font-weight": "600",
      "line-height": "1",
      "letter-spacing": "0.01em",
      "padding-left": `${box.px}px`,
      "padding-right": `${box.px}px`,
      cursor: known.disabled ? "not-allowed" : "pointer",
    };
  });

  const base = createMemo(() =>
    cn(
      "inline-flex items-center justify-center gap-1 whitespace-nowrap select-none transition-colors",
      known.disabled ? "opacity-50" : "",
      known.className,
    ),
  );

  const tone = createMemo(() => {
    if (isChecked()) {
      const t = checkedClasses(known.color);
      // `outline` keeps the body transparent: the hairline border carries the state.
      return cn(t.border, t.text, isOutline() ? "bg-transparent" : t.tint);
    }
    return "border-fin-border bg-transparent text-fin-text-muted hover:text-fin-text hover:border-fin-text-muted";
  });

  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={isChecked()}
      disabled={known.disabled}
      id={known.id}
      data-testid={known["data-testid"]}
      className={cn(base(), tone())}
      style={{ ...shape(), ...known.style }}
      onClick={handleClick}
    >
      <Show when={isChecked()}>
        <span aria-hidden="true" className="shrink-0 w-1 h-1 rounded-full bg-current" />
      </Show>
      {known.children ?? known.label}
    </button>
  );
}
