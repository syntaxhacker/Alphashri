import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";
import { alpha, useTheme } from "@mui/material/styles";
import { TEXT_MUTED, SCALE_DARK, TEXT } from "@/ui/palette";
import type { UIBadgeProps } from "../types";

function mapColor(color: UIBadgeProps["color"]): string {
  if (!color) return "primary";
  switch (color) {
    case "success":
      return "success";
    case "error":
    case "danger":
      return "error";
    case "warning":
      return "warning";
    case "info":
      return "info";
    case "secondary":
      return "secondary";
    case "primary":
      return "primary";
    case "default":
    case "neutral":
    case "dimmed":
      return "secondary";
    default:
      return "secondary";
  }
}

function mapSize(size: UIBadgeProps["size"]): "small" | "medium" {
  if (!size) return "small";
  switch (size) {
    case "xs":
    case "sm":
      return "small";
    case "lg":
    case "xl":
      return "medium";
    default:
      return "small";
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
  const theme = useTheme();
  const muiColor = mapColor(color);
  const muiSize = mapSize(size);

  // Resolve palette color (fallback to secondary -> grey for default)
  const palette: Record<string, { main: string; dark: string; contrastText: string }> = theme.palette as never;
  const isDefault = color === "default" || color === "neutral" || color === "dimmed";
  const grey = (theme.palette as any).grey;
  const pal = isDefault
    ? { main: grey?.[600] ?? TEXT_MUTED, dark: grey?.[700] ?? SCALE_DARK[4], contrastText: TEXT }
    : ((palette[muiColor] as { main: string; dark: string; contrastText: string } | undefined) ?? palette.primary);

  const isFilled = variant === "filled" || variant === "white";
  const isOutline = variant === "outline" || variant === "default";

  const sx: Record<string, unknown> = {
    ...(fullWidth ? { width: "100%" } : {}),
    ...(radius != null
      ? {
          borderRadius:
            typeof radius === "number"
              ? `${radius}px`
              : radius === "xs"
                ? "4px"
                : radius === "sm"
                  ? "6px"
                  : radius === "md"
                    ? "8px"
                    : radius === "lg"
                      ? "12px"
                      : radius === "xl"
                        ? "16px"
                        : undefined,
        }
      : {}),
    fontWeight: 600,
    ...(style ? { ...style } : {}),
  };

  if (isFilled) {
    // WCAG AA: dark bg + light text, uses contrastThreshold 4.5 already in theme
    Object.assign(sx, {
      bgcolor: pal.dark,
      color: pal.contrastText,
      border: `1px solid ${pal.dark}`,
    });
  } else if (isOutline) {
    Object.assign(sx, {
      bgcolor: "transparent",
      color: pal.main,
      border: `1px solid ${pal.main}`,
    });
  } else {
    // light / subtle / transparent / default light variant: tinted bg + the
    // brighter palette shade so text stays readable on dark surfaces (WCAG AA).
    Object.assign(sx, {
      bgcolor: alpha(pal.main, 0.15),
      color: pal.main,
      border: `1px solid ${alpha(pal.main, 0.35)}`,
    });
  }

  const label = (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
      {leftSection}
      <span>{children}</span>
      {rightSection}
    </Box>
  );

  return (
    <Chip
      label={label}
      size={muiSize}
      variant={isOutline ? "outlined" : "filled"}
      className={className}
      style={undefined}
      id={id}
      data-testid={testId}
      onClick={onClick as never}
      onMouseEnter={onMouseEnter as never}
      onMouseLeave={onMouseLeave as never}
      sx={sx}
      {...(rest as Record<string, unknown>)}
    />
  );
}
