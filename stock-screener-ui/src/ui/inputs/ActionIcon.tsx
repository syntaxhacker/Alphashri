import IconButton from "@mui/material/IconButton";
import CircularProgress from "@mui/material/CircularProgress";
import type { UIActionIconProps } from "../types";

function mapSize(size: UIActionIconProps["size"]): "small" | "medium" | "large" {
  if (size == null) return "medium";
  if (typeof size === "number") return size <= 28 ? "small" : size >= 36 ? "large" : "medium";
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

function mapColor(color: UIActionIconProps["color"]): "primary" | "secondary" | "success" | "error" | "warning" | "info" | "default" {
  if (!color) return "default";
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
      return "default";
  }
}

export function ActionIcon({
  children,
  className,
  style,
  onClick,
  "data-testid": testId,
  variant,
  color,
  size,
  radius,
  disabled,
  loading,
  id,
  onMouseEnter,
  onMouseLeave,
  ...rest
}: UIActionIconProps) {
  const muiSize = mapSize(size);
  const muiColor = mapColor(color);

  const sx: Record<string, unknown> = {
    ...(radius != null
      ? { borderRadius: typeof radius === "number" ? `${radius}px` : radius === "xs" ? "4px" : radius === "xl" ? "16px" : undefined }
      : {}),
    ...(style ? { ...style } : {}),
  };

  // variant subtle/transparent -> text-like, light -> contained-like, outline/default -> no border (elevation only)
  if (variant === "filled") {
    Object.assign(sx, { bgcolor: "primary.main", color: "primary.contrastText", "&:hover": { bgcolor: "primary.dark" } });
  } else if (variant === "light") {
    Object.assign(sx, { bgcolor: "action.selected", "&:hover": { bgcolor: "action.hover" } });
  }

  return (
    <IconButton
      size={muiSize}
      color={muiColor as never}
      disabled={disabled || loading}
      id={id}
      className={className}
      data-testid={testId}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      sx={sx}
      {...rest}
    >
      {loading ? <CircularProgress size={14} color="inherit" /> : children}
    </IconButton>
  );
}
