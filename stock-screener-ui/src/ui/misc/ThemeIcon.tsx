import Box from "@mui/material/Box";
import { alpha, useTheme } from "@mui/material/styles";
import type { UIThemeIconProps } from "../types";

function useResolveColor(color?: string): { main: string; dark: string } {
  const theme = useTheme();
  const palette = theme.palette as unknown as Record<string, { main: string; dark: string }>;
  const fallback = palette.primary ?? { main: theme.palette.primary.main, dark: theme.palette.primary.dark };
  if (!color) return fallback;
  if (color.startsWith("#") || color.startsWith("rgb")) return { main: color, dark: color };
  const key = color.split(".")[0];
  const entry = palette[key];
  if (entry?.main) return entry;
  // fallback to direct color
  return { main: color, dark: color };
}

function toPx(size: UIThemeIconProps["size"]): number | undefined {
  if (size == null) return undefined;
  if (typeof size === "number") return size;
  if (typeof size === "string" && !isNaN(Number(size))) return Number(size);
  const m: Record<string, number> = { xs: 20, sm: 28, md: 36, lg: 48, xl: 56 };
  return m[size as string];
}

export function ThemeIcon({ variant, color, size, radius, children, className, style, "data-testid": testId, id, ...rest }: UIThemeIconProps) {
  const { main, dark } = useResolveColor(color as string);
  const px = toPx(size);
  const br =
    radius != null
      ? typeof radius === "number"
        ? `${radius}px`
        : radius === "xs"
          ? "4px"
          : radius === "xl"
            ? "16px"
            : "6px"
      : "6px";

  const sx: Record<string, unknown> = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    ...(px != null ? { width: px, height: px, fontSize: px * 0.5 } : { width: 36, height: 36 }),
    borderRadius: br,
    ...(variant === "filled"
      ? { bgcolor: dark, color: "common.white" }
      : variant === "outline"
        ? { bgcolor: "transparent", color: dark }
        : variant === "white"
          ? { bgcolor: "background.paper", color: dark }
          : variant === "default"
            ? { bgcolor: "background.paper", color: dark }
            : { bgcolor: alpha(main, 0.11), color: dark }),
  };

  return (
    <Box className={className} style={style} id={id} data-testid={testId} sx={sx} {...(rest as Record<string, unknown>)}>
      {children}
    </Box>
  );
}
