import { splitProps } from "solid-js";
import { cn } from "../cn";
import { sxTheme } from "../sxTheme";
import { alpha } from "../palette";
import { TYPE_SCALE, typeSize } from "../typography";
import { pickTextColor } from "@/utils/contrast";
import type { UIThemeIconProps } from "../types";

const SCALE_STEPS = Object.values(TYPE_SCALE).map((s) => s.size);

/** Decorative glyph: half the icon box, snapped to the shared ladder, never < 12px. */
function snapTypeSize(px: number): number {
  const nearest = SCALE_STEPS.reduce(
    (best, step) => (Math.abs(step - px) <= Math.abs(best - px) ? step : best),
    SCALE_STEPS[0],
  );
  return Math.max(typeSize("micro"), nearest);
}

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
  if (color.startsWith("#") || color.startsWith("rgb")) {
    return { main: color, dark: pickTextColor(color) };
  }
  const key = color.split(".")[0];
  const entry = (sxTheme.palette as unknown as Record<string, { main?: string; contrastText?: string; dark?: string }>)[key];
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
  const borderRadius = _radiusValue(known.radius);

  const boxPx = px != null ? Number(px.replace("px", "")) : 36;
  const baseSize = { width: px ?? "36px", height: px ?? "36px", "font-size": `${snapTypeSize(boxPx * 0.5)}px` };
  const tint = (fill: string) =>
    fill.startsWith("#") ? alpha(fill, 0.12) : `color-mix(in srgb, ${fill} 12%, transparent)`;

  let backgroundColor: string | undefined;
  let colorValue: string | undefined;
  switch (known.variant) {
    case "filled":
      backgroundColor = main;
      colorValue = dark;
      break;
    case "outline":
      backgroundColor = "transparent";
      colorValue = main;
      break;
    case "white":
      backgroundColor = sxTheme.palette.background.paper;
      colorValue = main;
      break;
    case "default":
      backgroundColor = tint(main);
      colorValue = main;
      break;
    default:
      backgroundColor = tint(main);
      colorValue = main;
      break;
  }

  return (
    <span
      className={cn("inline-flex items-center justify-center shrink-0", known.className)}
      style={{
        ...baseSize,
        "border-radius": borderRadius,
        "background-color": backgroundColor,
        color: colorValue,
        ...(known.style as Record<string, string | undefined>),
      }}
      id={known.id}
      data-testid={known["data-testid"]}
    >
      {known.children}
    </span>
  );
}
