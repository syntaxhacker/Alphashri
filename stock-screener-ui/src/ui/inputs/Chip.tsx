import { useState, useCallback } from "react";
import MuiChip from "@mui/material/Chip";
import type { UIChipProps } from "../types";

function mapSize(size: UIChipProps["size"]): "small" | "medium" {
  switch (size) {
    case "xs":
    case "sm":
      return "small";
    case "md":
    case "lg":
    case "xl":
    default:
      return "medium";
  }
}

function mapColor(color: UIChipProps["color"]): "primary" | "secondary" | "success" | "error" | "warning" | "info" | "default" {
  if (!color) return "default";
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
    default:
      return "default";
  }
}

export function Chip({
  checked,
  defaultChecked,
  onChange,
  disabled,
  size,
  color,
  variant,
  value: _value,
  children,
  className,
  style,
  "data-testid": testId,
  id,
  onClick,
  ...rest
}: UIChipProps) {
  const isControlled = checked !== undefined;
  const [internalChecked, setInternalChecked] = useState<boolean>(defaultChecked ?? false);
  const isChecked = isControlled ? (checked as boolean) : internalChecked;

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return;
      onClick?.(e as never);
      const next = !isChecked;
      if (!isControlled) setInternalChecked(next);
      onChange?.(next);
    },
    [disabled, isChecked, isControlled, onChange, onClick],
  );

  const muiSize = mapSize(size);
  const muiColor = mapColor(color);

  // variant mapping: filled -> filled when checked, light -> filled subtle, outline -> outlined
  // Use MUI Chip variant accordingly: checked -> filled, unchecked -> outlined
  const muiVariant: "filled" | "outlined" = (() => {
    if (variant === "outline") return "outlined";
    if (variant === "light") return isChecked ? "filled" : "outlined";
    // filled (default)
    return isChecked ? "filled" : "outlined";
  })();

  const sx: Record<string, unknown> = {
    cursor: disabled ? "default" : "pointer",
    ...(style ? { ...style } : {}),
  };

  return (
    <MuiChip
      label={children}
      clickable={!disabled}
      disabled={disabled}
      size={muiSize}
      color={isChecked ? muiColor : "default"}
      variant={muiVariant}
      onClick={handleClick}
      className={className}
      style={undefined}
      id={id}
      data-testid={testId}
      sx={sx}
      {...rest}
    />
  );
}
