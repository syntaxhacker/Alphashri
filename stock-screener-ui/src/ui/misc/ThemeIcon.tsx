import { splitProps } from "solid-js";
import { cn } from "../cn";
import { sxTheme } from "../sxTheme";
import type { UIThemeIconProps } from "../types";

function toPx(size: UIThemeIconProps["size"]): string | undefined {
  if (size == null) return undefined;
  if (typeof size === "number") return `${size}px`;
  if (typeof size === "string" && !isNaN(Number(size))) return `${Number(size)}px`;
  const m: Record<string, string> = { xs: "20px", sm: "28px", md: "36px", lg: "48px", xl: "56px" };
  return m[size as string];
}

function _radiusValue(radius: UIThemeIconProps["radius"]): string {
  if (radius == null) return "6px";
  if (typeof radius === "number") return `${radius}px`;
  if (radius === "xs") return "4px";
  if (radius === "xl") return "16px";
  return "6px";
}

function resolveColor(color?: string): { main: string; dark: string } {
  const primaryDark = sxTheme.palette.primary.contrastText ?? sxTheme.palette.primary.main;
  const primary = { main: sxTheme.palette.primary.main, dark: primaryDark };
  if (!color) return primary;
  if (color.startsWith("#") || color.startsWith("rgb")) return { main: color, dark: color };
  const key = color.split(".")[0];
  const entry = (sxTheme.palette as Record<string, { main?: string; contrastText?: string; dark?: string }>)[key];
  if (entry) {
    return {
      main: entry.main ?? color,
      dark: entry.contrastText ?? entry.dark ?? entry.main ?? color,
    };
  }
  return { main: color, dark: color };
}

export function ThemeIcon(props: UIThemeIconProps) {
  const [known, _rest] = splitProps(props, [
    "variant",
    "color",
    "size",
    "radius",
    "children",
    "className",
    "style",
    "data-testid",
    "id",
  ]);

  const { main, dark } = resolveColor(known.color as string);
  const px = toPx(known.size);

  const baseSize = px != null ? { width: px, height: px, fontSize: `${Number(px.replace("px", "")) * 0.5}px` } : { width: "36px", height: "36px", fontSize: "18px" };

  let backgroundColor: string | undefined;
  let colorValue: string | undefined;
  const isFilled = known.variant === "filled";
  switch (known.variant) {
    case "filled":
      backgroundColor = dark;
      break;
    case "outline":
      backgroundColor = "transparent";
      colorValue = dark;
      break;
    case "white":
    case "default":
      backgroundColor = sxTheme.palette.background.paper;
      colorValue = dark;
      break;
    default:
      // subtle filled tint (was `alpha(main, 0.11)`)
      backgroundColor = main;
      colorValue = dark;
      break;
  }

  return (
    <span
      className={cn("inline-flex items-center justify-center shrink-0", isFilled ? "text-white" : "", `rounded-[${borderRadius}]`, known.className)}
      style={{ ...baseSize, borderRadius, backgroundColor, color: isFilled ? undefined : colorValue, ...known.style }}
      id={known.id}
      data-testid={known["data-testid"]}
    >
      {known.children}
    </span>
  );
}
