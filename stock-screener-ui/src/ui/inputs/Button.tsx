import MuiButton from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import type { UIButtonProps } from "../types";

function mapVariant(variant: UIButtonProps["variant"]): "contained" | "outlined" | "text" {
  switch (variant) {
    case "filled":
    case "white":
      return "contained";
    case "light":
      return "contained";
    case "outline":
    case "default":
      return "outlined";
    case "subtle":
    case "transparent":
      return "text";
    default:
      return "contained";
  }
}

function mapSize(size: UIButtonProps["size"]): "small" | "medium" | "large" {
  switch (size) {
    case "xs":
    case "sm":
      return "small";
    case "lg":
    case "xl":
      return "large";
    case "md":
    default:
      return "medium";
  }
}

function mapColor(color: UIButtonProps["color"]): "primary" | "secondary" | "success" | "error" | "warning" | "info" {
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

export function Button({
  children,
  leftSection,
  rightSection,
  className,
  style,
  onClick,
  "data-testid": testId,
  variant,
  color,
  size,
  radius,
  fullWidth,
  disabled,
  loading,
  type,
  id,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: UIButtonProps) {
  const muiVariant = mapVariant(variant);
  const muiSize = mapSize(size);
  const muiColor = mapColor(color);

  // MUI light/white need softer sx override; keep contained but lower emphasis via sx if needed
  const sx: Record<string, unknown> = {
    ...(fullWidth ? { width: "100%" } : {}),
    ...(radius != null ? { borderRadius: typeof radius === "number" ? radius : undefined } : {}),
    ...(style ? { ...style } : {}),
  };

  // For light variant mimic subtle filled with opacity
  const extraSx =
    variant === "light"
      ? { opacity: 0.9, "&:hover": { opacity: 1 } }
      : variant === "white"
        ? { bgcolor: "background.paper", color: "text.primary" }
        : {};

  return (
    <MuiButton
      variant={muiVariant}
      color={muiColor}
      size={muiSize}
      disabled={disabled || loading}
      fullWidth={fullWidth}
      type={type}
      id={id}
      className={className}
      data-testid={testId}
      data-loading={loading || undefined}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      startIcon={leftSection ?? (loading ? <CircularProgress size={14} color="inherit" /> : undefined)}
      endIcon={rightSection}
      sx={{ ...sx, ...extraSx }}
      {...rest}
    >
      {children}
    </MuiButton>
  );
}
