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
    case "xs": return "px-2 py-0.5 text-xs leading-none shrink-0";
    case "sm": return "px-2.5 py-0.5 text-sm leading-none shrink-0";
    case "md": return "px-3 py-1 text-sm leading-none shrink-0";
    case "lg": return "px-3.5 py-1.5 text-base leading-none shrink-0";
    case "xl": return "px-4 py-1.5 text-base leading-none shrink-0";
    default: return "px-2.5 py-0.5 text-sm leading-none shrink-0";
  }
}

export function Badge({
  children,
  leftSection,
  rightSection,
  className,
  style,
  "data-testid": testId,
  id,
  variant,
  color,
  size,
  radius,
  fullWidth,
  onClick,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: UIBadgeProps) {
  const main = resolveColor(color);
  const isFilled = variant === "filled" || variant === "white";
  const isOutline = variant === "outline" || variant === "default";
  const br = radiusValue(radius);

  let bg: string | undefined;
  let borderColor: string | undefined;
  let textColor: string | undefined;
  if (isFilled) {
    // solid bg + contrast (near-black) text, matches MUI contrastText
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
      data-testid={testId}
      id={id}
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap font-semibold border",
        br ? undefined : "rounded-fin",
        fullWidth ? "w-full" : "",
        badgeSizeClasses(size),
        className
      )}
      style={{
        borderRadius: br,
        backgroundColor: bg,
        border: borderColor ? `1px solid ${borderColor}` : undefined,
        color: textColor,
        ...style,
      }}
      onClick={onClick as never}
      onMouseEnter={onMouseEnter as never}
      onMouseLeave={onMouseLeave as never}
      {...rest}
    >
      {leftSection != null && <span className="shrink-0">{leftSection}</span>}
      <span>{children}</span>
      {rightSection != null && <span className="shrink-0">{rightSection}</span>}
    </span>
  );
}
