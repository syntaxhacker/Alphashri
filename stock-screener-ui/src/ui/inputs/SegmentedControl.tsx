import { useState, useCallback } from "react";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import ToggleButton from "@mui/material/ToggleButton";
import Box from "@mui/material/Box";
import type { UISegmentedControlProps } from "../types";

type NormalizedItem = { value: string; label: string; disabled?: boolean };

function normalize(data: UISegmentedControlProps["data"]): NormalizedItem[] {
  return (data ?? []).map((item) => (typeof item === "string" ? { value: item, label: item } : item));
}

function mapSize(size: UISegmentedControlProps["size"]): "small" | "medium" | "large" {
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

export function SegmentedControl({
  value,
  defaultValue,
  onChange,
  data,
  color: _color,
  size,
  fullWidth,
  withItemsBorders: _withItemsBorders,
  className,
  style,
  "data-testid": testId,
  id,
  ...rest
}: UISegmentedControlProps) {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<string | undefined>(defaultValue);
  const current = isControlled ? value : internal;
  const muiSize = mapSize(size);
  const items = normalize(data);

  const handleChange = useCallback(
    (_: React.MouseEvent<HTMLElement>, newValue: string | null) => {
      if (newValue === null) return;
      if (!isControlled) setInternal(newValue);
      onChange?.(newValue);
    },
    [isControlled, onChange],
  );

  const sx: Record<string, unknown> = {
    ...(fullWidth ? { width: "100%", display: "flex" } : {}),
    ...(style ? { ...style } : {}),
  };

  return (
    <Box className={className} id={id} data-testid={testId} sx={sx} {...rest}>
      <ToggleButtonGroup
        value={current ?? null}
        exclusive
        onChange={handleChange}
        size={muiSize}
        fullWidth={fullWidth}
        color="primary"
        sx={{ ...(fullWidth ? { width: "100%" } : {}) }}
      >
        {items.map((item) => (
          <ToggleButton key={item.value} value={item.value} disabled={item.disabled} sx={{ textTransform: "none", flex: fullWidth ? 1 : undefined }}>
            {item.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}
