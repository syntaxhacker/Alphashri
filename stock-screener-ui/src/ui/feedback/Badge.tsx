import { splitProps } from "solid-js";
import { cn } from "../cn";
import * as palette from "../palette";
import type { UIBadgeProps } from "../types";

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

function resolveColor(color: UIBadgeProps["color"]): string {
  if (!color) return palette.PRIMARY;
  if (color.startsWith("#") || color.startsWith("rgb") || color.startsWith("hsl")) return color;
  return COLOR_MAIN[color] ?? palette.PRIMARY;
}

function hexRgb(hex: string): string {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
  return `${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}`;
}

function radiusValue(radius: UIBadgeProps["radius"] | undefined): string | undefined {
  if (radius == null) return undefined;
  if (typeof radius === "number") return `${radius}px`;
  const m: Record<string, string> = { xs: "4px", sm: "6px", md: "8px", lg: "12px", xl: "16px" };
  return m[radius] ?? undefined;
}

function badgeSizeClasses(size: UIBadgeProps["size"]): string {
  switch (size) {
    case "xs":
      return "px-2 py-0.5 text-xs leading-none shrink-0";
    case "sm":
      return "px-2.5 py-0.5 text-sm leading-none shrink-0";
    case "md":
      return "px-3 py-1 text-sm leading-none shrink-0";
    case "lg":
      return "px-3.5 py-1.5 text-base leading-none shrink-0";
    case "xl":
      return "px-4 py-1.5 text-base leading-none shrink-0";
    default:
      return "px-2.5 py-0.5 text-sm leading-none shrink-0";
  }
}

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
  ]);

  const main = resolveColor(known.color);
  const isFilled = known.variant === "filled" || known.variant === "white";
  const isOutline = known.variant === "outline" || known.variant === "default";
  const br = radiusValue(known.radius);

  let bg: string | undefined;
  let borderColor: string | undefined;
  let textColor: string | undefined;
  if (isFilled) {
    // solid bg + contrast (near-black palette.BG) text
    bg = main;
    borderColor = main;
    textColor = palette.BG;
  } else if (isOutline) {
    bg = "transparent";
    borderColor = main;
    textColor = main;
  } else {
    // light / subtle / transparent / default-light: tinted bg + border
    const rgb = hexRgb(main);
    bg = `rgba(${rgb}, 0.12)`;
    borderColor = `rgba(${rgb}, 0.40)`;
    textColor = main;
  }

  return (
    <span
      data-testid={known["data-testid"]}
      id={known.id}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap font-semibold border",
        br ? undefined : "rounded-fin",
        known.fullWidth ? "w-full" : "",
        badgeSizeClasses(known.size),
        known.className
      )}
      style={{
        "border-radius": br,
        "background-color": bg,
        border: borderColor ? `1px solid ${borderColor}` : undefined,
        color: textColor,
        ...known.style,
      }}
      onClick={(e) => known.onClick?.(e)}
      onMouseEnter={(e) => known.onMouseEnter?.(e)}
      onMouseLeave={(e) => known.onMouseLeave?.(e)}
    >
      <Show when={known.leftSection != null}>
        <span className="shrink-0">{known.leftSection}</span>
      </Show>
      <span>{known.children}</span>
      <Show when={known.rightSection != null}>
        <span className="shrink-0">{known.rightSection}</span>
      </Show>
    </span>
  );
}
