import Box from "@mui/material/Box";
import { alpha } from "@mui/material/styles";
import type { UIThemeIconProps } from "../types";

function resolveColor(color?: string): { main: string; dark: string } {
  const map: Record<string, { main: string; dark: string }> = {
    teal: { main: "#0FAE99", dark: "#0C8575" },
    green: { main: "#16A34A", dark: "#14532D" },
    red: { main: "#DC2626", dark: "#7F1D1D" },
    orange: { main: "#D97706", dark: "#78350F" },
    blue: { main: "#2563EB", dark: "#1D4ED8" },
    gray: { main: "#64748B", dark: "#475569" },
    dark: { main: "#1E293B", dark: "#0F172A" },
    yellow: { main: "#D97706", dark: "#78350F" },
    violet: { main: "#8250DF", dark: "#4E2A8F" },
    pink: { main: "#E64980", dark: "#9c36b5" },
    cyan: { main: "#0891B2", dark: "#164E63" },
  };
  if (!color) return { main: "#2563EB", dark: "#1D4ED8" };
  return map[color] ?? { main: color, dark: color };
}

function toPx(size: UIThemeIconProps["size"]): number | undefined {
  if (size == null) return undefined;
  if (typeof size === "number") return size;
  if (typeof size === "string" && !isNaN(Number(size))) return Number(size);
  const m: Record<string, number> = { xs: 20, sm: 28, md: 36, lg: 48, xl: 56 };
  return m[size as string];
}

export function ThemeIcon({ variant, color, size, radius, children, className, style, "data-testid": testId, id, ...rest }: UIThemeIconProps) {
  const { main, dark } = resolveColor(color as string);
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
      ? { bgcolor: dark, color: "#fff" }
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
