import { Show, splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import type { UIBadgeProps } from "../types";

/**
 * Badge = a status label, never a control. It is deliberately smaller than a
 * Chip (16px vs 20px), shares the 4px radius, and carries no pointer cursor or
 * hover fill so it can never be mistaken for something clickable.
 * `variant="dot"` drops the pill chrome entirely — a dot plus inline text.
 */
const COLOR_MAIN: Record<string, string> = {
  primary: palette.PRIMARY,
  success: palette.POSITIVE_COLOR,
  error: palette.NEGATIVE_COLOR,
  danger: palette.NEGATIVE_COLOR,
  warning: palette.WARNING,
  info: palette.INFO,
  secondary: palette.TEXT_MUTED,
  default: palette.TEXT_MUTED,
  neutral: palette.TEXT_MUTED,
  dimmed: palette.TEXT_MUTED,
};

type BadgeBox = { h: number; font: number; px: number };

const BADGE_BOX: Record<string, BadgeBox> = {
  xs: { h: 14, font: 9, px: 4 },
  sm: { h: 16, font: 9, px: 5 },
  md: { h: 18, font: 9, px: 6 },
  lg: { h: 20, font: 10, px: 7 },
  xl: { h: 22, font: 10, px: 8 },
};

function badgeBox(size: UIBadgeProps["size"]): BadgeBox {
  return BADGE_BOX[String(size)] ?? BADGE_BOX.sm;
}

function resolveColor(color: UIBadgeProps["color"]): string {
  if (!color) return palette.PRIMARY;
  if (color.startsWith("#") || color.startsWith("rgb") || color.startsWith("hsl")) return color;
  return COLOR_MAIN[color] ?? palette.PRIMARY;
}

function radiusValue(radius: UIBadgeProps["radius"] | undefined): string {
  if (radius == null) return "4px";
  if (typeof radius === "number") return `${radius}px`;
  const m: Record<string, string> = { xs: "2px", sm: "4px", md: "4px", lg: "6px", xl: "8px" };
  return m[radius] ?? "4px";
}

const DOT_SIZE = 5;

export function Badge(props: UIBadgeProps) {
  const [known, _rest] = splitProps(props, [
    "children",
    "leftSection",
    "rightSection",
    "className",
    "style",
    "data-testid",
    "id",
    "variant",
    "color",
    "size",
    "radius",
    "fullWidth",
    "onClick",
    "onMouseEnter",
    "onMouseLeave",
    "title",
  ]);

  const main = resolveColor(known.color);
  const isFilled = known.variant === "filled" || known.variant === "white";
  const isOutline = known.variant === "outline";
  const isDot = known.variant === "dot";
  const box = badgeBox(known.size);

  const shape = (): Record<string, string> => {
    if (isDot) {
      // Inline status: dot + text, no pill chrome at all.
      return {
        height: `${box.h}px`,
        "border-radius": "0px",
        "border-width": "0px",
        "border-style": "none",
        "background-color": "transparent",
        "font-size": `${box.font}px`,
        "font-weight": "600",
        "line-height": "1",
        "padding-left": "0px",
        "padding-right": "0px",
        cursor: "default",
      };
    }
    return {
      height: `${box.h}px`,
      "border-radius": radiusValue(known.radius),
      border: isOutline ? `1px solid ${main}` : "none",
      "background-color": isFilled ? main : isOutline ? "transparent" : palette.alpha(main, 0.12),
      "font-size": `${box.font}px`,
      "font-weight": "600",
      "line-height": "1",
      "padding-left": `${box.px}px`,
      "padding-right": `${box.px}px`,
      cursor: "default",
    };
  };

  return (
    <span
      data-testid={known["data-testid"]}
      id={known.id}
      title={known.title}
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap font-mono uppercase select-none tracking-[0.04em]",
        known.fullWidth ? "w-full" : "shrink-0",
        known.className,
      )}
      style={{ ...shape(), color: isFilled ? palette.BG : main, ...known.style }}
      onClick={(e) => known.onClick?.(e)}
      onMouseEnter={(e) => known.onMouseEnter?.(e)}
      onMouseLeave={(e) => known.onMouseLeave?.(e)}
    >
      <Show when={isDot}>
        <span
          aria-hidden="true"
          className="shrink-0 rounded-full"
          style={{ width: `${DOT_SIZE}px`, height: `${DOT_SIZE}px`, "background-color": main }}
        />
      </Show>
      <Show when={!isDot && known.leftSection != null}>
        <span className="shrink-0">{known.leftSection}</span>
      </Show>
      <span>{known.children}</span>
      <Show when={!isDot && known.rightSection != null}>
        <span className="shrink-0">{known.rightSection}</span>
      </Show>
    </span>
  );
}
