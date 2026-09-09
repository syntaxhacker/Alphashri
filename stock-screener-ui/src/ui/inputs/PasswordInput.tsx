import { useState } from "react";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import IconButton from "@mui/material/IconButton";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import type { UIPasswordInputProps } from "../types";

function mapSize(size?: UIPasswordInputProps["size"]): "small" | "medium" {
  return size === "xs" || size === "sm" ? "small" : "medium";
}

export function PasswordInput({
  value,
  defaultValue,
  onChange,
  visibilityToggleButtonLabel,
  visible: controlledVisible,
  onVisibilityChange,
  label,
  description,
  error,
  required,
  disabled,
  size,
  placeholder,
  leftSection,
  rightSection,
  className,
  style,
  "data-testid": testId,
  ...rest
}: UIPasswordInputProps) {
  const muiSize = mapSize(size);
  const isError = Boolean(error);
  const helperText = isError
    ? typeof error === "string"
      ? error
      : String(error ?? "")
    : (description as string | undefined);

  const [internalVisible, setInternalVisible] = useState(false);
  const isControlled = controlledVisible !== undefined;
  const visible = isControlled ? controlledVisible : internalVisible;

  const handleToggle = () => {
    const next = !visible;
    if (!isControlled) setInternalVisible(next);
    onVisibilityChange?.(next);
  };

  return (
    <TextField
      value={value}
      defaultValue={defaultValue}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      label={label as string | undefined}
      placeholder={placeholder}
      helperText={helperText}
      error={isError}
      required={required}
      disabled={disabled}
      size={muiSize}
      type={visible ? "text" : "password"}
      fullWidth
      className={className}
      style={style as React.CSSProperties}
      data-testid={testId}
      slotProps={{
        input: {
          startAdornment: leftSection ? (
            <InputAdornment position="start">{leftSection}</InputAdornment>
          ) : undefined,
          endAdornment: (
            <InputAdornment position="end" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              {rightSection}
              <IconButton
                aria-label={visibilityToggleButtonLabel ?? "Toggle password visibility"}
                onClick={handleToggle}
                edge="end"
                size="small"
                disabled={disabled}
              >
                {visible ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
      sx={{ "& .MuiInputBase-root": { bgcolor: "background.paper" } }}
      {...(rest as object)}
    />
  );
}
