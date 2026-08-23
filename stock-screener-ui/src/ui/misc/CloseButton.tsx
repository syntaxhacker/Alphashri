import IconButton from "@mui/material/IconButton";
import CloseIcon from "@mui/icons-material/Close";
import type { UICloseButtonProps } from "../types";

function mapSize(size: UICloseButtonProps["size"]): "small" | "medium" | "large" {
  if (size == null) return "medium";
  if (typeof size === "number") return size <= 24 ? "small" : size >= 36 ? "large" : "medium";
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

export function CloseButton({ size, variant, disabled, onClick, className, style, "data-testid": testId, id, ...rest }: UICloseButtonProps) {
  const muiSize = mapSize(size);
  const sx: Record<string, unknown> = {
    ...(variant === "filled"
      ? { bgcolor: "action.selected", "&:hover": { bgcolor: "action.hover" } }
      : variant === "light"
        ? { bgcolor: "action.hover", "&:hover": { bgcolor: "action.selected" } }
        : variant === "outline"
          ? { border: 1, borderColor: "divider" }
          : variant === "transparent"
            ? { bgcolor: "transparent" }
            : {}),
  };

  return (
    <IconButton
      size={muiSize}
      disabled={disabled}
      onClick={onClick as never}
      aria-label="close"
      className={className}
      style={style}
      id={id}
      data-testid={testId}
      sx={sx}
      {...(rest as Record<string, unknown>)}
    >
      <CloseIcon fontSize={muiSize === "small" ? "small" : "medium"} />
    </IconButton>
  );
}
