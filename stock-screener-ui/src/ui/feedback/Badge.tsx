import Chip from "@mui/material/Chip";
import Box from "@mui/material/Box";
import { alpha, useTheme } from "@mui/material/styles";
import type { UIBadgeProps } from "../types";

function mapColor(color: UIBadgeProps["color"]): string {
  if (!color) return "primary";
  switch (color) {
    case "teal":
    case "green":
    case "success":
      return "success";
    case "red":
    case "danger":
      return "error";
    case "orange":
    case "yellow":
    case "warning":
      return "warning";
    case "cyan":
    case "violet":
    case "blue":
    case "pink":
      return "info";
    case "gray":
    case "dark":
      return "secondary";
    default:
      return "primary";
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

  // Resolve palette color (fallback to primary if unknown)
  const palette: Record<string, { main: string; dark: string; contrastText: string }> = theme.palette as never;
  const pal = (palette[muiColor] as { main: string; dark: string; contrastText: string } | undefined) ?? palette.primary;

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
      color: pal.dark,
      border: `1px solid ${pal.main}`,
    });
  } else {
    // light / subtle / transparent / default light variant: alpha bg + dark text (WCAG AA)
    Object.assign(sx, {
      bgcolor: alpha(pal.main, 0.11),
      color: pal.dark,
      border: `1px solid ${alpha(pal.main, 0.18)}`,
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
